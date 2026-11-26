# Frontend image — NovrCampaign dashboard (Vite static build served by nginx).
#
# VITE_API_URL is INLINED at build time by Vite (import.meta.env), so it MUST be
# supplied as a BUILD ARG, not a runtime env var. docker-compose.yml passes
# `VITE_API_URL=/api` so the SPA calls the same origin (Caddy proxies /api).
#
# Build context MUST be the repository ROOT because the frontend is an npm
# workspace of the monorepo (root lockfile).
#
# Build:
#   docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api -t novrcampaign-frontend .

# ── Stage 1: build the SPA ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

ARG VITE_API_URL=/api

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
COPY packages ./packages

RUN npm ci

COPY frontend ./frontend

# Build ONLY the main dashboard SPA (vite.config.js → frontend/dist).
# The package `build` script also runs a second `vite build --config
# vite.drive.config.js` for the unrelated WIP drive app (→ frontend/drive-dist);
# we deliberately omit it here: the drive is a separate entry the backend/Caddy
# does not route, and it is in-progress. Re-add below if that changes.
RUN cd frontend && npx vite build

# ── Stage 2: serve statically ────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

# nginx image ships a curl-free healthcheck; use wget (busybox) instead.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
