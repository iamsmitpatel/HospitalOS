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

## Phase 4 schema: Clinical, Laboratory, Pharmacy, Billing & Payments

Added to `apps/api/prisma/schema.prisma` in Phase 4. `hospitals` also gained `invoiceSequence Int @default(0)` — the same atomic-counter pattern as `mrnSequence`/`Queue.nextTokenNumber`, backing `Invoice.invoiceNumber` (see `## Invoice numbering` below).

### `encounters` / `vital_signs` / `clinical_notes` / `diagnoses` / `prescriptions` / `prescription_items`

| Table | Notes |
|---|---|
| `encounters` | `status`: `EncounterStatus` — `OPEN, IN_PROGRESS, COMPLETED, CANCELLED`. Created directly as `IN_PROGRESS`; `OPEN` exists in the enum but is unreachable via any Phase 4 endpoint, same pattern as `Appointment.CHECKED_IN` in Phase 3. `appointmentId` is `@unique` (one encounter per appointment) and nullable (a walk-in has none). |
| `vital_signs` | Structured, typed numeric fields (not free text) — `bloodPressureSystolic/Diastolic`, `heartRateBpm`, `temperatureCelsius` (`Decimal(4,1)`), `respiratoryRate`, `oxygenSaturationPercent`, `weightKg`/`heightCm` (`Decimal`). No status/correction fields — purely append-only; each new measurement is a new row. |
| `clinical_notes` | SOAP-style structured sections (`chiefComplaint`, `history`, `examination`, `assessment`, `plan` — all optional, at least one required at the application layer). `correctsId` is `@unique` self-FK: an existing note is **never edited or deleted** once written; a correction creates a new row pointing back at the one it supersedes (master doc §14 — "a later correction should not erase the fact that an earlier record existed"). |
| `diagnoses` | `status`: `DiagnosisStatus` — `DRAFT, FINALIZED, AMENDED, CANCELLED`. `diagnosisCode` is free text the clinician already knows — **never** validated against or auto-populated from a real coding system like ICD-10 (master doc §15: "do not invent medical codes"). `amendedFromId` is `@unique` self-FK, same amendment-chain pattern as `Appointment.rescheduledFromId` in Phase 3: amending a `FINALIZED` diagnosis marks it `AMENDED` and creates a new `DRAFT` row, never overwrites the original. |
| `prescriptions` / `prescription_items` | Same `DRAFT/FINALIZED/AMENDED/CANCELLED` lifecycle and `amendedFromId` chain as diagnoses. Each `PrescriptionItem` carries `medicineId`, `dosage`, `frequency`, `duration`, `quantity`, optional `route`/`instructions` — validated against the `medicines` catalog (existence, same hospital, `isActive`) by `prescriptions.service.ts` via a **direct Prisma query**, not a dependency on the `pharmacy/` module (which doesn't exist from `clinical/`'s point of view — see `/DECISIONS.md`). |

### `lab_tests` / `lab_orders` / `lab_order_items` / `lab_results`

| Table | Notes |
|---|---|
| `lab_tests` | Catalog. Optional `referenceRangeLow`/`referenceRangeHigh` (`Decimal(10,3)`) for tests with a single expected numeric band — qualitative or multi-range tests are covered by `LabResult.referenceRange` (free text) instead, a deliberate pair-of-representations rather than one field trying to do both jobs. |
| `lab_orders` | `status`: `LabOrderStatus` — `ORDERED, COLLECTED, PROCESSING, COMPLETED, CANCELLED`, a 5-state **rollup** computed from its items (see "Lab order status rollup" below), not stored independently of them except for the explicit `CANCELLED` override. |
| `lab_order_items` | Specimen tracking (`specimenType`, `collectedAt`, `collectedByUserId`) folded directly onto the item rather than a separate `Specimen` table — one specimen maps to one ordered test in this phase's scope, and a join table added no benefit (master doc §30: "do not create unnecessary specimen complexity"). `status`: `LabOrderItemStatus` — `ORDERED, COLLECTED, COMPLETED, CANCELLED` (no `PROCESSING` at the item level — that distinction exists only at the order level, where it means "some but not all items have results"). |
| `lab_results` | `labOrderItemId` is **`@unique`** — one `LabResult` per `LabOrderItem`, ever, for the life of that item. `status`: `LabResultStatus` — `ENTERED, REVIEWED, VERIFIED, AMENDED` (`REVIEWED` exists for future granularity but is unreachable via any Phase 4 endpoint, same unreachable-enum-value pattern used elsewhere). `verifiedByUserId` must differ from `enteredByUserId` — enforced in `lab-results.service.ts`, not just by convention (**maker-checker**, master doc §32). `amendsId` is `@unique` self-FK. |

