import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { storeItem, storeRun } from '../src/store/index.js';
import { createLlm, validateSchema, extractJson } from '../src/llm/index.js';
import { analyseItem } from '../src/understand/index.js';

/** In-memory adapter that satisfies the store contract. */
function memoryAdapter() {
  const raws = new Map();
  const events = [];
  let n = 0;
  return {
    _raws: raws,
    _events: events,
    async upsertSource() {},
    async findRawByHash(h) {
      return raws.get(h) ?? null;
    },
    async createRaw(sourceId, item) {
      const doc = { id: `r${++n}`, sourceId, ...item };
      raws.set(item.contentHash, doc);
      return doc;
    },
    async findEventByUrl(url) {
      return events.find((e) => e.canonicalUrl === url) ?? null;
    },
    async createEvent(sourceId, item, raw) {
      const ev = { id: `e${++n}`, sourceId, canonicalUrl: item.link, raws: [raw.id] };
      events.push(ev);
      return ev;
    },
    async attachEventSource(eventId, rawId) {
      events.find((e) => e.id === eventId)?.raws.push(rawId);
    },
  };
}

const item = (hash, url) => ({
  sourceId: 's',
  title: 'T',
  link: url,
  publishedAt: new Date().toISOString(),
  content: 'body',
  contentHash: hash,
});

describe('store: through an injected adapter', () => {
  test('stores new, then dedupes by content hash', async () => {
    const adapter = memoryAdapter();
    const first = await storeItem(item('h1', 'https://x/1'), { adapter });
    assert.equal(first.created, true);
    const second = await storeItem(item('h1', 'https://x/1'), { adapter });
    assert.equal(second.created, false);
    assert.equal(second.reason, 'duplicate');
  });

  test('second source for the same URL attaches to the existing event', async () => {
    const adapter = memoryAdapter();
    await storeItem(item('h1', 'https://x/1'), { adapter });
    const r = await storeItem(item('h2', 'https://x/1'), { adapter });
    assert.equal(r.reason, 'attached-to-existing-event');
    assert.equal(adapter._events.length, 1);
    assert.equal(adapter._events[0].raws.length, 2);
  });

  test('storeRun aggregates counts', async () => {
    const adapter = memoryAdapter();
    const summary = await storeRun(
      { items: [item('h1', 'https://x/1'), item('h2', 'https://x/2'), item('h1', 'https://x/1')] },
      { adapter },
    );
    assert.equal(summary.stored, 2);
    assert.equal(summary.skipped, 1);
  });

  test('skips items with no link or no hash', async () => {
    const adapter = memoryAdapter();
    assert.equal((await storeItem({ sourceId: 's', contentHash: 'h', link: null }, { adapter })).reason, 'no-link');
    assert.equal((await storeItem({ sourceId: 's', link: 'https://x', contentHash: '' }, { adapter })).reason, 'no-content-hash');
  });
});

describe('llm: schema + json helpers', () => {
  const schema = {
    type: 'object',
    required: ['a', 'b'],
    properties: { a: { type: 'string' }, b: { type: 'number', enum: [1, 2] } },
  };
  test('validates required and enums', () => {
    assert.equal(validateSchema({ a: 'x', b: 1 }, schema).ok, true);
    assert.equal(validateSchema({ a: 'x' }, schema).ok, false);
    assert.equal(validateSchema({ a: 'x', b: 9 }, schema).ok, false);
  });
  test('extracts JSON from fences and prose', () => {
    assert.equal(extractJson('```json\n{"x":1}\n```'), '{"x":1}');
    assert.equal(extractJson('hi {"x":1} bye'), '{"x":1}');
  });
  test('createLlm requires an apiKey', () => {
    assert.throws(() => createLlm({}));
  });
});

describe('understand: analyseItem with injected analysers', () => {
  test('runs analysers and merges results', async () => {
    const analysers = {
      classify: async () => ({ tags: ['x'] }),
      summarise: async () => ({ summary: 's' }),
    };
    const { results, errors } = await analyseItem({ title: 't' }, { analysers, llm: {} });
    assert.deepEqual(results.classify, { tags: ['x'] });
    assert.equal(results.summarise.summary, 's');
    assert.deepEqual(errors, {});
  });
  test('a failing analyser is captured, not thrown', async () => {
    const analysers = {
      good: async () => ({ ok: true }),
      bad: async () => {
        throw new Error('nope');
      },
    };
    const { results, errors } = await analyseItem({}, { analysers, llm: {} });
    assert.equal(results.good.ok, true);
    assert.equal(errors.bad, 'nope');
  });
  test('requires analysers', async () => {
    await assert.rejects(() => analyseItem({}, {}));
  });
});
