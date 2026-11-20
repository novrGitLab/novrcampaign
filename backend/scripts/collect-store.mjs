import { runCollectors, runCollection } from '../src/services/novrpulse/ingest.js';
import config from '../src/config/env.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Collect the regulator/CERT sources and persist them to the NovrPulse store.
 *
 * The collection PATH is selected by `NP_COLLECTION_ENABLED` via `runCollection`:
 *   - unset / false (default) → IN-APP collector (`collectAndStore`)
 *   - true                    → collector-via-API pull (`pullItemsAndCreateEvents`)
 * Exactly one path runs; there is NO silent fallback — if the flag is ON and the
 * collector is unreachable/misconfigured this script FAILS LOUDLY, so a broken
 * cutover can never be mistaken for a working one (and can never double-write).
 *
 * Safe by default: without `--commit` this is a DRY RUN — it collects and
 * reports what *would* be stored, and writes nothing. This mirrors the rest of
 * the drive tooling and protects the live database from an accidental run.
 *
 * Usage:
 *   node scripts/collect-store.mjs                 # dry run (no writes)
 *   node scripts/collect-store.mjs --commit        # write to the database
 *   node scripts/collect-store.mjs --commit --max-age-days 14
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const ageIdx = args.indexOf('--max-age-days');
const maxAgeDays = ageIdx !== -1 ? Number(args[ageIdx + 1]) : undefined;
const sourceIds = args.filter((a, i) => !a.startsWith('--') && i !== ageIdx + 1);

const usingCollector = config.novrpulse.collection.enabled;
const pathLabel = usingCollector ? 'collector (API pull)' : 'in-app (local collectors)';

// Fail loudly BEFORE any work if the cutover is ON but the collector is not
// configured — never fall back silently to the in-app path.
if (usingCollector && (!config.novrpulse.collection.consumerId || !process.env[config.novrpulse.collection.apiKey])) {
  console.error(
    '[collect-store] NP_COLLECTION_ENABLED=true but the collector is not configured. ' +
      'Set NP_COLLECTION_CONSUMER_ID, NP_COLLECTION_KEY_ID and NP_COLLECTION_SECRET, ' +
      'or unset NP_COLLECTION_ENABLED to use the in-app path.',
  );
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`\nNovrPulse collect → store — path: ${pathLabel}${commit ? '' : ' (DRY RUN)'}`);

if (!commit) {
  // Dry run uses the read-only collector over the SELECTED path so the printed
  // summary is real, but nothing is persisted.
  if (usingCollector) {
    const noopAdapter = {
      async upsertSource() {},
      async storeBatch(items) {
        return { stored: 0, skipped: (items ?? []).length, events: 0 };
      },
    };
    const { pullItemsAndCreateEvents } = await import('../src/services/novrpulse/collectionPull.js');
    const summary = await pullItemsAndCreateEvents({ sourceIds, maxAgeDays, adapter: noopAdapter });
    console.log('─'.repeat(72));
    console.log(`Pulled ${summary.items} item(s); status ${summary.status}.`);
  } else {
    const report = await runCollectors({ sourceIds, maxAgeDays });
    console.log('─'.repeat(72));
    for (const s of report.sources) {
      const mark = s.ok ? 'OK  ' : 'FAIL';
      console.log(
        `${mark}  ${s.sourceId.padEnd(16)} ${s.status.padEnd(14)} ${String(s.itemCount).padStart(3)} fresh / ${String(s.totalSeen).padStart(3)} seen`,
      );
    }
    console.log('─'.repeat(72));
    console.log(`Collected: ${report.items.length} fresh item(s)`);
  }
  console.log('DRY RUN — nothing written. Re-run with --commit to persist.\n');
  await prisma.$disconnect();
  process.exit(0);
}

const summary = await runCollection({ sourceIds, maxAgeDays });

console.log('─'.repeat(72));
if (summary.path === 'collector') {
  console.log(`Pulled ${summary.items} item(s); run ${summary.runId}; status ${summary.status}.`);
} else {
  for (const s of summary.report.sources) {
    const mark = s.ok ? 'OK  ' : 'FAIL';
    console.log(
      `${mark}  ${s.sourceId.padEnd(16)} ${s.status.padEnd(14)} ${String(s.itemCount).padStart(3)} fresh / ${String(s.totalSeen).padStart(3)} seen`,
    );
  }
  console.log(`Collected ${summary.report.items.length} fresh item(s).`);
}
console.log(`Stored ${summary.stored} new, skipped ${summary.skipped} duplicate/attached.`);
console.log(`Distinct events touched: ${summary.events}\n`);

await prisma.$disconnect();
process.exit(0);