**Why amending a `LabResult` creates a new `LabOrderItem`, not just a new `LabResult`:** the generic amendment-chain pattern used everywhere else (Diagnosis, Prescription, Appointment) creates a new row of the *same* type pointing back at the old one via a self-FK — but `LabResult.labOrderItemId`'s `@unique` constraint means a second `LabResult` can never point at the *same* item the original did. The correct real-world analogue is also arguably more accurate: correcting a lab result means re-running or re-reading the test, which is itself a new specimen/result event, not an edit to the old one. `lab-results.service.ts#amend()` therefore creates a fresh `LabOrderItem` (same `labOrderId`, same `labTestId`, carrying over the original's `specimenType`/`collectedAt`/`collectedByUserId`) and attaches the new `LabResult` to *that*, with `amendsId` pointing back at the original result. The original result's own item is untouched; only the result's `status` flips to `AMENDED`. See `/DECISIONS.md`.

**Lab order status rollup** (`computeLabOrderStatus`, a pure function in `lab-orders.service.ts`, unit-tested directly):

```
all items CANCELLED            → CANCELLED
all non-cancelled items COMPLETED → COMPLETED
any non-cancelled item COMPLETED (not all) → PROCESSING
all non-cancelled items COLLECTED (none COMPLETED yet) → COLLECTED
otherwise (at least one item still ORDERED)  → ORDERED
```

Recomputed and persisted after every item-status change (specimen collection, result entry) — never computed lazily on read — so `GET /lab-orders/:id` always reflects a value already written, not derived on the fly.

### `medicines` / `stock_batches` / `stock_movements` / `dispense_records`

| Table | Notes |
|---|---|
| `medicines` | Catalog. `form` (tablet/syrup/injection/...) is free text, not an enum — dosage forms vary by hospital and this platform doesn't claim to enumerate every one (master doc §21). |
| `stock_batches` | `quantityReceived` (immutable) vs. `quantityRemaining` (the live balance, decremented atomically — see "Inventory & FEFO dispensing" below). `status`: `StockBatchStatus` — `ACTIVE, EXPIRED, DEPLETED`. `@@unique([hospitalId, medicineId, batchNumber])`. |
| `stock_movements` | One row per quantity change, `type`: `StockMovementType` — `PURCHASE, ADJUSTMENT, DISPENSE, RETURN, EXPIRED, TRANSFER` (`TRANSFER` reserved, unused by any Phase 4 endpoint). `quantityDelta` is **signed** — positive for increases, negative for decreases — so "current stock = sum of movements for that batch" is trivially true and auditable without special-casing by type (master doc §23). `referenceType`/`referenceId` are a loose pointer (e.g. a `DispenseRecord` id), not an enforced FK, since the referenced entity varies by movement type. |
| `dispense_records` | Links a `PrescriptionItem` to the specific `StockBatch` it was drawn from and the `Patient` it was dispensed to. A single dispense **request** can produce multiple `DispenseRecord` rows (one per batch FEFO had to draw from) — see below. |

**Inventory & FEFO dispensing (master doc §24-§26):** `dispense.service.ts#create()` and `stock-batches.service.ts#applyMovement()` share one invariant-enforcement primitive: any quantity **decrease** is applied via a conditional `updateMany` —

