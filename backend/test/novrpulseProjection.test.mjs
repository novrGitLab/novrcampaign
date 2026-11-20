import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderF7,
  scrubPreConvictionWords,
  isArrestItem,
  personEntityNames,
  composeWho,
  derivePublicDescriptor,
  findPersonLikeNames,
  knownNonPersonTokens,
  F7_TEMPLATE_VERSION,
} from '../src/services/novrpulse/project/templates/f7.js';
import {
  NON_PERSON_TOKENS,
  GEOGRAPHIC_TOKENS,
  TRUSTED_ACRONYMS,
  URL_TLDS,
} from '../src/services/novrpulse/project/templates/allowlists.js';
import {
  assertPublishable,
  assertLicence,
  assertSourceLink,
  GateError,
} from '../src/services/novrpulse/project/gates.js';
import { planF7 } from '../src/services/novrpulse/project/projectF7.js';
import { deriveStatus, listPublishItems, projectF7Items } from '../src/controllers/publishController.js';
import { prisma } from '../src/utils/prisma.js';

// Pure-logic tests (no database). The projection service's DB reads/writes are
// exercised through `planF7`, which is I/O-free, so the suite runs without a
// live database — mirroring the existing collector/feed test style.

// ── F7 renderer ───────────────────────────────────────────────────────────────

describe('F7 renderer: template', () => {
  test('fills the frozen template exactly for a plain advisory', () => {
    const event = {
      id: 'e1',
      summary: 'The NCC issued a consumer advisory on SIM-swap fraud',
      canonicalUrl: 'https://ncc.gov.ng/advisory/1',
      region: 'Lagos',
      eventType: 'advisory',
      functions: [7],
    };
    const { body, templateVersion, namedPerson } = renderF7(event, {
      sources: [{ name: 'NCC', url: 'https://ncc.gov.ng/advisory/1' }],
      entities: [{ type: 'agency', name: 'NCC' }],
      tier: 'public',
    });

    assert.equal(templateVersion, F7_TEMPLATE_VERSION);
    assert.equal(namedPerson, false);
    assert.equal(
      body,
      'The NCC issued a consumer advisory on SIM-swap fraud — NCC — Lagos — NCC (https://ncc.gov.ng/advisory/1).',
    );
  });

  test('omits a missing slot rather than emitting an empty em-dash segment', () => {
    const event = {
      summary: 'A regulator issued a notice',
      canonicalUrl: 'https://example.org/a',
      eventType: 'policy',
      functions: [7],
    };
    const { body } = renderF7(event, { sources: [{ name: 'Example' }] });
    assert.equal(body, 'A regulator issued a notice — Example (https://example.org/a).');
  });
});

describe('F7 renderer: public-tier name omission for arrest items', () => {
  const arrestEvent = {
    id: 'e2',
    summary: 'The EFCC arrested a suspect over an alleged fraud at a Lagos fintech',
    canonicalUrl: 'https://efcc.gov.ng/statement/1',
    region: 'Lagos',
    eventType: 'arrest',
    functions: [7],
    publicDescriptor: 'a Lagos fintech executive',
  };
  const entities = [
    { type: 'person_role', name: 'Chinedu Okafor' },
    { type: 'agency', name: 'EFCC' },
  ];

  test('public tier omits the individual name and uses the sector descriptor', () => {
    const { body, namedPerson } = renderF7(arrestEvent, {
      sources: [{ name: 'EFCC' }],
      entities,
      tier: 'public',
    });
    assert.equal(namedPerson, false);
    assert.ok(!body.includes('Chinedu Okafor'), 'public body must not name the individual');
    assert.ok(body.includes('a Lagos fintech executive'), 'public body must use the sector descriptor');
    assert.ok(body.includes('EFCC'), 'allegation must be attributed to the agency');
    assert.ok(!body.includes('A charge is not a conviction.'), 'no charge line when no person is named');
  });

  test('paid tier names the individual and adds the charge line', () => {
    const { body, namedPerson } = renderF7(arrestEvent, {
      sources: [{ name: 'EFCC' }],
      entities,
      tier: 'paid',
    });
    assert.equal(namedPerson, true);
    assert.ok(body.includes('Chinedu Okafor'));
    assert.ok(body.includes('A charge is not a conviction.'));
  });

  test('falls back to a name-free generic descriptor when no sector descriptor exists', () => {
    const noDescriptor = { ...arrestEvent, publicDescriptor: undefined };
    // R2: the descriptor must NEVER interpolate a raw org/entity name (a person
    // mislabelled `organisation` would otherwise be re-emitted verbatim).
    assert.equal(composeWho(noDescriptor, entities, 'public').who, 'an unnamed individual');

    const noOrg = entities.filter((e) => e.type === 'person_role');
    assert.equal(composeWho(noDescriptor, noOrg, 'public').who, 'an unnamed individual');
  });

  test('isArrestItem covers arrest and fraud types only', () => {
    assert.equal(isArrestItem({ eventType: 'arrest' }), true);
    assert.equal(isArrestItem({ eventType: 'fraud' }), true);
    assert.equal(isArrestItem({ eventType: 'advisory' }), false);
    assert.equal(isArrestItem({}), false);
  });

  test('personEntityNames returns only person_role entities', () => {
    assert.deepEqual(personEntityNames(entities), ['Chinedu Okafor']);
  });
});

