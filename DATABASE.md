# Database

PostgreSQL is the source of truth for all persistent business data. Schema is managed exclusively through Prisma Migrate — never hand-edit the schema in production, never reset a production database casually (master doc §17, §43).

## Phase 1 schema

Defined in `apps/api/prisma/schema.prisma`.

### `hospitals` (tenant)

| Column | Notes |
|---|---|
| `id` | UUID PK |
| `name` | Display name |
| `slug` | Unique, URL-safe — reserved for future public hospital-discovery URLs (HospitalOS Connect, Phase 5) |
| `code` | Unique, uppercase, short — the MRN prefix (e.g. `SUN` → `SUN-000001`). Set once at creation, not editable afterward. |
| `mrnSequence` | Monotonic per-hospital counter backing MRN generation. Incremented via a single atomic `UPDATE ... increment` inside the same transaction that creates the patient — see `## MRN` below. |
| `isActive` | Soft deactivation flag |

### `users` (identity)

| Column | Notes |
|---|---|
| `id` | UUID PK |
| `email` | Globally unique, lowercased before storage |
| `passwordHash` | bcrypt, cost from `BCRYPT_SALT_ROUNDS` (default 12) |
| `role` | `Role` enum — see below |
| `hospitalId` | **Nullable.** Null only for `SUPER_ADMIN`. Every other role must have a hospital. This rule is enforced in `users.service.ts`, **not** a DB constraint — see `/DECISIONS.md` for why, and the hardening note about adding a CHECK constraint later. |
| `isActive` | Disabling a user without deleting their history |

`Role` enum: `SUPER_ADMIN, HOSPITAL_ADMIN, DOCTOR, NURSE, RECEPTIONIST, PHARMACIST, LAB_TECHNICIAN, ACCOUNTANT, PATIENT` (master doc §10; `PATIENT` is reserved for Phase 5 and unused by any Phase 1 code path).

### `refresh_tokens` (auth session state)

| Column | Notes |
|---|---|
| `id` | UUID PK — also used as the JWT `jti` claim |
| `tokenHash` | SHA-256 of the raw refresh token string, unique. Deterministic (not bcrypt) because it must be looked up by exact match; see `/SECURITY.md` for the full rotation/reuse design. |
| `revokedAt` | Null while active |
| `replacedByTokenId` | Set when rotated, forming a chain used for reuse detection |

### `audit_logs` (security/audit)

| Column | Notes |
|---|---|
| `actorUserId` | Nullable — e.g. failed logins have no authenticated actor |
| `hospitalId` | Nullable — e.g. platform-level `SUPER_ADMIN` actions |
| `action` | String constant from `audit.constants.ts` (`AuditAction`) |
| `outcome` | `SUCCESS \| FAILURE` |
| `metadata` | JSON — **non-sensitive structured context only.** Never passwords, tokens, OTPs, or clinical payloads (§21). |

Indexed on `[hospitalId, createdAt]`, `actorUserId`, and `action` for the query patterns an audit/compliance view would need.

### `patients`

| Column | Notes |
|---|---|
| `id` | UUID PK |
| `hospitalId` | Required (not nullable) — every patient belongs to exactly one hospital |
| `mrn` | Hospital-scoped identifier, e.g. `SUN-000001`. Unique per hospital via `@@unique([hospitalId, mrn])`, **not** globally unique — see `## MRN` below |
| `firstName`, `lastName`, `dateOfBirth`, `gender`, `phone`, `email`, `addressLine`, `emergencyContactName`, `emergencyContactPhone` | Minimal Phase 1B fields — a single free-text address line rather than a normalized address table (master doc §18: "do not build all of these immediately") |
| `registeredByUserId` | FK to the `User` who created the record |
| `isActive` | Soft deactivation flag |

