# Changelog

## Phase 3 — Hospital Operations Core (2026-10-06)

The operational workflow connecting Hospital → Departments → Doctors/Schedules → Patients → Appointments → Queue, built on the Phase 2 foundation (reused as-is: auth, RBAC/permissions, tenant isolation, audit, database patterns).

- **New modules:** `departments/`, `doctors/` (profile + weekly recurring schedule + one-off unavailability + computed available-slots), `appointments/` (explicit state machine, DB-level conflict prevention via a hand-added partial unique index, history-preserving reschedule, no-show), `queue/` (check-in, race-proof `call-next` via Postgres `FOR UPDATE SKIP LOCKED`, skip/requeue/start/complete/cancel, synced to appointment status).
- **Patients enhanced:** duplicate-registration detection (`POTENTIAL_DUPLICATE_PATIENT`, phone+DOB match, `confirmDuplicate` override), migrated from `@Roles()` to `@RequirePermissions()`, first unit-test coverage (`patients.service.spec.ts`).
- **Permission foundation extended:** `department.*`, `doctor.*` (incl. `doctor.schedule.manage`), `patient.*`, `appointment.*`, `queue.read`/`queue.operate`. `SUPER_ADMIN` holds the org-structure permissions (Department, Doctor) but **none** of the patient-touching ones (Patient, Appointment, Queue) — see `/DECISIONS.md` for exactly where that line falls and why.
- **Cleanup:** `RolesGuard`/`@Roles()` deleted entirely — every module had migrated to `@RequirePermissions()`, leaving it dead code that still ran on every request.
- **New shared utilities:** `common/utils/timezone.util.ts` (dependency-free IANA-timezone-aware date math, unit-tested including a DST transition), `common/utils/tenant.util.ts` (shared tenant-resolution/cross-tenant-check helpers, with a strict no-`SUPER_ADMIN`-bypass variant for clinical data).
- **Database:** `Hospital.timezone`; `Department`, `DoctorProfile`, `DoctorSchedule`, `DoctorUnavailability`, `Appointment`, `Queue`, `QueueEntry` tables; a hand-added partial unique index for appointment-slot conflict prevention. Second migration generated (`20261005120000_hospital_operations_core`) via the same `prisma migrate diff` workaround as Phase 1/2 — **unapplied**, same Docker blocker.
- **Tests:** 5 new unit spec files (departments, doctors, appointments, queue, patients services, plus a timezone-math spec) — 96/96 unit tests passing. 5 new e2e spec files (operations tenant-isolation/IDOR/security matrix, 3 dedicated concurrency tests — MRN/appointment-booking/queue-call-next, and the full admin→department→doctor→patient→appointment→queue→completion workflow test) — written and type-checked, **not executed** (same Docker blocker as all e2e tests since Phase 1).
- **Frontend (`apps/web`):** 6 new routes (`/departments`, `/doctors`, `/patients` + `/patients/[id]`, `/appointments` + `/appointments/[id]`, `/queues` + `/queues/[id]`), a shared `AppShell` nav/header component, `authedRequest()` added to the auth context so every page shares one token-aware fetch path. Queue dashboard polls every 5s (no WebSockets — master doc §75). Manually verified in a real browser (builds clean, all routes redirect correctly when unauthenticated, no console errors) against the same unreachable-API constraint as the rest of this environment.
- Reconciled `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, `DECISIONS.md` with all of the above.

Still outstanding, not done in this pass (out of Phase 3 scope or blocked by environment): both migrations' actual application to a live database, e2e test execution, `DoctorUnavailability` HTTP-level test coverage, frontend automated tests, CI.

## Phase 2 — Core Platform Foundation (2026-10-05)

Started from a substantial inherited Phase 1 implementation (zero git commits existed yet — see "Phase 1 baseline" commit). Closed gaps against the Phase 2 spec and fixed one real security issue found along the way.

- **Security fix:** `patients.service.ts` — `SUPER_ADMIN` could previously list or fetch *any* patient in *any* hospital (tenant filter was skipped for that role). Removed the bypass in `findAllForTenant` and `getTenantScopedPatientOrThrow`; platform administration no longer implies clinical access (master doc §14). See `/SECURITY.md` and `/DECISIONS.md`.
- **Permission foundation:** added `common/constants/permissions.constants.ts` (`Permission` + `ROLE_PERMISSIONS`), `PermissionsGuard`, `@RequirePermissions()`. `users/` and `hospitals/` now use it instead of `@Roles()`; `patients/` left untouched (out of scope). 5 new unit tests.
- **`GET /auth/me`** now returns a nested `hospital: { id, name }` instead of just `hospitalId`, matching master doc §26's example exactly. Frontend dashboard depends on this.
- **Database:** generated the initial Prisma migration (`20261005000000_init`) via `prisma migrate diff` (schema-to-schema, no live DB needed) — Docker Desktop cannot start in this environment, same blocker the Phase 0 re-audit hit. **Unverified**: never applied to a real Postgres instance. See `/DATABASE.md`.
- **Tests added** (`apps/api/test/`): `rbac.e2e-spec.ts` (§29 role matrix), `security.e2e-spec.ts` (§51 token/role checklist + §32 mass assignment), `concurrency.e2e-spec.ts` (§52 duplicate-email and duplicate-slug races), `rate-limit.e2e-spec.ts` (§37). All type-check and lint clean; **none have been executed** — see `/TESTING.md` for why (same Docker blocker; `createTestApp()` hangs rather than failing fast without a live DB).
- **Frontend (`apps/web`):** scaffolded from nothing — Next.js 14 + React 18, chosen over the "latest" `next@16.3.8` tag for stability (see `/DECISIONS.md`). `/login`, `/register` (bootstrap-only, matching the actual backend flow — not a generic signup form), `/dashboard` (protected shell), a shared API client with single-flight silent-refresh-on-401, and an in-memory-only access token. Build/typecheck/lint all pass; manually verified in a real browser (pages render, error handling works against an intentionally-unreachable API, auth redirects work) — no live-backend happy-path test yet, same blocker.
- Reconciled `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, `README.md`, `DECISIONS.md` with the above.

