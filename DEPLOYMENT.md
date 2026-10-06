# Deployment

**Status as of Phase 4: local development only.** Nothing in this repository has been deployed anywhere, and no CI/CD pipeline exists yet (that's Phase 7 — production hardening, per master doc §27). This document covers running the platform locally. Phase 4 introduced no new environment variables or infrastructure dependencies — same Postgres + Redis as Phase 1-3.

## Prerequisites

- Node.js ≥ 20 (built and tested on v24.18.0)
- Docker Desktop (for Postgres + Redis)
- npm (workspaces are used; no pnpm/yarn-specific config exists)

## First-time setup

```bash
# from the repo root
npm install

# copy env templates and fill in real secrets for anything beyond local dev
cp .env.example .env                       # root — docker-compose Postgres/Redis vars
cp apps/api/.env.example apps/api/.env     # api — DATABASE_URL, JWT secrets, etc.

# start Postgres + Redis
docker compose up -d

# apply migrations
cd apps/api
npx prisma migrate deploy

# run the API
npm run start:dev
```

The API listens on `http://localhost:3000` by default; Swagger docs at `http://localhost:3000/api/docs`; health check at `http://localhost:3000/api/v1/health`.

## Running the frontend (`apps/web`)

```bash
cp apps/web/.env.local.example apps/web/.env.local   # NEXT_PUBLIC_API_BASE_URL, defaults to http://localhost:3000/api/v1
npm run dev --workspace=apps/web                     # serves on http://localhost:3001
```

Port 3001 matches the API's default `CORS_ORIGIN` (`apps/api/.env.example`) out of the box — no extra config needed for local dev. Build/typecheck/lint: `npm run build|typecheck|lint --workspace=apps/web`.

## A note on this environment

Every verification step in this repo's history that needs Docker — generating/applying a Prisma migration against a real database, running the e2e test suite, running the API itself (it calls Postgres on boot) — is **blocked** here: `docker ps` fails with "Docker Desktop is unable to start," and the underlying `com.docker.service` Windows service cannot be started directly either (confirmed independently in Phase 1, Phase 2, Phase 3, and again in Phase 4 — `docker info`/`docker ps` re-checked at the start of Phase 4's e2e-test task, same failure). If you're reading this in an environment where Docker actually works, none of this applies to you — just follow "First-time setup" above. If you hit the same blocker, see `/DATABASE.md` for how both migrations were generated without a live database connection (`prisma migrate diff`), and `/TESTING.md` for exactly what has and hasn't been executed as a result.

## Environment variables

See `apps/api/.env.example` for the full list. The app **will not boot** if required variables are missing or invalid (`envValidationSchema`, Joi, `abortEarly: false` — every validation error is reported at once, not just the first). Notably:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` must each be ≥32 characters and **must differ** between the two (not currently enforced by validation — a hardening candidate — but using the same secret for both would weaken the separation between access and refresh tokens).
- `.env` and `.env.test` are git-ignored. Only `.env.example` is committed, and it contains placeholders, not real secrets.

## Before this goes anywhere beyond localhost

None of the following exist yet — do not deploy to a shared or production environment without them:

- A real secret-management story (the current `.env` file approach is dev-only).
- CI running lint/build/test on every change.
- A production Dockerfile for `apps/api` (none exists — `docker-compose.yml` currently only runs Postgres/Redis, not the API itself).
- `NODE_ENV=production` behavior has been exercised in code (cookie `secure` flag, etc.) but never actually run against a production-like environment.
- Backup/restore and disaster-recovery procedures for PostgreSQL.
- TLS termination — the app itself speaks plain HTTP; a reverse proxy/load balancer terminating TLS is assumed but not configured anywhere in this repo.

These map to later phases (primarily Phase 7) in the master roadmap, not omissions within the current phase's own scope.
