import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { weekRange, weekLabel, mondayOf } from '../src/services/feedWeek.js';
import { normaliseUrl, createSchema } from '../src/controllers/feedController.js';

// Pure-logic tests (no database). Pins the shared week definition so the API
// filter and the UI label cannot drift.

describe('feedWeek: Lagos week window', () => {
  test('Monday 00:00 to Sunday 23:59:59.999 Africa/Lagos', () => {
    // 2026-11-11T10:00:00Z is a Wednesday; the Lagos week is Mon 10 – Sun 16 Nov.
    const { start, end } = weekRange(new Date('2026-11-11T10:00:00Z'));
    // Lagos Monday 00:00 == Sunday 23:00 UTC the day before.
    assert.equal(start.toISOString(), '2026-11-08T23:00:00.000Z');
    assert.equal(end.toISOString(), '2026-11-15T22:59:59.999Z');
  });

  test('label is the date range', () => {
    assert.equal(weekLabel(new Date('2026-11-11T10:00:00Z')), '9 – 15 Nov 2026');
  });

  test('a Sunday-night-Lagos instant belongs to that same week, not the next', () => {
    // Sunday 2026-11-15 23:30 Lagos == 2026-11-15T22:30Z.
    const { start } = weekRange(new Date('2026-11-15T22:30:00Z'));
    assert.equal(start.toISOString(), '2026-11-08T23:00:00.000Z');
  });

  test('Monday 00:00 Lagos starts the new week', () => {
    // Monday 2026-11-16 00:00 Lagos == 2026-11-15T23:00Z.
    const { start } = weekRange(new Date('2026-11-15T23:00:00Z'));
    assert.equal(start.toISOString(), '2026-11-15T23:00:00.000Z');
  });

  test('mondayOf returns a stable day for any instant in the week', () => {
    const a = mondayOf(new Date('2026-11-09T00:00:00Z'));
    const b = mondayOf(new Date('2026-11-15T22:00:00Z'));
    assert.equal(a.getTime(), b.getTime());
  });
});

describe('feed: url normalisation', () => {
  test('lowercases host, drops tracking + fragment, strips trailing slash', () => {
    const out = normaliseUrl('https://WWW.Example.com/Path/?utm_source=x&fbclid=y#frag');
    assert.equal(out, 'https://www.example.com/Path');
  });

  test('keeps non-tracking query params', () => {
    const out = normaliseUrl('https://news.example.com/a?id=42');
    assert.equal(out, 'https://news.example.com/a?id=42');
  });

  test('same article via twitter/x hosts is not merged (host is preserved)', () => {
    assert.notEqual(normaliseUrl('https://x.com/a/status/1'), normaliseUrl('https://twitter.com/a/status/1'));
  });
});

describe('feed: create validation', () => {
  const base = {
    sourceType: 'x',
    sourceName: 'X',
    url: 'https://x.com/someone/status/1',
    publishedAt: '2026-11-11T10:00:00.000Z',
    title: 'A title',
    summary: 'A summary',
  };

  test('rejects an empty summary', () => {
    const { error } = createSchema.validate({ ...base, summary: '' }, { stripUnknown: true });
    assert.ok(error, 'expected an error for empty summary');
    assert.match(error.message, /summary/i);
  });

  test('rejects an unknown sourceType', () => {
    const { error } = createSchema.validate({ ...base, sourceType: 'blog' }, { stripUnknown: true });
    assert.ok(error);
  });

  test('accepts a valid payload and defaults status to draft', () => {
    const { value, error } = createSchema.validate(base, { stripUnknown: true });
    assert.equal(error, undefined);
    assert.equal(value.status, 'draft');
  });
});
