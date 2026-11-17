import { writeFile } from 'node:fs/promises';
import { runCollectors } from '../src/services/novrpulse/ingest.js';

/**
 * Run the NovrPulse regulator/CERT collectors and print a health report.
 *
 * Phase 1, task 9: the confirmed-RSS regulator/CERT sources only (NCC, NITDA,
 * NDPC). No database and no persistence — this validates the collection contract
 * and exercises the canary. Persistence lands in the Phase 1 store step; until
 * then `--out` dumps the exact payload that step will consume, so the data can
 * be inspected first.
 *
 * Usage:
 *   node scripts/collect.mjs                  # all enabled sources
 *   node scripts/collect.mjs ncc ndpc         # restrict to specific source ids
 *   node scripts/collect.mjs --json           # machine-readable output
 *   node scripts/collect.mjs --out run.json   # write the payload to a file
 *   node scripts/collect.mjs --max-age-days 14  # widen the freshness window
 */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outIdx = args.indexOf('--out');
const outFile = outIdx !== -1 ? args[outIdx + 1] : null;
const ageIdx = args.indexOf('--max-age-days');
const maxAgeDays = ageIdx !== -1 ? Number(args[ageIdx + 1]) : undefined;
const sourceIds = args.filter(
  (a, i) => !a.startsWith('--') && i !== outIdx + 1 && i !== ageIdx + 1,
);

if (outIdx !== -1 && !outFile) {
  console.error('--out requires a file path, e.g. --out run.json');
  process.exit(2);
}
if (ageIdx !== -1 && (!Number.isInteger(maxAgeDays) || maxAgeDays < 1)) {
  console.error('--max-age-days requires a positive integer, e.g. --max-age-days 7');
  process.exit(2);
}

const report = await runCollectors({ sourceIds, maxAgeDays });

if (outFile) {
  await writeFile(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Wrote ${report.items.length} item(s) from ${report.sources.length} source(s) to ${outFile}`);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nNovrPulse collector run — ${report.ranAt}`);
  if (maxAgeDays) console.log(`Freshness window: ${maxAgeDays} day(s)`);
  console.log('─'.repeat(72));
  for (const s of report.sources) {
    const mark = s.ok ? 'OK  ' : 'FAIL';
    const newest = s.newestAt ? `newest ${s.newestAt.slice(0, 10)}` : 'newest —';
    console.log(
      `${mark}  ${s.sourceId.padEnd(10)} ${s.status.padEnd(14)} ${String(s.itemCount).padStart(3)} fresh / ${String(s.totalSeen).padStart(3)} seen  (${newest})`,
    );
    if (s.error) console.log(`      ↳ ${s.error}`);
  }
  console.log('─'.repeat(72));
  console.log(`Total: ${report.items.length} fresh item(s) across ${report.sources.length} source(s)`);
  console.log(`Overall: ${report.ok ? 'healthy' : 'ATTENTION REQUIRED'}\n`);
}

process.exit(report.ok ? 0 : 1);
