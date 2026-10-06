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
| `health/` | `/api/v1/health` (combined check), `/health/live` (process-only, no dependency checks), `/health/ready` (same Postgres/Redis checks as the combined one — Phase 5 split liveness from readiness so a transient DB blip doesn't look like a reason to restart the process, see `/DECISIONS.md`), `/health/metrics` (Prometheus text, via `metrics/`). |
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
| `connect/` (Phase 5) | **HospitalOS Connect.** `DiscoveryController`/`DiscoveryService` (public, no auth — hospital/doctor/available-slots browsing, hand-picked response DTOs, never a raw Prisma row); `PatientController` (requires `PATIENT_PORTAL_ACCESS`) exposing booking/appointment-management/queue-status/medical-records/record-claiming, backed by `PatientQueueService` and `PatientMedicalRecordsService` — both separate query surfaces from the staff-side `queue/`/`clinical/` services on purpose, so the patient-safety visibility rules (no `DRAFT` clinical data, no unverified lab values, no other patient's identity) can't be weakened by a future staff-side change. Depends on `doctors/`, `appointments/`, `patients/`. |
| `notifications/` (Phase 5) | Provider-neutral `NotificationsService` + `NotificationProvider` interface — `LogNotificationProvider` is the only concrete implementation wired up (no email/SMS vendor credentials exist in this environment; see `/DECISIONS.md`). Every send is also recorded as an `AuditLog` row (`NOTIFICATION_SENT`/`NOTIFICATION_FAILED`); a provider failure never throws into the caller's request path. Triggered from `appointments/` (booking/cancellation) and `queue/` (call-next), both as best-effort fire-and-forget. |
| `metrics/` (Phase 5) | Hand-rolled, dependency-free Prometheus counters (`MetricsService` + a global `MetricsInterceptor`) — no prom-client added for what the current scope needs. Route labels are the route *pattern*, never a raw URL, to avoid unbounded cardinality. Exposed at `/health/metrics`. |

All 14 modules through Phase 5 are **unverified in the same sense `patients/` was** for anything requiring a live database: migrations generated but never applied, e2e tests written but never executed — see `/DATABASE.md` and `/TESTING.md`. Every module has full unit-test coverage of its business logic (280 unit tests passing as of Phase 5, up from 215). `nest build`'s clean exit confirms every new Phase 5 provider is syntactically wired into its module correctly (a genuinely missing/circular dependency is a compile-time error in NestJS with `emitDecoratorMetadata`), but — correcting an overclaim caught while writing this update — that is *not* the same proof as the Phase 4 doc's `Test.createTestingModule({imports:[AppModule]}).compile()` check, which actually instantiates the DI graph. Attempting to re-run that exact check for Phase 5 hung (something in the global `RedisModule`/`ThrottlerModule` provider wiring appears to attempt a real connection during provider instantiation, independent of lifecycle hooks) rather than confirming cleanly — so for Phase 5, treat the full instantiated-DI-graph claim as **not re-verified**, only the compile-time wiring.

## Request pipeline

Every request passes through, in order:

1. **CorrelationIdMiddleware** — reads/generates `x-correlation-id`, attaches it to the request and response, so a given request can be traced through logs and audit rows.
2. **ThrottlerGuard** — two tiers as of Phase 5: a generous global `default` bucket (`DEFAULT_THROTTLE_*`) for every route, plus a per-route `@Throttle()` override on `/auth/{register,register-patient,login,refresh}` using the original, stricter `AUTH_THROTTLE_*` budget. Splitting these was itself a Phase 5 fix — see `/DECISIONS.md` for the bug (every route briefly shared the strict budget).
3. **JwtAuthGuard** — validates the `Authorization: Bearer` access token, unless the route is marked `@Public()`.
4. **PermissionsGuard** — checks `@RequirePermissions(...)` metadata against the caller's role via the explicit `ROLE_PERMISSIONS` map (`common/constants/permissions.constants.ts`). No implicit `SUPER_ADMIN` bypass — a role only passes a permission check if that permission is explicitly listed for it. Every module uses this (see `/SECURITY.md` and `/DECISIONS.md`). The earlier `@Roles()`/`RolesGuard` mechanism (Phase 1/2) was removed in Phase 3 once `patients/` — the last holdout — migrated to permissions, leaving it dead code.
5. **ValidationPipe** (global) — `whitelist: true, forbidNonWhitelisted: true, transform: true`. Unknown body fields are rejected, not silently dropped or accepted.
6. Controller → Service — services, not controllers, own tenant-scoping and business rules. Controllers are thin.
7. **MetricsInterceptor** (Phase 5, global) — records request count/duration per (method, route-pattern, status) via `response.on('finish', ...)`, not a `tap()` on the handler's observable (timing-fragile — see `/DECISIONS.md`). Purely observational; never alters the response.
8. **AllExceptionsFilter** / **ResponseInterceptor** — every response, success or failure, leaves the API in the same envelope shape (see `/API.md`). `/health/metrics` is the one deliberate exception — it bypasses `ResponseInterceptor` via `@Res()` to return raw Prometheus text, not the JSON envelope.

## Tenant model

See `/SECURITY.md` for the full tenant isolation design. Short version: the authenticated user's `hospitalId` (carried in the JWT access token payload) is the only source of truth for "which tenant does this request belong to." Services never trust a client-supplied `hospitalId` for writes, and cross-tenant reads return `404`, not `403`.

**Phase 5 nuance:** `Role.PATIENT` also has `hospitalId: null`, same as `SUPER_ADMIN` — but for a completely different reason (a Connect account isn't scoped to one hospital at all, vs. a platform administrator having none). Every tenant-scoping helper in this codebase (`assertSameTenant`/`assertSameTenantStrict`/`resolveTenantHospitalId`) checks `actor.role !== Role.SUPER_ADMIN` explicitly, never "is `hospitalId` null" — confirmed during the Phase 5 security-hardening pass specifically to rule out a `PATIENT` actor piggy-backing on logic that was written assuming only `SUPER_ADMIN` has a null `hospitalId`. Connect's own ownership model is a third, separate mechanism entirely: `Patient.userId === actor.userId`, never a hospitalId comparison at all — see `connect/` in the module map above.

## Frontend (`apps/web`)

Next.js 14 (App Router) + React 18 + TypeScript. Phase 2 built the auth foundation (`/login`, `/register`, `/dashboard`); Phase 3 adds the operational pages: `/departments`, `/doctors`, `/patients` + `/patients/[id]`, `/appointments` + `/appointments/[id]` (booking, cancellation, rescheduling), `/queues` + `/queues/[id]` (the live queue dashboard — call-next, skip, start consultation, complete, requeue). `src/components/app-shell.tsx` is the shared header/nav wrapper every operational page uses. `src/lib/auth-context.tsx` now exposes `authedRequest<T>()` — every operational page calls the API through this rather than the lower-level `apiRequest` directly, so the current access token and its silent-refresh-on-401 behavior are never duplicated per page. The queue dashboard polls every 5s rather than using WebSockets (master doc §75: "queue state must be correct; real-time presentation can be improved later").

Client-side redirects and role-based UI hiding (e.g. only showing "Register patient" to non-`ACCOUNTANT` roles) are UX convenience only, never the security boundary — every API call is independently authorized server-side regardless of what the UI shows or hides.

**Phase 5:** this frontend was built before `Role.PATIENT` existed, so a valid Connect session logging into this staff portal would otherwise land on a staff dashboard full of links it has no permission to use. Fixed in two places — `login/page.tsx`'s submit handler (the interactive-login path) and `use-require-auth.ts` (the silent-refresh-on-page-load path, which the login-page check alone can't catch) — both log a `PATIENT` session back out immediately with a clear message rather than rendering broken staff UI. See `/DECISIONS.md`.

## What's deliberately not here yet

Insurance, AI, analytics, telemedicine, microservices decomposition — all explicitly out of scope per the Phase 5 master doc's own closing instruction, not just deferred-by-convention. **HospitalOS Connect has no frontend at all** — Phase 5 built the full API surface (discovery, booking, queue status, medical records — see `/API.md`) but zero `apps/web` pages for it, same "backend/API first" pattern Phase 4 established for clinical/lab/pharmacy/billing. Within Connect's own scope: no family/dependent-profile delegation (one account, one linked record per hospital — see `/DECISIONS.md`), no real notification delivery (log-based provider only — see `/DECISIONS.md`), no reschedule endpoint (cancel-and-rebook instead). Structured (JSON) logging remains deferred, flagged since Phase 1 and still not built — see `/SECURITY.md` and `/DECISIONS.md`. **Phase 4 remained backend-only for its own modules** — no `apps/web` pages for any clinical/laboratory/pharmacy/billing/payments resource exist yet either, unlike Phase 3 which shipped both; see `/DECISIONS.md`.
