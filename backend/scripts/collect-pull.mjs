import config from '../src/config/env.js';
import { pullItemsAndCreateEvents } from '../src/services/novrpulse/collectionPull.js';
import { createCollectionClient } from '../src/services/novrpulse/collectionClient.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Pull from the stateless collector over its HMAC v1 API and store the results.
 *
 * Safe by default: without `--commit` this is a DRY RUN — it starts a collector
 * run, pages the items out and reports what *would* be stored, then writes
 * nothing. Mirrors scripts/collect-store.mjs.
 *
 * Usage:
 *   node scripts/collect-pull.mjs                       # dry run (no writes)
 *   node scripts/collect-pull.mjs --commit              # write to the database
 *   node scripts/collect-pull.mjs --commit --max-age-days 14 cbn ncc
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const ageIdx = args.indexOf('--max-age-days');
const maxAgeDays = ageIdx !== -1 ? Number(args[ageIdx + 1]) : undefined;
const sourceIds = args.filter((a, i) => !a.startsWith('--') && i !== ageIdx + 1);

if (!config.novrpulse.collection.consumerId || !process.env[config.novrpulse.collection.apiKey]) {
  console.error(
    '[collect-pull] collector is not configured. Set NP_COLLECTION_CONSUMER_ID, NP_COLLECTION_KEY_ID and NP_COLLECTION_SECRET.',
  );
  await prisma.$disconnect();
  process.exit(1);
}

if (!commit) {
  // Dry run: pull everything, store NOTHING. Uses a no-op adapter so no write
  // reaches the database — the real `storeRun` code path still runs.
  const client = createCollectionClient();
  const noopAdapter = {
    async upsertSource() {},
    async storeBatch(items) {
      return { stored: 0, skipped: (items ?? []).length, events: 0 };
    },
  };
  const summary = await pullItemsAndCreateEvents({ sourceIds, maxAgeDays, client, adapter: noopAdapter });
  console.log(`\nNovrPulse collector pull → store (DRY RUN) — run ${summary.runId}`);
  console.log('─'.repeat(72));
  console.log(`Pulled ${summary.items} item(s); status ${summary.status}.`);
  console.log('DRY RUN — nothing written. Re-run with --commit to persist.\n');
  await prisma.$disconnect();
  process.exit(0);
}

const summary = await pullItemsAndCreateEvents({ sourceIds, maxAgeDays });
console.log(`\nNovrPulse collector pull → store (COMMIT) — run ${summary.runId}`);
console.log('─'.repeat(72));
console.log(`Pulled ${summary.items} item(s); status ${summary.status}.`);
console.log(`Stored ${summary.stored} new, skipped ${summary.skipped} duplicate/attached.`);
console.log(`Distinct events touched: ${summary.events}\n`);

await prisma.$disconnect();
process.exit(0);
