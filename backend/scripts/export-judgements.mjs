import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prisma } from '../src/utils/prisma.js';

/**
 * Export adjudicated AI judgements as JSONL — the training-export CLI.
 *
 * One JSON object per line for every row whose `outcome <> 'pending'` (i.e. a
 * human has accepted or rejected it). This is the training corpus; a pending row
 * has no human label and is skipped.
 *
 * PRIVACY: the export EXCLUDES `reviewerId` (who adjudicated is not training
 * signal and must not leave the system). It also never adds raw publisher
 * bodies: `scenario` is the frozen snapshot the AI saw and is exported verbatim
 * — this script does not enrich rows with any additional source text.
 *
 * Usage:
 *   node scripts/export-judgements.mjs
 *   node scripts/export-judgements.mjs --since 2026-11-01
 *   node scripts/export-judgements.mjs --kind dedup --out /tmp/dedup.jsonl
 *
 * Flags:
 *   --since <date>  only rows created on/after this ISO date.
 *   --kind <k>      restrict to one kind (dedup | rewrite | recommend).
 *   --out <path>    output path (default: judgements-export.jsonl, repo root).
 */

// Repo root (the backend/ directory's parent). fileURLToPath decodes the URL so
// a path containing spaces (e.g. "Ajibola Adedeji") is not percent-encoded.
// The script lives in backend/scripts/, so two levels up is the repo root.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_OUT = join(REPO_ROOT, 'judgements-export.jsonl');

const KINDS = ['dedup', 'rewrite', 'recommend'];

const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since');
const kindIdx = args.indexOf('--kind');
const outIdx = args.indexOf('--out');

const since = sinceIdx !== -1 ? args[sinceIdx + 1] : undefined;
const kind = kindIdx !== -1 ? args[kindIdx + 1] : undefined;
const out = outIdx !== -1 ? args[outIdx + 1] : DEFAULT_OUT;

if (sinceIdx !== -1 && (!since || Number.isNaN(Date.parse(since)))) {
  console.error('--since requires an ISO date, e.g. --since 2026-11-01');
  process.exit(2);
}
if (kindIdx !== -1 && !KINDS.includes(kind)) {
  console.error(`--kind must be one of: ${KINDS.join(', ')}`);
  process.exit(2);
}
if (outIdx !== -1 && !out) {
  console.error('--out requires a file path, e.g. --out judgements.jsonl');
  process.exit(2);
}

const where = {
  // Only human-adjudicated rows have a label; pending rows are excluded.
  outcome: { not: 'pending' },
};
if (kind) where.kind = kind;
if (since) where.createdAt = { gte: new Date(since) };

// Select EXACTLY the training fields. `reviewerId` is deliberately absent from
// this projection, so it can never reach the file.
const rows = await prisma.aiJudgement.findMany({
  where,
  orderBy: { createdAt: 'asc' },
  select: {
    kind: true,
    scenario: true,
    decision: true,
    confidence: true,
    model: true,
    promptVersion: true,
    detail: true,
    outcome: true,
    reason: true,
    reviewedAt: true,
  },
});

const stream = createWriteStream(out, { encoding: 'utf8' });
let written = 0;
try {
  for (const row of rows) {
    const record = {
      kind: row.kind,
      scenario: row.scenario,
      decision: row.decision,
      confidence: row.confidence,
      model: row.model,
      promptVersion: row.promptVersion,
      detail: row.detail,
      outcome: row.outcome,
      reason: row.reason,
      reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : (row.reviewedAt ?? null),
    };
    if (!stream.write(`${JSON.stringify(record)}\n`)) {
      await once(stream, 'drain');
    }
    written += 1;
  }
} finally {
  stream.end();
  await once(stream, 'finish');
}

console.log(`Wrote ${written} adjudicated judgement(s) to ${out}`);
console.log('reviewerId is EXCLUDED from the export.');

await prisma.$disconnect();
