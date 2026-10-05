# Testing

## Strategy

Per master doc §29/§30: tests exist to verify important business behavior, not to inflate a count. Phase 1 has unit tests for business logic that's awkward to exercise over HTTP (tenant-derivation edge cases, token-reuse detection), and e2e tests for everything that matters as an HTTP contract — including the **mandatory tenant isolation test**.

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

## What's covered

### Unit (`src/**/*.spec.ts`)

- `auth.service.spec.ts` — registration bootstrap/close behavior, login failure cases all returning the same generic error, refresh-token reuse revoking every session for the user.
- `users.service.spec.ts` — tenant-derivation logic (`HOSPITAL_ADMIN`'s client-supplied `hospitalId` is ignored; `SUPER_ADMIN` must supply a valid one), role-escalation blocking, cross-tenant fetch returning `USER_NOT_FOUND` rather than leaking existence.

### E2E (`test/*.e2e-spec.ts`)

- `auth.e2e-spec.ts` — the full register → login → `/me` → refresh → logout → refresh-fails-after-logout cycle against a real Postgres instance; refresh-token reuse detection proven over real HTTP with real cookies, not mocked.
- `tenant-isolation.e2e-spec.ts` — **the mandatory test from master doc §30.** Creates Hospital A and Hospital B, a `HOSPITAL_ADMIN` for each, and a "data" user in each. Asserts the full matrix:
  - A → A allowed, B → B allowed, A → B denied, B → A denied — for both `GET /users/:id` and `GET /hospitals/:id`.
  - List endpoints are tenant-filtered at the query level, not just at the individual-record level.
  - A `HOSPITAL_ADMIN` cannot escalate to `HOSPITAL_ADMIN`/`SUPER_ADMIN`, and cannot plant a user into another tenant by supplying a different `hospitalId` in the request body — the server derives the tenant from the caller's own token regardless of what the body says.

## Not yet covered

- **Patients module (`apps/api/src/patients/`) has zero test coverage** — no unit tests, no e2e tests. This is the top-priority gap: the `Patient` entity and its tenant-scoping/MRN logic exist in code (see `/DATABASE.md`) but none of it is proven by a test. Specifically missing, both required by the master doc:
  - Concurrency test (§31) — two receptionists registering a patient in the same hospital simultaneously, asserting no duplicate MRN is issued.
  - The mandatory tenant-isolation A/B matrix (§30) — `tenant-isolation.e2e-spec.ts` currently covers Users and Hospitals only.
- Load/performance testing — out of scope until Phase 7 (production hardening).
- Frontend/E2E-in-browser tests — no frontend UI exists yet beyond the `apps/web` scaffold placeholder.
