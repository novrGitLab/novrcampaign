import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { enabledCollectorSources, getSource } from '../src/services/novrpulse/sources.js';
import { severityFloor, normaliseAlias, novrPulseAnalysers } from '../src/services/novrpulse/analysers.js';

// The generic fetch/parse/pipeline/store/llm behaviour is tested in the engine
// package (@novr/ingest). This file tests NovrPulse-specific consumer wiring.

describe('sources registry: enabled set', () => {
  test('enabled collectors are the verified-fresh set (rss + api)', () => {
    const ids = enabledCollectorSources().map((s) => s.id).sort();
    assert.deepEqual(ids, [
      'bleepingcomputer',
      'businessday-tech',
      'cyberscoop',
      'darkreading',
      'hackernews',
      'itedgenews',
      'itweb.africa',
      'nairametrics',
      'ncc',
      'ndpc',
      'nitda',
      'securityweek',
      'techafrica',
      'techcabal',
      'techdigest',
      'techeconomy',
      'techpoint',
      'therecord',
      'vanguard-tech',
    ]);
  });
  test('every enabled source has a feed URL and a known type', () => {
    for (const s of enabledCollectorSources()) {
      assert.ok(s.feedUrl, `${s.id} must have feedUrl`);
      assert.ok(['rss', 'api'].includes(s.type), `${s.id} type must be rss/api`);
    }
  });
  test('dead / blocked / no-feed sources are not enabled', () => {
    for (const id of ['cbn', 'ngcert', 'efcc', 'npf-nccc', 'ke-cirt', 'africacert', 'techinafrica', 'csa-ghana']) {
      assert.equal(getSource(id).enabled, false, `${id} must not be enabled`);
    }
  });
  test('dead feeds are recorded as dead, not silently dropped', () => {
    for (const id of ['ke-cirt', 'africacert', 'techinafrica']) {
      assert.equal(getSource(id).status, 'dead', `${id} should be status dead`);
    }
  });
});

describe('novrpulse analysers: severity floor', () => {
  test('critical phrases raise the floor', () => {
    assert.equal(severityFloor('ransomware attack on critical infrastructure'), 4);
  });
  test('high phrases give 3', () => {
    assert.equal(severityFloor('malware found on a server'), 3);
  });
  test('advisory phrases give 2', () => {
    assert.equal(severityFloor('NCC issues a consumer advisory'), 2);
  });
  test('neutral text gives 1', () => {
    assert.equal(severityFloor('a general meeting was held'), 1);
  });
  test('bare "national" does not inflate severity', () => {
    assert.equal(severityFloor('The National Commissioner attended an awards ceremony'), 1);
  });
});

describe('novrpulse analysers: classify + entities (stubbed model)', () => {
  const llmStub = (payload) => ({ complete: async () => payload });

  test('classify filters F2 and de-duplicates functions', async () => {
    const llm = llmStub({ functions: [2, 7, 7, 1], event_type: 'policy', severity: 2, reasoning: 'r' });
    const out = await novrPulseAnalysers.classify({ title: 'CBN circular', content: 'notice' }, { llm });
    assert.deepEqual(out.functions, [7, 1]);
  });

  test('classify applies the rules floor when the model undershoots', async () => {
    const llm = llmStub({ functions: [7], event_type: 'incident', severity: 0, reasoning: 'r' });
    const out = await novrPulseAnalysers.classify(
      { title: 'Ransomware attack', content: 'critical infrastructure outage' },
      { llm },
    );
    assert.equal(out.severity, 4);
    assert.equal(out.severitySource, 'rule-floor');
  });

  test('extractEntities drops honorifics and generic roles', async () => {
    const llm = llmStub({
      entities: [
        { name: 'Oba of Amuwo-Odofin', type: 'person_role', role: 'mentioned' },
        { name: 'Board Member', type: 'person_role', role: 'mentioned' },
        { name: 'Lagos', type: 'location', role: 'mentioned' },
      ],
    });
    const out = await novrPulseAnalysers.extractEntities({ title: 't', content: 'c' }, { llm });
    assert.deepEqual(out.map((e) => e.name), ['Lagos']);
  });
});

describe('novrpulse analysers: alias normalisation', () => {
  test('lowercases, trims and collapses whitespace', () => {
    assert.equal(normaliseAlias('  Guaranty   Trust  '), 'guaranty trust');
  });
});
