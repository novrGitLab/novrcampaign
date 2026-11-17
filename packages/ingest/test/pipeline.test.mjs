import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { collectSource, runPipeline, filterFresh, evaluateCanary } from '../src/pipeline.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toUTCString();

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>A</title><link>https://x/1</link><pubDate>${daysAgo(2)}</pubDate><description>d</description></item>
</channel></rss>`;

const STALE = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Old</title><link>https://x/old</link><pubDate>${daysAgo(90)}</pubDate><description>d</description></item>
</channel></rss>`;

const src = (over = {}) => ({ id: 'test', enabled: true, type: 'rss', feedUrl: 'https://8.8.8.8/feed', ...over });

describe('pipeline: freshness + canary', () => {
  test('filterFresh keeps in-window items and drops undated', () => {
    const kept = filterFresh([{ publishedAt: daysAgo(1) }, { publishedAt: daysAgo(30) }, { publishedAt: null }], 7, NOW);
    assert.equal(kept.length, 1);
  });
  test('canary passes on a healthy shape, fails on empty', () => {
    assert.equal(evaluateCanary({ items: [{ title: 'A', link: 'https://x/1' }] }).passed, true);
    assert.equal(evaluateCanary({ items: [] }).passed, false);
  });
});

describe('pipeline: collectSource', () => {
  const fetcher = (body) => async () => ({ status: 200, body });

  test('ok path returns fresh items', async () => {
    const r = await collectSource(src(), { fetch: fetcher(RSS), now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'ok');
    assert.equal(r.itemCount, 1);
  });
  test('stale feed reports stale', async () => {
    const r = await collectSource(src(), { fetch: fetcher(STALE), now: NOW });
    assert.equal(r.status, 'stale');
    assert.equal(r.totalSeen, 1);
  });
  test('fetch failure is reported, not thrown', async () => {
    const r = await collectSource(src(), {
      fetch: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(r.status, 'fetch_failed');
    assert.equal(r.error, 'boom');
  });
  test('parse failure is reported', async () => {
    const r = await collectSource(src({ type: 'api' }), { fetch: fetcher('not json'), now: NOW });
    assert.equal(r.status, 'parse_failed');
  });
  test('unknown type reports no_parser', async () => {
    const r = await collectSource(src({ type: 'carrier-pigeon' }), { fetch: fetcher(RSS) });
    assert.equal(r.status, 'no_parser');
  });
  test('disabled source is skipped', async () => {
    const r = await collectSource(src({ enabled: false }), { fetch: fetcher(RSS) });
    assert.equal(r.status, 'disabled');
  });
});

describe('pipeline: runPipeline', () => {
  test('aggregates items and health across sources', async () => {
    const sources = [src({ id: 'a' }), src({ id: 'b', type: 'rss' })];
    const report = await runPipeline({
      sources,
      now: NOW,
      fetch: async () => ({ status: 200, body: RSS }),
    });
    assert.equal(report.sources.length, 2);
    assert.equal(report.items.length, 2);
    assert.equal(report.ok, true);
    assert.equal(report.items[0].sourceId, 'a');
  });
  test('sourceIds restricts the run', async () => {
    const report = await runPipeline({
      sources: [src({ id: 'a' }), src({ id: 'b' })],
      sourceIds: ['b'],
      now: NOW,
      fetch: async () => ({ status: 200, body: RSS }),
    });
    assert.equal(report.sources.length, 1);
    assert.equal(report.sources[0].sourceId, 'b');
  });
});
