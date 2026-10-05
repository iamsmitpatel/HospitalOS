# Testing

## Strategy

Per master doc §29/§30: tests exist to verify important business behavior, not to inflate a count. Unit tests cover business logic that's awkward to exercise over HTTP (tenant-derivation edge cases, token-reuse detection, the permission map); e2e tests cover everything that matters as an HTTP contract — including the **mandatory tenant isolation test**, the RBAC matrix, the security checklist, and the concurrency tests.

**Execution status (Phase 2, 2026-10-05): unit tests are run and pass; e2e tests are written but have never run in this environment.** Docker Desktop cannot start here (`docker ps` fails, and the underlying `com.docker.service` Windows service cannot be started either — confirmed in both Phase 1 and Phase 2), and `createTestApp()` eagerly calls `PrismaService.$connect()`, which hangs/fails without a live Postgres instance. Every e2e spec file below — the three inherited from Phase 1 and the four added in Phase 2 — is therefore unverified by actual execution. They are written to run against the Postgres+Redis started by `docker compose up -d` the moment that's available; until then, treat them as reviewed-but-unproven.

## Running tests

```bash
cd apps/api

npm run test          # unit tests — no database or Redis needed
npm run test:e2e      # e2e tests — needs Postgres + Redis running (docker compose up -d) and migrations applied
```

`test:e2e` sets `NODE_ENV=test` (via `cross-env`, for Windows/Mac/Linux parity), which points the app at `apps/api/.env.test` — `DATABASE_URL` there targets the separate `hospitalos_test` database created by `docker/postgres/init-test-db.sql`. **Never** point `.env.test` at `hospitalos_dev`; the e2e suite truncates `auditLog`, `refreshToken`, `user`, and `hospital` between every test file (`test/utils/test-app.ts#resetDatabase`).

Before running e2e tests for the first time, apply migrations to the test database:

```bash
cd apps/api
DATABASE_URL="postgresql://hospitalos:hospitalos_dev_password@localhost:5432/hospitalos_test?schema=public" npx prisma migrate deploy
```

(On Windows PowerShell: `$env:DATABASE_URL="..."; npx prisma migrate deploy`.)

**Windows note:** `npm run test:e2e` invokes `cross-env`, which in this environment failed with `'cross-env' is not recognized...` when npm dispatched the script through `cmd.exe` directly (works fine invoked other ways, e.g. from a shell that already has `node_modules/.bin` on `PATH`). If you hit this, run `npx jest --config ./test/jest-e2e.json` directly with `NODE_ENV=test` set in your shell instead. Separately: with Postgres/Redis unreachable, `createTestApp()` does not fail fast — `PrismaService.$connect()` hangs rather than throwing a quick connection-refused error, so a bad environment looks identical to a slow one until you kill the process. Worth a connection-timeout hardening pass if this keeps costing debugging time (see Phase 2 report, Known Issues).

## What's covered

### Unit (`src/**/*.spec.ts`) — executed, 24/24 passing

- `auth.service.spec.ts` — registration bootstrap/close behavior, login failure cases all returning the same generic error, refresh-token reuse revoking every session for the user.
- `users.service.spec.ts` — tenant-derivation logic (`HOSPITAL_ADMIN`'s client-supplied `hospitalId` is ignored; `SUPER_ADMIN` must supply a valid one), role-escalation blocking, cross-tenant fetch returning `USER_NOT_FOUND` rather than leaking existence.
- `common/guards/permissions.guard.spec.ts` (Phase 2) — the `ROLE_PERMISSIONS` map (every `Role` has an explicit entry, clinical/staff roles get zero platform permissions, `SUPER_ADMIN` doesn't get hospital-admin-only permissions), and `PermissionsGuard` itself (allows when no metadata, denies unauthenticated, denies missing permission, requires *every* listed permission not just one).

### E2E (`test/*.e2e-spec.ts`) — written, **not executed** (see Strategy above)

- `auth.e2e-spec.ts` — the full register → login → `/me` → refresh → logout → refresh-fails-after-logout cycle; refresh-token reuse detection over real HTTP with real cookies.
- `tenant-isolation.e2e-spec.ts` — **the mandatory test from master doc §30.** Creates Hospital A and Hospital B, a `HOSPITAL_ADMIN` for each, and a "data" user in each. Asserts the full matrix:
  - A → A allowed, B → B allowed, A → B denied, B → A denied — for both `GET /users/:id` and `GET /hospitals/:id`.
  - List endpoints are tenant-filtered at the query level, not just at the individual-record level.
  - A `HOSPITAL_ADMIN` cannot escalate to `HOSPITAL_ADMIN`/`SUPER_ADMIN`, and cannot plant a user into another tenant by supplying a different `hospitalId` in the request body — the server derives the tenant from the caller's own token regardless of what the body says.
- `rbac.e2e-spec.ts` (Phase 2) — master doc §29's exact matrix: `HOSPITAL_ADMIN`/`DOCTOR`/`RECEPTIONIST`/`PATIENT`/unauthenticated against a staff-admin-only endpoint (`GET /users`) and a platform-admin-only endpoint (`POST /hospitals`), including proof that `HOSPITAL_ADMIN` itself is denied the platform-admin-only route.
- `security.e2e-spec.ts` (Phase 2) — master doc §51's checklist in one file: no token → 401, malformed token → 401, token signed with the wrong secret → 401, expired token → 401, wrong role → 403, and (§32) a mass-assignment attempt (`isSuperAdmin: true` in a `POST /users` body) → 400.
- `concurrency.e2e-spec.ts` (Phase 2) — master doc §18/§52's mandatory races: two simultaneous `POST /users` with the same email, and two simultaneous `POST /hospitals` with the same slug/code. Each asserts exactly one `201` and one `409`, and exactly one row persisted — proving the database unique constraint is the real backstop, not just the service's pre-check. (`/auth/register` is bootstrap-only in this system, so the duplicate-email race targets `POST /users`, the actual general-purpose creation endpoint — see `/DECISIONS.md`.)
- `rate-limit.e2e-spec.ts` (Phase 2) — master doc §37. Overrides `AUTH_THROTTLE_LIMIT` to 3 for just this app instance (restored in `afterAll`, since `.env.test` sets it to 1000 so the rest of the suite isn't throttled by its own volume) and asserts the 4th rapid `/auth/login` attempt gets `429`.

## Not yet covered

- **Patients module (`apps/api/src/patients/`) has zero test coverage** — no unit tests, no e2e tests. This is the top-priority gap: the `Patient` entity and its tenant-scoping/MRN logic exist in code (see `/DATABASE.md`) but none of it is proven by a test. Specifically missing, both required by the master doc:
  - Concurrency test (§31) — two receptionists registering a patient in the same hospital simultaneously, asserting no duplicate MRN is issued.
  - The mandatory tenant-isolation A/B matrix (§30) — `tenant-isolation.e2e-spec.ts` currently covers Users and Hospitals only.
- Load/performance testing — out of scope until Phase 7 (production hardening).
- Frontend automated tests (component/E2E-in-browser) — `apps/web` (Phase 2) was manually verified in a real browser against a real (unreachable, by design in this environment) API: login/register pages render, form submission against an unreachable API shows a graceful error banner rather than crashing, `/` and `/dashboard` correctly redirect to `/login` when unauthenticated. No Playwright/Cypress suite exists yet — reasonable to add once there's a live backend to test the full login → dashboard happy path against.
