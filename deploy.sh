#!/usr/bin/env bash
#
# deploy.sh — one-command deploy/upgrade for the NovrCampaign stack on the VPS.
#
# Idempotent and safe to re-run:
#   git pull -> build -> up -d -> migrate -> health check -> status.
#
# Usage (from the app repo root on the VPS):
#   ./deploy.sh                 # app stack only (no collector)
#   ./deploy.sh --with-collector# also start the collector profile
#
# Prereqs: Docker Engine + Compose plugin; a filled .env in this directory;
# for --with-collector, the novr-collection repo cloned at ${COLLECTOR_CONTEXT:-../novr-collection}.

set -euo pipefail

cd "$(dirname "$0")"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RST=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$BOLD" "$RST" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GREEN" "$RST" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$YELLOW" "$RST" "$*"; }
die()  { printf '%s[error]%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

WITH_COLLECTOR=0
[[ "${1:-}" == "--with-collector" ]] && WITH_COLLECTOR=1

COMPOSE=(docker compose)
PROFILE_ARGS=()
if [[ "$WITH_COLLECTOR" == "1" ]]; then
  PROFILE_ARGS=(--profile collector)
  if [[ ! -d "${COLLECTOR_CONTEXT:-../novr-collection}" ]]; then
    die "collector profile requested but ${COLLECTOR_CONTEXT:-../novr-collection} not found (clone novr-collection or set COLLECTOR_CONTEXT)"
  fi
fi

# ── 0. Preconditions ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin not installed"
[[ -f .env ]] || die ".env not found — copy .env.production.example to .env and fill it"

# ── 1. Update source ──────────────────────────────────────────────────────────
log "Pulling latest source"
git pull --ff-only
if [[ "$WITH_COLLECTOR" == "1" ]]; then
  log "Pulling collector source"
  ( cd "${COLLECTOR_CONTEXT:-../novr-collection}" && git pull --ff-only )
fi

# ── 2. Build images ───────────────────────────────────────────────────────────
log "Building images"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" build

# ── 3. Start / update containers ──────────────────────────────────────────────
log "Starting containers"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" up -d

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
    "${COMPOSE[@]}" "${PROFILE_ARGS[@]}" logs --tail=40 backend || true
    die "health check failed"
  fi
  sleep 2
done

# ── 6. Status ─────────────────────────────────────────────────────────────────
log "Stack status"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" ps

echo
ok "Deploy complete."
echo "  Health: $HEALTH_URL"
echo "  Logs:   docker compose logs -f backend"