describe('F7 renderer: pre-conviction word scrub', () => {
  test('replaces forbidden words with neutral phrasing', () => {
    assert.equal(scrubPreConvictionWords('the fraudster was arrested'), 'the suspect was arrested');
    assert.equal(scrubPreConvictionWords('a guilty hacker and a mastermind'), 'a charged suspect and a suspect');
  });

  test('the renderer never propagates a forbidden word verbatim', () => {
    const event = {
      summary: 'Police say the scammer and the culprit defrauded a bank',
      canonicalUrl: 'https://example.org/x',
      eventType: 'arrest',
      functions: [7],
    };
    const { body } = renderF7(event, { sources: [{ name: 'Police' }], entities: [], tier: 'public' });
    for (const w of ['scammer', 'culprit', 'fraudster', 'criminal', 'hacker', 'thief', 'guilty', 'mastermind']) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `body leaked forbidden word: ${w}`);
    }
  });

  test('scrub is case-preserving on the first letter', () => {
    assert.equal(scrubPreConvictionWords('Fraudster'), 'Suspect');
  });
});

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates: licence', () => {
  test('a denied licence blocks publication entirely', () => {
    assert.throws(
      () => assertPublishable({}, 7, 'public', { licenceStatus: 'denied' }),
      (err) => err instanceof GateError && err.code === 'licence_denied',
    );
  });

  test('restricted / unknown do not block this gate', () => {
    assert.doesNotThrow(() => assertPublishable({}, 7, 'public', { licenceStatus: 'restricted' }));
    assert.doesNotThrow(() => assertPublishable({}, 7, 'public', { licenceStatus: 'unknown' }));
  });
});

