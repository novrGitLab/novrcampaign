#!/usr/bin/env bash
#
# deploy.sh — one-command deploy/upgrade for the NovrCampaign stack on the VPS.
#
# Idempotent and safe to re-run:
#   git pull -> build -> up -d -> migrate -> health check -> status.
#
# Usage (from the app repo root on the VPS):
#   ./deploy.sh                 # app stack only
#   ./deploy.sh --with-collector# also (re)build + up the standalone collector stack
#
# Prereqs: Docker Engine + Compose plugin; a filled .env in this directory.
# The collector is a SEPARATE stack in the novr-collection repo; it is deployed
# from that repo. `--with-collector` is a convenience that also drives it, and
# requires the novr-collection repo cloned at ${COLLECTOR_CONTEXT:-../novr-collection}.

set -euo pipefail

cd "$(dirname "$0")"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RST=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$BOLD" "$RST" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GREEN" "$RST" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$YELLOW" "$RST" "$*"; }
die()  { printf '%s[error]%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

WITH_COLLECTOR=0
[[ "${1:-}" == "--with-collector" ]] && WITH_COLLECTOR=1

COLLECTOR_DIR="${COLLECTOR_CONTEXT:-../novr-collection}"

COMPOSE=(docker compose)

# ── 0. Preconditions ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not installed"
[[ -f .env ]] || die ".env not found — copy .env.production.example to .env and fill it"

# The app and the standalone collector share an external network. Create it once;
# both `docker compose up` invocations require it to exist.
if ! docker network inspect novr-shared >/dev/null 2>&1; then
  log "Creating shared network novr-shared"
  docker network create novr-shared >/dev/null
fi

if [[ "$WITH_COLLECTOR" == "1" ]]; then
  [[ -d "$COLLECTOR_DIR" ]] || die "collector requested but $COLLECTOR_DIR not found (clone novr-collection or set COLLECTOR_CONTEXT)"
  [[ -f "$COLLECTOR_DIR/.env" ]] || die "$COLLECTOR_DIR/.env not found — copy .env.example to .env and fill it"
fi

# ── 1. Update source ──────────────────────────────────────────────────────────
log "Pulling latest source"
git pull --ff-only
if [[ "$WITH_COLLECTOR" == "1" ]]; then
  log "Pulling collector source"
  ( cd "$COLLECTOR_DIR" && git pull --ff-only )
fi

# ── 2. Build images ───────────────────────────────────────────────────────────
log "Building images"
"${COMPOSE[@]}" build

# ── 3. Start / update containers ──────────────────────────────────────────────
log "Starting containers"
"${COMPOSE[@]}" up -d

# ── 3b. Standalone collector stack ────────────────────────────────────────────
if [[ "$WITH_COLLECTOR" == "1" ]]; then
  log "Building + starting collector (standalone stack)"
  ( cd "$COLLECTOR_DIR" && "${COMPOSE[@]}" up -d --build )
fi

# ── 4. Migrate ────────────────────────────────────────────────────────────────
# The backend entrypoint already runs `prisma migrate deploy` on start; this
# explicit run is a belt-and-braces step and is a no-op when already current.
log "Applying database migrations"
"${COMPOSE[@]}" run --rm --no-deps backend sh -c "cd backend && npx prisma migrate deploy"

# ── 5. Health check ───────────────────────────────────────────────────────────
log "Waiting for API health"
HEALTH_URL="http://127.0.0.1:${HTTP_PORT:-80}/api/health"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok "API healthy at $HEALTH_URL"
    break
  fi
  if [[ "$i" == "30" ]]; then
    warn "API did not report healthy via $HEALTH_URL — showing logs"
    "${COMPOSE[@]}" logs --tail=40 backend || true
    die "health check failed"
  fi
  sleep 2
done

# ── 6. Status ─────────────────────────────────────────────────────────────────
log "Stack status"
"${COMPOSE[@]}" ps
if [[ "$WITH_COLLECTOR" == "1" ]]; then
  log "Collector status"
  ( cd "$COLLECTOR_DIR" && "${COMPOSE[@]}" ps )
fi

echo
ok "Deploy complete."
echo "  Health: $HEALTH_URL"
echo "  Logs:   docker compose logs -f backend"