Indexed on `[hospitalId, lastName, firstName]` and `[hospitalId, phone]` for search; `@@unique([hospitalId, mrn])` enforces MRN uniqueness at the database level, not just in application code (satisfying master doc §19's explicit requirement).

## Phase 3 schema: Hospital Operations Core

Added to `apps/api/prisma/schema.prisma` in Phase 3. `hospitals` also gained a `timezone` column (`String @default("Asia/Kolkata")`) — every `DoctorSchedule` wall-clock time is interpreted in the owning hospital's timezone (master doc §34), never the server's.

### `departments`

| Column | Notes |
|---|---|
| `hospitalId` | Required — tenant-scoped, `@@unique([hospitalId, code])` and `@@unique([hospitalId, name])` |
| `code` | Short uppercase identifier (e.g. `CARD`), immutable after creation (not in `UpdateDepartmentDto`) |
| `isActive` | Deactivation, not deletion — healthcare records preserve historical references (master doc §9/§61) |

### `doctor_profiles`

| Column | Notes |
|---|---|
| `userId` | `@unique` FK to `User` — a `DoctorProfile` is always attached to an *existing* `User` with `role=DOCTOR`, never a separate identity (master doc §11). Account creation stays in `users/`; `doctors.service.ts` only attaches professional metadata. |
| `hospitalId`, `departmentId` | Tenant and department scope |
| `registrationNumber` | Optional. `@@unique([hospitalId, registrationNumber])` — unique per hospital, not globally (Postgres allows multiple `NULL`s, so doctors without one on file don't collide). Not format-validated — no universal professional-registration format exists (§13) |
| `status` | `DoctorStatus`: `ACTIVE \| INACTIVE \| SUSPENDED`. Non-`ACTIVE` doctors are excluded from `GET /doctors/:id/available-slots` and rejected by `POST /appointments` (§15) |

### `doctor_schedules`

Recurring weekly availability. `dayOfWeek` (`DayOfWeek` enum) + `startTime`/`endTime` as **`"HH:mm"` strings**, not `DateTime` — a recurring pattern has no single calendar date, and storing wall-clock strings avoids baking in a specific UTC offset that would drift across DST or the wrong hospital timezone. Overlap prevention (master doc §82) is enforced in `doctors.service.ts` (`assertNoScheduleOverlap`) by comparing `HH:mm` strings lexicographically — valid because they're always zero-padded 24h format (`common/utils/timezone.util.ts#compareHhMm`).

### `doctor_unavailabilities`

One-off blocked ranges (leave, holiday) as absolute UTC `startAt`/`endAt` instants — unlike `doctor_schedules`, these are date-specific, not recurring, so an absolute timestamp is correct here.

### `appointments`

| Column | Notes |
|---|---|
| `status` | `AppointmentStatus`: `SCHEDULED, CONFIRMED, CHECKED_IN, IN_QUEUE, IN_CONSULTATION, COMPLETED, CANCELLED, NO_SHOW`. State machine enforced in `appointments.service.ts` (`ALLOWED_TRANSITIONS`) — see `/SECURITY.md`. `CHECKED_IN` exists in the enum but is unreachable via any Phase 3 endpoint; see `/DECISIONS.md`. |
| `scheduledAt` | Absolute UTC instant. Conflict prevention is **not** a plain `@@unique` — see the partial index below. |
| `rescheduledFromId` | `@unique` self-FK. Rescheduling never overwrites the original row: the old appointment is marked `CANCELLED` (`cancellationReason: 'RESCHEDULED'`) and a new row is created pointing back at it, preserving full history (master doc §42/§43). |

**Conflict prevention — a hand-added partial unique index, not expressible in `schema.prisma`:**

```sql
CREATE UNIQUE INDEX "appointments_doctor_active_slot_unique"
  ON "appointments" ("doctorProfileId", "scheduledAt")
  WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');
```

Prisma's schema DSL has no syntax for a filtered/partial unique index, so this is appended by hand to the Phase 3 migration SQL (see "Running migrations" below) and does not appear in `schema.prisma` itself — only a regular (non-unique) `@@index` does, for query performance. The `WHERE` clause matters: a plain unique constraint on `(doctorProfileId, scheduledAt)` would permanently block rebooking a slot whose original appointment was later cancelled, which is wrong. `appointments.service.ts` does a transactional availability pre-check before insert (reusing `doctors.service.ts#getAvailableSlots` — one source of truth, not duplicated logic), but that read-then-write is inherently racy on its own; this index is the actual race-proof backstop, converting a lost race into a clean `409 SLOT_ALREADY_BOOKED` via the existing `P2002` handling.

### `queues` / `queue_entries`

| Table | Notes |
|---|---|
| `queues` | One per `(hospitalId, doctorProfileId, queueDate)` — `@@unique`, get-or-created (`upsert`) on first check-in, not manually created (see `/DECISIONS.md`). `nextTokenNumber` is an atomic per-queue counter, the exact same pattern as `Hospital.mrnSequence` (row-locked `UPDATE ... increment` inside the same transaction as the `QueueEntry` insert). |
| `queue_entries` | `status`: `WAITING, CALLED, IN_CONSULTATION, COMPLETED, SKIPPED, CANCELLED`. `appointmentId` is `@unique` (one entry per appointment) — see `/DECISIONS.md` for why `SKIPPED → WAITING` (requeue) reuses the same row rather than creating a second one. `@@unique([queueId, tokenNumber])` backstops the atomic counter. |

**`call-next` concurrency — raw SQL, not an ORM call:**

```sql
UPDATE "queue_entries"
SET "status" = 'CALLED', "calledAt" = now(), "calledByUserId" = $1
WHERE "id" = (
  SELECT "id" FROM "queue_entries"
  WHERE "queueId" = $2 AND "status" = 'WAITING'
  ORDER BY "priority" DESC, "joinedAt" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING "id"
```

A single SQL statement is atomic by construction — no explicit multi-statement transaction needed. `FOR UPDATE SKIP LOCKED` means a second concurrent caller never blocks on the first caller's row lock; it skips straight to the next eligible row, so N concurrent `call-next` calls against N waiting entries claim N *distinct* entries, and a caller against zero waiting entries gets a clean empty result (mapped to `409 NO_WAITING_PATIENTS`), never a crash or a double-claim. See `queue.service.ts#callNext` and the concurrency test in `test/queue-concurrency.e2e-spec.ts`.

## MRN

Hospital-scoped, not global: `{hospital.code}-{sequence padded to 6 digits}` (e.g. `SUN-000001`). Generation (`apps/api/src/patients/patients.service.ts`) increments `Hospital.mrnSequence` via an atomic `UPDATE ... increment` inside the same database transaction that creates the `Patient` row — Postgres row-locks the `Hospital` row for that update, so two concurrent registrations for the same hospital serialize and can never be issued the same MRN. The `@@unique([hospitalId, mrn])` constraint is the backstop if that logic is ever bypassed.

**Status as of 2026-10-05 (Phase 2): SUPER_ADMIN no longer has implicit cross-tenant read access to Patient data** (`findAllForTenant`/`getTenantScopedPatientOrThrow` in `patients.service.ts` — fixed this phase per master doc §14, see `/SECURITY.md` and `/DECISIONS.md`). Everything else about this module is unchanged and still not fully verified:
- **A migration now exists** (see below) but has never been applied to a real database — still blocked by Docker Desktop in this environment.
- **No concurrency test exists** for simultaneous patient registration, despite master doc §19/§31 explicitly requiring one. No `patients.e2e-spec.ts` or `patients.service.spec.ts` exists at all. (Phase 2 added the mandatory concurrency tests for Hospital/User — see `/TESTING.md` — but did not extend them to Patient, since building out the Patient module is explicitly out of Phase 2 scope.)
- **No tenant-isolation test exists** for the Patient module — `tenant-isolation.e2e-spec.ts` covers Users and Hospitals only.

Do not treat Patient/MRN as done per master doc §44 (Definition of Done) until those gaps are closed.

## Running migrations

```bash
cd apps/api
npm run prisma:migrate:dev      # local dev — creates/applies a migration, prompts for a name
npm run prisma:migrate:deploy   # CI/production — applies existing migrations, no prompts, no schema drift detection
npm run prisma:generate         # regenerate the Prisma Client after a schema change
```

**Two migrations exist, neither has ever been applied to a real database — treat both as unverified:**
- `20261005000000_init` (Phase 1/2) — Hospital/User/RefreshToken/AuditLog/Patient.
- `20261005120000_hospital_operations_core` (Phase 3) — Hospital.timezone, Department, DoctorProfile, DoctorSchedule, DoctorUnavailability, Appointment, Queue, QueueEntry, plus the hand-added partial unique index above.

Docker Desktop cannot start in this sandboxed environment (`docker ps` fails with "Docker Desktop is unable to start"; the underlying `com.docker.service` Windows service cannot even be started — confirmed independently in Phase 1, Phase 2, and again in Phase 3), so `prisma migrate dev` has never been run against a live Postgres instance here. Both migrations' SQL was instead generated with `prisma migrate diff` — the Phase 1/2 one via `--from-empty`, the Phase 3 one via `--from-schema-datamodel <git-checked-out-Phase-2-schema.prisma> --to-schema-datamodel schema.prisma` (a schema-to-schema diff, so it needed no database connection either) — then placed by hand into conventional `<timestamp>_<name>/migration.sql` files. This produces the same DDL `prisma migrate dev` would have generated, but **neither has been proven to actually apply cleanly in sequence** — no migration-history table has ever been created, no `prisma migrate deploy` has ever run successfully end-to-end. The first person with working Docker/Postgres access must run `npx prisma migrate deploy` (or `migrate dev` to let Prisma re-derive matching diffs and confirm no drift) before either can be considered verified.

## Local databases

`docker-compose.yml` starts one Postgres container with two databases: `hospitalos_dev` (normal local development) and `hospitalos_test` (created by `docker/postgres/init-test-db.sql`, used exclusively by the e2e test suite — see `/TESTING.md`). Keep these separate; never point the test suite at the dev database.
