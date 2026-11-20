import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { BadRequest, NotFound } from '../utils/AppError.js';
import { deriveStatus } from './publishController.js';

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

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  function: Joi.number().integer().min(1).max(8),
  reviewStatus: Joi.string().valid(...REVIEW_STATUSES),
  q: Joi.string().trim().max(200).allow(''),
  since: Joi.string().isoDate(),
  region: Joi.string()
    .trim()
    .lowercase()
    .valid(...Object.keys(REGION_ALIASES)),
});

// Body schema for the review endpoint. Values mirror the `reviewStatus` column.
const reviewSchema = Joi.object({
  status: Joi.string().valid(...REVIEW_STATUSES).required(),
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
  functions: true,
  eventType: true,
  reviewStatus: true,
};

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
 * Mirror the DTO in `CARD_SELECT` for a Prisma row (also used by the detail
 * endpoint's merged select). Dates are normalised to ISO strings.
 */
function serializeCard(event) {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    whatItMeans: event.whatItMeans,
    publishedAt: event.publishedAt instanceof Date ? event.publishedAt.toISOString() : (event.publishedAt ?? null),
    canonicalUrl: event.canonicalUrl ?? null,
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
 * `reviewStatus`, `q`, `since` may be combined freely (e.g. Pillar + Region,
 * or Region + Review status).
 */
export async function listPulseEvents(req, res) {
  const { page, pageSize, function: functionId, reviewStatus, q, since, region } =
    await validateQuery(req.query);

  const where = {};
  if (functionId !== undefined) where.functions = { has: functionId };
  if (reviewStatus !== undefined) where.reviewStatus = reviewStatus;
  if (since !== undefined) where.publishedAt = { gte: new Date(since) };
  if (q) where.title = { contains: q, mode: 'insensitive' };
  if (region !== undefined) {
    // The event's own `region` is unpopulated; region is derived from the
    // provenance chain: event → sources → rawDocument → source → region.
    where.sources = { some: { rawDocument: { source: { region: REGION_ALIASES[region] } } } };
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
        sources: {
          orderBy: { extractedAt: 'asc' },
          take: 1,
          select: { rawDocument: { select: { source: { select: { name: true } } } } },
        },
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
      sources: {
        orderBy: { extractedAt: 'asc' },
        select: {
          pageRef: true,
          rawDocument: { select: { url: true, source: { select: { name: true, licence: true } } } },
        },
      },
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

  return res.json({
    event: {
      ...serializeCard(event),
      ...publishDraftOf(event),
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
    select: { ...CARD_SELECT, sources: { orderBy: { extractedAt: 'asc' }, take: 1, select: { rawDocument: { select: { source: { select: { name: true } } } } } }, publishItems: { orderBy: PUBLISH_ITEM_ORDER_BY, select: PUBLISH_ITEM_SELECT } },
  });

  return res.json({
    event: {
      ...serializeCard(updated),
      sourceName: sourceNameOf(updated),
      ...publishDraftOf(updated),
    },
  });
}

export { listSchema, reviewSchema, serializeCard };
