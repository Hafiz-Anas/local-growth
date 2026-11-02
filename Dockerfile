# syntax=docker/dockerfile:1.7
#
# Production image for Kubernetes (DigitalOcean, see DEPLOY-DIGITALOCEAN.md). Two targets from one build:
#   runner   the app: Next.js standalone output + static files + public/, sharp included, non-root (uid 1001)
#   migrate  `prisma migrate deploy` (the Prisma CLI is a dev dependency, so it has its own image)
# Vercel doesn't use this file; NEXT_OUTPUT=standalone is set only here (next.config.ts).
#
#   docker build --target runner  -t lge-web .
#   docker build --target migrate -t lge-migrate .

ARG NODE_IMAGE=node:22-bookworm-slim

# ── Dependencies (with dev dependencies: the build and the Prisma CLI need them) ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate` (client into lib/generated/prisma).
RUN npm ci --no-audit --no-fund

# ── Build ──
FROM deps AS build
COPY . .
ENV NEXT_OUTPUT=standalone \
    NODE_ENV=production
# lib/db.ts needs a URL when route modules load during the build; nothing connects to it.
# Real values come from the Kubernetes Secret at run time, never from the image.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    AUTH_SECRET="build-only-not-a-secret" \
    npx prisma generate && npx next build

# ── Migrations (Kubernetes Job before each rollout) ──
FROM ${NODE_IMAGE} AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
USER node
# Uses DIRECT_URL (unpooled) when set, else DATABASE_URL (prisma.config.ts). Applies pending migrations only.
CMD ["npx", "prisma", "migrate", "deploy"]

# ── App ──
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER 1001:1001
EXPOSE 3000
# Kubernetes uses its own probes (/api/health); this one is for `docker run` / compose.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
