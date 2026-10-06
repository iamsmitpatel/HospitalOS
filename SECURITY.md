# Security

This documents the controls actually implemented through Phase 3 — not a compliance claim. Per master doc §22: implementing these controls does not by itself make the platform HIPAA/compliant-with-anything; that requires a separate, explicit assessment.

## Authentication

- Passwords hashed with **bcrypt** (`BCRYPT_SALT_ROUNDS`, default 12). Never stored or logged in plaintext.
- Access tokens: JWT, short-lived (`JWT_ACCESS_TTL`, default 15m), returned in the response body, sent back by the client as `Authorization: Bearer <token>`.
- Refresh tokens: JWT, longer-lived (`JWT_REFRESH_TTL`, default 7d), set as an `httpOnly`, `secure` (in production), `sameSite=strict` cookie scoped to `/api/v1/auth` — never exposed to JavaScript, never returned in a JSON body.
- Every issued refresh token has a corresponding `RefreshToken` database row storing a **SHA-256 hash** of the token (not the raw value, not bcrypt — see `/DECISIONS.md` for why a fast deterministic hash is correct here).
- **Rotation**: every `/auth/refresh` call revokes the presented token and issues a new one, chaining `replacedByTokenId`.
- **Reuse detection**: presenting an already-revoked refresh token revokes *every* active session for that user and logs `REFRESH_TOKEN_REUSED` — treated as a signal of token theft, not a benign race.
- **Logout**: revokes the specific refresh token and clears the cookie. Idempotent — logging out twice, or with an already-invalid token, succeeds silently.
- Login failures (wrong password, unknown email, disabled account) all return the identical `INVALID_CREDENTIALS` error and are all audit-logged the same way, so an unauthenticated caller cannot distinguish "no such account" from "wrong password" from "disabled account."

## Authorization (RBAC + permission foundation)

Roles: `SUPER_ADMIN, HOSPITAL_ADMIN, DOCTOR, NURSE, RECEPTIONIST, PHARMACIST, LAB_TECHNICIAN, ACCOUNTANT, PATIENT`.

- `@RequirePermissions(...)` declares which permissions a route needs; `PermissionsGuard` checks them against `common/constants/permissions.constants.ts`'s `ROLE_PERMISSIONS` map. **No implicit `SUPER_ADMIN` bypass, ever** — a role passes only if its map entry explicitly lists every required permission. Every module uses this as of Phase 3.
- Phase 1/2 had a second mechanism, `@Roles()`/`RolesGuard`, with an implicit "`SUPER_ADMIN` always passes" bypass. It was **removed in Phase 3** once `patients/` (the last module still using it) migrated to `@RequirePermissions()` — at that point it was 100% dead code, run on every request for zero behavioral effect, and kept the bypass temptation available for any future module that reused it by copy-paste. See `/DECISIONS.md`.
- No `@RequirePermissions()` on a route means "any authenticated role" — used sparingly (`GET /auth/me`, `GET /hospitals/:id`), where the service layer does the real tenant check instead.
- Least privilege is enforced at the service layer beyond the route-level check: e.g. a `HOSPITAL_ADMIN` is blocked from creating another `HOSPITAL_ADMIN` or a `SUPER_ADMIN` (`ROLE_NOT_ALLOWED`), even though the route itself is open to `HOSPITAL_ADMIN`.

Permissions modeled as of Phase 3: `hospital.*`, `user.*`, `role.assign`, `department.*`, `doctor.*` (incl. `doctor.schedule.manage`), `patient.*`, `appointment.*`, `queue.read`/`queue.operate` — deliberately a small, explicit set (master doc §13: "do not implement hundreds of permissions prematurely"), not an attempt to model every future permission. `queue.operate` covers call-next/skip/requeue/start/complete/cancel as one permission rather than six.

### Platform administration vs. clinical/operational access (master doc §14)

`SUPER_ADMIN` is explicitly a **platform administration** role, not an implicit "can see everything" role. Phase 3 draws one consistent line across every module, not just Patients:

| Group | Modules | `SUPER_ADMIN` access |
|---|---|---|
| Platform administration | `hospital.*`, `user.*`, `role.assign` | Full, platform-wide |
| Org structure (judged administration-adjacent, not clinical) | `department.*`, `doctor.*` | Full, with explicit `hospitalId` (same pattern as Users/Hospitals) |
| Patient-touching operational/clinical data | `patient.*`, `appointment.*`, `queue.*` | **None at all** — not in `ROLE_PERMISSIONS[SUPER_ADMIN]`, and the services never special-case the role either |

