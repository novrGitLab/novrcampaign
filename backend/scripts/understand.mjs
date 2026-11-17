import { runUnderstanding } from '../src/services/novrpulse/understand/index.js';
import { seedAliases } from '../src/services/novrpulse/understand/seedAliases.js';
import { prisma } from '../src/utils/prisma.js';

/**
 * Run the NovrPulse understanding layer over stored events.
 *
 * Safe by default: without `--commit` it only reports how many events are not
 * yet understood and writes nothing. With `--commit` it calls the LLM (NVIDIA
 * NIM) to tag, summarise, and link entities.
 *
 * Usage:
 *   node scripts/understand.mjs                 # dry run
 *   node scripts/understand.mjs --commit        # tag + summarise + link
 *   node scripts/understand.mjs --commit --limit 5
 *   node scripts/understand.mjs --seed-aliases  # apply the curated entity seed
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const seed = args.includes('--seed-aliases');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 20;

if (seed) {
  const s = await seedAliases();
  console.log(`Seeded ${s.entities} new entit(ies) and ${s.aliases} alias(es).\n`);
}

const result = await runUnderstanding({ limit, commit });

console.log(`\nNovrPulse understanding ${commit ? '(COMMIT)' : '(DRY RUN)'}`);
console.log('─'.repeat(60));
console.log(`Events awaiting understanding: ${result.candidates}`);

if (!commit) {
  console.log('DRY RUN — nothing written. Re-run with --commit to process.\n');
  await prisma.$disconnect();
  process.exit(0);
}

for (const r of result.results) {
  if (r.error) console.log(`FAIL  ${r.eventId}  ${r.error}`);
  else {
    console.log(
      `OK    ${r.eventId}  F[${r.functions.join(',')}] ${r.eventType} sev=${r.severity} ` +
        `summary=${r.summaryLength}c means=${r.whatItMeansLength}c entities=${r.entitiesLinked}(+${r.entitiesProposed} proposed)`,
    );
  }
}
console.log('─'.repeat(60));
console.log(`Processed ${result.processed}.`);

await prisma.$disconnect();
process.exit(0);
