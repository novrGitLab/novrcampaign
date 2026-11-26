# Backend image — NovrCampaign API (monorepo workspace build).
#
# Build context MUST be the repository ROOT (see docker-compose.yml) because npm
# workspaces install from the root package.json/package-lock.json and the backend
# depends on the local workspace package @novr/ingest (packages/*).
#
# Build:
#   docker build -f backend/Dockerfile -t novrcampaign-backend .

# ── Stage 1: install workspace dependencies (incl. dev, needed for prisma) ──────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# openssl + ca-certificates are required by Prisma to detect the libssl version
# at generate/runtime (without them Prisma warns and defaults to openssl-1.1.x).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for a cacheable install layer.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY packages ./packages
COPY frontend/package.json ./frontend/package.json

# Full install across all workspaces. Needed because @novr/ingest is a workspace
# dep of the backend and prisma (a devDependency) is required to generate.
RUN npm ci

# ── Stage 2: build — generate the Prisma client from the schema ─────────────────
FROM deps AS build
WORKDIR /app

COPY backend ./backend

# The generated Prisma client is gitignored and produced by an EXPLICIT build
# step (there is no postinstall hook). Never skip this.
RUN npm -w backend run build

# ── Stage 3: minimal runtime ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# openssl is required at runtime for the Prisma query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp --create-home nodeapp

# Reuse the fully-installed workspace from the build stage so runtime has all
# hoisted node_modules, the generated Prisma client, and workspace symlinks in
# one consistent tree (simpler and safer than pruning across workspaces).
COPY --from=build --chown=nodeapp:nodeapp /app /app

USER nodeapp

EXPOSE 4000

# Migration-then-start: `prisma migrate deploy` runs on every boot, so first
# deploy and every upgrade migrate, then the API starts. migrate deploy is
# idempotent. Execute from the backend workspace so the schema/CLI resolve.
CMD ["sh", "-c", "cd backend && npx prisma migrate deploy && exec node src/server.js"]
