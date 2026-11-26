# Deploying NovrCampaign on a Contabo Ubuntu VPS

Single-VPS Docker Compose deployment: PostgreSQL, the Node API, the static SPA
(nginx), Caddy (reverse proxy + automatic TLS), and optionally the standalone
`novr-collection` service. Deployed by `git pull` on the server — no registry, no CI.

## Topology

```
                       ┌────────────────────────── VPS ──────────────────────────┐
  Internet             │                                                         │
  :80 / :443  ───────► │  caddy ──►  /            ──► frontend (nginx :80)       │
                       │        └─►  /api/*        ──► backend  (:4000)          │
                       │                                   │                     │
                       │                                   ├─► db (postgres:16)  │
                       │                                   └─► collector (:4100) │
                       │                                       (optional profile) │
                       │  all app containers on the internal `novr` bridge net   │
                       │  only `caddy` publishes host ports (80/443)             │
                       └─────────────────────────────────────────────────────────┘
```

- `db` and `collector` are **never** published to the host — internal network only.
- The backend reaches the collector at `http://collector:4100` over their HMAC API.
- The browser reaches the API at `/api` (same origin), proxied by Caddy. `VITE_API_URL=/api`
  is inlined into the SPA at build time.

## 1. Prerequisites

- Contabo Ubuntu 22.04/24.04 VPS, root or sudo access.
- A non-root **deploy user** (steps below).
- DNS (later): an A record for your domain → the VPS IP.

## 2. Install Docker Engine + Compose plugin

```bash
# As root (or with sudo)
apt-get update
apt-get install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list >/dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 3. Create the deploy user

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
# From now on, work as `deploy`:
su - deploy
```

### Firewall (recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Only 22/80/443 are exposed. PostgreSQL and the collector have no host ports.

## 4. Clone BOTH repos side by side

The compose `collector` service resolves its build context to `../novr-collection`
(overridable via `COLLECTOR_CONTEXT`). Cloning them side by side makes that resolve.

```bash
mkdir -p ~/novr && cd ~/novr
git clone <app-repo-url> novrcampaign
git clone <collector-repo-url> novr-collection
# Result:
#   ~/novr/novrcampaign
#   ~/novr/novr-collection
```

If the collector lives elsewhere, skip its clone and instead export
`COLLECTOR_CONTEXT=/path/to/novr-collection` when running `deploy.sh`.

## 5. Configure `.env`

```bash
cd ~/novr/novrcampaign
cp .env.production.example .env
chmod 600 .env
nano .env
```

Fill every `<...>` placeholder. Minimum for a first boot:

| Group | Keys |
| --- | --- |
| Site | `DOMAIN`, `CADDY_SITE_ADDRESS` |
| Database | `POSTGRES_*`, `DATABASE_URL`, `DIRECT_URL` |
| Auth | `JWT_SECRET` (generate ≥32-byte base64), `SEED_PASSWORD` |
| Email | `PLUNK_API_KEY`, `PLUNK_WEBHOOK_SECRET` |
| LLM | `NP_LLM_API_KEY`, `NP_BULK_MODEL`, `NP_FRONTIER_MODEL` |
| Cron | `NP_COLLECT_CRON_SECRET` |
| Collector (only if used) | `NP_COLLECTION_SECRET` = `NOVR_COLLECTION_KEY_PULSE_2026_01`, `NP_COLLECTION_ENABLED` |

Generate secrets without committing them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"    # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" # HMAC secret
```

> **Bare IP now, domain later.** For the first deploy set
> `DOMAIN=<vps-ip>` and `CADDY_SITE_ADDRESS=:80` (plain HTTP).
> When the domain is ready, see §10.

## 6. First deploy

```bash
cd ~/novr/novrcampaign
# Without the collector:
./deploy.sh
# With the standalone collector:
./deploy.sh --with-collector
```

`deploy.sh` runs: `git pull` → `docker compose build` → `up -d` → `prisma migrate deploy`
→ `curl /api/health` → `compose ps`. The backend image's entrypoint also runs
`prisma migrate deploy` on every start, so first boot and upgrades both migrate.

### Seed the admin user

```bash
docker compose run --rm --no-deps backend sh -c "cd backend && node prisma/seed.js"
```

This upserts `SEED_EMAIL` (default `admin@novrcampaign.local`) with `SEED_PASSWORD`.
**Log in and change that password immediately.**

## 7. Daily collection cron (host cron — recommended)

The daily briefing collection is `POST /api/pulse/collect/run`, guarded by the
`NP_COLLECT_CRON_SECRET` bearer token. A host cron is simpler than a container.

```bash
crontab -e
```

Add (05:00 UTC daily):

```cron
# NovrPulse daily collection — 05:00 UTC
0 5 * * * curl -fsS -X POST -H "Authorization: Bearer $NP_COLLECT_CRON_SECRET" http://127.0.0.1/api/pulse/collect/run >> /var/log/novr-collect.log 2>&1
```

Cron does not read `.env`; source the secret from the file first (or hardcode the
secret in the crontab, which is only readable by the `deploy` user):

```cron
0 5 * * * set -a; . /home/deploy/novr/novrcampaign/.env; set +a; curl -fsS -X POST -H "Authorization: Bearer $NP_COLLECT_CRON_SECRET" http://127.0.0.1/api/pulse/collect/run >> /var/log/novr-collect.log 2>&1
```

## 8. Operations

```bash
cd ~/novr/novrcampaign

