# Testing

## Strategy

Per master doc §29/§30: tests exist to verify important business behavior, not to inflate a count. Unit tests cover business logic that's awkward to exercise over HTTP (tenant-derivation edge cases, token-reuse detection, the permission map, the appointment/queue state machines, timezone math); e2e tests cover everything that matters as an HTTP contract — including the **mandatory tenant isolation test**, the RBAC matrix, the security checklist, and the concurrency tests.

**Execution status (Phase 3, 2026-10-06): unit tests are run and pass (96/96); e2e tests are written but have never run in this environment.** Docker Desktop cannot start here (`docker ps` fails, and the underlying `com.docker.service` Windows service cannot be started either — confirmed independently in Phase 1, Phase 2, and Phase 3), and `createTestApp()` eagerly calls `PrismaService.$connect()`, which hangs/fails without a live Postgres instance. Every e2e spec file below — the three inherited from Phase 1, the four added in Phase 2, and the five added in Phase 3 — is therefore unverified by actual execution. They are written to run against the Postgres+Redis started by `docker compose up -d` the moment that's available; until then, treat them as reviewed-but-unproven.

## Running tests

```bash
cd apps/api

npm run test          # unit tests — no database or Redis needed
npm run test:e2e      # e2e tests — needs Postgres + Redis running (docker compose up -d) and migrations applied
```

`test:e2e` sets `NODE_ENV=test` (via `cross-env`, for Windows/Mac/Linux parity), which points the app at `apps/api/.env.test` — `DATABASE_URL` there targets the separate `hospitalos_test` database created by `docker/postgres/init-test-db.sql`. **Never** point `.env.test` at `hospitalos_dev`; the e2e suite truncates every table between test files, children before parents (`test/utils/test-app.ts#resetDatabase` — extended in Phase 3 to cover `queueEntry`, `queue`, `appointment`, `doctorUnavailability`, `doctorSchedule`, `doctorProfile`, `department` alongside the Phase 1/2 tables).

Before running e2e tests for the first time, apply migrations to the test database:

```bash
cd apps/api
DATABASE_URL="postgresql://hospitalos:hospitalos_dev_password@localhost:5432/hospitalos_test?schema=public" npx prisma migrate deploy
```

(On Windows PowerShell: `$env:DATABASE_URL="..."; npx prisma migrate deploy`.)

**Windows note:** `npm run test:e2e` invokes `cross-env`, which in this environment failed with `'cross-env' is not recognized...` when npm dispatched the script through `cmd.exe` directly (works fine invoked other ways, e.g. from a shell that already has `node_modules/.bin` on `PATH`). If you hit this, run `npx jest --config ./test/jest-e2e.json` directly with `NODE_ENV=test` set in your shell instead. Separately: with Postgres/Redis unreachable, `createTestApp()` does not fail fast — `PrismaService.$connect()` hangs rather than throwing a quick connection-refused error, so a bad environment looks identical to a slow one until you kill the process. Worth a connection-timeout hardening pass if this keeps costing debugging time (see the Phase 2/3 reports, Known Issues).

## What's covered

### Unit (`src/**/*.spec.ts`) — executed, 96/96 passing

Phase 1/2 (unchanged): `auth.service.spec.ts`, `users.service.spec.ts`, `common/guards/permissions.guard.spec.ts` — see the Phase 2 report for details.

Phase 3 additions:

