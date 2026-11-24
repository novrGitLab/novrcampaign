import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, isEnglish } from '@novr/ingest';

// Unit tests for the script-based language heuristic. No database, no network:
// `detectLanguage` is a pure function over text.

describe('detectLanguage — English and Latin text', () => {
  test('plain ASCII English is "en"', () => {
    assert.equal(detectLanguage('NCC issues new spectrum guidance for operators'), 'en');
  });

  test('English with non-ASCII but Latin characters is still "en"', () => {
    // The naira sign, a curly apostrophe and an accented letter are legitimate
    // English title content — none is a non-Latin script letter.
    assert.equal(detectLanguage('OPay names the Top Finalists of the ₦18m National Innovation Challenge'), 'en');
    assert.equal(detectLanguage('NITDA, CBN partner to strengthen Nigeria’s digital sovereignty'), 'en');
    assert.equal(detectLanguage('How to Move in Pokémon GO without Walking'), 'en');
  });

  test('accented Latin (e.g. French/Spanish) is reported "en" (heuristic limitation)', () => {
    // The heuristic deliberately does not separate Latin scripts.
    assert.equal(detectLanguage('Élections générales prévues au Sénégal'), 'en');
  });

  test('empty and non-string input are "en"', () => {
    assert.equal(detectLanguage(''), 'en');
    assert.equal(detectLanguage(undefined), 'en');
    assert.equal(detectLanguage(null), 'en');
    assert.equal(detectLanguage(12345), 'en');
  });

  test('digits, punctuation and symbols alone are "en"', () => {
    assert.equal(detectLanguage('2026 — 100% growth!'), 'en');
  });
});

describe('detectLanguage — Japanese', () => {
  const JA = 'AIを活用したサイバー攻撃の増加を受け、日本がサイバーセキュリティへの緊急資金拠出を推進';

  test('the Dark Reading Japanese headline is "ja"', () => {
    assert.equal(detectLanguage(JA), 'ja');
  });

  test('kana alone is "ja"', () => {
    assert.equal(detectLanguage('サイバーセキュリティ'), 'ja');
  });

  test('kanji + kana mix is "ja" (kana wins over Han)', () => {
    assert.equal(detectLanguage('日本 の セキュリティ'), 'ja');
  });
});

describe('detectLanguage — other scripts', () => {
  test('pure Han without kana is "zh"', () => {
    assert.equal(detectLanguage('中国网络安全法'), 'zh');
  });

  test('Chinese extension-A ideographs are "zh"', () => {
    assert.equal(detectLanguage('\u3400\u3401\u3402'), 'zh');
  });

  test('Hangul is "ko"', () => {
    assert.equal(detectLanguage('사이버 보안 뉴스'), 'ko');
  });

  test('Cyrillic is "ru"', () => {
    assert.equal(detectLanguage('Новости кибербезопасности'), 'ru');
  });

  test('Arabic is "ar"', () => {
    assert.equal(detectLanguage('أخبار الأمن السيبراني'), 'ar');
  });

  test('Hebrew is "he"', () => {
    assert.equal(detectLanguage('חדשות אבטחת סייבר'), 'he');
  });

  test('Thai is "th"', () => {
    assert.equal(detectLanguage('ข่าวความปลอดภัยไซเบอร์'), 'th');
  });

  test('Devanagari is "hi"', () => {
    assert.equal(detectLanguage('साइबर सुरक्षा समाचार'), 'hi');
  });
});

describe('detectLanguage — dominance and ties', () => {
  test('the dominant non-Latin script wins over a smaller one', () => {
    // Many Hangul letters, one Cyrillic letter ⇒ "ko".
    assert.equal(detectLanguage('사이버보안н'), 'ko');
  });

  test('an equal split between two scripts is "und"', () => {
    // One Cyrillic letter, one Hangul letter ⇒ no dominance.
    assert.equal(detectLanguage('н가'), 'und');
  });

  test('a mostly-Latin title with one stray non-Latin letter still flags that script', () => {
    // A single foreign-script letter is enough to flag (and is the point: a bad
    // feed item must not be silently labelled English).
    assert.equal(detectLanguage('Breaking news н update'), 'ru');
  });
});

describe('isEnglish', () => {
  test('true for Latin/English text, including Latin non-ASCII', () => {
    assert.equal(isEnglish('NCC issues new spectrum guidance'), true);
    assert.equal(isEnglish('₦18m challenge — Nigeria’s finest'), true);
  });

  test('false for any tracked non-Latin script', () => {
    assert.equal(isEnglish('サイバーセキュリティ'), false);
    assert.equal(isEnglish('кибербезопасность'), false);
  });

  test('agrees with detectLanguage === "en"', () => {
    for (const s of ['', 'hello', '日本', 'नमस्ते', 'مرحبا']) {
      assert.equal(isEnglish(s), detectLanguage(s) === 'en');
    }
  });
});
