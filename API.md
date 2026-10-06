# API

Base URL: `http://localhost:3000/api/v1` (prefix and version are both configurable; see `.env.example`). Interactive Swagger UI is served at `/api/docs` whenever the API is running.

## Response envelope

Every response, success or failure, uses the same shape (master doc §15):

```json
// Success
{ "success": true, "data": { ... }, "message": "Operation successful" }

// Failure
{ "success": false, "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." }, "correlationId": "..." }
```

`code` is a stable machine-readable string the frontend can branch on; `message` is human-readable and may change wording over time.

## Status codes in use

`400` validation failure · `401` unauthenticated / invalid or expired token · `403` authenticated but not permitted (e.g. role not allowed) · `404` not found **or** cross-tenant (see `/SECURITY.md`) · `409` conflict (duplicate email/slug) · `429` rate limited · `500` unexpected server error.

## Auth — `/api/v1/auth`

| Method & path | Auth | Notes |
|---|---|---|
| `POST /auth/register` | Public | **Bootstrap only.** Succeeds only when zero users exist; creates the first `SUPER_ADMIN`. Returns `403 REGISTRATION_CLOSED` afterward. |
| `POST /auth/login` | Public | Body: `{ email, password }`. Sets the refresh-token cookie; returns `{ accessToken, user }`. |
| `POST /auth/refresh` | Public (reads refresh cookie) | Rotates the refresh token; returns a new `{ accessToken }`. |
| `POST /auth/logout` | Public (reads refresh cookie) | Revokes the current refresh token; clears the cookie. |
| `GET /auth/me` | Any authenticated role | Returns the caller's own profile, including a nested `hospital: { id, name }` (or `null` for `SUPER_ADMIN`) — matches master doc §26's exact example shape. Note this differs from the `user` object returned by `/auth/login`/`/auth/register`/`/auth/refresh`, which only carries `hospitalId`. |

## Authorization model

Every route is gated by `@RequirePermissions(...)` (see `/ARCHITECTURE.md` and `/SECURITY.md`): the caller's role must explicitly hold the listed permission(s) in `ROLE_PERMISSIONS` (`common/constants/permissions.constants.ts`) — **no implicit `SUPER_ADMIN` bypass**. (Phase 1/2 had a second, simpler `@Roles()` mechanism with a `SUPER_ADMIN`-always-passes bypass; it was removed in Phase 3 once every module had migrated to permissions — see `/DECISIONS.md`.) A route with no `@RequirePermissions()` at all (`GET /hospitals/:id`, `GET /auth/me`) is open to any authenticated role, with the real check done by the service's tenant-scoping logic.

**The governing line for Phase 3 (master doc §14):** `SUPER_ADMIN` holds every `hospital.*`/`user.*`/`department.*`/`doctor.*` permission (platform administration and hospital org-structure) but **zero** `patient.*`/`appointment.*`/`queue.*` permission. A platform administrator has no legitimate reason to see a specific patient's record, book an appointment, or operate a live queue — that's clinical/operational data, not platform administration. See `/SECURITY.md`.

## Users — `/api/v1/users`

All routes: `SUPER_ADMIN` (platform-wide) or `HOSPITAL_ADMIN` (own tenant only) — enforced via `@RequirePermissions(Permission.USER_*)`.

| Method & path | Notes |
|---|---|
| `POST /users` | Create a user. `hospitalId` in the body is **required** when the caller is `SUPER_ADMIN` creating a non-`SUPER_ADMIN`, and **ignored** (server-derived) when the caller is `HOSPITAL_ADMIN`. A `HOSPITAL_ADMIN` cannot set `role: HOSPITAL_ADMIN` or `SUPER_ADMIN` (`403 ROLE_NOT_ALLOWED`). |
| `GET /users` | Lists users in the caller's tenant (or all tenants for `SUPER_ADMIN`). |
| `GET /users/:id` | `404 USER_NOT_FOUND` if the user doesn't exist *or* belongs to a different tenant. |
| `PATCH /users/:id` | Update `firstName`, `lastName`, `role`, `isActive`. Role-escalation guarded the same way as create. |

## Hospitals — `/api/v1/hospitals`

| Method & path | Auth | Notes |
|---|---|---|
| `POST /hospitals` | `SUPER_ADMIN` (`hospital.create`) | Creates a new tenant. `slug` must be unique, lowercase, hyphenated. |
| `GET /hospitals` | `SUPER_ADMIN` (`hospital.list`) | Lists every tenant on the platform. |
| `GET /hospitals/:id` | Any authenticated role | `SUPER_ADMIN` can fetch any hospital; anyone else only their own (`404` otherwise). No permission decorator — gated by the service-layer tenant check instead. |
| `PATCH /hospitals/:id` | `SUPER_ADMIN` (`hospital.update`) | Rename or deactivate a tenant. |

## Patients — `/api/v1/patients`