For the third group this is enforced redundantly, on purpose:
1. `ROLE_PERMISSIONS[SUPER_ADMIN]` simply doesn't list any `patient.*`/`appointment.*`/`queue.*` permission, so `PermissionsGuard` rejects the request before it reaches a controller method.
2. Every service-layer tenant check for those three modules uses the **strict** variant (`assertSameTenantStrict` / an unconditional `actor.hospitalId` requirement — see `common/utils/tenant.util.ts`), which has no `SUPER_ADMIN` branch at all, unlike the Department/Doctor/User/Hospital checks (`assertSameTenant`, which does special-case `SUPER_ADMIN` for cross-hospital platform administration).

This is the direct continuation of the Phase 2 fix: before that fix, `patients.service.ts`'s `findAllForTenant`/`getTenantScopedPatientOrThrow` skipped the `hospitalId` filter for `SUPER_ADMIN`, letting a platform administrator list or fetch *any* patient in *any* hospital. Phase 3 applies the same no-bypass discipline to the two new patient-touching modules (Appointments, Queue) from the start, rather than having to fix the same bug twice.

## Tenant isolation

This is the control the master doc treats as non-negotiable (§8, §9, §30), so it's worth being explicit about the mechanism:

1. A user's `hospitalId` is resolved once, at login, from the database — never from client input — and embedded in the signed access token.
2. Every tenant-scoped service method receives the authenticated user (via `@CurrentUser()`) and uses `actor.hospitalId`, never a client-supplied `hospitalId`, to decide what the caller may write or which tenant a new record belongs to. See `users.service.ts#resolveTargetHospitalId` for the concrete logic, and the `tenant-isolation.e2e-spec.ts` test "a HOSPITAL_ADMIN cannot plant a user into a different hospital via the request body" for proof the client-supplied value is actually ignored, not just validated.
3. Reads of a specific resource by ID (`GET /users/:id`, `GET /hospitals/:id`) check `resource.hospitalId === actor.hospitalId` (or `actor.role === SUPER_ADMIN`) and return **404**, not 403, on mismatch — see `/DECISIONS.md` for the reasoning (avoid confirming the resource exists in a tenant the caller can't see).
4. List endpoints (`GET /users`) filter by `actor.hospitalId` at the database query level (`where: { hospitalId: actor.hospitalId }`), not by filtering an unscoped result set after the fact.

This is exercised end-to-end by `apps/api/test/tenant-isolation.e2e-spec.ts` (Users/Hospitals, Phase 2) and `apps/api/test/operations-tenant-isolation.e2e-spec.ts` (Phase 3 — Department, Doctor, Patient, Appointment, Queue, plus a bidirectional A→B/B→A check and a `Role.PATIENT`-is-denied-everything check), both implementing the A/B matrix the master doc requires (§30, §65). Unit-test coverage of the same tenant-check logic exists per-module too (`*.service.spec.ts`, 96 tests total) — see `/TESTING.md` for what's actually been executed versus just written.

## Appointment state machine (master doc §31/§32)

`appointments.service.ts`'s `ALLOWED_TRANSITIONS` is the single source of truth for which status changes are legal — no endpoint, including `PATCH /appointments/:id`, can move an appointment to an arbitrary status (that endpoint only ever touches `reason`). Every status-changing endpoint calls `assertTransitionAllowed(current, target)` before writing.

```
SCHEDULED ──► CONFIRMED ──► IN_QUEUE ──► IN_CONSULTATION ──► COMPLETED
    │              │             │
    └──► CANCELLED ┘             └──► CANCELLED (via a linked queue-entry cancel)
    └──► NO_SHOW ───┘
```

`COMPLETED`, `CANCELLED`, and `NO_SHOW` are terminal — `assertTransitionAllowed` rejects every transition out of them, including the master doc's explicit forbidden example (`COMPLETED → SCHEDULED`), proven directly in `appointments.service.spec.ts`. `CHECKED_IN` exists in the `AppointmentStatus` enum (future granularity) but no Phase 3 endpoint can reach it — check-in moves straight from `SCHEDULED`/`CONFIRMED` to `IN_QUEUE` in one transaction (see `/DECISIONS.md`).

## Queue state machine (master doc §46/§52)

`queue.service.ts`'s `ALLOWED_TRANSITIONS` (a separate, smaller map) governs `QueueEntry.status`: `WAITING → CALLED → IN_CONSULTATION → COMPLETED`, with `SKIPPED`/`CANCELLED` reachable from `WAITING`/`CALLED`, and `SKIPPED → WAITING` via an explicit requeue action only (not automatic — see `/DECISIONS.md` for why `SKIPPED` isn't terminal). Starting consultation and completing an entry update the linked `Appointment`'s status in the same database transaction, so the two state machines can never observably disagree (e.g. a queue entry `COMPLETED` while its appointment is still `IN_QUEUE`).

