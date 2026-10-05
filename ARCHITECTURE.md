# Architecture

## Overview

HospitalOS is a **modular monolith** (master doc §6) — one deployable NestJS application, organized into feature modules with clear boundaries, backed by a single PostgreSQL database and Redis. No microservices, no event bus, no second database. Scale based on evidence, not speculation (§38).

```
                    HOSPITALOS
                         |
          +--------------+--------------+
          |                             |
     HospitalOS Web               HospitalOS Connect
     (Next.js, Phase 1+)          (Next.js, Phase 5+)
          |                             |
          +--------------+--------------+
                         |
                    API Layer (NestJS, /api/v1)
                         |
                    Correlation ID middleware
                         |
                 ThrottlerGuard (rate limiting)
                         |
                 JwtAuthGuard (authentication)
                         |
                  RolesGuard (RBAC)
                         |
                 Business Modules (tenant-scoped services)
                         |
                   PrismaService
                         |
                +--------+--------+
                |                 |
            PostgreSQL          Redis
```

## Monorepo layout

```
HospitalOS/
  apps/
    api/            NestJS backend
    web/            Next.js frontend — auth foundation only (Phase 2): register, login, protected dashboard shell
  docker-compose.yml  Postgres + Redis for local dev
  docker/postgres/   DB init script (creates the hospitalos_test database)
```

## `apps/api` module map

| Module | Responsibility |
|---|---|
| `config/` | Env loading + Joi validation (`envValidationSchema`) — the app refuses to boot with missing/invalid env vars rather than silently running with defaults for secrets. |
| `common/` | Cross-cutting concerns: global exception filter, response envelope interceptor, `@Public`/`@Roles`/`@RequirePermissions`/`@CurrentUser` decorators, `JwtAuthGuard`, `RolesGuard`, `PermissionsGuard`, the Role→Permission map (`common/constants/permissions.constants.ts`), correlation-id middleware, shared utils. |
| `prisma/` | `PrismaService` — a single global, injectable Prisma client. |
| `redis/` | A global `ioredis` client provider (`REDIS_CLIENT` token). Currently used by the health check only; reserved for caching/session use in later phases. |
| `audit/` | `AuditService.log()` — the one place audit log rows get written. Never throws into the caller's request path (see `/SECURITY.md`). |
| `auth/` | Registration (bootstrap-only), login, refresh (rotation + reuse detection), logout, `/me`. |
| `users/` | Tenant-scoped user CRUD, enforcing who-can-create-what-role-where. |
| `hospitals/` | Tenant (Hospital) CRUD. Creation/listing/editing is `SUPER_ADMIN`-only; reading is tenant-scoped. |
| `health/` | `/api/v1/health` — liveness check against Postgres and Redis via `@nestjs/terminus`. |
| `patients/` | Patient registration, hospital-scoped MRN issuance, search/list/update. Implemented and wired in, but **unverified** — no migration, no tests. See `/DATABASE.md`. |

## Request pipeline

Every request passes through, in order:

1. **CorrelationIdMiddleware** — reads/generates `x-correlation-id`, attaches it to the request and response, so a given request can be traced through logs and audit rows.
2. **ThrottlerGuard** — global rate limit (env-configurable; see `AUTH_THROTTLE_*`).
3. **JwtAuthGuard** — validates the `Authorization: Bearer` access token, unless the route is marked `@Public()`.
4. **RolesGuard** — checks `@Roles(...)` metadata against the authenticated user's role. `SUPER_ADMIN` always passes. No `@Roles()` on a route means "any authenticated role." Still used by `patients/` (unmodified, out of Phase 2 scope).
5. **PermissionsGuard** — checks `@RequirePermissions(...)` metadata against the caller's role via the explicit `ROLE_PERMISSIONS` map (`common/constants/permissions.constants.ts`). No implicit `SUPER_ADMIN` bypass — a role only passes a permission check if that permission is explicitly listed for it. `users/` and `hospitals/` use this instead of `@Roles()` (see `/SECURITY.md` and `/DECISIONS.md`).
6. **ValidationPipe** (global) — `whitelist: true, forbidNonWhitelisted: true, transform: true`. Unknown body fields are rejected, not silently dropped or accepted.
7. Controller → Service — services, not controllers, own tenant-scoping and business rules. Controllers are thin.
8. **AllExceptionsFilter** / **ResponseInterceptor** — every response, success or failure, leaves the API in the same envelope shape (see `/API.md`).

## Tenant model

See `/SECURITY.md` for the full tenant isolation design. Short version: the authenticated user's `hospitalId` (carried in the JWT access token payload) is the only source of truth for "which tenant does this request belong to." Services never trust a client-supplied `hospitalId` for writes, and cross-tenant reads return `404`, not `403`.

## Frontend (`apps/web`)

Next.js 14 (App Router) + React 18 + TypeScript. Phase 2 scope only (master doc §44): `/login`, `/register` (bootstrap-only — see `/DECISIONS.md`), and `/dashboard` (a protected shell showing the caller's name/role/hospital and a logout button — not the full hospital dashboard). `src/lib/api-client.ts` is the single fetch wrapper every page uses (base URL, auth header, response-envelope unwrapping, single-flight silent refresh-and-retry on 401). `src/lib/auth-context.tsx` holds the access token in memory only (never `localStorage`/`sessionStorage`) and re-establishes a session on page load via the httpOnly refresh cookie. Client-side redirects (`/` and `/dashboard`) are UX convenience only, never the security boundary — every API call is independently authorized server-side regardless of what the UI shows or hides.

## What's deliberately not here yet

Scheduling, clinical records, laboratory, pharmacy, billing — all out of scope until their respective phases per the master roadmap (§27). Patient/MRN is implemented (`patients/`) but still not verified end-to-end — see `/DATABASE.md` and `/TESTING.md`. A full hospital-management frontend (beyond the auth shell above) is also future scope.
