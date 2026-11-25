/**
 * Script-based non-English detection.
 *
 * NovrPulse ingests feeds that are overwhelmingly English, but a small number
 * of items arrive in another script (e.g. a Japanese article pulled from an
 * English source). The event's `language` column exists so a reviewer can see
 * and filter those out; before this module it was hardcoded to `"en"`.
 *
 * WHY SCRIPT, NOT "HAS NON-ASCII": English titles legitimately contain
 * non-ASCII characters — the naira sign `₦`, curly apostrophes `’`, accented
 * letters `é`. Treating any non-ASCII byte as "foreign" would flag those as
 * non-English. Detection therefore counts only letters in well-known
 * *non-Latin scripts* via Unicode block ranges.
 *
 * THIS IS A HEURISTIC, NOT A LANGUAGE-ID LIBRARY. It does not use wordlists,
 * n-grams, or models, and it cannot tell English from, say, German or Spanish
 * (both Latin). Its single job is: "is there a substantial amount of text in a
 * non-Latin script?" — which is precisely the case that needs flagging here.
 * Where the dominant script maps to more than one language (e.g. Han is shared
 * by Chinese and Japanese), the returned code is a best guess; `'und'`
 * (undetermined) is returned when no script clearly dominates.
 */

/**
 * Script definitions, in evaluation order. Each entry is a name, the ISO 639-1
 * code to report, and the Unicode ranges that identify the script.
 *
 * Ranges (per the task spec):
 *  - Han (Chinese ideographs): U+4E00–U+9FFF, U+3400–U+4DBF (ext. A)
 *  - Hiragana/Katakana (Japanese kana): U+3040–U+30FF
 *  - Hangul (Korean): U+AC00–U+D7AF
 *  - Cyrillic (Russian et al.): U+0400–U+04FF
 *  - Arabic: U+0600–U+06FF
 *  - Hebrew: U+0590–U+05FF
 *  - Thai: U+0E00–U+0E7F
 *  - Devanagari (Hindi et al.): U+0900–U+097F
 */
const SCRIPTS = [
  { name: 'han', code: 'zh', ranges: [[0x4e00, 0x9fff], [0x3400, 0x4dbf]] },
  { name: 'kana', code: 'ja', ranges: [[0x3040, 0x30ff]] },
  { name: 'hangul', code: 'ko', ranges: [[0xac00, 0xd7af]] },
  { name: 'cyrillic', code: 'ru', ranges: [[0x0400, 0x04ff]] },
  { name: 'arabic', code: 'ar', ranges: [[0x0600, 0x06ff]] },
  { name: 'hebrew', code: 'he', ranges: [[0x0590, 0x05ff]] },
  { name: 'thai', code: 'th', ranges: [[0x0e00, 0x0e7f]] },
  { name: 'devanagari', code: 'hi', ranges: [[0x0900, 0x097f]] },
];

/** Precompute the range checks so detection is a single pass over the text. */
const RANGE_CHECKS = SCRIPTS.flatMap((script) =>
  script.ranges.map(([lo, hi]) => ({ script, lo, hi })),
);

/**
 * Count letters per non-Latin script in `text`.
 *
 * @param {string} text
 * @returns {Map<string, { code: string, count: number }>} script name → { code, count }
 */
function countScripts(text) {
  const counts = new Map();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    for (const { script, lo, hi } of RANGE_CHECKS) {
      if (cp >= lo && cp <= hi) {
        const entry = counts.get(script.name) ?? { code: script.code, count: 0 };
        entry.count += 1;
        counts.set(script.name, entry);
        break;
      }
    }
  }
  return counts;
}

/**
 * Detect the language of `text` from the scripts it uses.
 *
 * Returns `'en'` when the text contains no letters in a tracked non-Latin
 * script (this includes pure Latin English, and also Latin-script non-English
 * such as German — which this heuristic deliberately does not attempt to
 * separate). Otherwise returns a best-guess code for the dominant non-Latin
 * script: `'ja'`, `'zh'`, `'ko'`, `'ru'`, `'ar'`, `'he'`, `'th'`, `'hi'`, or
 * `'und'` when no script dominates.
 *
 * Japanese vs Chinese: a Japanese text usually mixes kana with Han, so when
 * any kana is present `'ja'` wins over Han. Kana alone is unambiguously
 * Japanese. Pure Han with no kana is reported as `'zh'` (the common case);
 * this can mislabel kanji-only Japanese text, which is accepted — the badge
 * only needs to say "not English".
 *
 * @param {string} text
 * @returns {'en'|'ja'|'zh'|'ko'|'ru'|'ar'|'he'|'th'|'hi'|'und'}
 */
export function detectLanguage(text) {
  const s = typeof text === 'string' ? text : '';
  const counts = countScripts(s);
  if (counts.size === 0) return 'en';

  // Kana present ⇒ Japanese (Han+kana mix or kana alone). Checked before the
  // generic dominance rule so a Han-heavy Japanese title is not labelled 'zh'.
  if (counts.has('kana')) return 'ja';

  // Otherwise the dominant script by letter count decides. A tie falls back to
  // 'und' rather than picking arbitrarily.
  let best = null;
  let tied = false;
  for (const { code, count } of counts.values()) {
    if (best === null || count > best.count) {
      best = { code, count };
      tied = false;
    } else if (count === best.count) {
      tied = true;
    }
  }

  return tied || best === null ? 'und' : best.code;
}

/**
 * True when `text` is (heuristically) English: i.e. no letters in a tracked
 * non-Latin script are present.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isEnglish(text) {
  return detectLanguage(text) === 'en';
}

export default { detectLanguage, isEnglish };
