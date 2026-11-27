import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { BadRequest, NotFound, Unauthorized } from '../utils/AppError.js';
import { deriveStatus } from './publishController.js';
import { runCollection } from '../services/novrpulse/ingest.js';
import { purgeStaleNews } from '../services/novrpulse/retention.js';
import { classifyEvents, isConfigured as isClassifyConfigured } from '../services/novrpulse/classify.js';
import { timingSafeEqualString } from '../utils/timingSafe.js';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * NovrPulse internal feed read API.
 *
 * Read-only over the NovrPulse event store (the `np_*` tables). This is an
 * internal, authenticated-only feed: every route sits behind `requireAuth` and
 * there is no client-supplied role/tier — authorization is "any authenticated
 * user" and is decided server-side by the middleware, never by the request.
 *
 * The event `body` is NEVER returned from either endpoint: it is the raw
 * underlying text and is deliberately kept off the feed surface.
 */

// Region filter: maps the accepted request values to the canonical `np_source.region`
// code. Both the short code and a friendly alias are accepted.
//   NG     | nigeria → NG
//   AF     | africa  → AF
//   GLOBAL | global  → GLOBAL
// ("West Africa" is intentionally not offered — owner decision.)
const REGION_ALIASES = {
  ng: 'NG',
  nigeria: 'NG',
  af: 'AF',
  africa: 'AF',
  global: 'GLOBAL',
};

const REVIEW_STATUSES = ['new', 'accepted', 'dismissed'];

/**
 * Map a `cyberRegion` tier to the `np_source.region` code used by the layered
 * fallback for NOT-YET-CLASSIFIED events. The source region already encodes the
 * tier for a dedicated regional outlet, so an unclassified story carried only by
 * a Nigerian source is treated as a Nigeria-cyber candidate (owner requirement
 * 2026-11-25). 'GLOBAL' maps to its own code.
 */
const CYBER_REGION_SOURCE_REGION = {
  NG: 'NG',
  AF: 'AF',
  GLOBAL: 'GLOBAL',
};

/**
 * CIP v1 deterministic "cybersecurity related" heuristic — the curated set of
 * `np_source.id` values whose outlet is dedicated to cybersecurity coverage.
 * These are the only sources whose every story is a cyber story; every other
 * registry source (Nigerian tech/business outlets, regulators) is mixed-general
 * and is deliberately NOT classified as cyber here.
 *
 * Every id below matches a `np_source.id` in the NovrPulse registry
 * (`@novr/ingest` sources). Filtering is done on the SOURCE, not on the event's
 * `eventType`/`functions`, because the LLM understanding stage has never run and
 * those fields are empty on all collected events.
 *
 * UPGRADE PATH: replace this source-based heuristic with an `eventType`/
 * `functions` filter once the LLM understanding stage has classified events.
 */
export const CYBER_SOURCE_IDS = [
  'bleepingcomputer',
  'hackernews',
  'therecord',
  'securityweek',
  'darkreading',
  'cyberscoop',
];

