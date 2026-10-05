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

**A migration exists at `apps/api/prisma/migrations/20261005000000_init/` but has never been applied to a real database — treat it as unverified.** Docker Desktop cannot start in this sandboxed environment (`docker ps` fails with "Docker Desktop is unable to start"; the underlying `com.docker.service` Windows service cannot even be started — confirmed both at the start of Phase 1 and again in Phase 2), so `prisma migrate dev` has never been run against a live Postgres instance here. The SQL was instead generated with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`, which computes the schema diff without needing a database connection, and placed by hand into a conventional `<timestamp>_init/migration.sql` + `migration_lock.toml` structure. This produces byte-for-byte the same DDL `prisma migrate dev` would have generated from an empty database, but **it has not been proven to actually apply cleanly** — no migration history table has ever been created, no `prisma migrate deploy` has ever run successfully end-to-end. The first person with working Docker/Postgres access must run `npx prisma migrate deploy` (or `migrate dev` to let Prisma re-derive a matching migration and confirm no drift) before this can be considered verified.

## Local databases

`docker-compose.yml` starts one Postgres container with two databases: `hospitalos_dev` (normal local development) and `hospitalos_test` (created by `docker/postgres/init-test-db.sql`, used exclusively by the e2e test suite — see `/TESTING.md`). Keep these separate; never point the test suite at the dev database.
