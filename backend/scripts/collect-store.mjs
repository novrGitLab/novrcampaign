import { runCollectors, collectAndStore } from '../src/services/novrpulse/ingest.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Collect the regulator/CERT sources and persist them to the NovrPulse store.
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

if (!commit) {
  const report = await runCollectors({ sourceIds, maxAgeDays });
  console.log(`\nNovrPulse collect → store (DRY RUN) — ${report.ranAt}`);
  console.log('─'.repeat(72));
  for (const s of report.sources) {
    const mark = s.ok ? 'OK  ' : 'FAIL';
    console.log(
      `${mark}  ${s.sourceId.padEnd(16)} ${s.status.padEnd(14)} ${String(s.itemCount).padStart(3)} fresh / ${String(s.totalSeen).padStart(3)} seen`,
    );
  }
  console.log('─'.repeat(72));
  console.log(`Collected: ${report.items.length} fresh item(s)`);
  console.log('DRY RUN — nothing written. Re-run with --commit to persist.\n');
  await prisma.$disconnect();
  process.exit(0);
}

const { report, stored, skipped, events } = await collectAndStore({ sourceIds, maxAgeDays });
console.log(`\nNovrPulse collect → store (COMMIT) — ${report.ranAt}`);
console.log('─'.repeat(72));
for (const s of report.sources) {
  const mark = s.ok ? 'OK  ' : 'FAIL';
  console.log(
    `${mark}  ${s.sourceId.padEnd(16)} ${s.status.padEnd(14)} ${String(s.itemCount).padStart(3)} fresh / ${String(s.totalSeen).padStart(3)} seen`,
  );
}
console.log('─'.repeat(72));
console.log(`Collected ${report.items.length} fresh item(s).`);
console.log(`Stored ${stored} new, skipped ${skipped} duplicate/attached.`);
console.log(`Distinct events touched: ${events}\n`);

await prisma.$disconnect();
process.exit(0);
