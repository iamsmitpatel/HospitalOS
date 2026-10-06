# HospitalOS

A hospital operating platform for hospitals/clinics (HospitalOS) and a connected patient-facing platform (HospitalOS Connect). See the project's master engineering instructions (held outside this repo) for the full long-term scope.

**Current status: Phase 3 — Hospital Operations Core.** Authentication, RBAC/permissions, tenant (hospital) model, users, audit/health/config infrastructure, and the operational workflow: departments, doctors (profile/schedule/availability), patients (incl. duplicate detection), appointments (state machine, conflict-safe booking/cancel/reschedule), and queue management (concurrency-safe call-next). Frontend covers the full staff-facing flow for all of the above. No clinical notes, prescriptions, laboratory, pharmacy, or billing exist yet — see `/CHANGELOG.md` and the latest Phase report for exactly what's implemented, and what's written-but-unverified due to this environment's Docker blocker.

## Stack

NestJS 11 + TypeScript · PostgreSQL + Prisma 6 · Redis · Next.js 14 + React 18. See `/DECISIONS.md` for why these specific major versions were pinned instead of each package's newest release.

## Documentation

| File | Covers |
|---|---|
| `ARCHITECTURE.md` | Module layout, request pipeline, tenant model |
| `DATABASE.md` | Schema, migrations, local databases |
| `API.md` | Every route that exists today |
| `SECURITY.md` | Auth, RBAC, tenant isolation, audit logging — what's implemented and what's a known gap |
| `DEPLOYMENT.md` | Local setup; what's missing before this could go anywhere beyond localhost |
| `TESTING.md` | How to run tests, what's covered |
| `DECISIONS.md` | Why things were built the way they were, especially non-obvious dependency/architecture calls |

## Quick start

```bash
npm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env   # then fill in real values
docker compose up -d
cd apps/api && npx prisma migrate deploy
npm run start:dev

# in a second terminal — frontend
cp apps/web/.env.local.example apps/web/.env.local
npm run dev --workspace=apps/web          # http://localhost:3001
```

Full details in `/DEPLOYMENT.md`, including what to do if Docker isn't available in your environment (it wasn't in the one this was built in — see `/DATABASE.md` and `/TESTING.md`).