docker compose ps                                   # status
docker compose logs -f backend                      # follow API logs
docker compose logs -f caddy                        # TLS / access logs
docker compose restart backend                      # restart one service
docker compose up -d --build                        # rebuild after a change
docker compose --profile collector up -d --build    # with the collector
docker compose down                                 # stop (keeps volumes)
docker compose down -v                              # stop AND delete data (destructive)
```

## 9. Rollback

```bash
cd ~/novr/novrcampaign
git log --oneline -10                 # find the previous good commit
git checkout <prev-commit>
docker compose up -d --build
# to return to latest:
git checkout main && ./deploy.sh
```

Database migrations are forward-only (`prisma migrate deploy`). If a rollback
requires reverting a schema change, restore from the latest `pg_dump` (§11) into a
fresh volume.

## 10. Enable the domain + automatic HTTPS

1. Point DNS: A record for `app.example.com` → VPS IP.
2. Open ports 80 and 443 (already done in §3).
3. Edit `.env`:

   ```diff
   - DOMAIN=<vps-ip>
   - CADDY_SITE_ADDRESS=:80
   + DOMAIN=app.example.com
   + CADDY_SITE_ADDRESS=app.example.com
   + FRONTEND_URL=https://app.example.com
   ```

4. Apply:

   ```bash
   docker compose up -d caddy backend
   ```

Caddy automatically requests and renews a Let's Encrypt certificate for
`CADDY_SITE_ADDRESS`. This requires the domain to resolve to the VPS and port 80
reachable for the ACME HTTP challenge. Certificates persist in the `caddy_data`
volume.

## 11. Backups (`pg_dump` cron)

```bash
mkdir -p ~/backups
```

Add a nightly dump (keeps 14 days):

```cron
# Nightly Postgres backup — 03:30 UTC
30 3 * * * cd /home/deploy/novr/novrcampaign && docker compose exec -T db pg_dump -U novrcampaign novrcampaign | gzip > /home/deploy/backups/novr-$(date +\%F).sql.gz && find /home/deploy/backups -name 'novr-*.sql.gz' -mtime +14 -delete
```

Restore:

```bash
gunzip -c ~/backups/novr-2026-11-26.sql.gz | docker compose exec -T db psql -U novrcampaign -d novrcampaign
```

## 12. Collector placement — decision

The collector is a **separate repository** and runs as an **optional Compose profile**
(`profiles: ["collector"]`) inside this stack's compose file, rather than a separate
compose project. Rationale:

- **Shared network without duplication.** The backend already needs to reach
  `http://collector:4100`; putting it in the same compose file makes it a first-class
  member of the `novr` network with one `up`.
- **Still optional and standalone.** The profile keeps it off by default, so the app
  runs (in-app collector) with no collector repo present. It is its own container,
  own port, own repo, own lifecycle — satisfying "still a separate service".
- **Relocatable.** The build context is `COLLECTOR_CONTEXT` (default
  `../novr-collection`), so the repo can be cloned anywhere.

**Alternative (documented, not chosen):** a separate `docker-compose.collector.yml`
with an `external: true` shared network. Use this only if the collector must be
deployed and versioned fully independently of the app; it costs an extra network
bootstrap step and a second `up`. For a single VPS, the profile is simpler.

## 13. First-deploy command sequence (owner)

```bash
# 1. as root: install docker (§2), create deploy user (§3), firewall (§3)
su - deploy

# 2. clone both repos side by side (§4)
mkdir -p ~/novr && cd ~/novr
git clone <app-repo-url> novrcampaign
git clone <collector-repo-url> novr-collection

# 3. configure env (§5)
cd ~/novr/novrcampaign
cp .env.production.example .env && chmod 600 .env
nano .env                       # fill DOMAIN, POSTGRES_*, JWT_SECRET, PLUNK_*, LLM, NP_COLLECT_CRON_SECRET

# 4. deploy (§6)
./deploy.sh --with-collector

# 5. seed admin, then change the password (§6)
docker compose run --rm --no-deps backend sh -c "cd backend && node prisma/seed.js"

# 6. schedule cron (§7, §11)
crontab -e

# 7. visit http://<vps-ip>/ , log in, change the seeded password
```

## 14. Risks / must-test on the real VPS

- **Path for `git pull --ff-only`** in `deploy.sh` assumes the working tree is clean
  and on a tracking branch; a dirty checkout aborts the deploy (by design).
- **First `docker build` needs outbound network** (npm registry, Prisma engines).
- **Prisma engines**: the generated client is produced during the image build; if the
  VPS arch differs from the build host it is irrelevant here because the build runs on
  the VPS itself.
- **`VERCEL=1`** is set on the backend container solely to disable its built-in static
  serving (Caddy/nginx serve the SPA). If the backend is ever expected to serve the SPA
  directly, remove that flag and copy `frontend/dist` into the image.
- **The collector is untested end-to-end against the app** in this environment — run
  one manual `POST /api/pulse/collect/run` with `NP_COLLECTION_ENABLED=true` and confirm
  HMAC acceptance before enabling the cron.
- **Collector secret parity**: `NP_COLLECTION_SECRET` (app) MUST equal
  `NOVR_COLLECTION_KEY_PULSE_2026_01` (collector). A mismatch fails closed.
- **DNS/TLS**: automatic HTTPS needs correct DNS and open port 80; verify the
  certificate issued before switching clients to `https://`.
- **Backups restored** must be validated (restore into a scratch DB) before relying on them.
