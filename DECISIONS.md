# Architecture & Engineering Decisions

Chronological log of non-obvious decisions made while building HospitalOS, and why. See also `/ARCHITECTURE.md`, `/SECURITY.md`, `/DATABASE.md`.

## 2026-10-05 — Re-audit found the prior Phase 0 entry below was only half right

A fresh Phase 0 audit (new conversation, no memory of the session that wrote the entry immediately below) was asked to inspect this repository read-only before touching anything. It found that the claim "repository had zero commits... no existing implementation of any kind" is misleading: **zero git commits is true** (`git log` on `main` errors with "does not have any commits yet"), but there is a substantial working NestJS+Prisma implementation already on disk — Auth, Users, Hospitals, Audit, Health, *and* a `Patient`/MRN module (`apps/api/src/patients/*`) that every other doc in this repo (`DATABASE.md`, `API.md`, `SECURITY.md`, `TESTING.md`, `CHANGELOG.md`) explicitly denied the existence of. Lesson for future sessions, consistent with master doc §41: "no commits" is not the same claim as "no code" — check the filesystem, not just `git log`, before concluding a repo is empty.

Verified by actually running `tsc --noEmit`, `nest build`, and `npm test` rather than trusting the docs:
- `nest build` **failed** — a real type error in `patients.service.ts` (tenant-scoping `where` clause assigned `hospitalId: string | null` where Prisma's generated type only accepts `string | StringFilter | undefined`, never `null`).
- `test/auth.e2e-spec.ts` had a second, unrelated type error (a cookie-extraction helper typed too narrowly against supertest's actual header type).
- `apps/api/prisma/migrations/` does not exist — the schema was never applied to a real database, contradicting `DATABASE.md`'s claim of an "initial migration."
- The mandatory tenant-isolation test (§30) and the concurrency test master doc §19/§31 explicitly requires for patient registration do not exist for the Patient module, despite a code comment in `patients.service.ts` claiming a concurrency test file that doesn't exist.

Both type errors were fixed (see `CHANGELOG.md`), all five affected docs were reconciled with the actual code, and a migration was attempted — blocked because Docker Desktop would not start in this sandboxed environment ("Docker Desktop is unable to start"). That step needs a human with a working local Docker setup; the Patient module should not be considered done (master doc §44) until a migration exists and the two missing tests are written.

## 2026-10-05 — Phase 0: repository was empty, no legacy system to evaluate

The master instructions asked for an audit comparing an existing NestJS+Prisma implementation against a proposed FastAPI+SQLAlchemy stack. On inspection, the repository had zero commits and the GitHub remote had zero branches — there was no existing implementation of any kind. The NestJS-vs-FastAPI comparison was therefore made as a greenfield choice, not a migration-risk evaluation. See the Phase 0 report in conversation history for the full comparison table.

**Decision:** NestJS + Prisma + PostgreSQL + Redis, Next.js frontend. Python/FastAPI deferred to a later phase for analytics/AI only (per master doc §35), not as the primary backend.

## Pinned dependency majors below the "latest" npm tag

Several packages' `latest` dist-tag pointed at versions too new to safely build on, discovered by actually running the install/build rather than assuming the newest major is safe:

- **TypeScript**: pinned to `^5.7.3`, not the `latest` tag (`7.0.2`). TypeScript 7 is the new Go-ported compiler rewrite; `ts-jest`'s peer dependency explicitly caps at `typescript <7`. Using it would have broken the test toolchain.
- **NestJS**: pinned the whole `@nestjs/*` family to the `11.x` line, not `12.x`. `@nestjs/schematics@12` requires `typescript >=6.0.0`, and TypeScript 6 only exists as a beta (`6.0.0-beta`) — there is no stable TypeScript version that satisfies both NestJS 12's schematics and `ts-jest` simultaneously. NestJS 11 has no such conflict.
- **Prisma**: pinned to `6.19.3`, not the `latest` tag (`8.0.0-rc.19`, a release candidate) and not even the newest *stable* line, `7.x`. Prisma 7 removed the conventional `datasource { url = env("DATABASE_URL") }` syntax in favor of a new driver-adapter model (`prisma.config.ts` + `@prisma/adapter-pg`) — confirmed by actually running `prisma generate` against a 7.x schema and hitting the validation error. That's a real architectural change, not a patch, and not worth taking on for the platform's foundation yet. Revisit once the adapter model is mainstream and well-documented.
- **ioredis, joi**: pinned to the established `5.x` / `17.x` lines rather than freshly-cut `6.x` / `18.x` majors, to avoid taking on unreviewed breaking changes in infrastructure-critical packages for no functional benefit.
- **uuid**: dropped entirely. `node:crypto`'s built-in `randomUUID()` covers every use case here (refresh token IDs), so there's no reason to carry an extra dependency.

**Lesson applied going forward:** always check a package's peer dependencies and actually run the install/build before trusting `npm view <pkg> version`. "Latest" is not the same claim as "stable" or "compatible with the rest of your toolchain."

## `jsonwebtoken`'s numeric `expiresIn` is seconds, not milliseconds

`src/common/utils/duration.util.ts` parses durations like `"15m"` into milliseconds (correct for `Date` math on `RefreshToken.expiresAt`). The JWT signing calls in `auth.service.ts` divide that by 1000 before passing it as `expiresIn`, because `jsonwebtoken` (via `@nestjs/jwt`) interprets a numeric `expiresIn` as seconds. Passing milliseconds directly would have made a configured 15-minute access token actually live for ~10 days — caught during the build by reading the type error closely rather than silencing it with a cast.

## `/auth/register` is bootstrap-only, not general self-registration

The master doc's API list (§13) includes `POST /auth/register`. For a hospital staff system, letting anyone self-register as any role would violate least-privilege (§10) and tenant security (§9). Implemented instead: `/auth/register` only succeeds when zero users exist in the database — it creates the first platform `SUPER_ADMIN` and then permanently closes itself (returns `403 REGISTRATION_CLOSED` thereafter). Every other account — hospital admins, doctors, staff — is created through the authenticated, RBAC-guarded `POST /users` endpoint, which forces tenant assignment server-side. `PATIENT` self-registration is explicitly out of scope until Phase 5 (HospitalOS Connect).

## Refresh tokens: httpOnly cookie, not response body

Access tokens are returned in the JSON response body (short-lived, kept client-side in memory). Refresh tokens are set as an `httpOnly`, `sameSite=strict` cookie scoped to `/api/v1/auth`, not returned in the body. This follows master doc §11/§22's "secure cookies where appropriate" guidance and reduces the refresh token's exposure to XSS relative to storing it in JS-accessible storage. Refresh tokens are further backed by a DB-resident `RefreshToken` row (SHA-256 hash, not the raw token) enabling rotation, revocation, and reuse detection — see `/SECURITY.md`.

## Cross-tenant access returns 404, not 403

When a caller requests a resource (user, hospital) that exists but belongs to a different tenant, the API returns `404 NOT_FOUND` rather than `403 FORBIDDEN`. This avoids confirming to a caller that a resource exists in a tenant they can't see (resource-enumeration hardening), while still satisfying the master doc §30 isolation matrix — the request is denied either way. Within-tenant authorization failures (e.g., a HOSPITAL_ADMIN trying to assign a SUPER_ADMIN role) still return `403 FORBIDDEN`/`ROLE_NOT_ALLOWED`, since no tenant-existence information is at stake there.

## `User.hospitalId` nullability is enforced at the application layer, not a DB constraint

`hospitalId` is nullable on `User` because `SUPER_ADMIN` is a platform-level role not scoped to any hospital. Every other role must have a non-null `hospitalId`. Prisma cannot express "NOT NULL unless role = X" declaratively, so this is enforced in `users.service.ts` (`resolveTargetHospitalId`) rather than as a database CHECK constraint. **Flagged as a hardening candidate**: a raw-SQL CHECK constraint (`role = 'SUPER_ADMIN' OR hospital_id IS NOT NULL`) could be added via a follow-up migration if defense-in-depth against application bugs becomes a priority.

## Structured logging (pino/winston) deferred

Phase 1 uses NestJS's built-in `Logger`. Per master doc §38 ("do not overengineer"), a dedicated structured-logging library is deferred to Phase 7 (production hardening / observability) rather than added speculatively now.
