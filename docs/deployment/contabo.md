# Deploying NovrCampaign on a Contabo Ubuntu VPS

Single-VPS Docker Compose deployment: PostgreSQL, the Node API, the static SPA
(nginx), Caddy (reverse proxy + automatic TLS), and — when used — the standalone
`novr-collection` service as a **separate compose stack from its own repo**.
Deployed by `git pull` on the server — no registry, no CI.

## Topology

The app stack runs on its own private **named** network, `novr`; the app and the
collector also share a second named network, `novr-shared`:

```
                        ┌────────────────────────── VPS ───────────────────────────┐
  Internet              │   stack A: ~/novr/novrcampaign                            │
  :80 / :443  ────────► │  caddy ──►  /       ──► frontend (nginx :80)              │
                        │        └─►  /api/*  ──► backend  (:4000)                  │
                        │                            └─► db (postgres:16)           │
                        │                                                           │
                        │   stack B: ~/novr/novr-collection  (own repo, own up)     │
                        │  collector (:4100)  ◄── backend calls http://collector:4100│
                        │                                                           │
                        │  `novr` (private): db, frontend, caddy, backend          │
                        │  `novr-shared` (named): backend ──────── collector        │
                        │  only `caddy` publishes host ports (80/443)               │
                        └───────────────────────────────────────────────────────────┘
```

- `db`, `frontend`, and `caddy` are on the app's private `novr` network only;
  `backend` joins **both** `novr` and `novr-shared`; `collector` is on
  `novr-shared` only. `db` and `collector` are **never** published to the host.
- `novr-shared` is a **named** network (not `external: true`): whichever stack starts
  first creates it, and the other attaches to it — so the app boots fine even when the
  collector is not deployed at all.
- The backend reaches the collector at `http://collector:4100` over their HMAC API.
- The browser reaches the API at `/api` (same origin), proxied by Caddy. `VITE_API_URL=/api`
  is inlined into the SPA at build time.
- The collector is **not** part of `novrcampaign/docker-compose.yml`. It is started
  from its own repo, independently of the app's deploy.

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

## 4. Clone BOTH repos

```bash
mkdir -p ~/novr && cd ~/novr
git clone <app-repo-url> novrcampaign
git clone <collector-repo-url> novr-collection
# Result:
#   ~/novr/novrcampaign
#   ~/novr/novr-collection
```

The shared network `novr-shared` is a **named** network (not `external: true`):
whichever stack starts first creates it and the other attaches to it, so **no manual
`docker network create` is required**. (If you prefer to pre-create it explicitly, you
may — `docker network create novr-shared` — but it is optional.)

If the collector runs on a different host (see §12 "Lift to its own VPS"), it does
not need to be cloned here and the shared network is not used — point
`NP_COLLECTION_BASE_URL` at that host instead.

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
| Collector (only if used) | `NP_COLLECTION_SECRET`, `NP_COLLECTION_ENABLED` |

Then configure the collector's own `.env` (separate file, separate repo):

```bash
cd ~/novr/novr-collection
cp .env.example .env
chmod 600 .env
nano .env
```

Set `NOVR_COLLECTION_KEY_PULSE_2026_01` to the **same value** as the app's
`NP_COLLECTION_SECRET`. They are the two halves of the shared HMAC secret; a
mismatch fails closed with 401.

Generate secrets without committing them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"    # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" # HMAC secret
```

> **Bare IP now, domain later.** For the first deploy set
> `DOMAIN=<vps-ip>` and `CADDY_SITE_ADDRESS=:80` (plain HTTP).
> When the domain is ready, see §10.

## 6. Deploy the two stacks

```bash
# 1) App stack (db, backend, frontend, caddy):
cd ~/novr/novrcampaign
./deploy.sh

