# Changelog

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