Still outstanding, not done in this pass (out of Phase 2 scope or blocked by environment): Patients module tenant-isolation/concurrency tests, the migration's actual application to a live database, e2e test execution, a CHECK constraint for `SUPER_ADMIN ⇒ hospitalId IS NULL`, CI.

## Phase 0 re-audit + Phase 1B build fixes (2026-10-05)

An independent Phase 0 audit found that `apps/api/src/patients/*` and the `Patient`/MRN schema already existed on disk (unlike what `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, and this changelog previously claimed) but was never verified: `nest build` failed outright, and there were zero tests or a migration for it. See `DECISIONS.md` for the full account.

Fixed in this pass:
- `patients.service.ts`: tenant-scoping `where` clause had a real type error (`hospitalId: string | null` isn't valid `Prisma.PatientWhereInput`). Fixed by guarding with the same `TENANT_CONTEXT_MISSING` exception pattern already used elsewhere, not a cast.
- `test/auth.e2e-spec.ts`: `extractRefreshCookie` had a type mismatch against `Response.headers['set-cookie']`; now accepts and normalizes both `string` and `string[]`.
- `npm run build` and `npm test` (14/14) now pass.
- Reconciled `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md` with what the code actually contains.

Still outstanding, not done in this pass:
- **No Prisma migration exists.** Attempted to generate one; blocked because Docker Desktop would not start in this environment ("Docker Desktop is unable to start"). Needs a human to get Postgres running locally, then `cd apps/api && npx prisma migrate dev`.
- No tests for the Patients module (unit, tenant-isolation e2e, or the concurrency test master doc §31 requires).
- Zero git commits still exist for any of this.

## Phase 1 — Foundation (2026-10-05)

Initial build. See the Phase 1 report (conversation history) for the full breakdown of implemented/not-implemented, test results, and known gaps.

- Monorepo scaffold (`apps/api`, `apps/web` reserved), Docker Compose (Postgres + Redis).
- NestJS API: config/env validation, global exception filter + response envelope, correlation IDs, rate limiting.
- Auth: bootstrap-only registration, login, JWT access + httpOnly-cookie refresh with rotation and reuse detection, logout, `/me`.
- RBAC: 9-role enum, `@Roles` guard, least-privilege checks beyond route-level role gating.
- Tenant isolation: server-derived `hospitalId`, cross-tenant reads return 404, tenant-scoped list queries.
- Users and Hospitals modules (CRUD, tenant- and role-scoped).
- Audit logging for all auth and user/hospital lifecycle events.
- Health check (`/api/v1/health`) against Postgres and Redis.
- Swagger/OpenAPI at `/api/docs`.
- Unit tests (auth, users) and e2e tests (auth flow, mandatory tenant-isolation matrix per master doc §30).
- Documentation set: `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `DEPLOYMENT.md`, `TESTING.md`, `DECISIONS.md`.

Not implemented: Patient/MRN, scheduling, clinical records, laboratory, pharmacy, billing, HospitalOS Connect, frontend UI. These are later-phase scope per the master roadmap.
