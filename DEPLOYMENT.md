# Deployment

**Status as of Phase 5: still never deployed anywhere.** A CI pipeline and production Dockerfiles now exist (see below) but neither has been exercised by an actual deployment — this document still mainly covers running the platform locally. Phase 5 added `DEFAULT_THROTTLE_TTL_SECONDS`/`DEFAULT_THROTTLE_LIMIT` to the API's environment variables (see `apps/api/.env.example`); no new infrastructure dependencies (same Postgres + Redis as every prior phase).

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

## CI/CD (Phase 5)

`.github/workflows/ci.yml` runs on every push/PR to `main`: lint + build for both apps, unit tests for the API, and — using GitHub Actions' real Docker-backed Postgres/Redis service containers — the full e2e suite and `prisma migrate deploy`. This is the first point in the project where the long-standing local Docker blocker doesn't apply: GitHub's runners have a working Docker daemon, so every `*.e2e-spec.ts` file across every phase (written and type-checked throughout, never executed locally — see `/TESTING.md`) gets to actually run for the first time once this is pushed. The workflow itself has not been observed running (that only happens after a push triggers it); it was written against the actual `package.json` scripts and verified by typechecking/building locally, not by watching a real Actions run succeed.

## Production Docker images (Phase 5)

`apps/api/Dockerfile` and `apps/web/Dockerfile` — multi-stage builds, neither `docker build`-tested in this environment (no Docker daemon here either). `apps/web`'s underlying Next.js `output: 'standalone'` build **was** verified locally (`npm run build` actually produces `.next/standalone/apps/web/server.js` and its pruned `node_modules`, exactly what the Dockerfile copies); the Docker layer wrapping it is the untested part. See the comments at the top of each Dockerfile.

## Before this goes anywhere beyond localhost

Addressed this phase: CI (above), production Dockerfiles (above), backup/restore *procedure* documented (`/DATABASE.md` — but still **not** restore-tested, see there for why), migration lock/safety review (`/DATABASE.md`).

Still missing — do not deploy to a shared or production environment without them:

- A real secret-management story (the current `.env` file approach is dev-only).
- `NODE_ENV=production` behavior has been exercised in code (cookie `secure` flag, etc.) but never actually run against a production-like environment.
- An actual backup *restore* drill — the documented procedure has never been executed against real data (no live Postgres instance has existed in this project's history).
- TLS termination — the app itself speaks plain HTTP; a reverse proxy/load balancer terminating TLS is assumed but not configured anywhere in this repo.
- Structured (JSON) logging — still the built-in NestJS text `Logger`; see `/SECURITY.md` and `/DECISIONS.md` for why this stays deferred.
- A container orchestrator/deployment target (Kubernetes manifests, ECS task definitions, a Fly.io/Render config, etc.) — the two Dockerfiles produce images; nothing here runs them anywhere yet.