// Language filter: the accepted request values. "All" sends no param. `en` is
// the common case; `non-en` selects everything whose `language` is not `en`
// (this is the flagging filter for the bad-feed-item case). Any concrete code
// (e.g. `ja`, `ru`) is also accepted so a reviewer can narrow to one language.
const LANGUAGE_FILTERS = ['en', 'non-en'];

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  function: Joi.number().integer().min(1).max(8),
  reviewStatus: Joi.string().valid(...REVIEW_STATUSES),
  q: Joi.string().trim().max(200).allow(''),
  since: Joi.string().isoDate(),
  // v1 deterministic cyber filter: `true` narrows to cybersecurity stories.
  // Layered semantics (see the where-clause): a story is cyber when its AI flag
  // `isCybersecurity = true`, OR — for events not yet classified — when its
  // source is a dedicated cybersecurity outlet (CYBER_SOURCE_IDS). Sent as the
  // query string `cyber=true`, so both the string and bare boolean forms are
  // accepted.
  cyber: Joi.boolean().truthy('true').falsy('false'),
  // AI classification flags (owner requirement). Same truthy/falsy pattern as
  // `cyber`. `true` narrows to events the AI flagged; `false` is accepted but
  // currently a no-op (the filter only narrows on `true`).
  isCybersecurity: Joi.boolean().truthy('true').falsy('false'),
  isThreatIntel: Joi.boolean().truthy('true').falsy('false'),
  // DEPRECATED: `isNigeriaRelated` filter param is retained for backward
  // compatibility but the column is no longer written; `cyberRegion=NG` is the
  // Nigeria-cyber filter now.
  isNigeriaRelated: Joi.boolean().truthy('true').falsy('false'),
  // Regional cybersecurity tier (owner requirement 2026-11-25). One of the three
  // canonical tiers; the case-insensitive/friendly aliases mirror `region`.
  cyberRegion: Joi.string()
    .trim()
    .uppercase()
    .valid('NG', 'AF', 'GLOBAL'),
  region: Joi.string()
    .trim()
    .lowercase()
    .valid(...Object.keys(REGION_ALIASES)),
  // `en` | `non-en` | a specific ISO 639-1 code (e.g. `ja`). Lowercased so the
  // request value matches the stored codes. The `en`/`non-en` sentinels are the
  // named filters; any two-letter code passes the pattern.
  language: Joi.string()
    .trim()
    .lowercase()
    .max(10)
    .custom((value, helpers) => {
      if (LANGUAGE_FILTERS.includes(value)) return value;
      if (/^[a-z]{2}$/.test(value)) return value;
      return helpers.error('any.invalid');
    }, 'language filter'),
});

// Body schema for the review endpoint. Values mirror the `reviewStatus` column.
const reviewSchema = Joi.object({
  status: Joi.string().valid(...REVIEW_STATUSES).required(),
});

// Body schema for the collection-run endpoint. All fields optional: an empty
// body triggers a run over the default window (3 days). `maxAgeDays` bounds how
// far back the collector looks; it is validated to a sane positive range.
const collectSchema = Joi.object({
  maxAgeDays: Joi.number().integer().min(1).max(30).default(3),
});

// Body schema for the retention purge endpoint. `retentionDays` defaults to 1
// (owner decision: previous days' unpublished news is purged once a new day's
// collection lands). `dryRun` defaults to TRUE so a stray call can never delete.
const purgeSchema = Joi.object({
  retentionDays: Joi.number().integer().min(1).max(30).default(1),
  dryRun: Joi.boolean().truthy('true').falsy('false').default(true),
});

/**
 * Validate query params, converting a Joi failure into the repo's `BadRequest`
 * so a malformed request surfaces as HTTP 400 (a raw Joi error carries no
 * status and the shared error handler would otherwise return 500).
 */
async function validateQuery(query) {
  try {
    return await listSchema.validateAsync(query, { convert: true, stripUnknown: true });
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }
}

/** Validate the review request body, mapping a Joi failure to a 400. */
async function validateReviewBody(body) {
  try {
    return await reviewSchema.validateAsync(body, { convert: true, stripUnknown: true });
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }
}

/**
 * The card fields shared by the list and detail endpoints. `body` is
 * intentionally absent.
 */
const CARD_SELECT = {
  id: true,
  title: true,
  summary: true,
  whatItMeans: true,
  publishedAt: true,
  canonicalUrl: true,
  language: true,
  functions: true,
  eventType: true,
  reviewStatus: true,
};

/**
 * Excerpt length (characters) for a card's description fallback. The raw
 * article `body` is long; the DTO carries only a short, collapsed opening.
 */
const EXCERPT_LENGTH = 220;

/**
 * The `sources` include used by the list/review select: the first provenance
 * row, narrowed to the source NAME (for attribution) and the raw document BODY
 * (for the excerpt fallback). Only `body` is selected from the raw document —
 * never the whole row. `take: 1` keeps it a single join, so there is no N+1.
 */
const SOURCES_INCLUDE = {
  orderBy: { extractedAt: 'asc' },
  take: 1,
  select: {
    rawDocument: {
      select: { body: true, source: { select: { name: true } } },
    },
  },
};