```ts
tx.stockBatch.updateMany({
  where: { id: batchId, quantityRemaining: { gte: take } },
  data: { quantityRemaining: { decrement: take } },
})
```

— not a plain `update`. Postgres resolves a concurrent conflict on the same row by serializing the two `UPDATE`s (the second waits for the first's transaction to finish, then re-evaluates its own `WHERE` clause against the now-current value) — so `count === 0` only ever means "genuinely not enough stock right now," never a false negative from pure timing. A hand-added CHECK constraint (`quantityRemaining >= 0`, see below) is the database-level backstop if that logic is ever bypassed, the exact same defense-in-depth pattern as the Phase 3 partial unique index.

Dispensing a prescription item draws from the **earliest-expiring `ACTIVE`, unexpired batch first** (`ORDER BY expiryDate ASC`), and — unlike a single-batch operation like `adjust()` — loops across batches within one `$transaction` if the first candidate doesn't have enough: it takes what that batch has, moves to the next-earliest-expiring batch for the remainder, and so on, capped at `MAX_BATCH_ALLOCATION_ATTEMPTS = 50` as a backstop against a pathological retry storm (not an expected path). If the loop ever can't find a next candidate before the requested quantity is satisfied, the **entire transaction throws and rolls back** — a request is never partially fulfilled; either the full requested quantity is dispensed (possibly from several batches, each logged as its own `DispenseRecord` + `DISPENSE` movement) or none of it is, and no stock is left debited for an unfulfilled request. Proven under real concurrent load in `test/clinical-concurrency.e2e-spec.ts` (written, not yet executed — see `/TESTING.md`).

### `services` / `service_prices` / `invoices` / `invoice_items`

| Table | Notes |
|---|---|
| `services` | Catalog. `category`: `ServiceCategory` — `CONSULTATION, LABORATORY, PROCEDURE, IMAGING, PHARMACY, OTHER`. |
| `service_prices` | The **current** price for a service is the row with `effectiveTo: null`; setting a new price (`services.service.ts#setPrice()`) closes out the old one (`effectiveTo: now()`) and creates the new row in the same transaction — never mutates a price in place, and never affects an `InvoiceItem` already billed against the old price (master doc §37/§38 — the same historical-value-preservation principle, applied to pricing). |
| `invoices` | `status`: `InvoiceStatus` — `DRAFT, ISSUED, PARTIALLY_PAID, PAID, CANCELLED, REFUNDED`. All monetary fields are `Decimal`, never float (master doc §40) — `subtotal`, `discountAmount`, `taxRate` (`Decimal(5,4)`, e.g. `0.1800` for 18%), `taxAmount`, `total`, running `amountPaid`/`amountRefunded` (updated transactionally alongside Payment/Refund creation, never recomputed by summing on every read). `invoiceNumber` is hospital-scoped (`@@unique([hospitalId, invoiceNumber])`), not globally unique — see `## Invoice numbering` below. |
| `invoice_items` | `serviceId` is **nullable and loose** — the `description`/`unitPrice`/`discountAmount`/`lineTotal` fields on the item itself are the historical source of truth (master doc §41), never reconstructed by joining back to the live `Service`/`ServicePrice` catalog later, even if `serviceId` is still set and still resolves. |

### `payments` / `refunds`

| Table | Notes |
|---|---|
| `payments` | `method`: `PaymentMethod` — `CASH, CARD, UPI, BANK_TRANSFER, OTHER`. `referenceNumber` is an external/physical-terminal transaction reference only — **never** a raw card number or CVV; neither is stored anywhere in this schema (master doc §48). `idempotencyKey` is nullable and `@@unique([hospitalId, idempotencyKey])` — Postgres treats multiple `NULL`s in a unique index as distinct, so calls without a key are never constrained against each other, only calls that explicitly supply the same key are deduplicated (master doc §47). |
| `refunds` | `paymentId` nullable — a refund can reference the specific payment it reverses, or just the invoice generally. `status`: `RefundStatus` — `PENDING, COMPLETED, FAILED` (created as `COMPLETED` directly; `PENDING`/`FAILED` are reserved for a future payment-gateway-async flow this phase doesn't implement). |

**Six hand-added CHECK constraints** (non-negative money/stock invariants Prisma's schema DSL cannot express, same accepted pattern as Phase 3's partial unique index):

```sql
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_quantity_remaining_non_negative" CHECK ("quantityRemaining" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_paid_non_negative" CHECK ("amountPaid" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_refunded_non_negative" CHECK ("amountRefunded" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_non_negative" CHECK ("amount" >= 0);
```

Appended by hand to the Phase 4 migration SQL after `prisma migrate diff` generated the rest — these are the database-level backstop behind the application-layer checks (`INSUFFICIENT_STOCK`, `DISCOUNT_EXCEEDS_SUBTOTAL`, `PAYMENT_EXCEEDS_BALANCE`, `REFUND_EXCEEDS_PAID`), not a substitute for them.

## Invoice numbering

Hospital-scoped, not global — same shape as MRN: `{hospital.code}-INV-{sequence padded to 6 digits}` (e.g. `SUN-INV-000001`). `invoices.service.ts#create()` increments `Hospital.invoiceSequence` via an atomic `UPDATE ... increment` inside the same transaction that creates the `Invoice` row — identical mechanism to `Hospital.mrnSequence` and `Queue.nextTokenNumber`, now used a third time for a third independent counter.

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

**Three migrations exist, none has ever been applied to a real database — treat all three as unverified:**
- `20261005000000_init` (Phase 1/2) — Hospital/User/RefreshToken/AuditLog/Patient.
- `20261005120000_hospital_operations_core` (Phase 3) — Hospital.timezone, Department, DoctorProfile, DoctorSchedule, DoctorUnavailability, Appointment, Queue, QueueEntry, plus the hand-added partial unique index above.
- `20261006000000_clinical_lab_pharmacy_billing` (Phase 4) — Hospital.invoiceSequence, Encounter, VitalSigns, ClinicalNote, Diagnosis, Prescription, PrescriptionItem, LabTest, LabOrder, LabOrderItem, LabResult, Medicine, StockBatch, StockMovement, DispenseRecord, Service, ServicePrice, Invoice, InvoiceItem, Payment, Refund, plus the six hand-added CHECK constraints above.

Docker Desktop cannot start in this sandboxed environment (`docker ps` fails with "Docker Desktop is unable to start"; the underlying `com.docker.service` Windows service cannot even be started — confirmed independently in Phase 1, Phase 2, Phase 3, and again in Phase 4), so `prisma migrate dev` has never been run against a live Postgres instance here. All three migrations' SQL was instead generated with `prisma migrate diff` — the Phase 1/2 one via `--from-empty`, the Phase 3 and Phase 4 ones via `--from-schema-datamodel <previous-phase's-checked-out-schema.prisma> --to-schema-datamodel schema.prisma` (a schema-to-schema diff, so neither needed a database connection either) — then placed by hand into conventional `<timestamp>_<name>/migration.sql` files. This produces the same DDL `prisma migrate dev` would have generated, but **none has been proven to actually apply cleanly in sequence** — no migration-history table has ever been created, no `prisma migrate deploy` has ever run successfully end-to-end. The first person with working Docker/Postgres access must run `npx prisma migrate deploy` (or `migrate dev` to let Prisma re-derive matching diffs and confirm no drift) before any can be considered verified.

## Local databases

`docker-compose.yml` starts one Postgres container with two databases: `hospitalos_dev` (normal local development) and `hospitalos_test` (created by `docker/postgres/init-test-db.sql`, used exclusively by the e2e test suite — see `/TESTING.md`). Keep these separate; never point the test suite at the dev database.