- `common/utils/timezone.util.spec.ts` — the IANA-timezone-conversion math (`zonedWallTimeToUtc`/`getZonedDateParts`) against concrete worked examples, including a DST-observing zone (`America/New_York`) on both sides of a spring-forward transition, and a near-midnight date-boundary disagreement between a local zone and UTC. This is the correctness-critical piece everything else (schedules, slots, bookings) depends on.
- `departments.service.spec.ts` — tenant derivation (`HOSPITAL_ADMIN` ignores a client-supplied `hospitalId`; `SUPER_ADMIN` must supply a valid one), duplicate code/name conflict, cross-tenant fetch returning `404` not `403`, `SUPER_ADMIN` cross-hospital read allowed (org-structure, not clinical).
- `doctors.service.spec.ts` — profile-creation validation chain (target user must have `role=DOCTOR`, must not already have a profile, must belong to the resolved hospital), `displayName` defaulting, schedule ownership (`DOCTOR` can only manage their own schedule — `403 FORBIDDEN` for another doctor's), schedule-range and overlap validation, and the full `getAvailableSlots` computation: inclusive end-boundary slot generation, exclusion of booked/unavailable/past slots, with a controlled "now" via fake timers.
- `appointments.service.spec.ts` — `assertTransitionAllowed` tested directly and exhaustively (every terminal-state transition rejected, the master doc §32 `COMPLETED → SCHEDULED` example explicitly proven to throw, `SCHEDULED → IN_CONSULTATION` skip-ahead rejected), plus the full `create` validation chain (`SUPER_ADMIN` rejected, inactive patient/doctor rejected, past time rejected, slot-not-in-available-list rejected, a `P2002` from a lost race converted to `409 SLOT_ALREADY_BOOKED`), cancel (state-check + linked-queue-entry cleanup), reschedule (state-check + history-preserving create), no-show (future-appointment rejection).
- `queue.service.spec.ts` — check-in validation chain (appointment-state check, duplicate-entry check, token assignment, appointment sync to `IN_QUEUE`), `callNext` (the raw-SQL claim path, the `NO_WAITING_PATIENTS` empty case, cross-tenant rejection), and every entry-state transition including the `SKIPPED → WAITING` requeue with a fresh token, each verified to sync (or not sync) the linked appointment correctly.
- `patients.service.spec.ts` (Phase 3 — Patients had zero unit tests before this) — duplicate-registration detection (`POTENTIAL_DUPLICATE_PATIENT` on a phone+DOB match, inactive patients excluded from the match, `confirmDuplicate: true` bypasses the check entirely), and `SUPER_ADMIN` cross-tenant denial (locking in the Phase 2 fix with a dedicated test).

### E2E (`test/*.e2e-spec.ts`) — written, **not executed** (see Strategy above)

Phase 1/2 (unchanged): `auth.e2e-spec.ts`, `tenant-isolation.e2e-spec.ts`, `rbac.e2e-spec.ts`, `security.e2e-spec.ts`, `concurrency.e2e-spec.ts`, `rate-limit.e2e-spec.ts` — see the Phase 2 report for details.

Phase 3 additions:

- `operations-tenant-isolation.e2e-spec.ts` — the mandatory IDOR/privacy/security matrix for every Phase 3 module (master doc §65-68). Builds a full operational graph (department, doctor + schedule, patient, appointment, queue entry) independently in Hospital A and Hospital B, then asserts: cross-tenant `404` for Department/Doctor/Patient/Appointment/Queue/QueueEntry (bidirectional — A→B and B→A); a mass-assignment attempt against `PATCH /appointments/:id` (smuggling a `status` field) rejected with `400`; a client-supplied `hospitalId` on `POST /departments` ignored; and a `Role.PATIENT` account denied every operational endpoint outright (list patients, create appointment, check in, call-next, skip) since no patient self-service exists yet.
- `patient-mrn-concurrency.e2e-spec.ts` — master doc §84. **25 simultaneous patient registrations** (reduced from the suggested 100 — meaningful concurrency pressure on the same atomic counter without a disproportionately slow test; the mechanism being proven doesn't get materially more proof from 100 vs 25), asserting 25 unique MRNs and exactly 25 persisted patients.
- `appointment-concurrency.e2e-spec.ts` — master doc §85. 10 simultaneous booking attempts for the same doctor and the exact same slot; asserts exactly 1 `201` and 9 `409`s, and exactly one non-cancelled appointment at that slot afterward.
- `queue-concurrency.e2e-spec.ts` — master doc §86. 5 waiting entries, 5 simultaneous `call-next` requests; asserts all 5 succeed and claim 5 *distinct* entries (proving `FOR UPDATE SKIP LOCKED` actually distributes claims rather than letting callers race for the same row), then asserts a 6th call-next against an now-empty queue gets a controlled `409 NO_WAITING_PATIENTS`.
- `hospital-workflow.e2e-spec.ts` — **the most important end-to-end test in Phase 3** (master doc §87). One continuous run of the full real-world flow: admin login → create department → create doctor → configure schedule → confirm the slot appears in `available-slots` → create patient (asserts the MRN format) → book appointment → confirm the slot disappears from `available-slots` once booked → check in (asserts token number, asserts the appointment flips to `IN_QUEUE`) → call next → start consultation (asserts appointment flips to `IN_CONSULTATION`) → complete the queue entry → confirm the appointment is `COMPLETED` without a separate call → confirm `COMPLETED` is terminal (a cancel attempt afterward gets `409 INVALID_APPOINTMENT_TRANSITION`). Every step asserts state before advancing, so a regression fails at the step it broke, not just at the end.

## Not yet covered

- Load/performance testing — out of scope until Phase 7 (production hardening).
- Frontend automated tests (component/E2E-in-browser) — `apps/web` was manually verified in a real browser against a real (unreachable, by design in this environment) API, both in Phase 2 (auth pages) and Phase 3 (operational pages: `/departments`, `/appointments?patientId=`, `/queues/:id` all correctly redirect unauthenticated visitors to `/login`, no console errors, clean production build of all 12 routes). No Playwright/Cypress suite exists yet — reasonable to add once there's a live backend to test the full happy paths (registration → booking → queue → completion) against in a real browser.
- `DoctorUnavailability` has no dedicated unit or e2e test beyond what `getAvailableSlots`'s tests exercise indirectly (an unavailability window excludes the slots it overlaps) — no test for creating/listing unavailability via the HTTP endpoints themselves.