| Method & path | Permission | Notes |
|---|---|---|
| `POST /patients` | `patient.create` (`HOSPITAL_ADMIN`, `DOCTOR`, `NURSE`, `RECEPTIONIST`) | Registers a patient and issues a hospital-scoped MRN. `SUPER_ADMIN` cannot call this — no hospital context (`403 TENANT_CONTEXT_MISSING`). **Duplicate detection (Phase 3, master doc §22):** if an active patient already matches `phone` + `dateOfBirth`, returns `409 POTENTIAL_DUPLICATE_PATIENT` with the existing MRN in the message, unless the body includes `confirmDuplicate: true`. |
| `GET /patients` | `patient.read` (+ `PHARMACIST`, `LAB_TECHNICIAN`, `ACCOUNTANT`, read-only) | Paginated, tenant-filtered list. Supports `?search=` across name/MRN/phone, `?page=`, `?pageSize=`. `SUPER_ADMIN` has no `patient.read` permission at all — `403`, not just tenant-filtered to empty (see `/SECURITY.md`). |
| `GET /patients/:id` | `patient.read` | `404 PATIENT_NOT_FOUND` if the patient doesn't exist *or* belongs to a different tenant — no `SUPER_ADMIN` exception. |
| `PATCH /patients/:id` | `patient.update` | Updates demographic/contact fields and `isActive`; `mrn` is immutable. |

## Departments — `/api/v1/departments`

| Method & path | Permission | Notes |
|---|---|---|
| `POST /departments` | `department.create` (`HOSPITAL_ADMIN`, `SUPER_ADMIN`) | `hospitalId` required for `SUPER_ADMIN`, server-derived for `HOSPITAL_ADMIN` — same pattern as Users/Hospitals. `code`/`name` unique per hospital (`409 DEPARTMENT_IDENTIFIER_TAKEN`). |
| `GET /departments` | `department.read` (every staff role) | Tenant-filtered; `SUPER_ADMIN` sees all. |
| `GET /departments/:id` | `department.read` | `404 DEPARTMENT_NOT_FOUND` cross-tenant. |
| `PATCH /departments/:id` | `department.update` | `name`, `description`, `isActive`. `code` is immutable once set. No `DELETE` — deactivate instead (master doc §9/§61). |

## Doctors — `/api/v1/doctors`

| Method & path | Permission | Notes |
|---|---|---|
| `POST /doctors` | `doctor.create` (`HOSPITAL_ADMIN`, `SUPER_ADMIN`) | Attaches a professional profile to an **existing** `User` with `role=DOCTOR` (create the account via `POST /users` first — see `/DECISIONS.md`). `400 USER_NOT_A_DOCTOR` / `409 DOCTOR_PROFILE_ALREADY_EXISTS` / `409 REGISTRATION_NUMBER_TAKEN`. |
| `GET /doctors` | `doctor.read` | Filters: `?departmentId=`, `?specialization=`, `?status=`. |
| `GET /doctors/:id` | `doctor.read` | `404 DOCTOR_NOT_FOUND` cross-tenant. |
| `PATCH /doctors/:id` | `doctor.update` | `departmentId`, `specialization`, `registrationNumber`, `displayName`, `status` (`ACTIVE\|INACTIVE\|SUSPENDED`). Non-`ACTIVE` doctors stop appearing in available-slots and reject new bookings (`400 DOCTOR_INACTIVE`). |
| `POST /doctors/:id/schedules` | `doctor.schedule.manage` (`HOSPITAL_ADMIN`, `SUPER_ADMIN`, or the `DOCTOR` themself) | Weekly recurring slot `{ dayOfWeek, startTime, endTime, slotDurationMinutes }`. `400 INVALID_SCHEDULE_RANGE` / `409 SCHEDULE_OVERLAP` against the same doctor+day. A `DOCTOR` caller gets `403 FORBIDDEN` for any profile that isn't their own. |
| `GET /doctors/:id/schedules` | `doctor.read` | |
| `PATCH /schedules/:id` | `doctor.schedule.manage` | Flat route (not nested) per master doc §56. Same ownership/overlap rules as create. |
| `POST /doctors/:id/unavailability` | `doctor.schedule.manage` | One-off blocked range `{ startAt, endAt, reason? }` (absolute UTC instants — leave, holiday). `400 INVALID_UNAVAILABILITY_RANGE`. |
| `GET /doctors/:id/unavailability` | `doctor.read` | |
| `GET /doctors/:id/available-slots?date=YYYY-MM-DD` | `doctor.read` | **Computed, not persisted** — schedule minus unavailability minus already-booked appointments minus anything already in the past, in the hospital's timezone. Returns an array of ISO UTC instants. Empty for an `INACTIVE`/`SUSPENDED` doctor. |

## Appointments — `/api/v1/appointments`

State machine: `SCHEDULED → CONFIRMED → IN_QUEUE → IN_CONSULTATION → COMPLETED`, with `CANCELLED`/`NO_SHOW` reachable from the pre-consultation states. See `/SECURITY.md` for the full transition table — **no endpoint can move an appointment to an arbitrary status**; `PATCH` only ever touches `reason`.

