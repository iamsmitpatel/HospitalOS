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

Routes are gated one of two ways (see `/ARCHITECTURE.md` and `/SECURITY.md` for the mechanism): `@Roles(...)` (simple role allow-list, `SUPER_ADMIN` always passes — used by `patients/`) or `@RequirePermissions(...)` (checks the caller's role against an explicit `ROLE_PERMISSIONS` map, no implicit bypass — used by `users/` and `hospitals/` as of Phase 2). Both end up enforcing the same per-route table below; the permission-based routes are just centralized rather than hand-checked per controller.

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

**Status: implemented in code, not yet verified end-to-end** — the build compiles, but there is no database migration and no test coverage for this module yet (see `/DATABASE.md` and `/TESTING.md`). Treat as unverified until those gaps close.

| Method & path | Auth | Notes |
|---|---|---|
| `POST /patients` | `HOSPITAL_ADMIN`, `DOCTOR`, `NURSE`, `RECEPTIONIST` | Registers a patient and issues a hospital-scoped MRN. `SUPER_ADMIN` cannot call this (no hospital context to register against — `403 TENANT_CONTEXT_MISSING`). |
| `GET /patients` | Write roles + `PHARMACIST`, `LAB_TECHNICIAN`, `ACCOUNTANT` | Paginated, tenant-filtered list. Supports `?search=` across name/MRN/phone, `?page=`, `?pageSize=`. **`SUPER_ADMIN` also receives `403 TENANT_CONTEXT_MISSING`** (fixed in Phase 2 — previously returned every patient across every tenant; see `/SECURITY.md`). |
| `GET /patients/:id` | Same read roles | `404 PATIENT_NOT_FOUND` if the patient doesn't exist *or* belongs to a different tenant — including for `SUPER_ADMIN` as of Phase 2. |
| `PATCH /patients/:id` | Same write roles | Updates demographic/contact fields and `isActive`; `mrn` is immutable. |

## Health — `/api/v1/health`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /health` | Public | Checks live connectivity to Postgres (`SELECT 1` via Prisma) and Redis (`PING`). Returns Terminus's standard health-check shape (not wrapped in the success envelope, since monitoring tools expect the raw Terminus format). |

## Correlation IDs

Every response carries an `x-correlation-id` header — echoed from the request if the caller supplied one, generated otherwise. Include it when reporting a bug; it's what ties a client-visible error to the corresponding server log line and (where applicable) audit log row.

## Not yet implemented

Doctors, appointments, queues, prescriptions, laboratory, billing — none of these exist yet; they're Phase 2+ scope per the master roadmap.
