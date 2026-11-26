import { extractArticle, capBody, fetchText, stripHtml } from '@novr/ingest';
import { prisma } from '../src/utils/prisma.js';

/**
 * One-off backfill: upgrade TEASER-only `np_raw_document.body` text to the
 * article's own full text.
 *
 * Events collected BEFORE the full-text enrichment feature were stored with the
 * feed teaser (often two or three sentences, truncated with "[...]"). This
 * script finds those short bodies that still have a `url`, fetches the article,
 * extracts its readable text with `enrichItemFullText`, and — only when the
 * fetched text passes the same length gates the ingest pipeline uses — UPDATEs
 * `np_raw_document.body` with the article text.
 *
 * NOTE: `np_raw_document` has NO `updatedAt` column (see schema.prisma), so
 * there is no column to mark an upgrade. No schema change is made; instead the
 * upgrades are logged in this script's output.
 *
 * This is a DATA UPDATE, not a migration.
 *
 * Safe by default: WITHOUT `--commit` this is a DRY RUN — it reports what it
 * would upgrade and writes nothing.
 *
 * Usage:
 *   node scripts/backfill-fulltext.mjs                    # dry run (no writes)
 *   node scripts/backfill-fulltext.mjs --limit 50         # cap the run (default 50)
 *   node scripts/backfill-fulltext.mjs --commit           # apply the updates
 *
 * Do NOT run this against production without approval.
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(0, Number(args[limitIdx + 1]) || 50) : 50;

/** The length below which a stored body counts as a teaser (matches ingest gate). */
const MIN_BODY_CHARS = 500;
/** Bodies longer than this are presumed bloated (whole-page scrape) and re-extracted. */
const MAX_BODY_CHARS = 30000;
/** Signals that a stored body still carries markup/code that must be cleaned. */
const CODE_RE = /<script|<style|\{\s*margin|\{\s*padding|function\s*\(|!important|@media/i;

/** The full-text options the ingest enricher accepts today (mirror DEFAULT_FULL_TEXT). */
const CFG = { minFetchedChars: 500, maxBodyChars: 20000 };

const isNoisy = (strippedLen, body) =>
  strippedLen < MIN_BODY_CHARS || strippedLen > MAX_BODY_CHARS || CODE_RE.test(body ?? '');

console.log(`\nNovrPulse backfill â€” full text ${commit ? '(COMMIT)' : '(DRY RUN)'} (limit ${limit})`);

// Candidates: stored bodies that are short (teasers), bloated (whole-page scrapes)
// or still carry markup/code, and that have a url. Prisma cannot filter on the
// stripped/derived signals, so we scan `take`-bounded rows and decide in JS.
const rows = await prisma.npRawDocument.findMany({
  where: { url: { not: '' }, body: { not: null } },
  orderBy: { fetchedAt: 'desc' },
  take: 2000,
  select: { id: true, url: true, body: true, fetchedAt: true },
});

const shortRows = rows.filter((r) => isNoisy(stripHtml(r.body ?? '').length, r.body));
console.log('â”€'.repeat(72));
console.log(
  `Scanned ${rows.length} document(s); ${shortRows.length} need repair (short < ${MIN_BODY_CHARS}, bloated > ${MAX_BODY_CHARS}, or code-marked) with a url.`,
);

const targets = shortRows.slice(0, limit);
console.log(`Processing up to ${targets.length} (limit ${limit}).`);
console.log('─'.repeat(72));

let upgraded = 0;
let unchanged = 0;
let failed = 0;

for (const row of targets) {
  const before = stripHtml(row.body ?? '').length;
  let extracted = '';
  try {
    // Direct path: fetch the page and EXTRACT the article (do not use the
    // pipeline enricher — it is upgrade-only and refuses to shrink a bloated body).
    const res = await fetchText(row.url, { logger: { debug: () => {}, warn: () => {}, info: () => {} } });
    const html = typeof res === 'string' ? res : (res?.body ?? '');
    const readable = extractArticle(html);
    extracted = readable?.text && readable.text.length >= 500 ? readable.text : stripHtml(html);
    extracted = capBody(extracted, CFG.maxBodyChars);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${row.id}  ${err?.message ?? err}  ${row.url.slice(0, 70)}`);
    continue;
  }
  const item = { content: extracted };

  const after = stripHtml(item.content ?? '').length;
  // Adopt the extraction when it is a usable article AND either the stored body
  // was noisy (short / bloated / code-marked — clean-and-replace even if the
  // clean text is shorter) or the fetched text is a material gain (longer).
  const adopt = after >= 500 && (isNoisy(before, row.body) || after > before);
  if (!adopt) {
    unchanged += 1;
    console.log(`  skip  ${row.id}  ${before} -> ${after}  (no material gain)  ${row.url.slice(0, 70)}`);
    continue;
  }

  upgraded += 1;
  console.log(`  ${commit ? 'UPDATE' : 'would '} ${row.id}  ${before} -> ${after} chars  ${row.url.slice(0, 70)}`);
  if (commit) {
    await prisma.npRawDocument.update({ where: { id: row.id }, data: { body: item.content } });
  }
}

console.log('─'.repeat(72));
console.log(`Upgradeable: ${upgraded}; unchanged: ${unchanged}; failed: ${failed}.`);

if (!commit) {
  console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
} else {
  console.log(`Applied ${upgraded} update(s).\n`);
}

await prisma.$disconnect();
process.exit(0);
