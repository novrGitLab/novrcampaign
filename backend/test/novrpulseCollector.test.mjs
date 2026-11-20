import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { enabledCollectorSources, getSource, allSources } from '../src/services/novrpulse/sources.js';
import { normaliseAlias, novrPulseAnalysers } from '../src/services/novrpulse/analysers.js';
import { parsers } from '@novr/ingest';

// The generic fetch/parse/pipeline/store/llm behaviour is tested in the engine
// package (@novr/ingest). This file tests NovrPulse-specific consumer wiring.

describe('sources registry: enabled set', () => {
  // The intent of the old hardcoded 19-id list was to catch accidental enables.
  // Properties catch that more robustly than a frozen list: any newly enabled
  // source must be collectable (endpoint + dispatchable parser), and the frozen
  // count still fails loudly if the enabled set grows or shrinks.
  const EXPECTED_ENABLED_COUNT = 19;

  test('every enabled source is collectable (property)', () => {
    const enabled = enabledCollectorSources();
    assert.ok(enabled.length > 0, 'expected at least one enabled source');
    for (const s of enabled) {
      assert.ok(s.feedUrl, `${s.id} must have feedUrl`);
      const key = s.parser ?? s.type;
      assert.ok(key in parsers, `${s.id} dispatch key "${key}" must be a registered parser`);
    }
  });

  test('no disabled source leaks into the enabled set (property)', () => {
    const enabledIds = new Set(enabledCollectorSources().map((s) => s.id));
    for (const s of allSources()) {
      if (!s.enabled) assert.ok(!enabledIds.has(s.id), `${s.id} is disabled but was collected`);
    }
  });

  test('enabled count is frozen at 19 (catches accidental enables)', () => {
    assert.equal(enabledCollectorSources().length, EXPECTED_ENABLED_COUNT);
  });

  test('the enabled set is exactly the enabled+feed-backed+dispatchable set', () => {
    const expected = allSources()
      .filter((s) => s.enabled && s.feedUrl && (s.parser ?? s.type) in parsers)
      .map((s) => s.id)
      .sort();
    assert.deepEqual(enabledCollectorSources().map((s) => s.id).sort(), expected);
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

describe('novrpulse analysers: classify + entities (stubbed model)', () => {
  const llmStub = (payload) => ({ complete: async () => payload });

  test('classify filters F2 and de-duplicates functions', async () => {
    const llm = llmStub({ functions: [2, 7, 7, 1], event_type: 'policy', reasoning: 'r' });
    const out = await novrPulseAnalysers.classify({ title: 'CBN circular', content: 'notice' }, { llm });
    assert.deepEqual(out.functions, [7, 1]);
  });

  test('classify returns the event type and no severity field', async () => {
    const llm = llmStub({ functions: [7], event_type: 'incident', reasoning: 'r' });
    const out = await novrPulseAnalysers.classify(
      { title: 'Ransomware attack', content: 'critical infrastructure outage' },
      { llm },
    );
    assert.equal(out.eventType, 'incident');
    assert.equal(out.severity, undefined, 'severity was dropped from the analyser output');
    assert.equal(out.severitySource, undefined);
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
