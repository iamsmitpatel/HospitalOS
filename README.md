# HospitalOS

A hospital operating platform for hospitals/clinics (HospitalOS) and a connected patient-facing platform (HospitalOS Connect). See the project's master engineering instructions (held outside this repo) for the full long-term scope.

**Current status: Phase 5 — HospitalOS Connect + Final Hardening (the final implementation phase).** Phases 1-4's hospital-staff platform (auth/RBAC, departments/doctors/patients/appointments/queue, clinical/laboratory/pharmacy/billing/payments) is unchanged. Phase 5 adds HospitalOS Connect — a public-facing patient portal (discovery, self-registration, booking, queue status, medical records, all API-only, no frontend pages yet) — plus a security-hardening pass, a database-integrity audit (two real bugs found and fixed — see `/DECISIONS.md`), observability (health/live/ready, Prometheus metrics), and the project's first CI/CD pipeline and production Dockerfiles. See `/CHANGELOG.md` for the full list, and `/DECISIONS.md`/`/SECURITY.md` for what's still honestly flagged as not done (structured logging, family/dependent delegation, real notification delivery, an actual backup-restore drill, a CI run actually observed succeeding) rather than silently skipped.

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