# 2) Collector stack (from its OWN repo):
cd ~/novr/novr-collection
docker compose up -d --build
```

`./deploy.sh` runs: `git pull` → `docker compose build` → `up -d` → `prisma migrate
deploy` → `curl /api/health` → `compose ps`. The named network `novr-shared` is
created automatically by whichever stack starts first, so no manual step is needed.
The backend image's entrypoint also runs `prisma migrate deploy` on every
start, so first boot and upgrades both migrate.

> `./deploy.sh --with-collector` is a convenience that also drives the collector
> stack (it requires `../novr-collection` with a filled `.env`). The collector can
> always be started directly from its own repo regardless.

### Seed the admin user

```bash
docker compose run --rm --no-deps backend sh -c "cd backend && node prisma/seed.js"
```

This upserts `SEED_EMAIL` (default `admin@novrcampaign.local`) with `SEED_PASSWORD`.
**Log in and change that password immediately.**

### Cut over to the collector

Once both stacks are up, enable the backend's collector client:

```bash
cd ~/novr/novrcampaign
sed -i 's/^NP_COLLECTION_ENABLED=.*/NP_COLLECTION_ENABLED=true/' .env
docker compose up -d backend          # re-reads .env
```

Verify the collector is reachable and healthy:

```bash
cd ~/novr/novr-collection
docker compose ps                      # collector should be "healthy"
docker compose logs -f collector       # follow logs
# From the app's network, the backend resolves it as collector:4100:
docker run --rm --network novr-shared curlimages/curl -fsS http://collector:4100/healthz
```

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

The log lands in `/var/log/novr-collect.log`; verify a run by tailing it after the
scheduled time, and by checking the collector received the call:

```bash
tail -f /var/log/novr-collect.log
cd ~/novr/novr-collection && docker compose logs --since 10m collector
```

## 8. Operations

```bash
# App stack
cd ~/novr/novrcampaign
docker compose ps                                   # status
docker compose logs -f backend                      # follow API logs
docker compose logs -f caddy                        # TLS / access logs
docker compose restart backend                      # restart one service
docker compose up -d --build                        # rebuild after a change
docker compose down                                 # stop (keeps volumes)

# Collector stack (own repo)
cd ~/novr/novr-collection
docker compose ps
docker compose logs -f collector
docker compose up -d --build                        # rebuild after a change
docker compose down                                 # stop the collector only
```

`novr-shared` is a named network; whichever stack starts first creates it, and both
`down` commands leave it intact. The two stacks are otherwise independent.


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

The collector is a **separate repository** and runs as its **own compose stack**
(`novr-collection/docker-compose.yml`), startable from its own folder:

```bash
cd ~/novr/novr-collection && docker compose up -d
```

The two stacks are joined by a **shared named** Docker network, `novr-shared`, which
both composes declare as a named network (not `external: true`):

```yaml
networks:
  novr-shared:
    name: novr-shared
```

Whichever stack starts first **creates** it; the other **attaches**. The collector
attaches to it and does **not** publish port 4100 to the host; the app's backend
resolves it as `http://collector:4100` (a container-DNS name on the shared network).
The port is reachable only by containers on that network.

Rationale:

- **Fully standalone, owner-initiated.** The collector is not owned by the app's
  compose and is not merely a profile of it. You can start, stop, rebuild, or redeploy
  the collector without touching the app stack (and vice versa).
- **One network, no duplication.** The shared named network is created automatically
  by whichever stack starts first and survives `compose down` on either side.
  Container DNS on a user-defined network provides the `collector` name the backend
  needs — no `links`, no published ports.
- **Relocatable with zero app change.** Moving the collector to its own VPS later is
  a clone + `up` + repointing `NP_COLLECTION_BASE_URL`; nothing in the app's source
  changes.

### Lift the collector to its own VPS later

The collector is already independent, so relocation is the same flow on another box:

```bash
# On the collector VPS:
mkdir -p ~/novr && cd ~/novr
git clone <collector-repo-url> novr-collection
cd novr-collection
cp .env.example .env && chmod 600 .env
nano .env                       # set the matching NOVR_COLLECTION_KEY_PULSE_2026_01
docker compose up -d --build
```

Then, in the **app's** `.env` on the app VPS, point the backend at the collector
host instead of the shared network, and restart only the backend:

```bash
cd ~/novr/novrcampaign
# e.g. a private address or a TLS-fronted hostname:
NP_COLLECTION_BASE_URL=https://collector.example.com
docker compose up -d backend
```

