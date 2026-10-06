# Production image for @hospitalos/api.
#
# UNTESTED in the environment this was written in — `docker build`/`docker
# run` need a working Docker daemon, and this whole project was built where
# "Docker Desktop is unable to start" (see /DEPLOYMENT.md, /TESTING.md).
# Written carefully against the actual package.json scripts and npm-
# workspaces layout, but treat the first real `docker build` as the real
# test, not this file's existence.
#
# Favors correctness over image size for a first attempt: the final stage
# installs the full dependency set (including the `prisma` CLI, a
# devDependency) rather than a hand-pruned subset, so `prisma migrate
# deploy` works out of the box as the container's entrypoint. Revisit once
# this has actually been built and run at least once.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

WORKDIR /app/apps/api
EXPOSE 3000

# Runs pending migrations before every container start — safe to run on
# every boot (Prisma tracks what's already applied), but see
# /DATABASE.md's migration-safety notes before scaling this to multiple
# replicas starting simultaneously against the same database.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
