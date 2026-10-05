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

**Status as of 2026-10-05: implemented in code, not yet verified.** The model and generation logic exist, but:
- **No migration has been generated.** `apps/api/prisma/migrations/` does not exist on disk — this schema has never been applied to a real database. Run `npx prisma migrate dev` against a running local Postgres to generate it (attempted during this session; blocked because Docker Desktop would not start in this environment — see `DECISIONS.md`).
- **No concurrency test exists** for simultaneous patient registration, despite master doc §19/§31 explicitly requiring one. No `patients.e2e-spec.ts` or `patients.service.spec.ts` exists at all.
- **No tenant-isolation test exists** for the Patient module — `tenant-isolation.e2e-spec.ts` covers Users and Hospitals only.

Do not treat Patient/MRN as done per master doc §44 (Definition of Done) until those three gaps are closed.

## Running migrations

```bash
cd apps/api
npm run prisma:migrate:dev      # local dev — creates/applies a migration, prompts for a name
npm run prisma:migrate:deploy   # CI/production — applies existing migrations, no prompts, no schema drift detection
npm run prisma:generate         # regenerate the Prisma Client after a schema change
```

**No migration has been generated yet** — `apps/api/prisma/migrations/` does not currently exist. The first `prisma migrate dev` run (against the Postgres instance started by `docker compose up -d`, see root `docker-compose.yml`) will create it and name it `<timestamp>_init`. Do this before anything else; `prisma migrate deploy` has nothing to apply until it exists.

## Local databases

`docker-compose.yml` starts one Postgres container with two databases: `hospitalos_dev` (normal local development) and `hospitalos_test` (created by `docker/postgres/init-test-db.sql`, used exclusively by the e2e test suite — see `/TESTING.md`). Keep these separate; never point the test suite at the dev database.