| Method & path | Permission | Notes |
|---|---|---|
| `POST /appointments` | `appointment.create` | `{ patientId, doctorProfileId, scheduledAt, durationMinutes?, reason? }`. `scheduledAt` must exactly match a slot from `GET /doctors/:id/available-slots` (`400 SLOT_NOT_AVAILABLE`) — a race lost against a concurrent booking for the same slot returns `409 SLOT_ALREADY_BOOKED`, backed by a DB partial unique index, not just the pre-check (see `/DATABASE.md`). `SUPER_ADMIN` cannot call this (`403 TENANT_CONTEXT_MISSING`) — no clinical access. |
| `GET /appointments` | `appointment.read` | Paginated. Filters: `?doctorId=`, `?patientId=`, `?departmentId=`, `?date=YYYY-MM-DD`, `?status=`. |
| `GET /appointments/:id` | `appointment.read` | `404 APPOINTMENT_NOT_FOUND` cross-tenant. |
| `PATCH /appointments/:id` | `appointment.update` | `{ reason? }` only — see state-machine note above. `409 APPOINTMENT_NOT_EDITABLE` once `COMPLETED`/`CANCELLED`/`NO_SHOW`. |
| `POST /appointments/:id/cancel` | `appointment.cancel` | `{ reason? }`. Allowed from `SCHEDULED`/`CONFIRMED`/`CHECKED_IN`/`IN_QUEUE`; also cancels any linked `WAITING`/`CALLED` queue entry in the same transaction. `409 INVALID_APPOINTMENT_TRANSITION` otherwise (e.g. already `COMPLETED`). |
| `POST /appointments/:id/reschedule` | `appointment.reschedule` | `{ scheduledAt }` (new slot, validated the same way as create). The original is marked `CANCELLED` (`cancellationReason: "RESCHEDULED"`); a new appointment is created with `rescheduledFromId` pointing back at it — full history preserved, nothing overwritten (master doc §42/§43). Only allowed from `SCHEDULED`/`CONFIRMED`. |
| `POST /appointments/:id/no-show` | `appointment.update` | Only for a past `SCHEDULED`/`CONFIRMED` appointment (`400 APPOINTMENT_NOT_YET_DUE` if still in the future). |

## Queue — `/api/v1/queues` and `/api/v1/queue-entries`

State machine: `WAITING → CALLED → IN_CONSULTATION → COMPLETED`, with `SKIPPED`/`CANCELLED` reachable from `WAITING`/`CALLED`, and `SKIPPED → WAITING` via an explicit requeue (see `/DECISIONS.md` for why skip isn't terminal). Starting consultation and completing an entry synchronize the linked `Appointment`'s status in the same transaction.

| Method & path | Permission | Notes |
|---|---|---|
| `POST /queue-entries` | `queue.operate` | "Check in" — `{ appointmentId }`. Only from `SCHEDULED`/`CONFIRMED` (`409 INVALID_APPOINTMENT_TRANSITION` otherwise); `409 APPOINTMENT_ALREADY_IN_QUEUE` if one exists. Get-or-creates today's queue for that doctor, assigns the next token atomically, moves the appointment to `IN_QUEUE`. |
| `GET /queues` | `queue.read` | Filters: `?doctorId=`, `?departmentId=`, `?date=YYYY-MM-DD`. |
| `GET /queues/:id` | `queue.read` | Includes all entries, ordered by priority then arrival. |
| `POST /queues/:id/call-next` | `queue.operate` | Atomically claims the next `WAITING` entry (`FOR UPDATE SKIP LOCKED` — see `/DATABASE.md`) and moves it to `CALLED`. `409 NO_WAITING_PATIENTS` if the queue is empty right now — a controlled response, not a crash. |
| `POST /queue-entries/:id/skip` | `queue.operate` | From `WAITING` or `CALLED` → `SKIPPED`. |
| `POST /queue-entries/:id/requeue` | `queue.operate` | From `SKIPPED` → `WAITING` with a fresh token (reuses the same row — see `/DECISIONS.md`). |
| `POST /queue-entries/:id/start` | `queue.operate` | From `CALLED` → `IN_CONSULTATION`; syncs the linked appointment. |
| `POST /queue-entries/:id/complete` | `queue.operate` | From `IN_CONSULTATION` → `COMPLETED`; completes the linked appointment too. |
| `POST /queue-entries/:id/cancel` | `queue.operate` | From `WAITING`/`CALLED` → `CANCELLED`; cancels the linked appointment too. |

None of these grant `SUPER_ADMIN` any access (`queue.read`/`queue.operate` aren't in its permission set) — a live patient queue is operational/clinical data, same principle as Patients and Appointments.

## Health — `/api/v1/health`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /health` | Public | Checks live connectivity to Postgres (`SELECT 1` via Prisma) and Redis (`PING`). Returns Terminus's standard health-check shape (not wrapped in the success envelope, since monitoring tools expect the raw Terminus format). |

## Correlation IDs

Every response carries an `x-correlation-id` header — echoed from the request if the caller supplied one, generated otherwise. Include it when reporting a bug; it's what ties a client-visible error to the corresponding server log line and (where applicable) audit log row.

## Not yet implemented

Clinical notes, prescriptions, laboratory, radiology, pharmacy, billing, payments, insurance, AI, analytics, HospitalOS Connect public discovery, and patient-role self-service — all later-phase scope per the master roadmap (§3).
