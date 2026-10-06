# Security

This documents the controls actually implemented through Phase 4 — not a compliance claim. Per master doc §22: implementing these controls does not by itself make the platform HIPAA/compliant-with-anything; that requires a separate, explicit assessment.

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

Permissions modeled as of Phase 4: `hospital.*`, `user.*`, `role.assign`, `department.*`, `doctor.*` (incl. `doctor.schedule.manage`), `patient.*`, `appointment.*`, `queue.read`/`queue.operate`, plus Phase 4's 23: `encounter.read`/`encounter.manage`, `vitals.create`, `clinical_note.create`, `diagnosis.manage`, `prescription.manage`/`prescription.read`, `labtest.read`/`labtest.manage`, `lab_order.create`/`lab_order.read`/`lab_order.process`, `lab_result.enter`/`lab_result.verify`/`lab_result.read`, `medicine.read`/`medicine.manage`, `inventory.read`/`inventory.manage`, `pharmacy.dispense`, `service.read`/`service.manage`, `invoice.read`/`invoice.manage`, `payment.read`/`payment.manage`/`payment.refund` — 39 permissions total, still deliberately a small, explicit set (master doc §13: "do not implement hundreds of permissions prematurely"), not an attempt to model every future permission. `queue.operate` covers call-next/skip/requeue/start/complete/cancel as one permission rather than six; `encounter.manage` similarly covers create/update/complete/cancel, and `diagnosis.manage`/`prescription.manage` each cover create/update-while-draft/finalize/amend.

### Platform administration vs. clinical/operational access (master doc §14)

`SUPER_ADMIN` is explicitly a **platform administration** role, not an implicit "can see everything" role. Phase 4 extends the same one consistent line across the new modules — and, new this phase, draws it a second time one level down for `HOSPITAL_ADMIN`:

| Group | Modules | `SUPER_ADMIN` access | `HOSPITAL_ADMIN` access |
|---|---|---|---|
| Platform administration | `hospital.*`, `user.*`, `role.assign` | Full, platform-wide | Own tenant only |
| Org structure / catalog (judged administration-adjacent, not clinical) | `department.*`, `doctor.*`, `labtest.*`, `medicine.*`, `service.*` | Full, with explicit `hospitalId` (same pattern as Users/Hospitals) | Full, own tenant |
| Financial / inventory administration (operational, not clinical) | `invoice.*`, `payment.*`, `inventory.*` | **None** — not platform-catalog, it's hospital-specific operational data | Full, own tenant |
| Patient-touching operational/clinical data | `patient.*`, `appointment.*`, `queue.*`, `encounter.*`, `vitals.*`, `clinical_note.*`, `diagnosis.*`, `prescription.*`, `lab_order.*`, `lab_result.*` | **None at all** | **None at all** — same exclusion as `SUPER_ADMIN`, applied one level down |

