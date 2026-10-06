# Production image for @hospitalos/web (Next.js standalone output).
#
# UNTESTED end-to-end (no Docker daemon in this environment — see
# /DEPLOYMENT.md) but the standalone build itself (`npm run build`) WAS
# verified locally during the Phase 5 frontend audit: `.next/standalone/
# apps/web/server.js` and `.next/standalone/node_modules` exist exactly as
# this Dockerfile expects. The untested part is the Docker layer itself,
# not the Next.js output it copies.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
WORKDIR /app/apps/web
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# next.config.mjs's output: 'standalone' traces exactly the node_modules
# this app needs and lays them out pre-flattened — no separate `npm ci`
# in this stage, unlike apps/api's Dockerfile.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/web/server.js"]
