import { randomUUID } from 'node:crypto';
import { prisma } from '../../utils/prisma.js';
import { BadRequest, Conflict } from '../../utils/AppError.js';

/**
 * NovrPulse AI judgement ledger — record + review service.
 *
 * This is the persistence + review loop for the AI layer. Every AI decision
 * (a dedup pairing, a rewrite, a recommendation) is RECORDED here with its
 * frozen input snapshot and the model's output, then a human ADJUDICATES it
 * (accept / reject-with-reason). The rows are training data.
 *
 * Invariants enforced here (and again at the DB in the migration):
 *  - `kind` is a closed set: 'dedup' | 'rewrite' | 'recommend'.
 *  - A new row is always `outcome: 'pending'`.
 *  - Accept/reject is a ONE-WAY transition out of `pending`. The guarded
 *    `updateMany` (where outcome = 'pending') makes a second adjudication a
 *    no-op; we surface that as a Conflict (409), never a silent overwrite.
 *  - A rejection REQUIRES a reason (min 3 chars).
 *  - Reviewer identity is always supplied by the caller (the controller reads
 *    it from the session) and is never taken from a request body.
 *  - The record columns are append-only: the service never updates them.
 */

/** The closed set of judgement kinds. */
export const JUDGEMENT_KINDS = ['dedup', 'rewrite', 'recommend'];

/** The closed set of review outcomes. */
export const JUDGEMENT_OUTCOMES = ['pending', 'accepted', 'rejected'];

/** Minimum length of a rejection reason. Kept in step with the controller Joi schema. */
const MIN_REASON_LENGTH = 3;

/**
 * Record an AI judgement.
 *
 * Writes a new row with `outcome: 'pending'` — never accepted/rejected. The
 * `scenario` is the FROZEN input snapshot: the caller must pass exactly what the
 * model saw, so a later review is reproducible. `detail` is optional extra
 * structured context (e.g. per-field confidence breakdown).
 *
 * Callers must pass a `subjectKey` and at least one subject id; the DB CHECK
 * enforces the subject requirement, while this function rejects an unknown
 * `kind` early with a clear 400 rather than letting a CHECK violation surface
 * as an opaque 500.
 *
 * @param {object} input
 * @param {'dedup'|'rewrite'|'recommend'} input.kind
 * @param {string} [input.eventId]
 * @param {string} [input.counterpartEventId]
 * @param {string} [input.publishItemId]
 * @param {string} input.subjectKey
 * @param {object} input.scenario
 * @param {string} input.decision
 * @param {number} [input.confidence]
 * @param {string} [input.rationale]
 * @param {string} input.model
 * @param {string} input.promptVersion
 * @param {object} [input.detail]
 * @returns {Promise<object>} the created row (outcome 'pending').
 * @throws {BadRequest} when `kind` is not in the closed set.
 */
export async function recordJudgement(input) {
  const {
    kind,
    eventId = null,
    counterpartEventId = null,
    publishItemId = null,
    subjectKey,
    scenario,
    decision,
    confidence = null,
    rationale = null,
    model,
    promptVersion,
    detail = null,
  } = input ?? {};

  if (!JUDGEMENT_KINDS.includes(kind)) {
    throw BadRequest(`Unknown judgement kind: ${JSON.stringify(kind)}`);
  }

  return prisma.aiJudgement.create({
    data: {
      kind,
      eventId,
      counterpartEventId,
      publishItemId,
      subjectKey,
      scenario,
      decision,
      confidence,
      rationale,
      model,
      promptVersion,
      detail,
      // Always pending on insert — the review loop is the only writer of outcome.
      outcome: 'pending',
    },
  });
}

/**
 * Accept a pending judgement.
 *
 * One-way transition out of `pending`. The guarded `updateMany` atomically
 * matches only a still-pending row, so two concurrent accepts cannot both win:
 * the loser sees `count === 0` and gets a Conflict. `reviewerId` is the acting
 * reviewer (the controller passes the session user id).
 *
 * @param {string} id
 * @param {string} reviewerId
 * @returns {Promise<object>} the updated row.
 * @throws {Conflict} when the row is already adjudicated (or does not exist — the
 *   controller disambiguates 404 first).
 */
export async function acceptJudgement(id, reviewerId) {
  const { count } = await prisma.aiJudgement.updateMany({
    where: { id, outcome: 'pending' },
    data: { outcome: 'accepted', reviewerId, reviewedAt: new Date() },
  });

  if (count === 0) {
    throw Conflict('Judgement already adjudicated');
  }

  // Accept-side effect (dedup only): a human accepting an LLM `same_story`
  // verdict GROUPS the two events under a shared `clusterId`. This runs AFTER
  // the guarded transition above has won, so a losing concurrent accept (which
  // threw Conflict) can never reach it. It is idempotent and transaction-safe;
  // see `groupAcceptedDedup`.
  const row = await prisma.aiJudgement.findUnique({ where: { id } });
  if (row) await groupAcceptedDedup(row);

  return row;
}

/**
 * Group the two events of an ACCEPTED dedup/`same_story` judgement under one
 * `clusterId` (Capability 1, accept-side effect).
 *
 * v1 only GROUPS — it never merges or deletes events. The cluster id is chosen
 * deterministically: reuse A's existing cluster, else B's, else a fresh uuid;
 * then EVERY event already in that cluster, plus A and B, is set to it, so a
 * chain (A~B accepted, then B~C accepted) folds into a single cluster.
 *
 * Runs in a transaction, and is a no-op for any other kind/decision or when
 * either event is already in the target cluster (idempotent: re-running changes
 * nothing).
 *
 * @param {object} row  the adjudicated `ai_judgement` row.
 */
