# Security

This documents the controls actually implemented in Phase 1 — not a compliance claim. Per master doc §22: implementing these controls does not by itself make the platform HIPAA/compliant-with-anything; that requires a separate, explicit assessment.

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

- `@Roles(...)` on a controller method declares which roles may call it; `RolesGuard` enforces it. `SUPER_ADMIN` always passes (it's a platform-level role, not a bypass of tenant checks — see below). Currently used only by `patients/` (left as-is; out of Phase 2 scope).
- `@RequirePermissions(...)` (Phase 2) declares which permissions a route needs; `PermissionsGuard` checks them against `common/constants/permissions.constants.ts`'s `ROLE_PERMISSIONS` map. **No implicit `SUPER_ADMIN` bypass** — a role passes only if its map entry explicitly lists every required permission. `users/` and `hospitals/` use this instead of `@Roles()`. Permissions modeled today: `hospital.read/create/update/list`, `user.read/create/update/deactivate`, `role.assign` — deliberately a small, explicit set (master doc §13: "do not implement hundreds of permissions prematurely"), not an attempt to model every future permission.
- No `@Roles()`/`@RequirePermissions()` on a route means "any authenticated role" — used sparingly (`GET /auth/me`, `GET /hospitals/:id`, where the service layer does the real tenant check).
- Least privilege is enforced at the service layer beyond the route-level check: e.g. a `HOSPITAL_ADMIN` is blocked from creating another `HOSPITAL_ADMIN` or a `SUPER_ADMIN` (`ROLE_NOT_ALLOWED`), even though the route itself is open to `HOSPITAL_ADMIN`.

### Platform administration vs. clinical access (master doc §14)

`SUPER_ADMIN` is explicitly a **platform administration** role, not an implicit "can see everything" role. This is enforced two ways:
1. `ROLE_PERMISSIONS[SUPER_ADMIN]` only lists `hospital.*`/`user.*`/`role.assign` — no clinical permission exists in the map at all, so there is nothing for `SUPER_ADMIN` (or anyone) to implicitly inherit.
2. **`patients.service.ts` does not grant `SUPER_ADMIN` a tenant-scoping bypass** (fixed in Phase 2 — see `/DECISIONS.md`). Before this fix, `findAllForTenant` and `getTenantScopedPatientOrThrow` both skipped the `hospitalId` filter for `SUPER_ADMIN`, meaning a platform administrator could list or fetch *any* patient in *any* hospital — a direct violation of this principle. Both call sites now require `actor.hospitalId` unconditionally; `SUPER_ADMIN` (which always has `hospitalId: null`) gets the same `403 TENANT_CONTEXT_MISSING` / `404 PATIENT_NOT_FOUND` as any other caller with no hospital context. `RolesGuard`'s own "`SUPER_ADMIN` always passes" behavior was deliberately left unchanged for `patients/` — the fix is at the service layer (where this codebase's tenant-scoping has always lived), not by special-casing the guard.

## Tenant isolation

This is the control the master doc treats as non-negotiable (§8, §9, §30), so it's worth being explicit about the mechanism:

1. A user's `hospitalId` is resolved once, at login, from the database — never from client input — and embedded in the signed access token.
2. Every tenant-scoped service method receives the authenticated user (via `@CurrentUser()`) and uses `actor.hospitalId`, never a client-supplied `hospitalId`, to decide what the caller may write or which tenant a new record belongs to. See `users.service.ts#resolveTargetHospitalId` for the concrete logic, and the `tenant-isolation.e2e-spec.ts` test "a HOSPITAL_ADMIN cannot plant a user into a different hospital via the request body" for proof the client-supplied value is actually ignored, not just validated.
3. Reads of a specific resource by ID (`GET /users/:id`, `GET /hospitals/:id`) check `resource.hospitalId === actor.hospitalId` (or `actor.role === SUPER_ADMIN`) and return **404**, not 403, on mismatch — see `/DECISIONS.md` for the reasoning (avoid confirming the resource exists in a tenant the caller can't see).
4. List endpoints (`GET /users`) filter by `actor.hospitalId` at the database query level (`where: { hospitalId: actor.hospitalId }`), not by filtering an unscoped result set after the fact.

This is exercised end-to-end by `apps/api/test/tenant-isolation.e2e-spec.ts`, which implements the exact A/B matrix the master doc requires (§30): Hospital A, Hospital B, a data record in each, and assertions that A→A and B→B succeed while A→B and B→A are both denied — **for Users and Hospitals only.** The Patients module (`patients.service.ts`) implements the identical pattern (`getTenantScopedPatientOrThrow`, same 404-not-403 design), but **has no test proving it** — no tenant-isolation coverage, no unit tests. Code-reading suggests it's correct; master doc §41 ("never assume... tenant isolation works") is exactly why that isn't good enough yet. Closing this gap is the top-priority item before Patient reaches Definition of Done (§44).

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

Every security-relevant action writes an `AuditLog` row via `AuditService.log()`: `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `USER_REGISTERED`, `USER_CREATED`, `USER_UPDATED`, `REFRESH_TOKEN_REUSED`, `HOSPITAL_CREATED`, `HOSPITAL_UPDATED`, `PATIENT_REGISTERED`, `PATIENT_ACCESSED`, `PATIENT_UPDATED`. A failure to write an audit row is logged but **never** blocks or fails the primary request — audit logging is observability, not a transactional guarantee, and must not become an availability dependency for login/registration.

## Rate limiting

A global `ThrottlerGuard` is configured via `AUTH_THROTTLE_TTL_SECONDS` / `AUTH_THROTTLE_LIMIT` (default: 10 requests / 60s per client). Phase 1 has few enough routes that a single global limit is adequate; per-route tiered limits (e.g., looser limits on read endpoints, tighter on `/auth/login`) are a reasonable addition once more endpoints exist. Exercised by `test/rate-limit.e2e-spec.ts` (Phase 2) — written but not executed in this environment, see `/TESTING.md`.

## Mass assignment

The global `ValidationPipe`'s `forbidNonWhitelisted: true` is the actual control (§35 above) — an unrecognized field like `isSuperAdmin: true` in a request body is rejected with `400`, not silently dropped or accepted. `test/security.e2e-spec.ts` (Phase 2) asserts this directly against `POST /users`, in addition to the existing proof that a client-supplied `hospitalId` is ignored, not validated-and-trusted (`tenant-isolation.e2e-spec.ts`).

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
- No automated test coverage for Patient tenant isolation or concurrent-registration MRN safety — see the note under "Tenant isolation" above.
- The generated Prisma migration (`20261005000000_init`) has never been applied to a real Postgres instance — Docker Desktop cannot start in this environment. See `/DATABASE.md`.
- `apps/api/test/*.e2e-spec.ts` (all of them, Phase 1 and Phase 2 alike) have never been executed here for the same reason — `createTestApp()` calls `PrismaService.$connect()`, which requires a live database. See `/TESTING.md`.

These are explicitly deferred, not accidentally missed — see the Phase 1 and Phase 2 reports for what's recommended for later phases (Phase 7 is production hardening).
