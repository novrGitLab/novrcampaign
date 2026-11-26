/**
 * Probe 2: fast-model batch behaviour. Retries bolt + lightning and covers the
 * flash/small models. Lightning puts its text in `reasoning_content`, so this
 * probe enables reasoningContentAsText for every call (harmless for models
 * that already answer in `content`).
 *
 * Run: node scripts/probe-models.mjs
 */
import { createLlm } from '@novr/ingest';
import { config } from '../src/config/env.js';
import { buildClassifySystem, buildClassifyPrompt } from '../src/services/novrpulse/classify.js';

const CANDIDATES = [
  'z-ai/glm-5.3-flash',
  'minimaxai/minimax-m3.1-flash',
  'google/gemma-3-12b-it',
  'poolside/laguna-xs-2.1',
];

const STORIES = [
  'Hackers exploit a critical ScreenConnect flaw to hijack MSP technician PCs without warning.',
  'Meta unveils a $700,000 AI grant for Nigerian startups to build local models.',
  'NDPC issues an advisory telling Nigerian banks to appoint data protection officers.',
  'Apple reports outages affecting iCloud Mail and AppleCare for several hours.',
  'A ransomware group encrypts patient records at a Lagos hospital and demands payment.',
  'Five things to know about the new Grand Theft Auto game.',
  'NCC gives telcos a 20-day ultimatum over poor service quality.',
  'Researchers detail a phishing campaign targeting Kenyan bank customers with fake login pages.',
  'A Nigerian fintech raises $20 million in a Series A funding round.',
  'CISA adds a newly exploited VMware vCenter vulnerability to its known-exploited list.',
  'MTN Nigeria announces a new data bundle for students ahead of exams.',
  'A Chinese APT is profiled for espionage against African government networks.',
  'The naira hits an eight-month low against the dollar.',
  'A misconfigured cloud bucket exposed the personal data of thousands of South African users.',
  'Google announces a new Pixel phone with improved AI camera features.',
  'An employee falls for a fake Microsoft 365 login page, exposing company credentials.',
  'NITDA opens applications for its digital literacy programme.',
  'A security researcher discovers a zero-day in a popular open-source library.',
  'Access Bank reports higher quarterly profit amid rising interest rates.',
  'ngCERT warns of a surge in SIM-swap fraud targeting Nigerian bank customers.',
];

async function probe(model) {
  const llm = createLlm({
    apiKey: config.novrpulse.llm.apiKey,
    baseUrl: config.novrpulse.llm.baseUrl,
    bulkModel: model,
    frontierModel: model,
    maxTokens: 2048,
    temperature: 0.2,
    jsonMode: config.novrpulse.llm.jsonMode,
    reasoningContentAsText: true,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  });
  const started = Date.now();
  try {
    const out = await llm.complete({
      tier: 'bulk',
      system: buildClassifySystem(),
      prompt: buildClassifyPrompt(STORIES.map((s, i) => ({ index: i + 1, title: s, summary: '', source: '' }))),
    });
    const arr = Array.isArray(out?.classifications) ? out.classifications : (Array.isArray(out) ? out : null);
    const count = arr ? arr.length : 0;
    const indices = arr ? arr.map((e) => Number(e?.index)).filter((n) => Number.isFinite(n)) : [];
    // Show a couple of verdicts so we can sanity-check the classification too.
    const sample = arr ? arr.slice(0, 3).map((e) => `${e.index}:${e.isCybersecurity ? 'CYBER' : 'no'}${e.cyberRegion ? '/' + e.cyberRegion : ''}`).join(' ') : '';
    return { model, ok: true, count, indices: indices.length, sample, ms: Date.now() - started };
  } catch (err) {
    return { model, ok: false, error: String(err?.message ?? err).slice(0, 120), ms: Date.now() - started };
  }
}

console.log(`\nFast-model batch probe — baseUrl=${config.novrpulse.llm.baseUrl}`);
console.log('─'.repeat(80));
if (!config.novrpulse.llm.apiKey) { console.log('No API key — aborting.'); process.exit(0); }

for (const model of CANDIDATES) {
  const r = await probe(model);
  if (r.ok) {
    console.log(`  ${model.padEnd(44)} entries=${String(r.count).padStart(2)}/20  ${(r.ms / 1000).toFixed(1)}s  ${r.sample}`);
  } else {
    console.log(`  ${model.padEnd(44)} FAILED  ${r.error}`);
  }
}
console.log('─'.repeat(80));
process.exit(0);