async function groupAcceptedDedup(row) {
  if (row?.kind !== 'dedup' || row.decision !== 'same_story') return;
  const a = row.eventId;
  const b = row.counterpartEventId;
  if (!a || !b) return;

  await prisma.$transaction(async (tx) => {
    const [evA, evB] = await Promise.all([
      tx.npEvent.findUnique({ where: { id: a }, select: { id: true, clusterId: true } }),
      tx.npEvent.findUnique({ where: { id: b }, select: { id: true, clusterId: true } }),
    ]);
    if (!evA || !evB) return; // event gone: nothing to group

    const clusterId = evA.clusterId || evB.clusterId || randomUUID();

    // Every event already in the cluster plus both accepted events → one id.
    const memberIds = new Set([a, b]);
    if (evA.clusterId) memberIds.add(a);
    if (evB.clusterId) memberIds.add(b);
    const existing = await tx.npEvent.findMany({
      where: { clusterId },
      select: { id: true },
    });
    for (const m of existing) memberIds.add(m.id);

    await tx.npEvent.updateMany({
      where: { id: { in: [...memberIds] } },
      data: { clusterId },
    });
  });
}

/**
 * Reject a pending judgement with a reason.
 *
 * Same guarded one-way transition as {@link acceptJudgement}, but a reason is
 * REQUIRED (and must be at least `MIN_REASON_LENGTH` chars) — a rejection with
 * no reason is worthless as training signal. The entity/session boundary is the
 * caller's job; only the reason content is validated here.
 *
 * @param {string} id
 * @param {string} reviewerId
 * @param {string} reason
 * @returns {Promise<object>} the updated row.
 * @throws {BadRequest} when the reason is missing or too short.
 * @throws {Conflict} when the row is already adjudicated.
 */
export async function rejectJudgement(id, reviewerId, reason) {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw BadRequest(`A rejection reason of at least ${MIN_REASON_LENGTH} characters is required`);
  }

  const { count } = await prisma.aiJudgement.updateMany({
    where: { id, outcome: 'pending' },
    data: { outcome: 'rejected', reason: trimmed, reviewerId, reviewedAt: new Date() },
  });

  if (count === 0) {
    throw Conflict('Judgement already adjudicated');
  }

  return prisma.aiJudgement.findUnique({ where: { id } });
}

/**
 * Select the display fields a review list needs, including the subject titles.
 *
 * Titles are pulled through the relation FKs in the SAME query (a single join),
 * so there is no N+1: `event` gives the primary event title, and — for a dedup
 * pairing — the counterpart event title is resolved via a second relation read
 * keyed on `counterpartEventId`. `publishItemId` is a plain column (the publish
 * item may be gone; the id is still meaningful).
 */
const LIST_SELECT = {
  id: true,
  kind: true,
  eventId: true,
  counterpartEventId: true,
  publishItemId: true,
  subjectKey: true,
  decision: true,
  confidence: true,
  rationale: true,
  model: true,
  promptVersion: true,
  scenario: true,
  detail: true,
  outcome: true,
  reason: true,
  createdAt: true,
  reviewedAt: true,
  event: { select: { title: true } },
  publishItem: { select: { id: true } },
};

/**
 * List judgements for the review UI.
 *
 * Ordered `createdAt` desc (newest first). Filters compose with AND: `kind` and
 * `outcome` are optional; `limit` bounds the page. The counterpart title for a
 * dedup pairing is resolved in a single follow-up `findMany` over the distinct
 * counterpart ids — still O(1) queries, not O(n).
 *
 * The returned row shape includes the frozen `scenario`/`detail` so the UI can
 * show WHAT the AI judged, plus a `subject` object with the resolved titles.
 *
 * @param {{kind?:string, outcome?:string, limit?:number}} [filters]
 * @returns {Promise<object[]>}
 */
export async function listJudgements({ kind, outcome, limit = 50 } = {}) {
  const where = {};
  if (kind !== undefined) where.kind = kind;
  if (outcome !== undefined) where.outcome = outcome;

  const rows = await prisma.aiJudgement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: LIST_SELECT,
  });

  // Resolve the counterpart event titles in one extra query (no per-row query).
  const counterpartIds = [...new Set(rows.map((r) => r.counterpartEventId).filter(Boolean))];
  const counterpartTitles = new Map();
  if (counterpartIds.length > 0) {
    const counterparts = await prisma.npEvent.findMany({
      where: { id: { in: counterpartIds } },
      select: { id: true, title: true },
    });
    for (const c of counterparts) counterpartTitles.set(c.id, c.title);
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    decision: row.decision,
    confidence: row.confidence,
    rationale: row.rationale,
    outcome: row.outcome,
    reason: row.reason,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    eventId: row.eventId ?? null,
    eventTitle: row.event?.title ?? null,
    scenario: row.scenario,
    detail: row.detail,
    subject: {
      eventTitle: row.event?.title ?? null,
      counterpartTitle: row.counterpartEventId ? (counterpartTitles.get(row.counterpartEventId) ?? null) : null,
      publishItemId: row.publishItemId ?? null,
      subjectKey: row.subjectKey,
    },
  }));
}

export { MIN_REASON_LENGTH };
