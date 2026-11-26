import { classifyEvents, findUnclassified, clearClassifications, isConfigured, CLASSIFY_BATCH_SIZE } from '../src/services/novrpulse/classify.js';
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
 *   node scripts/classify.mjs --commit         # classify (frontier LLM)
 *   node scripts/classify.mjs --commit --limit 300
 *   node scripts/classify.mjs --commit --region-backfill
 *     # ALSO re-select already-cyber events whose cyberRegion is NULL (one-off
 *     # backfill after the regional-tier column was added)
 *   node scripts/classify.mjs --reclassify --commit [--limit N]
 *     # CLEAR the three flags (isCybersecurity/cyberRegion/isThreatIntel = null)
 *     # for all events (or the first N), so the stricter pass re-judges the whole
 *     # corpus. Runs the clear then a normal classify in the same invocation.
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const regionBackfill = args.includes('--region-backfill');
const reclassify = args.includes('--reclassify');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 300;

if (limitIdx !== -1 && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit requires a positive integer, e.g. --limit 300');
  process.exit(2);
}

console.log(`\nNovrPulse classify ${commit ? '(COMMIT)' : '(DRY RUN)'}  limit=${limit} batch=${CLASSIFY_BATCH_SIZE}${regionBackfill ? ' region-backfill' : ''}${reclassify ? ' RECLASSIFY' : ''}`);

if (!commit) {
  if (reclassify) {
    console.log('─'.repeat(72));
    console.log('--reclassify set: with --commit the three flags are CLEARED before re-classifying. DRY RUN writes nothing.');
  }
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

if (reclassify) {
  const cleared = await clearClassifications({ limit });
  console.log(`Cleared classification flags on ${cleared} event(s) for re-judging.`);
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
