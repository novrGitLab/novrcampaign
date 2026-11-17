import { enabledCollectorSources, registryStats, sourcesByTier } from '../src/services/novrpulse/sources.js';

/**
 * Print the NovrPulse source registry: counts, and every source with its tier,
 * status, and whether it is enabled. Read-only; makes the allowlist inspectable
 * without reading the code or the markdown.
 *
 * Usage:
 *   node scripts/sources.mjs           # all sources
 *   node scripts/sources.mjs --enabled # only enabled
 *   node scripts/sources.mjs --tier 4  # only a tier
 */

const args = process.argv.slice(2);
const onlyEnabled = args.includes('--enabled');
const tierIdx = args.indexOf('--tier');
const tier = tierIdx !== -1 ? Number(args[tierIdx + 1]) : null;

const stats = registryStats();
console.log(`\nNovrPulse source registry — ${stats.total} sources, ${stats.enabled} enabled`);
console.log(`status: ${Object.entries(stats.byStatus).map(([k, v]) => `${k}=${v}`).join('  ')}\n`);

const TIERS = { 1: 'identity (regulators)', 2: 'local spine (NG/AF tech)', 3: 'press', 4: 'global filler' };
const tiers = tier ? [tier] : [1, 2, 3, 4];

for (const t of tiers) {
  const rows = sourcesByTier(t).filter((s) => (onlyEnabled ? s.enabled : true));
  if (!rows.length) continue;
  console.log(`── Tier ${t}: ${TIERS[t]} ─────────────────────────────`);
  for (const s of rows) {
    const mark = s.enabled ? 'ON ' : 'off';
    console.log(`  [${mark}] ${s.id.padEnd(18)} ${s.region.padEnd(7)} ${s.status.padEnd(11)} ${s.licence.padEnd(8)} ${s.note ?? ''}`);
  }
  console.log('');
}

if (!tier && !onlyEnabled) {
  console.log(`Enabled collectors: ${enabledCollectorSources().map((s) => s.id).join(', ')}`);
}
console.log('');
