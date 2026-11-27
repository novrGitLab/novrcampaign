# NovrPulse

NovrPulse is CyberNovr’s cybersecurity publication and staff newsroom. The public front page, Nigeria, Africa and World editions, article pages, contact management and editorial desk run in one Next.js App Router application with TypeScript and Tailwind. The Express API serves public story projections and authenticated staff operations. PostgreSQL stores editorial records. Plunk manages the contact audience, campaigns, suppressions and delivery.

## Development

Use Node.js 22.12 or later and PostgreSQL. Copy backend/.env.example to backend/.env and configure DATABASE_URL and DIRECT_URL for the development database. Configure the development identity provider before using the staff desk. Copy frontend/.env.example to frontend/.env.local when overriding local defaults.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:5173 for the public front page and /login for staff sign-in. Public news requires eligible, attributed events in the database. The application shows a real empty state when no stories qualify.

## Verification

```sh
npm run lint
npm -w @novr/ingest test
npm run build
node --test backend/test/feed.test.mjs backend/test/novrpulseEventKeywords.test.mjs backend/test/novrpulseLanguage.test.mjs backend/test/novrpulseSourcesShim.test.mjs backend/test/newsroom.test.mjs
```

Use a local database, a test OIDC issuer and a local Plunk substitute to exercise subscription, preview and sending. For an edition, review ten sections, preview the email and confirm delivery in the staff desk.

## Operations and design

- [Production configuration, deployment and shared collector](docs/deployment/newsroom.md)
- [Contabo operating history, backups and cron](docs/deployment/contabo.md)
- [Editorial design and source research](DESIGN.md)
- [Motion and accessibility](MOTION.md)


### Rejected stories

In the staff portal, open **Article review → Rejected stories** to search retained stories that screening excluded or an editor dismissed. New screening decisions include the recorded rationale and confidence where available. Older records contain only the verdict. The existing daily retention policy applies to unreferenced rejected stories.

Administrators can choose Nigeria, Africa or World and restore an eligible story. Restoration records the editor and time, protects the edition from later classification passes and returns the article to private review. Publishing requires a separate editorial approval. Publisher restrictions and the Breaking News review for arrest and accusation coverage still apply.
