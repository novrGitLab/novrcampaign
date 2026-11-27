# NovrPulse production

The public newsroom and staff desk run on Next.js with TypeScript and Tailwind. Caddy terminates HTTPS at pulse.cybernovr.com. Browsers use same-origin /api endpoints. Next reads the public projection from the Express service over the private Compose network. PostgreSQL has no published port. Preserve the existing checkout directory and Compose project identity to retain the current database and Caddy volumes.

## Configure the release

Use the authoritative DNS zone for cybernovr.com. At audit time the domain delegated to dns1.namecheaphosting.com and dns2.namecheaphosting.com. The hosting account's cPanel Zone Editor contains the `pulse` A record pointing to `213.136.94.10` with a 300-second TTL. Check for conflicting A, AAAA or CNAME records. Confirm the resolved name reaches this Contabo instance on 80 and 443.

Register a server-based Zoho application, or an approved callback on an existing client for this relying party. Register exactly `https://pulse.cybernovr.com/api/auth/oidc/callback`. Put the client ID and secret in the VPS repository's untracked .env. The browser never receives the secret. The issuer and verified email domain must match the staff directory.

| Variable | Production value or purpose |
| --- | --- |
| DOMAIN, CADDY_SITE_ADDRESS | pulse.cybernovr.com |
| FRONTEND_URL, PUBLIC_SITE_URL | https://pulse.cybernovr.com |
| OIDC_ISSUER_URL | https://accounts.zoho.com or the organisation's Zoho data centre |
| OIDC_CLIENT_ID, OIDC_CLIENT_SECRET | Registered server-based client |
| OIDC_REDIRECT_URI | https://pulse.cybernovr.com/api/auth/oidc/callback |
| OIDC_ALLOWED_EMAIL_DOMAINS | cybernovr.com |
| PULSE_EDITOR_EMAILS | Explicit comma-separated initial administrators who have no existing Pulse account. Existing verified staff email matches retain their current role. |
| JWT_SECRET | Existing high-entropy signing secret for the temporary OIDC flow |
| PLUNK_API_KEY, NP_PULSE_SEGMENT | Existing Plunk secret key and the static newsletter audience segment |
| PEXELS_API_KEY | Optional free Pexels photo search. Uploads work independently. |
| INTERNAL_API_ORIGIN | Set to http://backend:4000 for the Next container in Compose |

## Deploy

Keep the existing GitHub VPS_HOST, VPS_USER and VPS_SSH_KEY secrets. Configure VPS_HOST_FINGERPRINT with the verified SHA256 fingerprint of the server's SSH host key when available. A main push deploys the tested revision. A manual CI run on main can retry the same revision after configuring the server. The public release can run while identity or email settings are pending. Staff routes stay protected. Sign-in and subscription each report unavailable until their own service is configured. DNS and database settings are checked before container replacement. The Compose file sets the canonical public URL, callback, and Caddy hostname. Vercel Git deployments are disabled for this release so the previous deployment remains available during the transition. On the server, use `./deploy.sh --check` to check readiness and `./deploy.sh` to deploy the checked-out revision. Retain a recent restorable PostgreSQL backup. Migrations add staff sessions, pending confirmations, edition image records and the two new editorial categories. Already-published edition snapshots remain intact.

The collector is a separate service. A normal Pulse release leaves it running. For an intentional coordinated collector release, use `./deploy.sh --with-collector` with COLLECTOR_CONTEXT pointing to its checkout. Existing collection and retention cron entries can continue using the loopback API. Maintain one scheduler per job. Retire the former Vercel deployment and any duplicate scheduler after the HTTPS public site, staff sign-in, and subscription confirmation pass on the production domain.

## Editorial and delivery checks

The editions use the inbox cybersecurity flag from the existing classifier and keyword pre-tagging. The public view requires a dated, attributed story, excludes dismissed and denied-licence items, and withholds arrest coverage requiring editorial review. Public output contains a headline, the newsroom summary and context, and a source link. An attributed photograph attached to a published newsletter story can also lead its public article. The daily inbox cleanup preserves cybersecurity stories used by the public archive. The original article body and internal judgements stay private.

Staff can attach or write stories, edit copy, upload JPEG/PNG/WebP photographs or search Pexels, and set descriptions and credits. Review every section including Tool Spotlight and Quiz. Empty sections need an explicit no-updates decision. Preview and send use the same HTML renderer. A local test provider can exercise the segment path without mailing real subscribers. In production, test only to a verified staff recipient before an editor confirms the live send. If Plunk accepts a dispatch and fails to acknowledge it, check its campaign delivery history before retrying. The delivery lock prevents another broadcast during reconciliation.

Public sign-up sends a one-day confirmation link. Following it opens a page, and the reader's confirmation adds their address to the newsletter segment. The first email leaves existing subscription state intact. Configure a static segment in Plunk and verify suppression and unsubscribe behavior before the first live edition.

## NovrCollector reuse

Reviewed novrGitLab/novrcollector at 22f69b8. The service already supports per-consumer HMAC keys, operation scopes, a source registry and consumer-owned runs. A NovrEvent integration should use its own consumer ID, key, scopes and source list. The Pulse key stays exclusively in the Pulse backend. The inspected collector passed lint and all 95 tests. Before workloads compete for capacity, add per-consumer concurrency limits and move process-local run state to shared persistent storage if operating multiple replicas or requiring restart recovery. The collector deployment lifecycle is independent of the Pulse UI.

## References

[Zoho OIDC](https://www.zoho.com/developer/oauth/sign-in-using-zoho-oidc.html) · [Plunk transactional delivery](https://docs.useplunk.com/api-reference/public-api/sendEmail) · [Pexels API](https://www.pexels.com/api/documentation/)