There is **no app code change** — only the base URL (and, if the collector host uses
a different LLM/secret, the shared secret value kept in both `.env` files). When the
collector is remote, `novr-shared` is no longer the path the backend uses to reach it;
leave the network in place for the app stack (harmless) or remove the collector's
`networks` block.

## 13. First-deploy command sequence (owner)

```bash
# 1. as root: install docker (§2), create deploy user (§3), firewall (§3)
su - deploy

# 2. clone both repos (§4)
mkdir -p ~/novr && cd ~/novr
git clone <app-repo-url> novrcampaign
git clone <collector-repo-url> novr-collection
# No `docker network create` needed: the named network `novr-shared` is created
# automatically by whichever stack starts first.

# 3. configure env (§5)
cd ~/novr/novrcampaign
cp .env.production.example .env && chmod 600 .env
nano .env                       # fill DOMAIN, POSTGRES_*, JWT_SECRET, PLUNK_*, LLM, NP_COLLECT_CRON_SECRET
cd ~/novr/novr-collection
cp .env.example .env && chmod 600 .env
nano .env                       # set NOVR_COLLECTION_KEY_PULSE_2026_01 = NP_COLLECTION_SECRET

# 4. deploy the app stack (§6)
cd ~/novr/novrcampaign
./deploy.sh

# 5. deploy the collector stack from its own repo (§6)
cd ~/novr/novr-collection
docker compose up -d --build

# 6. cut the backend over to the collector (§6)
cd ~/novr/novrcampaign
sed -i 's/^NP_COLLECTION_ENABLED=.*/NP_COLLECTION_ENABLED=true/' .env
docker compose up -d backend

# 7. seed admin, then change the password (§6)
docker compose run --rm --no-deps backend sh -c "cd backend && node prisma/seed.js"

# 8. schedule cron (§7, §11)
crontab -e

# 9. visit http://<vps-ip>/ , log in, change the seeded password
```

## 14. Risks / must-test on the real VPS

- **Network creation order — not a prerequisite.** `novr-shared` is a **named** network
  (both composes declare `networks: { novr-shared: { name: novr-shared } }`, not
  `external: true`). Whichever stack starts first **creates** it and the other
  **attaches**, so there is **no** required `docker network create novr-shared` step.
  The app runs on its own private `novr` network and is unaffected if the collector is
  absent; only the backend's cross-stack calls to `collector:4100` need `novr-shared`,
  and it is created automatically.
- **Container DNS is per-network.** The backend resolves `collector` only because both
  are attached to the same user-defined network. If the collector is later moved to
  another host, `http://collector:4100` no longer resolves — repoint
  `NP_COLLECTION_BASE_URL` (see §12).
- **Path for `git pull --ff-only`** in `deploy.sh` assumes the working tree is clean
  and on a tracking branch; a dirty checkout aborts the deploy (by design).
- **First `docker build` needs outbound network** (npm registry, Prisma engines).
- **Prisma engines**: the generated client is produced during the image build; if the
  VPS arch differs from the build host it is irrelevant here because the build runs on
  the VPS itself.
- **`SERVE_STATIC=false`** is set on the backend container solely to disable its
  built-in static serving (Caddy/nginx serve the SPA). `SERVE_STATIC` defaults to `true`
  and the backend still also honours `VERCEL` (set automatically on Vercel). If the
  backend is ever expected to serve the SPA directly, drop the flag and copy
  `frontend/dist` into the image.
- **The collector is untested end-to-end against the app** in this environment — run
  one manual `POST /api/pulse/collect/run` with `NP_COLLECTION_ENABLED=true` and confirm
  HMAC acceptance before enabling the cron.
- **Collector secret parity**: `NP_COLLECTION_SECRET` (app `.env`) MUST equal
  `NOVR_COLLECTION_KEY_PULSE_2026_01` (collector `.env`). A mismatch fails closed (401).
- **Single-instance constraint**: the collector keeps its run store, replay-nonce store,
  and cursor key in process memory — it MUST run as exactly one replica. Do not scale it.
- **DNS/TLS**: automatic HTTPS needs correct DNS and open port 80; verify the
  certificate issued before switching clients to `https://`.
- **Backups restored** must be validated (restore into a scratch DB) before relying on them.
