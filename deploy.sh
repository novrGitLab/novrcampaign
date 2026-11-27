#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in ""|--with-collector|--check) ;; *) echo "Usage: ./deploy.sh [--check|--with-collector]" >&2; exit 2 ;; esac

# Inspect the resolved environment without printing credential values.
docker compose config --format json | python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
settings = services["backend"]["environment"]
site = "https://pulse.cybernovr.com"
required = ["JWT_SECRET", "DATABASE_URL", "DIRECT_URL"]
for feature, names in {"staff SSO": ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"], "newsletter": ["PLUNK_API_KEY","NP_PULSE_SEGMENT"]}.items():
    unset = [name for name in names if not str(settings.get(name) or "").strip()]
    if unset:
        print("Pending " + feature + " configuration: " + ", ".join(unset), file=sys.stderr)
missing = [name for name in required if not str(settings.get(name) or "").strip()]
expected = {"OIDC_REDIRECT_URI": site + "/api/auth/oidc/callback", "PUBLIC_SITE_URL": site, "FRONTEND_URL": site}
missing += [name for name, value in expected.items() if settings.get(name) != value]
if services["caddy"]["environment"].get("CADDY_SITE_ADDRESS") != "pulse.cybernovr.com":
    missing.append("CADDY_SITE_ADDRESS")
if missing:
    sys.exit("Configure the VPS environment before cutover: " + ", ".join(missing))
'
getent ahostsv4 pulse.cybernovr.com | awk '{print $1}' | grep -Fx '213.136.94.10' >/dev/null || { echo 'Awaiting pulse.cybernovr.com DNS on the Pulse VPS' >&2; exit 1; }
if [[ "${1:-}" == "--check" ]]; then exit 0; fi
docker network inspect novr-shared >/dev/null 2>&1 || docker network create novr-shared >/dev/null
docker compose build backend frontend
docker compose up -d db
docker compose run --rm --no-deps backend sh -c 'cd backend && npx prisma migrate deploy'
docker compose up -d backend frontend
docker compose up -d --force-recreate caddy
if [[ "${1:-}" == "--with-collector" ]]; then
  bash ./scripts/release-collector.sh
fi
for attempt in {1..40}; do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 https://pulse.cybernovr.com/api/health)" == 200 ]] &&
     curl -fsS --max-time 8 https://pulse.cybernovr.com/ | grep -F 'The front page' >/dev/null &&
     [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 https://pulse.cybernovr.com/api/auth/me)" == 401 ]]; then
    echo 'Public newsroom and protected API are responding over HTTPS.'
    exit 0
  fi
  sleep 3
done
echo 'Production verification failed. Inspect docker compose ps and the service logs.' >&2
exit 1
