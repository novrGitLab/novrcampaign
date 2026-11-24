import { runDedup, findCandidatePairs, isConfigured } from '../src/services/novrpulse/dedup.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Run the NovrPulse deduplication layer (Capability 1): deterministic blocking
 * plus a bounded LLM pair confirmation, writing `ai_judgement` rows.
 *
 * Safe by default: without `--commit` this is a DRY RUN. It still blocks and
 * asks the model (so the printed summary is real) but writes NOTHING.
 *
 * Usage:
 *   node scripts/dedup.mjs                  # dry run (no writes)
 *   node scripts/dedup.mjs --commit         # record judgements
 *   node scripts/dedup.mjs --commit --limit 50
 *   node scripts/dedup.mjs --candidates     # blocking only, no LLM, no writes
 *   node scripts/dedup.mjs --max-age-days 7
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const candidatesOnly = args.includes('--candidates');
const limitIdx = args.indexOf('--limit');
const ageIdx = args.indexOf('--max-age-days');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 25;
const maxAgeDays = ageIdx !== -1 ? Number(args[ageIdx + 1]) : 3;

console.log(`\nNovrPulse dedup — ${commit ? '(COMMIT)' : '(DRY RUN)'}  window=${maxAgeDays}d limit=${limit}`);

if (candidatesOnly) {
  const pairs = await findCandidatePairs({ maxAgeDays });
  console.log('─'.repeat(72));
  console.log(`Candidate pairs (deterministic blocking, no LLM): ${pairs.length}`);
  for (const p of pairs) {
    console.log(`  ${p.subjectKey}`);
    console.log(`    A: ${p.a.title}`);
    console.log(`    B: ${p.b.title}`);
  }
  console.log('─'.repeat(72));
  await prisma.$disconnect();
  process.exit(0);
}

if (commit && !isConfigured()) {
  console.error('No AI provider configured (NP_LLM_API_KEY). Cannot confirm pairs; re-run without --commit.');
  await prisma.$disconnect();
  process.exit(1);
}

const result = await runDedup({ dryRun: !commit, maxAgeDays, limit });

console.log('─'.repeat(72));
console.log(`Candidates (after blocking): ${result.candidates}`);
console.log(`Confirmed:                  ${result.processed}`);
for (const p of result.pairs) {
  if (p.error) {
    console.log(`FAIL  ${p.subjectKey}  ${p.error}`);
    continue;
  }
  const conf = p.confidence === null ? 'n/a' : p.confidence.toFixed(2);
  const flag = p.decision === 'same_story' ? 'SAME ' : 'DIST ';
  console.log(`${flag} conf=${conf} ${p.subjectKey}  — ${p.reason || ''}`);
}
console.log('─'.repeat(72));
console.log(commit ? `Recorded ${result.processed} judgement(s).` : 'DRY RUN — nothing written. Re-run with --commit to record.');

await prisma.$disconnect();
process.exit(0);