## Concurrency-safety mechanisms (master doc §37-39, §80)

Three independent invariants, three different mechanisms — chosen per-invariant, not a single generic solution applied everywhere (master doc §38: "choose the simplest mechanism that correctly protects the invariant"):

| Invariant | Mechanism |
|---|---|
| MRN uniqueness (Phase 1B, unchanged) | Atomic `UPDATE Hospital SET mrnSequence = mrnSequence + 1` inside the same transaction as the `Patient` insert — Postgres row-locks `Hospital` for the update, serializing concurrent registrations for the same hospital. |
| Appointment double-booking | A transactional availability pre-check (reusing `getAvailableSlots`) for a fast, friendly error in the common case, **backed by** a hand-added partial unique index (`appointments_doctor_active_slot_unique`, `WHERE status NOT IN ('CANCELLED','NO_SHOW')`) that makes a lost race fail at the database level with `P2002`, caught and surfaced as `409 SLOT_ALREADY_BOOKED`. The pre-check alone is insufficient — it's a read-then-write with a window a concurrent request can land in; the index is what actually closes that window. |
| Queue call-next (no double-claim) | A single raw SQL statement (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`) — atomic by construction, no application-level lock needed. See `/DATABASE.md` for the full statement and reasoning. |

All three are exercised by dedicated concurrency e2e tests (`patient-mrn-concurrency`, `appointment-concurrency`, `queue-concurrency`) — written and type-checked, **not executed** in this environment (see `/TESTING.md`).

## Input validation

Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true, transform: true` — unrecognized body fields are **rejected** (400), not silently dropped or passed through. Every DTO uses `class-validator` decorators; there is no untyped `any`-shaped request body anywhere in Phase 1.

## Error handling / information disclosure

`AllExceptionsFilter` is the single place exceptions become HTTP responses:

- Stack traces, raw database errors, and internal file paths are **never** sent to the client, in any environment — they're logged server-side only, keyed by `correlationId`.
- A known Prisma unique-constraint violation (`P2002`) becomes a generic `409 RESOURCE_CONFLICT`, not a raw constraint-name leak.
- Every error response carries both a machine-readable `code` (e.g. `INVALID_CREDENTIALS`, `USER_NOT_FOUND`) and the `correlationId` of the request, so a user-facing error message and a server-side log line can be connected without exposing internals.

## What is never logged or placed in `AuditLog.metadata`

Passwords, raw tokens (access or refresh), OTPs, or clinical payloads. Audit metadata is restricted to small structured facts (e.g. `{ role: 'DOCTOR' }`, `{ changedFields: ['firstName'] }`) — enforced by convention and code review today, not by a runtime scrubber. **Hardening candidate**: a central logging/audit scrubber that rejects known-sensitive key names would make this harder to violate by accident as more modules are added.

## Audit log

Every security-relevant action writes an `AuditLog` row via `AuditService.log()`: `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `USER_REGISTERED`, `USER_CREATED`, `USER_UPDATED`, `REFRESH_TOKEN_REUSED`, `HOSPITAL_CREATED`, `HOSPITAL_UPDATED`, `PATIENT_REGISTERED`, `PATIENT_ACCESSED`, `PATIENT_UPDATED`, plus Phase 3's `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`, `DOCTOR_CREATED`, `DOCTOR_UPDATED`, `DOCTOR_DEACTIVATED`, `DOCTOR_SCHEDULE_CREATED`, `DOCTOR_SCHEDULE_UPDATED`, `DOCTOR_UNAVAILABILITY_CREATED`, `APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_NO_SHOW`, `APPOINTMENT_COMPLETED`, `QUEUE_ENTRY_CREATED`, `QUEUE_ENTRY_CALLED`, `QUEUE_ENTRY_SKIPPED`, `QUEUE_ENTRY_STARTED`, `QUEUE_ENTRY_COMPLETED`, `QUEUE_ENTRY_CANCELLED`. Metadata stays non-sensitive and structured (e.g. `{ tokenNumber }`, `{ oldScheduledAt, newScheduledAt }`) — never a diagnosis, clinical note, or anything from `Appointment.reason`/`DoctorUnavailability.reason`. A failure to write an audit row is logged but **never** blocks or fails the primary request — audit logging is observability, not a transactional guarantee, and must not become an availability dependency for login/registration.

## Rate limiting

A global `ThrottlerGuard` is configured via `AUTH_THROTTLE_TTL_SECONDS` / `AUTH_THROTTLE_LIMIT` (default: 10 requests / 60s per client). Phase 1 has few enough routes that a single global limit is adequate; per-route tiered limits (e.g., looser limits on read endpoints, tighter on `/auth/login`) are a reasonable addition once more endpoints exist. Exercised by `test/rate-limit.e2e-spec.ts` (Phase 2) — written but not executed in this environment, see `/TESTING.md`.

## Mass assignment

The global `ValidationPipe`'s `forbidNonWhitelisted: true` is the actual control (§35 above) — an unrecognized field like `isSuperAdmin: true` in a request body is rejected with `400`, not silently dropped or accepted. `test/security.e2e-spec.ts` (Phase 2) asserts this against `POST /users`; `test/operations-tenant-isolation.e2e-spec.ts` (Phase 3) asserts the same for a `status` field smuggled into `PATCH /appointments/:id` (which only accepts `reason` — see `UpdateAppointmentDto`), in addition to the existing proof that a client-supplied `hospitalId` is ignored, not validated-and-trusted, for every tenant-scoped create endpoint (Departments, Doctors, Users).

## Frontend session handling

`apps/web` (Phase 2) never persists the access token to `localStorage`/`sessionStorage` — it lives in a React context in memory only, reducing exposure to XSS relative to JS-accessible storage. On page load, the frontend doesn't know whether a session exists; it silently calls `/auth/refresh` (which relies on the httpOnly cookie) to find out, and only renders the authenticated shell if that succeeds. Route redirects (`/` and `/dashboard`) are UX convenience, not a security boundary — see `/ARCHITECTURE.md`.

## Secrets

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` must be ≥32 characters (enforced by `envValidationSchema` at boot — the app refuses to start otherwise). `.env` and `.env.test` are git-ignored; only `.env.example` is committed, and it contains placeholder values only.

## Known gaps / not yet implemented

- No CHECK constraint enforcing `SUPER_ADMIN` ⇒ `hospitalId IS NULL` at the database level (app-layer only today — see `/DECISIONS.md`).
- No centralized secret manager integration (Vault, AWS Secrets Manager, etc.) — `.env` files only, appropriate for local dev, **not** for production deployment.
- No automated dependency vulnerability scanning wired into CI yet (no CI exists yet — Phase 1 has no pipeline).
- No account lockout after N failed logins beyond the global rate limiter.
- No MFA.
- Neither generated Prisma migration (`20261005000000_init`, `20261005120000_hospital_operations_core`) has ever been applied to a real Postgres instance — Docker Desktop cannot start in this environment. See `/DATABASE.md`.
- `apps/api/test/*.e2e-spec.ts` (all of them, Phase 1 through Phase 3 alike) have never been executed here for the same reason — `createTestApp()` calls `PrismaService.$connect()`, which requires a live database. See `/TESTING.md`.
- No SKIP-LOCKED-equivalent safety analysis has been done for the `Queue.nextTokenNumber` and `Hospital.mrnSequence` atomic-increment pattern under extremely high throughput (hundreds of concurrent requests) — the mandatory concurrency tests use 25/10/5-way concurrency (documented reductions from the master doc's suggested 100), not a load test. See `/TESTING.md`.
- `DoctorProfile.registrationNumber` uniqueness is per-hospital, not globally — a doctor practicing across two hospitals in this platform could (in principle) register different or missing numbers at each. Not currently a product requirement; flagged as a future consideration, not a bug.
- No automated reminder/notification system exists for upcoming appointments (explicitly out of Phase 3 scope — master doc §3, "advanced notifications").

These are explicitly deferred, not accidentally missed — see the Phase 1, Phase 2, and Phase 3 reports for what's recommended for later phases (Phase 7 is production hardening).
