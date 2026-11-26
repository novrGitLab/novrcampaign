import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pretagEvent } from '../src/services/novrpulse/eventKeywords.js';

// Tests for the deterministic keyword pre-tag (the free layer of the AI
// filtering classification). Pure function — no DB, no network.

describe('pretag: cybersecurity keywords', () => {
  test('a title hit sets isCybersecurity', () => {
    const r = pretagEvent({ title: 'Ransomware gang hits Lagos hospital' });
    assert.equal(r.isCybersecurity, true);
  });

  test('a summary hit sets isCybersecurity even with a clean title', () => {
    const r = pretagEvent({ title: 'Bank announces new app', summary: 'The breach affected 2m users' });
    assert.equal(r.isCybersecurity, true);
  });

  test('multi-word phrases match as adjacent words', () => {
    assert.equal(pretagEvent({ title: 'Zero-day exploited in the wild' }).isCybersecurity, true);
    assert.equal(pretagEvent({ title: 'A data breach was disclosed' }).isCybersecurity, true);
    assert.equal(pretagEvent({ title: 'A cyberattack hit the grid' }).isCybersecurity, true);
  });

  test('word-boundary matching: CVE inside a word does not false-positive', () => {
    // "cve" must not match inside e.g. "covered" (no boundary).
    assert.equal(pretagEvent({ title: 'The new policy covered scrap metal' }).isCybersecurity, false);
    // "apt" must not match inside "capture".
    assert.equal(pretagEvent({ title: 'Police capture suspect in Enugu' }).isThreatIntel, false);
  });

  test('a clean, non-cyber story sets no flag', () => {
    const r = pretagEvent({ title: 'FG moves to regulate scrap metal trade as cable theft threatens infrastructure' });
    // The motivating example: zero obvious keywords → the free layer misses,
    // leaving the flags NULL for the accurate AI pass to fill.
    assert.equal(r.isCybersecurity, false);
    assert.equal(r.isThreatIntel, false);
    // "FG" is a Nigeria keyword, so the geography flag DOES hit here.
    assert.equal(r.isNigeriaRelated, true);
  });
});

describe('pretag: threat-intel keywords', () => {
  test('threat-intel phrases set isThreatIntel', () => {
    assert.equal(pretagEvent({ title: 'Threat actor profiled in new report' }).isThreatIntel, true);
    assert.equal(pretagEvent({ title: 'New IOC list published by ngCERT' }).isThreatIntel, true);
    assert.equal(pretagEvent({ title: 'Backdoor found in a popular package' }).isThreatIntel, true);
    assert.equal(pretagEvent({ title: 'Ransomware group claims the attack' }).isThreatIntel, true);
  });

  test('a cyber story with no threat-intel angle leaves isThreatIntel false', () => {
    const r = pretagEvent({ title: 'Regulator issues guidance on cybersecurity policy' });
    assert.equal(r.isCybersecurity, true);
    assert.equal(r.isThreatIntel, false);
  });
});

describe('pretag: Nigeria keywords and region', () => {
  test('a Nigeria keyword in the title sets isNigeriaRelated', () => {
    assert.equal(pretagEvent({ title: 'Lagos tech hub launches security programme' }).isNigeriaRelated, true);
    assert.equal(pretagEvent({ title: 'NCC warns on SIM fraud' }).isNigeriaRelated, true);
  });

  test('region NG counts as a Nigeria signal even with no keyword', () => {
    const r = pretagEvent({ title: 'A generic headline', region: 'NG' });
    assert.equal(r.isNigeriaRelated, true);
  });

  test('a non-NG region with no keyword does not set isNigeriaRelated', () => {
    assert.equal(pretagEvent({ title: 'A generic headline', region: 'GLOBAL' }).isNigeriaRelated, false);
  });

  test('empty input is safe and sets nothing', () => {
    const zero = { isCybersecurity: false, isThreatIntel: false, isNigeriaRelated: false, cyberRegion: null };
    assert.deepEqual(pretagEvent({}), zero);
    assert.deepEqual(pretagEvent(), zero);
  });
});

describe('pretag: regional cyber tier (cyberRegion)', () => {
  test('a cyber keyword with no geography → GLOBAL', () => {
    assert.equal(pretagEvent({ title: 'Ransomware hits a hospital' }).cyberRegion, 'GLOBAL');
  });

  test('a Nigeria keyword → NG (priority tier) when the story is cyber', () => {
    assert.equal(pretagEvent({ title: 'Data breach at a Lagos bank' }).cyberRegion, 'NG');
    assert.equal(pretagEvent({ title: 'NCC warns telcos over a phishing surge' }).cyberRegion, 'NG');
  });

  test('an African keyword (non-Nigeria) → AF', () => {
    assert.equal(pretagEvent({ title: 'Hackers target Kenyan banks' }).cyberRegion, 'AF');
    assert.equal(pretagEvent({ title: 'Malware campaign spreads in South Africa' }).cyberRegion, 'AF');
  });

  test('an NG source region sets NG even with no Nigeria keyword', () => {
    assert.equal(pretagEvent({ title: 'A generic cyber headline', region: 'NG' }).cyberRegion, 'NG');
  });

  test('an AF source region sets AF', () => {
    assert.equal(pretagEvent({ title: 'A generic cyber headline', region: 'AF' }).cyberRegion, 'AF');
  });

  test('Nigeria wins over Africa when both signals appear', () => {
    assert.equal(pretagEvent({ title: 'Nigeria joins an African cyber pact' }).cyberRegion, 'NG');
  });

  test('a non-cyber story has no region (null)', () => {
    const r = pretagEvent({ title: 'A quiet weekend in the city', region: 'NG' });
    // The NG source region makes the pre-tag SUGGEST cyber (recall-oriented),
    // so it is tagged NG. But a clean GLOBAL non-cyber story stays null.
    assert.equal(pretagEvent({ title: 'A quiet weekend in the city', region: 'GLOBAL' }).cyberRegion, null);
    assert.equal(r.isCybersecurity, false);
  });

  test('cyber keyword + GLOBAL source → GLOBAL', () => {
    assert.equal(
      pretagEvent({ title: 'Critical CVE exploited in the wild', region: 'GLOBAL' }).cyberRegion,
      'GLOBAL',
    );
  });
});