/** The `sources` include used by the detail endpoint (adds url/licence for display). */
const SOURCES_INCLUDE_DETAIL = {
  orderBy: { extractedAt: 'asc' },
  select: {
    pageRef: true,
    rawDocument: {
      select: { body: true, url: true, source: { select: { name: true, licence: true } } },
    },
  },
};

/**
 * Cap on the raw source text returned by the detail endpoint.
 *
 * The AI rewrite needs the publisher's full text to work from, so the event
 * DETAIL response — which is already the authenticated, evidence-carrying
 * surface — includes `sourceBody`. It is capped so a single pathological
 * document cannot bloat the response; `sourceTruncated` tells the client the
 * text was clipped. The card/list DTO stays body-free (see `rawBodyOf`).
 */
export const SOURCE_BODY_MAX_CHARS = 60_000;

/**
 * Fields needed to identify the event's "best" publish draft and derive its
 * status. `body` is deliberately excluded from the list DTO (it can be long);
 * the Edit modal fetches the body via the dedicated publish endpoint. Selected
 * in the SAME query as the card (no per-row extra query — no N+1).
 */
const PUBLISH_ITEM_SELECT = {
  id: true,
  approvedAt: true,
  publishedAt: true,
  withdrawnAt: true,
  rejectedAt: true,
};

/**
 * Order drafts deterministically so the first row is the "best" one, then pick
 * it in JS. Prisma is asked to put non-withdrawn rows first (nulls-first on
 * `withdrawnAt`), then the most recently meaningful activity (published >
 * approved > rejected). `PublishItem` has no `updatedAt`, so recency is
 * expressed through the available timestamp columns.
 */
const PUBLISH_ITEM_ORDER_BY = [
  { withdrawnAt: { sort: 'asc', nulls: 'first' } },
  { publishedAt: { sort: 'desc', nulls: 'last' } },
  { approvedAt: { sort: 'desc', nulls: 'last' } },
  { rejectedAt: { sort: 'desc', nulls: 'last' } },
  { id: 'desc' },
];

/**
 * Choose the most relevant publish draft for an event and derive its status.
 *
 * Precedence (documented rule): pick the most recently updated publish item
 * that is NOT withdrawn; if every item is withdrawn, fall back to the most
 * recent one anyway. Recency is read from the timestamp columns (there is no
 * `updatedAt`): the query orders non-withdrawn first, then publishedAt desc,
 * then approvedAt desc, then rejectedAt desc — so the first row is the pick.
 *
 * Returns `{ publishItemId: null, publishStatus: null }` when the event has no
 * publish items.
 */
function publishDraftOf(event) {
  const items = event.publishItems ?? [];
  if (items.length === 0) return { publishItemId: null, publishStatus: null };
  const best = items[0];
  return { publishItemId: best.id, publishStatus: deriveStatus(best) };
}

/**
 * Collapse runs of whitespace in `text` to single spaces and trim the ends.
 * The raw article body is multi-line HTML/plain text; the card wants one line.
 */
function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * The first source's raw document body, if the event has provenance and the
 * document carries text. Returns null otherwise.
 */
function rawBodyOf(event) {
  const first = event.sources?.[0];
  const body = first?.rawDocument?.body;
  return typeof body === 'string' && body.trim() ? body : null;
}

/**
 * Build the card's `excerpt` (the short description shown under the title).
 *
 * Rule (documented):
 *  - If `summary` is populated, prefer it (it is NovrPulse's own words).
 *  - Otherwise fall back to the first source's raw article body, whitespace-
 *    collapsed and trimmed to `EXCERPT_LENGTH` chars, with a trailing ellipsis
 *    ("…") when truncated.
 *  - If neither exists, return null (the UI shows nothing — no fabricated text).
 *
 * The full body is NEVER returned; only this bounded opening.
 */
