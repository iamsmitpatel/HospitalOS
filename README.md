# HospitalOS

A hospital operating platform for hospitals/clinics (HospitalOS) and a connected patient-facing platform (HospitalOS Connect). See the project's master engineering instructions (held outside this repo) for the full long-term scope.

**Current status: Phase 1 — Foundation.** Authentication, RBAC, tenant (hospital) model, users, and the audit/health/config infrastructure the rest of the platform builds on. No patient records, scheduling, clinical, or billing features exist yet — see `/CHANGELOG.md` and the latest Phase report for exactly what's implemented.

## Stack

NestJS 11 + TypeScript · PostgreSQL + Prisma 6 · Redis · Next.js (frontend, reserved — not yet scaffolded). See `/DECISIONS.md` for why these specific major versions were pinned instead of each package's newest release.

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
```

Full details in `/DEPLOYMENT.md`.
