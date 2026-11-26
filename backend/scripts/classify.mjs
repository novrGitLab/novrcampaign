import { classifyEvents, findUnclassified, isConfigured, CLASSIFY_BATCH_SIZE } from '../src/services/novrpulse/classify.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Run the NovrPulse AI filtering classification over unclassified events.
 *
 * This WRITES classifications, so `--commit` is required. Without it this is a
 * DRY RUN: it reports how many events are unclassified and the batches it would
 * run (title previews only), and writes NOTHING.
 *
 * Usage:
 *   node scripts/classify.mjs                  # dry run (no writes)
 *   node scripts/classify.mjs --commit         # classify (bulk LLM)
 *   node scripts/classify.mjs --commit --limit 300
 *   node scripts/classify.mjs --commit --region-backfill
 *     # ALSO re-select already-cyber events whose cyberRegion is NULL (one-off
 *     # backfill after the regional-tier column was added)
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const regionBackfill = args.includes('--region-backfill');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 300;

if (limitIdx !== -1 && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit requires a positive integer, e.g. --limit 300');
  process.exit(2);
}

console.log(`\nNovrPulse classify ${commit ? '(COMMIT)' : '(DRY RUN)'}  limit=${limit} batch=${CLASSIFY_BATCH_SIZE}${regionBackfill ? ' region-backfill' : ''}`);

if (!commit) {
  const pending = await findUnclassified({ limit, regionBackfill });
  console.log('─'.repeat(72));
  console.log(`Events unclassified (any flag IS NULL): ${pending.length}`);  for (let i = 0; i < pending.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = pending.slice(i, i + CLASSIFY_BATCH_SIZE);
    console.log(`  batch ${i / CLASSIFY_BATCH_SIZE + 1}: ${batch.length} event(s)`);
    for (const e of batch) console.log(`    - ${e.title}`);
  }
  console.log('─'.repeat(72));
  console.log('DRY RUN — nothing written. Re-run with --commit to classify.\n');
  await prisma.$disconnect();
  process.exit(0);
}

if (!isConfigured()) {
  console.error('No AI provider configured (NP_LLM_API_KEY). Cannot classify; re-run without --commit.');
  await prisma.$disconnect();
  process.exit(1);
}

const result = await classifyEvents({ limit, regionBackfill });

console.log('─'.repeat(72));
console.log(`Candidates:  ${result.candidates}`);
console.log(`Batches:     ${result.batches}`);
console.log(`Classified:  ${result.classified}`);
console.log(`Skipped:     ${result.skipped}`);
for (const r of result.results) {
  if (r.error) {
    console.log(`FAIL  ${r.error}`);
    continue;
  }
  const c = r.confidence === null ? 'n/a' : r.confidence.toFixed(2);
  const flags = [r.isCybersecurity && 'cyber', r.cyberRegion && `region=${r.cyberRegion}`, r.isThreatIntel && 'tint']
    .filter(Boolean)
    .join(',') || 'none';
  console.log(`OK    ${r.id}  [${flags}]  conf=${c}`);
}
console.log('─'.repeat(72));
console.log(`Classified ${result.classified} of ${result.candidates} candidate(s).`);

await prisma.$disconnect();
process.exit(0);