The `HOSPITAL_ADMIN` row is the new line this phase draws: Phase 3 only had to decide where `SUPER_ADMIN` sat. Phase 4 adds financial/catalog administration that *does* belong to `HOSPITAL_ADMIN` (a hospital's own administrator plausibly manages its medicine catalog, lab test menu, service pricing, and billing) — but an administrative role is not a clinical role merely by being administrative, so `HOSPITAL_ADMIN_PERMISSIONS` explicitly lists every financial/catalog permission and **zero** clinical-record permissions, the exact same shape as `SUPER_ADMIN`'s own list one tier up.

This is enforced redundantly for both groups, on purpose:
1. Neither `ROLE_PERMISSIONS[SUPER_ADMIN]` nor `ROLE_PERMISSIONS[HOSPITAL_ADMIN]` lists any clinical permission, so `PermissionsGuard` rejects the request before it reaches a controller method.
2. Every service-layer tenant check for patient-touching modules uses the **strict** variant (`assertSameTenantStrict` / an unconditional `actor.hospitalId` requirement — see `common/utils/tenant.util.ts`), which has no `SUPER_ADMIN` branch at all, unlike the Department/Doctor/catalog checks (`assertSameTenant`, which does special-case `SUPER_ADMIN` for cross-hospital platform administration).

This is the direct continuation of the Phase 2 fix: before that fix, `patients.service.ts`'s `findAllForTenant`/`getTenantScopedPatientOrThrow` skipped the `hospitalId` filter for `SUPER_ADMIN`, letting a platform administrator list or fetch *any* patient in *any* hospital. Phase 3 applied the same no-bypass discipline to Appointments/Queue from the start; Phase 4 applies it again to five more modules, plus draws the equivalent line for `HOSPITAL_ADMIN` for the first time.

Phase 4 also narrows two Phase 3 role groupings that had previously been treated as one undifferentiated "clinical operational staff" bucket: `RECEPTIONIST` never gets any clinical documentation permission (front-desk + billing only), and `NURSE` gets only `vitals.create` — not notes, diagnosis, or prescriptions (master doc §52: "Nurse: vital signs where permitted"). Five new roles get their own explicit permission sets for the first time: `PHARMACIST` (medicine/inventory/dispense), `LAB_TECHNICIAN` (lab order processing + result entry **and** verification — maker-checker is enforced in the service layer by comparing user ids, not by splitting verify into a separate role), `ACCOUNTANT` (billing/payment/refund + catalog pricing, same financial-administration shape as `HOSPITAL_ADMIN` minus the user-management piece).

## Tenant isolation

This is the control the master doc treats as non-negotiable (§8, §9, §30), so it's worth being explicit about the mechanism:

1. A user's `hospitalId` is resolved once, at login, from the database — never from client input — and embedded in the signed access token.
2. Every tenant-scoped service method receives the authenticated user (via `@CurrentUser()`) and uses `actor.hospitalId`, never a client-supplied `hospitalId`, to decide what the caller may write or which tenant a new record belongs to. See `users.service.ts#resolveTargetHospitalId` for the concrete logic, and the `tenant-isolation.e2e-spec.ts` test "a HOSPITAL_ADMIN cannot plant a user into a different hospital via the request body" for proof the client-supplied value is actually ignored, not just validated.
3. Reads of a specific resource by ID (`GET /users/:id`, `GET /hospitals/:id`) check `resource.hospitalId === actor.hospitalId` (or `actor.role === SUPER_ADMIN`) and return **404**, not 403, on mismatch — see `/DECISIONS.md` for the reasoning (avoid confirming the resource exists in a tenant the caller can't see).
4. List endpoints (`GET /users`) filter by `actor.hospitalId` at the database query level (`where: { hospitalId: actor.hospitalId }`), not by filtering an unscoped result set after the fact.

This is exercised end-to-end by `apps/api/test/tenant-isolation.e2e-spec.ts` (Users/Hospitals, Phase 2), `apps/api/test/operations-tenant-isolation.e2e-spec.ts` (Phase 3 — Department, Doctor, Patient, Appointment, Queue, plus a bidirectional A→B/B→A check and a `Role.PATIENT`-is-denied-everything check), and `apps/api/test/clinical-tenant-isolation.e2e-spec.ts` (Phase 4 — extends the same matrix to Encounter, Diagnosis, Prescription, LabOrder, LabOrderItem, LabResult, Medicine, StockBatch, Service, Invoice, Payment, including a case using the *correct* permission-holding role per resource — e.g. `HOSPITAL_ADMIN` for inventory/billing reads, `DOCTOR` for clinical reads — since Phase 4's narrower permission map means the wrong role would 403 before the tenant check is ever reached), all implementing the A/B matrix the master doc requires (§30, §65). Unit-test coverage of the same tenant-check logic exists per-module too (`*.service.spec.ts`, 215 tests total as of Phase 4) — see `/TESTING.md` for what's actually been executed versus just written.

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

## Clinical/lab lifecycle integrity (master doc §16, §32, §33)

- **Append-only / amendment-chain pattern**, used consistently across `ClinicalNote` (`correctsId`), `Diagnosis`/`Prescription` (`amendedFromId`), and `LabResult` (`amendsId`): a finalized or entered clinical/financial record is never overwritten in place. A correction creates a **new** row referencing the one it supersedes; the old row stays on the chart, marked (`AMENDED`) but never deleted. `LabResult` additionally has to work around its own `labOrderItemId` `@unique` constraint by creating a fresh `LabOrderItem` for the correction rather than reusing the original item — see `/DATABASE.md` and `/DECISIONS.md`.
- **Maker-checker for lab result verification** (master doc §32): `lab-results.service.ts#verify()` rejects `403 SELF_VERIFICATION_FORBIDDEN` if `verifiedByUserId === enteredByUserId`, enforced by an explicit equality check comparing the caller's own user id against the result row — not by giving "enter" and "verify" to different roles (both live on `LAB_TECHNICIAN`). Granting both actions to one role but still blocking self-verification is deliberate: splitting them into two roles would be both unrealistic (most hospitals don't staff two separate lab-tech tiers) and insufficient on its own (two different `LAB_TECHNICIAN` accounts could still coincidentally be the same literal person without a role split preventing anything) — the actual invariant the master doc cares about is "a different human reviewed this," which only an identity check, not a role check, can enforce.
- **Encounter ownership**: `ENCOUNTER_MANAGE`/`DIAGNOSIS_MANAGE`/`PRESCRIPTION_MANAGE`/`LAB_ORDER_CREATE` are `DOCTOR`-only permissions, but the service layer additionally verifies the acting doctor **owns** the specific encounter (`EncountersService#assertOwnEncounter`, comparing the caller's own `DoctorProfile.id` — never a client-supplied one — against `encounter.doctorProfileId`) before allowing any write against it or its children. One doctor cannot add a diagnosis, prescription, or lab order to a colleague's encounter, even within the same hospital.
- **Encounter creation precondition**: starting an encounter from an existing appointment requires `appointment.status === 'IN_CONSULTATION'` — the state the Phase 3 queue module (`queue.service.ts#startConsultation`) has already moved it to by the time a doctor is actually with the patient. This was initially implemented incorrectly (requiring `IN_QUEUE` and attempting to re-transition it) — see `/DECISIONS.md` for the bug and fix.

## Concurrency-safety mechanisms (master doc §37-39, §80)

Seven independent invariants, mechanisms chosen per-invariant, not a single generic solution applied everywhere (master doc §38: "choose the simplest mechanism that correctly protects the invariant"):

| Invariant | Mechanism |
|---|---|
| MRN uniqueness (Phase 1B, unchanged) | Atomic `UPDATE Hospital SET mrnSequence = mrnSequence + 1` inside the same transaction as the `Patient` insert — Postgres row-locks `Hospital` for the update, serializing concurrent registrations for the same hospital. |
| Appointment double-booking | A transactional availability pre-check (reusing `getAvailableSlots`) for a fast, friendly error in the common case, **backed by** a hand-added partial unique index (`appointments_doctor_active_slot_unique`, `WHERE status NOT IN ('CANCELLED','NO_SHOW')`) that makes a lost race fail at the database level with `P2002`, caught and surfaced as `409 SLOT_ALREADY_BOOKED`. The pre-check alone is insufficient — it's a read-then-write with a window a concurrent request can land in; the index is what actually closes that window. |
| Queue call-next (no double-claim) | A single raw SQL statement (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`) — atomic by construction, no application-level lock needed. See `/DATABASE.md` for the full statement and reasoning. |
| Inventory never oversells (Phase 4) | A conditional `updateMany(WHERE quantityRemaining >= take)` for every stock decrement (dispensing, adjustment) — Postgres serializes concurrent writers on the same batch row rather than letting both succeed; a dispense that can't be fully satisfied rolls back entirely (never a partial deduction). Backed by a hand-added `quantityRemaining >= 0` CHECK constraint. See `/DATABASE.md`. |
| Payment idempotency (Phase 4) | `@@unique([hospitalId, idempotencyKey])` on `Payment`, checked proactively (`findUnique` before insert) **and** backstopped by catching the `P2002` a genuine concurrent retry produces — both paths return the original payment, never create a second one or double-credit the invoice. |
| Connect appointment booking (Phase 5) | Same partial-unique-index backstop as staff booking, **plus** a second check for `@@unique([hospitalId, idempotencyKey])` on `Appointment` — a `P2002` is disambiguated by re-querying for the idempotency key (not by parsing Prisma's error metadata): a genuine retry returns the original booking, an unrelated slot collision still surfaces as `409`. |
| Connect record-claiming (Phase 5) | A conditional `updateMany(WHERE id = ? AND userId IS NULL)` rather than a plain `update()` — closes a check-then-act race where two concurrent claimants who both read the record as unclaimed could otherwise both "succeed," with the second silently overwriting the first's link. See `/DECISIONS.md`. |

All seven are exercised by dedicated concurrency e2e tests (`patient-mrn-concurrency`, `appointment-concurrency`, `queue-concurrency`, Phase 4's `clinical-concurrency` — inventory-oversell and payment-idempotency — and Phase 5's `connect-concurrency`) — written and type-checked, **not executed** in this environment (see `/TESTING.md`).

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

Every security-relevant action writes an `AuditLog` row via `AuditService.log()`: `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `USER_REGISTERED`, `USER_CREATED`, `USER_UPDATED`, `REFRESH_TOKEN_REUSED`, `HOSPITAL_CREATED`, `HOSPITAL_UPDATED`, `PATIENT_REGISTERED`, `PATIENT_ACCESSED`, `PATIENT_UPDATED`, plus Phase 3's `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`, `DOCTOR_CREATED`, `DOCTOR_UPDATED`, `DOCTOR_DEACTIVATED`, `DOCTOR_SCHEDULE_CREATED`, `DOCTOR_SCHEDULE_UPDATED`, `DOCTOR_UNAVAILABILITY_CREATED`, `APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_NO_SHOW`, `APPOINTMENT_COMPLETED`, `QUEUE_ENTRY_CREATED`, `QUEUE_ENTRY_CALLED`, `QUEUE_ENTRY_SKIPPED`, `QUEUE_ENTRY_STARTED`, `QUEUE_ENTRY_COMPLETED`, `QUEUE_ENTRY_CANCELLED`, plus Phase 4's `ENCOUNTER_CREATED`, `ENCOUNTER_UPDATED`, `ENCOUNTER_COMPLETED`, `ENCOUNTER_CANCELLED`, `VITALS_RECORDED`, `CLINICAL_NOTE_CREATED`, `DIAGNOSIS_CREATED`, `DIAGNOSIS_UPDATED`, `DIAGNOSIS_FINALIZED`, `DIAGNOSIS_AMENDED`, `PRESCRIPTION_CREATED`, `PRESCRIPTION_UPDATED`, `PRESCRIPTION_FINALIZED`, `PRESCRIPTION_AMENDED`, `LABTEST_CREATED`, `LABTEST_UPDATED`, `LAB_ORDER_CREATED`, `LAB_ORDER_CANCELLED`, `SPECIMEN_COLLECTED`, `LAB_RESULT_ENTERED`, `LAB_RESULT_UPDATED`, `LAB_RESULT_VERIFIED`, `LAB_RESULT_AMENDED`, `MEDICINE_CREATED`, `MEDICINE_UPDATED`, `STOCK_RECEIVED`, `STOCK_ADJUSTED`, `STOCK_EXPIRED`, `MEDICINE_DISPENSED`, `STOCK_RETURNED`, `SERVICE_CREATED`, `SERVICE_UPDATED`, `SERVICE_PRICE_SET`, `INVOICE_CREATED`, `INVOICE_ISSUED`, `INVOICE_CANCELLED`, `PAYMENT_CREATED`, `REFUND_CREATED`, plus Phase 5's `PATIENT_PORTAL_REGISTERED`, `PATIENT_RECORD_LINKED`, `PATIENT_PROFILE_UPDATED`, `CONNECT_APPOINTMENT_BOOKED`, `HOSPITAL_PUBLIC_PROFILE_UPDATED`, `NOTIFICATION_SENT`, `NOTIFICATION_FAILED`. Metadata stays non-sensitive and structured (e.g. `{ tokenNumber }`, `{ oldScheduledAt, newScheduledAt }`, `{ amendedFromId }`, `{ quantity }`) — never a diagnosis, clinical note, lab value, prescription content, or anything from `Appointment.reason`/`DoctorUnavailability.reason`. A failure to write an audit row is logged but **never** blocks or fails the primary request — audit logging is observability, not a transactional guarantee, and must not become an availability dependency for login/registration.

## Rate limiting

Two tiers (Phase 5 — a single global tier was adequate through Phase 4, but HospitalOS Connect added public, pollable, patient-facing read endpoints that must not share a budget with brute-force-sensitive auth routes):

- **`default`** (`DEFAULT_THROTTLE_TTL_SECONDS` / `DEFAULT_THROTTLE_LIMIT`, default 120 req/60s) — applied globally via `APP_GUARD`. Generous on purpose: a patient polling `GET /patient/queue` or browsing `GET /discover/hospitals` must never be throttled by normal use.
- **`default` override** (`AUTH_THROTTLE_TTL_SECONDS` / `AUTH_THROTTLE_LIMIT`, default 10 req/60s) — applied per-route via `@Throttle({ default: { limit, ttl } })` on exactly four routes: `/auth/register`, `/auth/register-patient`, `/auth/login`, `/auth/refresh`. These are the brute-force/credential-stuffing/signup-spam targets. See `/DECISIONS.md` for why this started as a single accidentally-global strict tier and the per-route override reads a function, not a captured value.

Exercised by `test/rate-limit.e2e-spec.ts` — written but not executed in this environment, see `/TESTING.md`.

## Mass assignment

The global `ValidationPipe`'s `forbidNonWhitelisted: true` is the actual control (§35 above) — an unrecognized field like `isSuperAdmin: true` in a request body is rejected with `400`, not silently dropped or accepted. `test/security.e2e-spec.ts` (Phase 2) asserts this against `POST /users`; `test/operations-tenant-isolation.e2e-spec.ts` (Phase 3) asserts the same for a `status` field smuggled into `PATCH /appointments/:id` (which only accepts `reason` — see `UpdateAppointmentDto`), in addition to the existing proof that a client-supplied `hospitalId` is ignored, not validated-and-trusted, for every tenant-scoped create endpoint (Departments, Doctors, Users).

## Frontend session handling

`apps/web` (Phase 2) never persists the access token to `localStorage`/`sessionStorage` — it lives in a React context in memory only, reducing exposure to XSS relative to JS-accessible storage. On page load, the frontend doesn't know whether a session exists; it silently calls `/auth/refresh` (which relies on the httpOnly cookie) to find out, and only renders the authenticated shell if that succeeds. Route redirects (`/` and `/dashboard`) are UX convenience, not a security boundary — see `/ARCHITECTURE.md`.

## Secrets

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` must be ≥32 characters (enforced by `envValidationSchema` at boot — the app refuses to start otherwise). `.env` and `.env.test` are git-ignored; only `.env.example` is committed, and it contains placeholder values only.

## Known gaps / not yet implemented

- No CHECK constraint enforcing `SUPER_ADMIN` ⇒ `hospitalId IS NULL` at the database level (app-layer only today — see `/DECISIONS.md`).
- No centralized secret manager integration (Vault, AWS Secrets Manager, etc.) — `.env` files only, appropriate for local dev, **not** for production deployment.
- No automated dependency vulnerability scanning wired into CI yet (no CI exists yet).
- No account lockout after N failed logins beyond the global rate limiter.
- No MFA.
- No structured (JSON) logging — NestJS's built-in text `Logger`, correlation-ID-tagged but not machine-parseable. Flagged since Phase 1, still deferred in Phase 5 despite the master doc asking for it under observability — see `/DECISIONS.md` for why.
- None of the Prisma migrations generated across every phase (`20261005000000_init` through Phase 5's `20261006190000_patient_connect_user_scoped_unique`) has ever been applied to a real Postgres instance — Docker Desktop cannot start in this environment. See `/DATABASE.md`.
- `apps/api/test/*.e2e-spec.ts` (every phase alike, including Phase 5's `connect-idor`/`connect-concurrency`) have never been executed here for the same reason — `createTestApp()` calls `PrismaService.$connect()`, which requires a live database. See `/TESTING.md`.
- No SKIP-LOCKED-equivalent safety analysis has been done for the `Queue.nextTokenNumber`/`Hospital.mrnSequence`/`Hospital.invoiceSequence` atomic-increment pattern under extremely high throughput (hundreds of concurrent requests) — the mandatory concurrency tests use 10/50/100-way concurrency (documented, deliberately-sized reductions from truly production-scale load), not a load test. See `/TESTING.md`.
- No file-storage/document system exists in this codebase — the master doc's "report/document access security" (Phase 5 Part 7) is therefore N/A, not silently skipped.
- No multi-user delegation model for a single Connect account to access a family member's/dependent's records — `Patient.userId` is a single-owner link (one Connect account per Patient row). The master doc's "family/dependent profiles, if supported by the existing architecture" was evaluated and deliberately deferred rather than bolted on; see `/DECISIONS.md`.
- `DoctorProfile.registrationNumber` uniqueness is per-hospital, not globally — a doctor practicing across two hospitals in this platform could (in principle) register different or missing numbers at each. Not currently a product requirement; flagged as a future consideration, not a bug.
- No automated reminder/notification system exists for upcoming appointments (explicitly out of Phase 3 scope — master doc §3, "advanced notifications").
- `DispenseService#returnStock()` (Phase 4) checks a single return's quantity only against the original dispense's `quantity` field — it does not track cumulative prior returns against the same `DispenseRecord`, so two separate partial-return calls against the same dispense are not mutually bounded by each other. Not currently exploitable for negative stock (the batch-level CHECK constraint still holds), but flagged as a data-integrity edge case for a product that needs precise return accounting. See `/DECISIONS.md`.
- `Payment`/`Refund` have no payment-gateway integration — `PaymentStatus.PENDING`/`FAILED` and `RefundStatus.PENDING`/`FAILED` exist in the schema for a future async gateway flow but are unreachable via any Phase 4 endpoint (every payment/refund is created directly as `SUCCESS`/`COMPLETED`). No assumption about any specific payment gateway is baked in anywhere (master doc §49).

These are explicitly deferred, not accidentally missed — see the Phase 1 through Phase 4 reports for what's recommended for later phases (Phase 7 is production hardening).