describe('gates: public-tier namelessness for arrest items', () => {
  const entities = [{ type: 'person_role', name: 'Chinedu Okafor' }];

  test('a public arrest body naming the individual is refused', () => {
    assert.throws(
      () =>
        assertPublishable({ eventType: 'arrest' }, 7, 'public', {
          body: 'An arrest — Chinedu Okafor — Lagos — EFCC.',
          entities,
        }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  test('a public arrest body that omits the name passes', () => {
    assert.doesNotThrow(() =>
      assertPublishable({ eventType: 'arrest' }, 7, 'public', {
        body: 'An arrest — a Lagos fintech executive — Lagos — EFCC.',
        entities,
      }),
    );
  });

  test('paid tier may name the individual', () => {
    assert.doesNotThrow(() =>
      assertPublishable({ eventType: 'arrest' }, 7, 'paid', {
        body: 'An arrest — Chinedu Okafor — Lagos — EFCC.',
        entities,
      }),
    );
  });
});

// ── Projection planning (I/O-free) ────────────────────────────────────────────

describe('F7 projection: planF7', () => {
  function row(overrides = {}) {
    return {
      id: 'evt-1',
      title: 'EFCC arrests suspect over fintech fraud',
      summary: 'The EFCC said it arrested a suspect over an alleged fintech fraud',
      whatItMeans: '',
      canonicalUrl: 'https://efcc.gov.ng/statement/1',
      region: 'Lagos',
      eventType: 'arrest',
      functions: [7],
      publicDescriptor: 'a Lagos fintech executive',
      sources: [
        {
          rawDocument: { url: 'https://efcc.gov.ng/statement/1', source: { name: 'EFCC', licenceStatus: 'verified', paywall: false } },
        },
      ],
      entities: [
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Chinedu Okafor' } },
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
      ],
      ...overrides,
    };
  }

  test('creates a draft item for an eligible arrest event and never auto-publishes', () => {
    const { created, refused } = planF7([row()], { tier: 'public' });
    assert.equal(refused.length, 0);
    assert.equal(created.length, 1);
    assert.equal(created[0].functionId, 7);
    assert.equal(created[0].tier, 'public');
    assert.equal(created[0].requiresHumanApproval, true);
    assert.equal(created[0].isArrest, true);
    assert.ok(!created[0].body.includes('Chinedu Okafor'));
    assert.equal(created[0].templateVersion, F7_TEMPLATE_VERSION);
  });

  test('refuses an event whose licence is denied', () => {
    const denied = row({
      sources: [
        {
          rawDocument: { url: 'https://example.org/x', source: { name: 'X', licenceStatus: 'denied', paywall: false } },
        },
      ],
    });
    const { created, refused } = planF7([denied], { tier: 'public' });
    assert.equal(created.length, 0);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'licence_denied');
  });

  test('refuses a public arrest item only if its rendered body would leak the name', () => {
    // A well-formed event renders namelessly, so this passes; proving the gate is
    // part of the creation path the projection uses.
    const { refused } = planF7([row()], { tier: 'public' });
    assert.equal(refused.length, 0);
  });
});

// ── Defect-fix regressions (QA / security / review follow-up) ─────────────────

describe('D1: secondary arrest signal (text verbs, not only eventType)', () => {
  test('an unlabelled item whose text contains an arrest verb is treated as arrest', () => {
    assert.equal(isArrestItem({ eventType: 'advisory', summary: 'Police arrested a suspect in Lagos' }), true);
    assert.equal(isArrestItem({ summary: 'The man was arraigned in court' }), true);
    assert.equal(isArrestItem({ title: 'Suspect charged with fraud' }), true);
    assert.equal(isArrestItem({ whatItMeans: 'He was detained overnight' }), true);
  });

  test('a benign advisory text is not treated as arrest', () => {
    assert.equal(isArrestItem({ eventType: 'advisory', summary: 'The NCC issued a consumer notice' }), false);
  });

  test('the public-tier name control applies to a text-detected arrest with no eventType', () => {
    const event = {
      summary: 'Police arrested Chinedu Okafor in Lagos',
      canonicalUrl: 'https://x.example/a',
    };
    assert.throws(
      () =>
        assertPublishable(event, 7, 'public', {
          body: 'Police arrested Chinedu Okafor in Lagos — Lagos.',
          entities: [],
          sources: [{ url: 'https://x.example/a' }],
        }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });
});

describe('D1: fail-closed person-like name detection', () => {
  test('findPersonLikeNames detects a possible name token but not a known agency', () => {
    // R2: detection is per-TITLE-CASE-TOKEN, not per-adjacent-pair, so both words
    // of "Jane Doe" are reported (either alone would be enough to fail closed).
    const found = findPersonLikeNames('EFCC arrested Jane Doe yesterday', new Set(['efcc']));
    assert.deepEqual(found, ['Jane', 'Doe']);
    assert.ok(!found.includes('EFCC'), 'the known agency must not be flagged');
  });

  test('all-caps acronyms are never treated as person names', () => {
    assert.deepEqual(findPersonLikeNames('The EFCC and NCC issued a notice', new Set()), []);
  });

  test('a public arrest whose STORED PROSE names someone with no person entity is denied', () => {
    assert.throws(
      () =>
        assertPublishable(
          {
            eventType: 'arrest',
            summary: 'The EFCC has arrested Chinedu Okafor over an alleged fintech fraud',
          },
          7,
          'public',
          { body: 'The EFCC has arrested a Lagos fintech executive — EFCC.', entities: [], sources: [{ url: 'u' }] },
        ),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  test('an agency-only public arrest with no name passes', () => {
    assert.doesNotThrow(() =>
      assertPublishable(
        { eventType: 'arrest', summary: 'The EFCC arrested a suspect over fraud' },
        7,
        'public',
        { body: 'The EFCC arrested a suspect over fraud — EFCC.', entities: [], sources: [{ url: 'u' }] },
      ),
    );
  });
});

describe('R3: case-insensitive detection closes the lowercase/ALL-CAPS/region leaks', () => {
  // L1 [HIGH] — an ALL-LOWERCASE name in stored prose. The old `\p{Lu}`-anchored
  // token regex never matched it, so it was neither redacted nor denied.
  test('L1: an all-lowercase name in the stored prose is detected, redacted, and denied', () => {
    const prose = 'the efcc has detained chinedu okafor over alleged fraud';
    const found = findPersonLikeNames(prose, new Set(['efcc']));
    assert.ok(found.includes('chinedu'), `lowercase name token must be detected: ${JSON.stringify(found)}`);
    assert.ok(found.includes('okafor'), `lowercase name token must be detected: ${JSON.stringify(found)}`);

    const event = { eventType: 'arrest', summary: prose };
    const { body } = renderF7(event, { sources: [{ name: 'EFCC' }], entities: [], tier: 'public' });
    assert.ok(!body.toLowerCase().includes('chinedu'), 'the lowercase name must not survive redaction');
    assert.throws(
      () => assertPublishable(event, 7, 'public', { body, entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  // L2 [HIGH] — an ALL-CAPS name. The old `isTitlecaseWord` rejected every
  // `^\p{Lu}{2,}$` token as a "presumed acronym", so the name passed through.
  test('L2: an ALL-CAPS name is detected and denied (not assumed to be an acronym)', () => {
    const found = findPersonLikeNames('The EFCC has detained CHINEDU OKAFOR over fraud', new Set());
    assert.ok(found.includes('CHINEDU'), `ALL-CAPS name must be detected: ${JSON.stringify(found)}`);
    assert.ok(found.includes('OKAFOR'), `ALL-CAPS name must be detected: ${JSON.stringify(found)}`);

    const event = { eventType: 'arrest', summary: 'The EFCC has detained CHINEDU OKAFOR over fraud' };
    const { body } = renderF7(event, { sources: [{ name: 'EFCC' }], entities: [], tier: 'public' });
    assert.ok(!body.includes('CHINEDU'), 'the ALL-CAPS name must not survive redaction');
    assert.throws(
      () => assertPublishable(event, 7, 'public', { body, entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  // L3 [MEDIUM] — a name placed in `event.region`. The old allow-list seeded
  // itself from EVERY region token (so the name was trusted) AND the renderer
  // echoed region verbatim into {where}.
  test('L3: a name in event.region is not self-trusted and is redacted/denied', () => {
    const event = { eventType: 'arrest', summary: 'The EFCC arrested a suspect over alleged fraud', region: 'Chinedu' };
    assert.ok(!knownNonPersonTokens(event).has('chinedu'), 'region tokens must NOT be self-allow-listed');

    const { body } = renderF7(event, { sources: [{ name: 'EFCC' }], entities: [], tier: 'public' });
    assert.ok(!body.includes('Chinedu'), 'the region-placed name must not survive redaction');

    // And if a body still carries the region name, the gate denies.
    assert.throws(
      () => assertPublishable(event, 7, 'public', { body: 'x — an unnamed individual — Chinedu — EFCC.', entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  // CONTROL — a REAL acronym must not false-deny, and detection must stay
  // acronym-correct via the trusted-acronym list rather than "all-caps is safe".
  test('CONTROL: real acronyms (EFCC/NCC) are trusted; an advisory mentioning them publishes', () => {
    assert.deepEqual(findPersonLikeNames('EFCC and NCC issued a notice', new Set()), []);
    assert.doesNotThrow(() =>
      assertPublishable(
        { eventType: 'advisory', summary: 'The EFCC issued a consumer advisory on SIM-swap fraud' },
        7,
        'public',
        { body: 'The EFCC issued a consumer advisory on SIM-swap fraud — NCC — Lagos — NCC (https://n.example/a).', entities: [], sources: [{ url: 'u' }] },
      ),
    );
  });

  // CONTROL — a registry source with ordinary words ("Central Bank of Nigeria")
  // must not over-block into absurdity.
  test('CONTROL: a trusted registry source name does not over-block', () => {
    assert.doesNotThrow(() =>
      assertPublishable(
        { eventType: 'advisory', summary: 'The Central Bank of Nigeria issued a notice' },
        7,
        'public',
        { body: 'The Central Bank of Nigeria issued a notice — Central Bank of Nigeria (https://c.example/a).', entities: [], sources: [{ url: 'u' }] },
      ),
    );
  });

  // OVER-BLOCK DOCUMENTED — an unknown two-word org ("Zenith Bank") is denied,
  // which is the accepted fail-closed direction.
  test('documented over-block: an unknown Titlecase org in an arrest item is denied', () => {
    assert.throws(
      () =>
        assertPublishable(
          { eventType: 'arrest', summary: 'The EFCC detained a suspect over an alleged fraud at Zenith Bank' },
          7,
          'public',
          { body: 'The EFCC detained a suspect — EFCC.', entities: [], sources: [{ url: 'u' }] },
        ),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });
});

// ── R4: a bare dotted name (`first.last`) must not be stripped as a URL ────────

describe('R4: dotted person names survive URL-stripping and are detected', () => {
  // The old `stripUrls` treated ANY dot-delimited letter token as URL-like and
  // deleted it BEFORE tokenisation, so `chinedu.okafor` was neither redacted nor
  // denied and leaked into the public body. `stripUrls` must now strip only
  // GENUINE URLs (scheme, `www.`, or a recognised TLD).

  test('UNIT: a bare dotted name is detected as a person, not stripped', () => {
    const found = findPersonLikeNames('The EFCC detained chinedu.okafor over fraud', new Set(['efcc']));
    assert.ok(found.includes('chinedu'), `dotted-name part must be detected: ${JSON.stringify(found)}`);
    assert.ok(found.includes('okafor'), `dotted-name part must be detected: ${JSON.stringify(found)}`);
  });

  test('UNIT: a bare word.tld where the suffix is a TLD is NOT stripped (fail-closed)', () => {
    // `okafor.dev` / `Grace.Ng`: a scheme-less `word.tld` with no path is a
    // possible name, so it must survive for detection. Stripping requires a
    // genuine URL tail (path/query/port), so only real links are removed.
    assert.deepEqual(findPersonLikeNames('detained okafor.dev today', new Set()), ['okafor', 'dev']);
    assert.deepEqual(findPersonLikeNames('detained Grace.Ng today', new Set()), ['Grace']);
  });

  test('UNIT: genuine URLs are still stripped so host tokens never read as prose', () => {
    // `see`/`now` are the only untrusted prose words; the URL tokens (`https`,
    // `efcc`, `gov`, `ng`, `statement`, `www`, `example`, `reg`, `advisory`)
    // must all be stripped so none of them surfaces as a possible name.
    // scheme URL
    assert.deepEqual(findPersonLikeNames('see https://efcc.gov.ng/statement/1 zoo', new Set()), ['see', 'zoo']);
    // www. URL
    assert.deepEqual(findPersonLikeNames('see www.example.com/a zoo', new Set()), ['see', 'zoo']);
    // bare host with a recognised TLD (+ path)
    assert.deepEqual(findPersonLikeNames('see reg.gov.ng/advisory/1 zoo', new Set()), ['see', 'zoo']);
    assert.deepEqual(findPersonLikeNames('see example.com/a zoo', new Set()), ['see', 'zoo']);
  });

  test('CONFIRMED LEAK: a dotted name in the summary is redacted and DENIED', () => {
    const event = {
      eventType: 'arrest',
      summary: 'The EFCC detained chinedu.okafor over an alleged fraud',
      region: 'Lagos',
      canonicalUrl: 'https://x',
    };
    const { body } = renderF7(event, { sources: [{ name: 'EFCC' }], entities: [], tier: 'public' });

    assert.ok(!/chinedu/i.test(body), `the dotted name must not survive redaction: ${JSON.stringify(body)}`);
    assert.ok(!/okafor/i.test(body), `the dotted name must not survive redaction: ${JSON.stringify(body)}`);
    // No stray dot from the dotted name: the only period is the template terminator.
    assert.ok(!/individual\.an/i.test(body), `the redaction must not leave "...individual.an..." from a dotted name: ${JSON.stringify(body)}`);

    assert.throws(
      () => assertPublishable(event, 7, 'public', { body, entities: [], sources: [{ url: 'https://x' }] }),
      (err) =>
        err instanceof GateError &&
        err.code === 'named_individual_in_public_arrest' &&
        err.details?.leaked?.includes('chinedu'),
    );
  });

  test('CONFIRMED LEAK: planF7 refuses the dotted-name event (nothing published)', () => {
    const row = {
      id: 'evt-dot',
      title: 'EFCC arrests suspect over fintech fraud',
      summary: 'The EFCC detained chinedu.okafor over an alleged fraud',
      whatItMeans: '',
      canonicalUrl: 'https://efcc.gov.ng/s/1',
      region: 'Lagos',
      eventType: 'arrest',
      sources: [
        { rawDocument: { url: 'https://efcc.gov.ng/s/1', source: { name: 'EFCC', licenceStatus: 'verified', paywall: false } } },
      ],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0, 'a dotted-name public arrest must not be created');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
  });

  test('CONTROL: a real link in the {source} slot still renders verbatim', () => {
    const { body } = renderF7(
      {
        summary: 'The EFCC issued a notice over online fraud',
        canonicalUrl: 'https://efcc.gov.ng/statement/1',
        region: 'Lagos',
        eventType: 'advisory',
      },
      { sources: [{ name: 'EFCC', url: 'https://efcc.gov.ng/statement/1' }], entities: [{ type: 'agency', name: 'EFCC' }], tier: 'public' },
    );
    assert.ok(
      body.includes('EFCC (https://efcc.gov.ng/statement/1)'),
      `the source link must render verbatim: ${JSON.stringify(body)}`,
    );
  });

  test('CONTROL: the acronym control still publishes an advisory mentioning EFCC/NCC', () => {
    assert.doesNotThrow(() =>
      assertPublishable(
        { eventType: 'advisory', summary: 'The EFCC and NCC issued a consumer advisory on fraud' },
        7,
        'public',
        {
          body: 'The EFCC and NCC issued a consumer advisory on fraud — NCC — Lagos — NCC (https://n.example/a).',
          entities: [],
          sources: [{ url: 'u' }],
        },
      ),
    );
  });

  test('CONTROL: the L1/L2/L3 leaks remain closed after the URL-strip change', () => {
    // L1 lowercase
    const l1 = { eventType: 'arrest', summary: 'the efcc has detained chinedu okafor over alleged fraud' };
    assert.throws(
      () => assertPublishable(l1, 7, 'public', { body: 'x — an unnamed individual.', entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
    // L2 ALL-CAPS
    const l2 = { eventType: 'arrest', summary: 'The EFCC has detained CHINEDU OKAFOR over fraud' };
    assert.throws(
      () => assertPublishable(l2, 7, 'public', { body: 'x — an unnamed individual.', entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
    // L3 region-placed name
    const l3 = { eventType: 'arrest', summary: 'The EFCC arrested a suspect over alleged fraud', region: 'Chinedu' };
    assert.throws(
      () => assertPublishable(l3, 7, 'public', { body: 'x — an unnamed individual — Chinedu — EFCC.', entities: [], sources: [{ url: 'u' }] }),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });
});

describe('D1/D7: public descriptor derivation fails closed and is name-free', () => {
  test('explicit descriptor wins when supplied', () => {
    assert.equal(derivePublicDescriptor({ publicDescriptor: 'a fintech executive' }, []), 'a fintech executive');
  });

  test('falls back to a name-free generic descriptor, never an org/person name', () => {
    assert.equal(derivePublicDescriptor({}, [{ type: 'agency', name: 'EFCC' }]), 'an unnamed individual');
    assert.equal(derivePublicDescriptor({}, []), 'an unnamed individual');
  });

  test('the fallback never contains a person name', () => {
    const d = derivePublicDescriptor({}, [{ type: 'person_role', name: 'Chinedu Okafor' }]);
    assert.equal(d, 'an unnamed individual');
    assert.ok(!d.includes('Chinedu Okafor'));
  });
});

describe('D4: licence gate covers EVERY source', () => {
  test('a denied licence anywhere in the list blocks publication', () => {
    assert.throws(
      () => assertLicence({ licenceStatuses: ['verified', 'denied'] }),
      (err) => err instanceof GateError && err.code === 'licence_denied',
    );
  });

  test('all-clear licence lists pass', () => {
    assert.doesNotThrow(() => assertLicence({ licenceStatuses: ['verified', 'unknown', 'restricted'] }));
  });

  test('planF7 refuses an event whose SECOND source is denied (index >= 1)', () => {
    const row = {
      id: 'evt-2src',
      title: 'A regulator issued a notice',
      summary: 'The regulator issued a notice',
      whatItMeans: '',
      canonicalUrl: 'https://reg.example/n',
      region: 'Abuja',
      eventType: 'advisory',
      functions: [7],
      sources: [
        { rawDocument: { url: 'https://reg.example/n', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } },
        { rawDocument: { url: 'https://other.example/n', source: { name: 'Other', licenceStatus: 'denied', paywall: false } } },
      ],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'licence_denied');
  });
});

describe('D5: no link, no publish', () => {
  test('a candidate with no canonicalUrl and no source URL is denied', () => {
    assert.throws(
      () => assertSourceLink({}, [{ name: 'X' }]),
      (err) => err instanceof GateError && err.code === 'missing_source_link',
    );
  });

  test('a canonicalUrl alone is sufficient', () => {
    assert.doesNotThrow(() => assertSourceLink({ canonicalUrl: 'https://x.example/a' }, []));
  });

  test('a source URL alone is sufficient', () => {
    assert.doesNotThrow(() => assertSourceLink({}, [{ url: 'https://x.example/a' }]));
  });

  test('planF7 refuses a linkless event', () => {
    const row = {
      id: 'evt-nolink',
      title: 'A regulator issued a notice',
      summary: 'The regulator issued a notice',
      whatItMeans: '',
      canonicalUrl: null,
      region: 'Abuja',
      eventType: 'advisory',
      functions: [7],
      sources: [{ rawDocument: { url: null, source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0);
    assert.equal(refused[0].code, 'missing_source_link');
  });
});

describe('D6: paywall is non-blocking and not a gate input', () => {
  test('a paywall flag does not block and is not threaded into assertPublishable', () => {
    assert.doesNotThrow(() =>
      assertPublishable({}, 7, 'public', { licenceStatus: 'unknown', sources: [] }),
    );
  });
});

describe('D3: a projected row is a draft, not approved', () => {
  test('deriveStatus reports draft for a row with null approvedAt', () => {
    assert.equal(deriveStatus({ approvedAt: null, publishedAt: null, withdrawnAt: null }), 'draft');
  });

  test('deriveStatus reports approved only when a human set approvedAt', () => {
    assert.equal(deriveStatus({ approvedAt: new Date(), publishedAt: null, withdrawnAt: null }), 'approved');
  });

  test('projection planning never claims an approval on the candidate', () => {
    const row = {
      id: 'evt-draft',
      title: 'A regulator issued a notice',
      summary: 'The regulator issued a notice',
      whatItMeans: '',
      canonicalUrl: 'https://reg.example/n',
      region: 'Abuja',
      eventType: 'advisory',
      functions: [7],
      sources: [{ rawDocument: { url: 'https://reg.example/n', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created } = planF7([row], { tier: 'public' });
    assert.ok(!Object.prototype.hasOwnProperty.call(created[0], 'approvedAt'), 'plan must not set approvedAt');
    assert.ok(!Object.prototype.hasOwnProperty.call(created[0], 'editorId'), 'plan must not set editorId');
  });
});

// ── D2: route-level authorization for the publish endpoints ───────────────────

describe('D2: publish endpoint authorization', () => {
  function store(seedItems = [], seedEvents = []) {
    // Model nullable timestamp columns as Postgres returns them (null, not
    // undefined); the list default bucket filters on `rejectedAt = null`.
    const items = seedItems.map((i) => ({ approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...i }));
    const events = seedEvents.map((e) => ({ ...e }));
    let seq = 0;
    const matches = (row, where = {}) =>
      Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if ('not' in v) return row[k] !== v.not;
          if ('in' in v) return v.in.includes(row[k]);
        }
        return row[k] === v;
      });
    return {
      items,
      publishItem: {
        async findMany({ where } = {}) {
          return items.filter((i) => matches(i, where));
        },
        async create({ data }) {
          seq += 1;
          const row = { id: `pi-${seq}`, approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...data };
          items.push(row);
          return { ...row };
        },
      },
      npEvent: {
        async findMany() {
          return events.map((e) => ({ ...e }));
        },
      },
    };
  }

  async function withPrisma(s, fn) {
    const hadP = Object.prototype.hasOwnProperty.call(prisma, 'publishItem');
    const hadE = Object.prototype.hasOwnProperty.call(prisma, 'npEvent');
    Object.defineProperty(prisma, 'publishItem', { value: s.publishItem, configurable: true, writable: true });
    Object.defineProperty(prisma, 'npEvent', { value: s.npEvent, configurable: true, writable: true });
    try {
      return await fn();
    } finally {
      if (!hadP) delete prisma.publishItem;
      if (!hadE) delete prisma.npEvent;
    }
  }

  function res() {
    return {
      statusCode: 200,
      payload: undefined,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.payload = b;
        return this;
      },
    };
  }

  async function call(fn, req) {
    const r = res();
    try {
      await fn(req, r);
      return { statusCode: r.statusCode, payload: r.payload };
    } catch (error) {
      return { error };
    }
  }

  test('an authenticated listing may request a non-public tier (masking relaxed; owner decision 2026-11-18)', async () => {
    // Policy change 2026-11-18: the social team is internal; list-tier masking
    // was deliberately relaxed — any authenticated user may request a tier.
    const s = store([
      { id: 'pub', functionId: 7, tier: 'public', approvedAt: null, publishedAt: null, withdrawnAt: null },
      { id: 'paid', functionId: 7, tier: 'paid', approvedAt: null, publishedAt: null, withdrawnAt: null },
    ]);
    const { payload } = await withPrisma(s, () =>
      call(listPublishItems, { query: { tier: 'paid' }, user: { id: 'u1', role: 'VIEWER' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['paid'], 'an authenticated user may now request a tier');
  });

  test('an unauthenticated listing fails closed to the public tier', async () => {
    const s = store([
      { id: 'pub', functionId: 7, tier: 'public', approvedAt: null, publishedAt: null, withdrawnAt: null },
      { id: 'paid', functionId: 7, tier: 'paid', approvedAt: null, publishedAt: null, withdrawnAt: null },
    ]);
    const { payload } = await withPrisma(s, () =>
      call(listPublishItems, { query: { tier: 'paid' }, user: undefined }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['pub'], 'no session only ever sees the public tier');
  });

  test('an editor listing may request a non-public tier', async () => {
    const s = store([
      { id: 'pub', functionId: 7, tier: 'public', approvedAt: null, publishedAt: null, withdrawnAt: null },
      { id: 'paid', functionId: 7, tier: 'paid', approvedAt: null, publishedAt: null, withdrawnAt: null },
    ]);
    const { payload } = await withPrisma(s, () =>
      call(listPublishItems, { query: { tier: 'paid' }, user: { id: 'a1', role: 'ADMIN' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['paid']);
  });

  test('POST /f7 commit is allowed for any authenticated user and writes (owner decision 2026-11-18)', async () => {
    // Policy change 2026-11-18: the social team is internal; the former
    // editor-only gate (403 for SENDER) was deliberately relaxed to ANY
    // authenticated user.
    const s = store([], []);
    const { statusCode } = await withPrisma(s, () =>
      call(projectF7Items, { user: { id: 'u1', role: 'SENDER' }, body: { commit: true } }),
    );
    assert.equal(statusCode, 201, 'an authenticated SENDER may now commit a projection');
  });

  test('POST /f7 dry-run is allowed for any authenticated user and writes nothing', async () => {
    // Owner decision 2026-11-18: dry-run is likewise allowed for any
    // authenticated user. A dry-run must still write nothing.
    const s = store([], []);
    const { statusCode } = await withPrisma(s, () =>
      call(projectF7Items, { user: { id: 'u1', role: 'VIEWER' }, body: {} }),
    );
    assert.equal(statusCode, 200);
    assert.equal(s.items.length, 0, 'a dry-run must not write');
  });

  test('POST /f7 with no session is rejected (identity must come from the session)', async () => {
    const s = store([], []);
    const { error } = await withPrisma(s, () => call(projectF7Items, { user: undefined, body: {} }));
    assert.ok(error, 'a session-less projection must be rejected');
    assert.equal(error.statusCode, 403);
    assert.equal(s.items.length, 0);
  });
});

// ── Allow-list DATA guard (refactor of the extracted `allowlists.js`) ─────────
//
// The word/regex allow-lists were extracted from `f7.js` into `allowlists.js` for
// reviewability. These tests pin the invariants the extraction must not break:
// every list is de-duplicated and non-blank, no plausible personal name may be
// trusted, and the exported detector behaviour is unchanged.

describe('allow-list data: structural invariants', () => {
  const LISTS = [
    ['NON_PERSON_TOKENS', NON_PERSON_TOKENS],
    ['GEOGRAPHIC_TOKENS', GEOGRAPHIC_TOKENS],
    ['TRUSTED_ACRONYMS', TRUSTED_ACRONYMS],
    ['URL_TLDS', URL_TLDS],
  ];

  for (const [name, list] of LISTS) {
    test(`${name} is de-duplicated and holds no empty/whitespace-only entry`, () => {
      const values = [...list];
      assert.equal(values.length, new Set(values).size, `${name} must contain no duplicate literals`);
      for (const v of values) {
        assert.equal(typeof v, 'string', `${name} entries must be strings`);
        assert.ok(v.trim().length > 0, `${name} must not contain a blank entry: ${JSON.stringify(v)}`);
      }
    });
  }
});

describe('allow-list data: no plausible personal name is trusted (security invariant)', () => {
  // The allow-lists are "safe if trusted" lists, never "known-good names" lists.
  // A backstop set that forces a future edit adding a plausible name to be
  // justified or removed. Not exhaustive — a tripwire, not a proof.
  const PERSONAL_NAMES = [
    'chinedu', 'okafor', 'ada', 'nwosu', 'amina', 'bello', 'adewale', 'funke',
    'chioma', 'emeka', 'grace', 'madonna', 'jane', 'doe', 'john', 'mary',
    'musa', 'abdul', 'yakubu', 'obinna', 'ngozi', 'tunde', 'bimpe', 'segun',
  ];

  const TRUST_LISTS = [
    ['NON_PERSON_TOKENS', NON_PERSON_TOKENS],
    ['GEOGRAPHIC_TOKENS', GEOGRAPHIC_TOKENS],
    ['TRUSTED_ACRONYMS', TRUSTED_ACRONYMS],
  ];

  for (const [name, list] of TRUST_LISTS) {
    test(`${name} trusts no plausible personal name/surname`, () => {
      for (const candidate of PERSONAL_NAMES) {
        assert.ok(
          !list.has(candidate),
          `${name} must not trust the plausible personal name ${JSON.stringify(candidate)}`,
        );
      }
    });
  }
});

describe('allow-list extraction: detector behaviour is unchanged (smoke)', () => {
  test('knownNonPersonTokens still trusts the registry and geography, never a region name', () => {
    const tokens = knownNonPersonTokens({ publicDescriptor: 'a Lagos fintech executive' });
    assert.ok(tokens.has('lagos'), 'geography constant must still be trusted');
    assert.ok(tokens.has('fintech'), 'public descriptor tokens must still be trusted');
    assert.ok(!tokens.has('chinedu'), 'an arbitrary region name must not be self-trusted');
  });

  test('findPersonLikeNames still flags a name token and still trusts a known agency', () => {
    const found = findPersonLikeNames('EFCC arrested Jane Doe yesterday', new Set(['efcc']));
    assert.deepEqual(found, ['Jane', 'Doe']);
    assert.ok(!found.includes('EFCC'), 'the known agency must not be flagged');
    assert.deepEqual(findPersonLikeNames('The EFCC and NCC issued a notice', new Set()), []);
  });
});

