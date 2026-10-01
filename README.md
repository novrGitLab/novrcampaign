# NovrCampaign — In-House Email Campaign Platform

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
novrcampaign/
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

Log in with `admin@novrcampaign.local` / `admin12345`.

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
| `GET` | `/api/contacts` | List contacts (`limit`, `cursor`, `search`) |
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

## License

MIT