function excerptOf(event) {
  const summary = typeof event.summary === 'string' ? event.summary.trim() : '';
  if (summary) return summary;

  const body = rawBodyOf(event);
  if (!body) return null;

  const collapsed = collapseWhitespace(body);
  if (collapsed.length <= EXCERPT_LENGTH) return collapsed;
  return `${collapsed.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/**
 * Mirror the DTO in `CARD_SELECT` for a Prisma row (also used by the detail
 * endpoint's merged select). Dates are normalised to ISO strings.
 *
 * `excerpt` is the description shown under the title (summary first, then the
 * raw article body opening). `hasSummary` lets the UI distinguish NovrPulse's
 * own words from the "from the article" fallback.
 */
function serializeCard(event) {
  const summary = typeof event.summary === 'string' ? event.summary.trim() : '';
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    whatItMeans: event.whatItMeans,
    excerpt: excerptOf(event),
    hasSummary: summary.length > 0,
    publishedAt: event.publishedAt instanceof Date ? event.publishedAt.toISOString() : (event.publishedAt ?? null),
    canonicalUrl: event.canonicalUrl ?? null,
    language: event.language ?? 'en',
    functions: event.functions,
    eventType: event.eventType ?? null,
    reviewStatus: event.reviewStatus ?? 'new',
  };
}

/**
 * Pick the source name from the first `np_event_source -> np_raw_document ->
 * np_source` chain. Returns null when the event has no provenance rows.
 */
function sourceNameOf(event) {
  const first = event.sources?.[0];
  if (!first) return null;
  if (first.sourceName !== undefined) return first.sourceName;
  return first.rawDocument?.source?.name ?? null;
}

/**
 * GET /api/pulse/events — paginated, filterable event cards.
 * Order: publishedAt desc (nulls last), then createdAt desc.
 *
 * Filters are independent and compose with AND: `function`, `region`,
 * `reviewStatus`, `q`, `since`, `language` may be combined freely (e.g. Pillar +
 * Region, or Region + Review status).
 */
export async function listPulseEvents(req, res) {
  const {
    page, pageSize, function: functionId, reviewStatus, q, since, region, language, cyber,
    isCybersecurity, isThreatIntel, isNigeriaRelated, cyberRegion,
  } = await validateQuery(req.query);

  const where = {};
  if (functionId !== undefined) where.functions = { has: functionId };
  if (reviewStatus !== undefined) where.reviewStatus = reviewStatus;
  if (since !== undefined) where.publishedAt = { gte: new Date(since) };
  if (q) where.title = { contains: q, mode: 'insensitive' };
  if (language !== undefined) {
    // `non-en` is the flagging filter: everything not labelled English.
    if (language === 'non-en') where.language = { not: 'en' };
    else where.language = language;
  }
  if (region !== undefined) {
    // The event's own `region` is unpopulated; region is derived from the
    // provenance chain: event → sources → rawDocument → source → region.
    where.sources = { some: { rawDocument: { source: { region: REGION_ALIASES[region] } } } };
  }
  // AI classification filters: `true` narrows to the flag.
  if (isCybersecurity === true) where.isCybersecurity = true;
  if (isThreatIntel === true) where.isThreatIntel = true;
  if (isNigeriaRelated === true) where.isNigeriaRelated = true;
  if (cyberRegion !== undefined) {
    // REGIONAL CYBERSECURITY filter (owner requirement 2026-11-25): narrow to the
    // cyber tier 'NG' | 'AF' | 'GLOBAL'. LAYERED, same shape as `cyber`: an event
    // is in the tier when the AI classified it `isCybersecurity = true` AND its
    // `cyberRegion` matches, OR — for events not yet classified — when its
    // provenance source region equals the tier's region (the source region
    // already encodes the tier). The OR rides in the AND list so it composes with
    // the other filters.
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { AND: [{ isCybersecurity: true }, { cyberRegion }] },
          {
            AND: [
              { isCybersecurity: null },
              {
                sources: {
                  some: {
                    rawDocument: { source: { region: CYBER_REGION_SOURCE_REGION[cyberRegion] } },
                  },
                },
              },
            ],
          },
        ],
      },
    ];
  }
  if (cyber === true) {
    // LAYERED cyber filter. A cyber story is EITHER an event the AI classified
    // `isCybersecurity = true`, OR — for events not yet classified (the flag is
    // NULL) — one whose provenance source is a dedicated cybersecurity outlet
    // (CYBER_SOURCE_IDS). The OR rides in the AND list so it composes with the
    // region filter (an event whose provenance includes a cyber source AND, when
    // region is set, a region-matching source).
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { isCybersecurity: true },
          {
            AND: [
              { isCybersecurity: null },
              { sources: { some: { rawDocument: { source: { id: { in: CYBER_SOURCE_IDS } } } } } },
            ],
          },
        ],
      },
    ];
  }

  // One findMany (with the source-name include) plus one count — no N+1.
  const [rows, total] = await Promise.all([
    prisma.npEvent.findMany({
      where,
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...CARD_SELECT,
        sources: SOURCES_INCLUDE,
        publishItems: {
          orderBy: PUBLISH_ITEM_ORDER_BY,
          select: PUBLISH_ITEM_SELECT,
        },
      },
    }),
    prisma.npEvent.count({ where }),
  ]);

  const items = rows.map((event) => ({
    ...serializeCard(event),
    sourceName: sourceNameOf(event),
    ...publishDraftOf(event),
  }));

  return res.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * GET /api/pulse/events/:id — one event card plus its sources and entities.
 * Unknown id → 404 via the repo NotFound helper.
 */
export async function getPulseEvent(req, res) {
  const event = await prisma.npEvent.findUnique({
    where: { id: req.params.id },
    select: {
      ...CARD_SELECT,
      sources: SOURCES_INCLUDE_DETAIL,
      entities: {
        select: { role: true, entity: { select: { type: true, canonicalName: true } } },
      },
      publishItems: {
        orderBy: PUBLISH_ITEM_ORDER_BY,
        select: PUBLISH_ITEM_SELECT,
      },
    },
  });

  if (!event) throw NotFound('Pulse event not found');

  const fullBody = rawBodyOf(event) ?? '';
  const sourceTruncated = fullBody.length > SOURCE_BODY_MAX_CHARS;
  const sourceBody = sourceTruncated ? fullBody.slice(0, SOURCE_BODY_MAX_CHARS) : fullBody;

  return res.json({
    event: {
      ...serializeCard(event),
      ...publishDraftOf(event),
      sourceBody,
      sourceTruncated,
      sources: event.sources.map((s) => ({
        sourceName: s.rawDocument?.source?.name ?? null,
        url: s.rawDocument?.url ?? null,
        licence: s.rawDocument?.source?.licence ?? null,
      })),
      entities: event.entities.map((e) => ({
        name: e.entity?.canonicalName ?? null,
        type: e.entity?.type ?? null,
        role: e.role,
      })),
    },
  });
}

/**
 * PATCH /api/pulse/events/:id/review — persist the reviewer triage state.
 *
 * Non-destructive: it only writes `reviewStatus` ("new" | "accepted" |
 * "dismissed"). Raw evidence (sources, body, entities) is never touched, so a
 * dismissed event is hidden from the inbox by filter, not deleted. Returns the
 * updated card so the client can reconcile without a refetch.
 */
export async function reviewPulseEvent(req, res) {
  const { status } = await validateReviewBody(req.body);

  const existing = await prisma.npEvent.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!existing) throw NotFound('Pulse event not found');

  const updated = await prisma.npEvent.update({
    where: { id: req.params.id },
    data: { reviewStatus: status },
    select: { ...CARD_SELECT, sources: SOURCES_INCLUDE, publishItems: { orderBy: PUBLISH_ITEM_ORDER_BY, select: PUBLISH_ITEM_SELECT } },
  });

  return res.json({
    event: {
      ...serializeCard(updated),
      sourceName: sourceNameOf(updated),
      ...publishDraftOf(updated),
    },
  });
}

export function isPulseCollectAuthorized(req) {
  // Rule 1 — the cron secret. Vercel sends `Authorization: Bearer <secret>`.
  // Fail closed when the secret is unset (an empty secret can never match a
  // non-empty bearer token because the length check rejects it). The compare is
  // constant-time and the secret is NEVER logged or echoed.
  const secret = config.novrpulse.collection.cronSecret;
  const auth = req.get?.('authorization') ?? req.headers?.authorization ?? '';
  const provided = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (secret && provided && timingSafeEqualString(provided, secret)) return true;

  // Rule 2 — an authenticated ADMIN session, so a human can trigger it from a
  // browser/curl without the secret. Only an already-valid session counts; the
  // role is read server-side and never trusted from the request.
  return req.user?.role === 'ADMIN';
}

/**
 * Resolve the caller's session (if any) WITHOUT rejecting. This runs on the
 * collection route, which sits outside `requireAuth` (a cron has no session),
 * so we opportunistically attach `req.user` for the ADMIN-session path. A bad
 * or absent token is simply ignored here — the guard decides authorization.
 */
export async function attachOptionalUser(req) {
  const header = req.headers?.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true },
    });
    if (user) req.user = user;
  } catch {
    // A malformed/expired token is not an error here: the Bearer token may be
    // the cron secret instead, and the guard below is the single decision point.
  }
}

/**
 * POST /api/pulse/collect/run — trigger one NovrPulse collection run.
 *
 * Auth (fail-closed, exactly two accepted callers):
 *   - `Authorization: Bearer <NP_COLLECT_CRON_SECRET>` (constant-time compare);
 *   - an authenticated ADMIN session (Joi-guarded role check server-side).
 * No session and no/incorrect secret → 401. Query params are never trusted.
 *
 * Delegates to `runCollection`, the cutover selector: with
 * `NP_COLLECTION_ENABLED` off it runs the in-app collectors, on it pulls from
 * the standalone collector over HMAC v1 — exactly one path per run. The endpoint
 * starts a run and returns its summary; there is no silent fallback.
 */
export async function runPulseCollection(req, res) {
  await attachOptionalUser(req);

  if (!isPulseCollectAuthorized(req)) {
    throw Unauthorized('Unauthorized');
  }

  let body;
  try {
    body = await collectSchema.validateAsync(req.body ?? {}, { convert: true, stripUnknown: true });
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }

  // `req._runCollection` is an injectable seam for tests ONLY; production never
  // sets it, so the real cutover selector runs. (Mirrors the `_paths` seam on
  // `runCollection`.)
  const runner = req._runCollection ?? runCollection;
  const summary = await runner({ maxAgeDays: body.maxAgeDays });

  // Best-effort AI classification AFTER a successful collection: the daily cron
  // now chains classification onto the pull, so freshly collected events get the
  // accurate flags without a second schedule. A classification failure MUST NOT
  // fail the collection response — it is caught and logged, and the run's summary
  // is returned unchanged (the events are stored; classification retries next
  // run). Skipped silently when no provider is configured.
  let classified;
  if (isClassifyConfigured()) {
    const classifyRunner = req._classifyEvents ?? classifyEvents;
    try {
      const result = await classifyRunner();
      classified = result.classified;
    } catch (err) {
      logger.warn({ message: err.message }, 'post-collection classification failed (collection unaffected)');
    }
  }

  return res.json(classified === undefined ? summary : { ...summary, classified });
}

/**
 * POST /api/pulse/maintenance/purge — purge collected news older than the
 * retention window, keeping published events (and their source documents)
 * forever.
 *
 * Auth (fail-closed, exactly the same two accepted callers as the collection
 * trigger): the `NP_COLLECT_CRON_SECRET` bearer token (constant-time compare) OR
 * an authenticated ADMIN session. No session and no/incorrect secret → 401.
 *
 * Body `{ retentionDays?: number (default 1), dryRun?: boolean (default TRUE) }`.
 * `dryRun` defaults TRUE so a stray call never deletes; pass `dryRun:false` to
 * perform the purge. `req._purgeStaleNews` is an injectable seam for tests ONLY;
 * production never sets it, so the real service runs.
 */
export async function purgePulseRetention(req, res) {
  await attachOptionalUser(req);

  if (!isPulseCollectAuthorized(req)) {
    throw Unauthorized('Unauthorized');
  }

  let body;
  try {
    body = await purgeSchema.validateAsync(req.body ?? {}, { convert: true, stripUnknown: true });
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }

  const purger = req._purgeStaleNews ?? purgeStaleNews;
  const summary = await purger({ retentionDays: body.retentionDays, dryRun: body.dryRun });

  return res.json(summary);
}

export { listSchema, reviewSchema, collectSchema, purgeSchema, serializeCard, excerptOf, EXCERPT_LENGTH };
