import { detectLanguage } from '@novr/ingest';
import { prisma } from '../src/utils/prisma.js';

/**
 * One-off backfill: recompute `np_event.language` for existing rows.
 *
 * Before this change, `language` was never set by the adapter and relied on the
 * column default `"en"`, so non-English events were mislabelled. This script
 * recomputes the value with the same heuristic the adapter now uses —
 * `detectLanguage(title + ' ' + summary)` — and updates only the rows whose
 * stored value differs. It is idempotent: a re-run finds nothing to change.
 *
 * This is a DATA UPDATE, not a migration: `language` already exists with a
 * default, so no schema change is involved.
 *
 * Safe by default: without `--commit` this is a DRY RUN — it reports what would
 * change and writes nothing.
 *
 * Usage:
 *   node scripts/backfill-language.mjs            # dry run (no writes)
 *   node scripts/backfill-language.mjs --commit   # apply the updates
 */

const commit = process.argv.slice(2).includes('--commit');

console.log(`\nNovrPulse backfill — language ${commit ? '(COMMIT)' : '(DRY RUN)'}`);

const events = await prisma.npEvent.findMany({ select: { id: true, title: true, summary: true, language: true } });

let changed = 0;
const changes = [];

for (const e of events) {
  const detected = detectLanguage(`${e.title ?? ''} ${e.summary ?? ''}`);
  if (detected !== e.language) {
    changed += 1;
    changes.push({ id: e.id, from: e.language, to: detected, title: e.title });
  }
}

console.log('─'.repeat(72));
console.log(`Scanned ${events.length} event(s); ${changed} differ from the detection.`);
for (const c of changes) {
  console.log(`  ${c.id}  ${c.from} -> ${c.to}  ${String(c.title ?? '').slice(0, 70)}`);
}
console.log('─'.repeat(72));

if (!commit) {
  console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
  await prisma.$disconnect();
  process.exit(0);
}

// Apply per-row updates (bounded set; keeps each write auditable).
for (const c of changes) {
  await prisma.npEvent.update({ where: { id: c.id }, data: { language: c.to } });
}

console.log(`Applied ${changes.length} update(s).\n`);
await prisma.$disconnect();
process.exit(0);
