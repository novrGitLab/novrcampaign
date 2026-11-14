# NovrPulse — In-House Email Campaign Platform

An internal email marketing dashboard built on the [Plunk](https://useplunk.com) API.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Dashboard   │────▶│  Thin BFF     │────▶│   Plunk     │
│   (React)    │◀────│  (Node.js)    │◀────│    API      │
└─────────────┘     └──────────────┘     └─────────────┘
                          │
                    ┌─────▼──────┐
                    │  Supabase   │
                    │ Postgres    │
                    │ (users only)│
                    └────────────┘
```

## Architecture — thin BFF

Plunk is the **source of truth** for contacts, campaigns, and analytics. The
backend deliberately does *not* duplicate that data; it exists for three things:

1. **Keeping the Plunk `sk_*` secret key server-side.** The browser can never see
   it — Plunk's public `pk_*` key only unlocks `/v1/track`, while every endpoint
   this dashboard needs (`/contacts`, `/campaigns`, `/campaigns/:id/stats`)
   requires the secret key.
2. **Dashboard auth** — JWT login for your team (one seeded account, no
   self-registration; Plunk has one project key, not per-user accounts).
3. **Value-add logic** — CSV/MX pre-flight validation, unsubscribe enforcement,
   webhook ingestion, and rate-limit headroom protection.

Because nothing is mirrored locally, there are **no queues and no sync jobs** —
there is nothing to keep in sync. The only database table stores dashboard users,
so the database is a single Supabase Postgres project (pooler URL for runtime,
direct URL for migrations).

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, TanStack Query, React Router, Recharts, react-dropzone |
| Backend | Node.js 18+, Express, Prisma (Supabase Postgres), JWT auth |
| Email provider | Plunk Cloud (secret-key Bearer auth) |

## Repository layout

```
novrpulse/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # User table only
│   ├── src/
│   │   ├── config/              # env config
│   │   ├── controllers/         # auth, contacts, campaigns, webhooks
│   │   ├── services/            # plunkService (API client), emailService, csvService
│   │   ├── routes/
│   │   ├── middleware/          # auth, error handling, rate limiting, validation
│   │   └── utils/               # logger, email validation, backoff, rate budget, asyncHandler
│   └── .env                     # DATABASE_URL + DIRECT_URL (Supabase), never committed
├── frontend/
│   ├── src/
│   │   ├── components/          # layout + UI primitives
│   │   ├── pages/               # Dashboard, Contacts, Campaigns, Analytics, Login
│   │   ├── hooks/               # TanStack Query hooks
│   │   └── lib/                 # api client, utils
└── package.json                 # npm workspaces root
```

## Quick start

```bash
# 1. Copy environment templates
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 2. Fill in your Plunk key + JWT secret (see "Plunk setup" below)

# 3. Install, generate the Prisma client, migrate, and seed
npm install
npm run db:generate
npm run db:migrate:dev
npm run db:seed

# 4. Run both apps
npm run dev
```

Frontend: `http://localhost:5173` · Backend: `http://localhost:4000`

Log in with the seeded team account (`SEED_EMAIL` / `SEED_PASSWORD`, defaults to
`admin@novrcampaign.local` / `admin12345` for local dev only).

## Plunk setup

1. Create a project at [useplunk.com](https://useplunk.com).
2. **Verify your sending domain** (`cybernovr.com`) by adding the SPF / DKIM / MX
   records Plunk shows you. Only verified domains can send.
3. Generate a **secret API key** (`sk_*`) at Settings → API Keys.
4. Create a **Webhook workflow** (Workflows → New → trigger on `email.bounce`,
   `email.complaint`, `contact.unsubscribed`, … → add a Webhook step) pointing at
   `https://<your-backend>/api/webhooks/plunk`, and set `PLUNK_WEBHOOK_SECRET`
   to match the header your workflow sends.
5. Put the credentials into `backend/.env`:

   ```env
   PLUNK_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   PLUNK_BASE_URL=https://next-api.useplunk.com
   PLUNK_WEBHOOK_SECRET=replace_with_a_random_string
   ```

All campaigns send from the fixed in-house identity **`info@cybernovr.com`**,
which must be on the verified domain.

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Login → JWT |
| `GET` | `/api/auth/me` | Current user + Plunk status |
| `GET` | `/api/contacts` | List contacts (`limit`, `cursor`, `search`, `subscribed`, `sort`, `dir`) |
| `POST` | `/api/contacts` | Create/upsert a contact |
| `POST` | `/api/contacts/bulk-subscribe` | Bulk subscribe (≤1,000 IDs) |
| `POST` | `/api/contacts/bulk-unsubscribe` | Bulk unsubscribe |
| `POST` | `/api/contacts/bulk-delete` | Bulk delete |
| `GET` | `/api/contacts/bulk/:jobId` | Poll a bulk job |
| `POST` | `/api/contacts/import` | CSV import (multipart, ≤5 MB) |
| `GET` | `/api/contacts/import/:jobId` | Poll an import job |
| `GET` | `/api/campaigns` | List campaigns |
| `POST` | `/api/campaigns` | Create campaign draft |
| `GET` | `/api/campaigns/:id` | Campaign detail |
| `PUT` | `/api/campaigns/:id` | Update draft |
| `DELETE` | `/api/campaigns/:id` | Delete campaign |
| `POST` | `/api/campaigns/:id/send` | Send now, or `{ scheduledFor }` to schedule |
| `POST` | `/api/campaigns/:id/schedule` | Schedule campaign |
| `POST` | `/api/campaigns/:id/cancel` | Cancel scheduled/sending campaign |
| `POST` | `/api/campaigns/:id/test` | Test send to one address |
| `GET` | `/api/campaigns/:id/analytics` | Authoritative stats from Plunk |
| `POST` | `/api/webhooks/plunk` | Plunk event webhook (signature-verified) |

## Resilience & safeguards

- **Async error isolation** — every route handler is wrapped so a Plunk outage
  returns a clean HTTP error instead of crashing the process.
- **Rate budget** — an in-memory fixed-window limiter keeps outbound Plunk calls
  inside the configured budget (default 480/5 min), plus **exponential backoff**
  with jitter and `Retry-After` honoring on 429/5xx.
- **CSV pre-flight** — before forwarding an import, the BFF validates syntax,
  disposable domains, and MX records and returns a per-row rejection report.
- **Unsubscribe enforcement** — `HEADLESS` campaigns must reference
  `{{unsubscribeUrl}}`; `MARKETING` campaigns get Plunk's auto-injected footer.
- **Webhook verification** — shared-secret header or HMAC-SHA256 over the raw body.

## Compliance

- One-click unsubscribe (`{{unsubscribeUrl}}`) in every marketing email
- Physical address in the default footer
- Hard bounces and spam complaints auto-suppress the contact in Plunk
- Unsubscribes honored immediately by Plunk (well under the 10-day CAN-SPAM limit)

## Switching providers

Only two files are provider-specific: `plunkService.js` (the API client) and the
webhook verifier. Swapping to Resend, Postmark, or SES means rewriting those two —
the dashboard, auth, and routing stay as-is.

## Encrypted file drive (`/drive`)

A private, password-protected file drive served at **`/drive`** on the same
deployment. Files are encrypted at rest; the R2 bucket and the database hold
ciphertext only, and the drive is reachable only with the password.

### Threat model (plain language)

**Protects against**
- A stolen copy of the Supabase bucket or an R2 bucket: only ciphertext.
- A leaked database dump: ciphertext, opaque ids, sizes, and wrapped keys only.
- Password guessing: bcrypt (cost 12), 5-failure lockout, per-IP rate limits.
- Casual discovery: no link from the dashboard, unauthenticated drive paths
  return a generic 404, the bucket rejects anonymous reads, `noindex` headers.

**Does NOT protect against**
- A compromised backend server or leaked environment variables — the KEK lives
  there and the server decrypts on request.
- Anyone with admin access to Vercel, Supabase, Cloudflare, or the DNS.
- The drive URL being discovered. If you later attach a custom domain, the
  subdomain name is visible in DNS and certificate-transparency logs; that is
  accepted. Today the drive lives on a shared `*.vercel.app` URL, which anyone
  who guesses it can load — but access still requires the password.

**Password-only means:** there is no second factor and no recovery codes. A
single stolen password grants full read access. This is compensated by a
16-character minimum, strict lockout and rate limits, 2-hour sessions, and an
audit log of every download.

**Core risk:** losing the encryption key loses all files. See "Keys" below.

### Storage: Cloudflare R2

Files live in a **private** Cloudflare R2 bucket (S3-compatible), reached only
server-side. The bucket must have no public access. R2 replaces Supabase Storage
because the free tier's 1 GB is too small for a drive of tens of GB, while R2's
free tier is 10 GB and costs ~$0.015/GB-month beyond it. The Postgres database
stays on Supabase.

### Upload and download

- **Upload:** the browser splits the file into ≤4 MB chunks and **encrypts each
  chunk in the browser** before sending it, so only ciphertext crosses the
  network. The backend stores each encrypted chunk as its own R2 object. This
  works within Vercel's 4.5 MB request-body limit.
- **Download:** the backend reads the encrypted chunks from R2, decrypts each
  one, and **streams** the plaintext to the client. Streaming is not counted
  against Vercel's 4.5 MB response limit, so files up to 500 MB work within the
  300-second Hobby function duration.
- Plaintext is never written to disk, `/tmp`, logs, or error messages.

### Keys (read this before you deploy)

- Each file gets a random 32-byte data key. File bytes are **AES-256-GCM**
  encrypted, with a per-chunk IV and auth tag, so a tampered chunk fails GCM
  independently.
- The data key is wrapped by the **KEK** (`DRIVE_KEK`, an env var) and by the
  **recovery key** (`DRIVE_RECOVERY_KEY`). Only the wrapped forms are stored.
- Filenames and MIME types are encrypted with the data key; the DB stores only
  ciphertext, an opaque id, and the size.

**If BOTH the env KEK and the recovery key are lost, the files are
unrecoverable.** Keep the recovery key offline; it is printed once.

| Task | Command |
|------|---------|
| Provision the owner / change password | `npm -w backend run drive:provision <email> <password>` |
| Rotate the KEK (re-wraps; files not re-encrypted) | `DRIVE_KEK=<old> DRIVE_KEK_NEW=<new> npm -w backend run drive:kek:rotate` |
| Restore after losing the KEK | `DRIVE_RECOVERY_KEY=<base58> DRIVE_KEK=<new> npm -w backend run drive:recovery:restore` |
| Cleanup interrupted uploads / sessions / audit | `npm -w backend run drive:cleanup` (also runs via Vercel cron) |

### Environment variables

Set these in the backend service (see `backend/.env.example` for the full list):

```
DRIVE_ENABLED=true
DRIVE_KEK=<32-byte base64>
DRIVE_RECOVERY_KEY=<base58, printed once>
DRIVE_TOKEN_SECRET=<random>
DRIVE_IP_SALT=<random>
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
CRON_SECRET=<random>   # Vercel sends this to /api/drive/maintenance
```

When `DRIVE_ENABLED=false`, drive routes return 404, new sessions are refused,
and existing files stay intact and readable when re-enabled. The dashboard,
API, and Plunk integration are unaffected.

### Access and CSRF

- A separate session cookie (`novr_drive_session`): HttpOnly, Secure,
  SameSite=Strict, 2-hour expiry, backed by a server-side session table so
  logout is immediate.
- Every mutating request must carry a same-origin Origin/Referer; missing or
  foreign origins are rejected with a 404. No CORS wildcard.
- A download needs a valid session, a valid 60-second token
  (`DRIVE_TOKEN_SECRET`), and file ownership, and is served with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- No anonymous listing, metadata, or download exists.

### Route map (Vercel)

`vercel.json` defines a `drive` service (built from `frontend/drive` to
`frontend/drive-dist`) and routes `/drive/*` to it and `/api/drive/*` to the
backend. **No custom domain and no DNS changes are required**; the drive is
served from the project's existing URL. To move it to a domain later, add that
domain in Vercel and attach it — no code change.

### Tests

`npm -w backend test` runs the `node:test` suite: chunked crypto round-trip and
tamper detection, 60-second token signing, password lockout, session/CSRF/Origin
rejection, unauthenticated 404 obscurity, and recovery-key restore.

## License

MIT
