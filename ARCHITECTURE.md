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
               PermissionsGuard (RBAC, §13)
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
    web/            Next.js frontend — auth foundation (Phase 2) + operational pages (Phase 3)
  docker-compose.yml  Postgres + Redis for local dev
  docker/postgres/   DB init script (creates the hospitalos_test database)
```

## `apps/api` module map

| Module | Responsibility |
|---|---|
| `config/` | Env loading + Joi validation (`envValidationSchema`) — the app refuses to boot with missing/invalid env vars rather than silently running with defaults for secrets. |
| `common/` | Cross-cutting concerns: global exception filter, response envelope interceptor, `@Public`/`@RequirePermissions`/`@CurrentUser` decorators, `JwtAuthGuard`, `PermissionsGuard`, the Role→Permission map (`common/constants/permissions.constants.ts`), correlation-id middleware, shared utils — including Phase 3's `tenant.util.ts` (shared tenant-resolution/cross-tenant-check helpers) and `timezone.util.ts` (IANA-timezone-aware date math, no external dependency — see `/DECISIONS.md`). |
| `prisma/` | `PrismaService` — a single global, injectable Prisma client. |
| `redis/` | A global `ioredis` client provider (`REDIS_CLIENT` token). Currently used by the health check only; reserved for caching/session use in later phases. |
| `audit/` | `AuditService.log()` — the one place audit log rows get written. Never throws into the caller's request path (see `/SECURITY.md`). |
| `auth/` | Registration (bootstrap-only), login, refresh (rotation + reuse detection), logout, `/me`. |
| `users/` | Tenant-scoped user CRUD, enforcing who-can-create-what-role-where. |
| `hospitals/` | Tenant (Hospital) CRUD. Creation/listing/editing is `SUPER_ADMIN`-only; reading is tenant-scoped. |
| `health/` | `/api/v1/health` — liveness check against Postgres and Redis via `@nestjs/terminus`. |
| `patients/` | Patient registration, hospital-scoped MRN issuance, search/list/update, duplicate-registration detection (Phase 3). |
| `departments/` | Tenant-scoped department CRUD (no hard delete — deactivation only). |
| `doctors/` | `DoctorProfile` (attached to an existing `User`, never a separate identity), `DoctorSchedule` (recurring weekly availability), `DoctorUnavailability` (one-off blocked ranges), and computed `available-slots`. Exports `getTenantScopedDoctorOrThrow`/`getAvailableSlots` for reuse by `appointments/`. |
| `appointments/` | Booking, cancellation, rescheduling (preserves history via `rescheduledFromId`), no-show marking. Owns the `AppointmentStatus` state machine (`assertTransitionAllowed`, exported for reuse by `queue/`). |
| `queue/` | Check-in (`QueueEntriesController`), queue retrieval (`QueuesController`), and the concurrency-safe `call-next` claim. Depends on `appointments/` (one-directional — `appointments/` has no dependency back on `queue/`). |
| `clinical/` (Phase 4) | `Encounter` (the clinical visit itself — started only once Phase 3's queue module has moved an appointment to `IN_CONSULTATION`, or as a walk-in), `VitalSigns`, `ClinicalNote`, `Diagnosis`, `Prescription`/`PrescriptionItem`. Depends on `patients/`, `doctors/`, `appointments/`. Exports `EncountersService` (`getTenantScopedEncounterOrThrow`/`assertOwnEncounter`, reused by `laboratory/`) and `PrescriptionsService` (`getTenantScopedPrescriptionOrThrow`, reused by `pharmacy/`). |
| `laboratory/` (Phase 4) | `LabTest` catalog, `LabOrder`/`LabOrderItem`, specimen collection, `LabResult` entry/verification/amendment. Depends on `clinical/` (encounter ownership checks) only — validates `LabTest`/`Medicine` references via its own catalog, not a cross-module call. |
| `pharmacy/` (Phase 4) | `Medicine` catalog, `StockBatch` inventory, `StockMovement` audit trail, FEFO `DispenseRecord` creation. Deliberately has **zero** dependency on `clinical/` — validates a `prescriptionItemId` reference via a direct Prisma query on the shared schema rather than injecting `ClinicalModule`, mirroring how `clinical/`'s own `PrescriptionsService` validates `Medicine` the same way before `pharmacy/` existed (see `/DECISIONS.md`). |
| `billing/` (Service catalog + Invoices, Phase 4) | `Service` catalog with price history (`ServicePrice`, "current" = `effectiveTo: null`), `Invoice`/`InvoiceItem`. No module dependencies — validates `Patient`/`Encounter`/`Medicine`-adjacent references directly. Exports `InvoicesService` (`applyPayment`/`applyRefund`, transaction-aware, reused by `payments/`). |
| `payments/` (Phase 4) | `Payment` (idempotency-key supported) and `Refund`, both against an `Invoice`. Depends on `billing/` only. |

All ten modules through Phase 4 are **unverified in the same sense `patients/` was**: migration generated but never applied, e2e tests written but never executed — see `/DATABASE.md` and `/TESTING.md`. Every module has full unit-test coverage of its business logic (215 unit tests passing as of Phase 4, up from 96). The full dependency-injection graph across all 11 modules (counting `AppModule` itself) was independently confirmed to resolve cleanly via `Test.createTestingModule({imports:[AppModule]}).compile()` — see `/TESTING.md`.

## Request pipeline

Every request passes through, in order:

1. **CorrelationIdMiddleware** — reads/generates `x-correlation-id`, attaches it to the request and response, so a given request can be traced through logs and audit rows.
2. **ThrottlerGuard** — global rate limit (env-configurable; see `AUTH_THROTTLE_*`).
3. **JwtAuthGuard** — validates the `Authorization: Bearer` access token, unless the route is marked `@Public()`.
4. **PermissionsGuard** — checks `@RequirePermissions(...)` metadata against the caller's role via the explicit `ROLE_PERMISSIONS` map (`common/constants/permissions.constants.ts`). No implicit `SUPER_ADMIN` bypass — a role only passes a permission check if that permission is explicitly listed for it. Every module uses this (see `/SECURITY.md` and `/DECISIONS.md`). The earlier `@Roles()`/`RolesGuard` mechanism (Phase 1/2) was removed in Phase 3 once `patients/` — the last holdout — migrated to permissions, leaving it dead code.
5. **ValidationPipe** (global) — `whitelist: true, forbidNonWhitelisted: true, transform: true`. Unknown body fields are rejected, not silently dropped or accepted.
6. Controller → Service — services, not controllers, own tenant-scoping and business rules. Controllers are thin.
7. **AllExceptionsFilter** / **ResponseInterceptor** — every response, success or failure, leaves the API in the same envelope shape (see `/API.md`).

## Tenant model

See `/SECURITY.md` for the full tenant isolation design. Short version: the authenticated user's `hospitalId` (carried in the JWT access token payload) is the only source of truth for "which tenant does this request belong to." Services never trust a client-supplied `hospitalId` for writes, and cross-tenant reads return `404`, not `403`.

## Frontend (`apps/web`)

Next.js 14 (App Router) + React 18 + TypeScript. Phase 2 built the auth foundation (`/login`, `/register`, `/dashboard`); Phase 3 adds the operational pages: `/departments`, `/doctors`, `/patients` + `/patients/[id]`, `/appointments` + `/appointments/[id]` (booking, cancellation, rescheduling), `/queues` + `/queues/[id]` (the live queue dashboard — call-next, skip, start consultation, complete, requeue). `src/components/app-shell.tsx` is the shared header/nav wrapper every operational page uses. `src/lib/auth-context.tsx` now exposes `authedRequest<T>()` — every operational page calls the API through this rather than the lower-level `apiRequest` directly, so the current access token and its silent-refresh-on-401 behavior are never duplicated per page. The queue dashboard polls every 5s rather than using WebSockets (master doc §75: "queue state must be correct; real-time presentation can be improved later").

Client-side redirects and role-based UI hiding (e.g. only showing "Register patient" to non-`ACCOUNTANT` roles) are UX convenience only, never the security boundary — every API call is independently authorized server-side regardless of what the UI shows or hides.

## What's deliberately not here yet

Insurance, AI, analytics, and HospitalOS Connect public discovery — all out of scope until their respective later phases per the master roadmap (§3, §27). Patient-role self-service (a patient viewing their own queue position or lab results, per master doc §55) is also deferred — `Role.PATIENT` currently has zero operational permissions; see `/SECURITY.md`. **Phase 4 is backend-only by explicit scope decision** — no `apps/web` pages for any clinical/laboratory/pharmacy/billing/payments resource exist yet, unlike Phase 3 which shipped both; see `/DECISIONS.md`.
