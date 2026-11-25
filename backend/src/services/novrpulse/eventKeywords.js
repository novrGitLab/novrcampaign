/**
 * NovrPulse deterministic keyword pre-tag (the free, instant layer of the AI
 * filtering classification).
 *
 * At store time every new event is scanned for a small, curated keyword set and
 * the matching flags are set TRUE. A flag is NEVER set to false here: a miss is
 * left NULL (UNCLASSIFIED) so the accurate batched LLM classification pass can
 * still fill it. This module is pure and synchronous — no DB, no network — so it
 * is cheap to run over every stored event.
 *
 * Title matches weigh more than summary matches: a title hit sets the flag
 * regardless of the summary. A summary hit alone still sets the flag (the free
 * layer is deliberately recall-oriented; the AI pass is the precision pass and
 * OVERWRITES these interim flags).
 *
 * Keyword matching is whole-word (word-boundary) and case-insensitive, so
 * "APT" does not match "capture" and "CVE" does not match inside a longer token.
 * Multi-word phrases match as a run of adjacent words.
 */

/** Cybersecurity indicators. */
export const CYBER_KEYWORDS = [
  'ransomware', 'phishing', 'malware', 'breach', 'breached', 'hacked', 'hacker', 'hackers',
  'hacking', 'cve', 'vulnerability', 'vulnerabilities', 'exploit', 'zero day', 'zero-day',
  'apt', 'botnet', 'ddos', 'data leak', 'data breach', 'cyberattack', 'cyber attack',
  'cyber', 'cybersecurity', 'cyber security', 'infosec', 'firewall', 'endpoint',
  'spyware', 'trojan', 'keylogger', 'encryption', 'dark web', 'identity theft',
  'social engineering', 'password', 'credential', 'credentials', 'cybercrime', 'cyber crime',
];

/** Threat-intelligence indicators (actors, campaigns, tradecraft). */
export const THREAT_KEYWORDS = [
  'threat actor', 'threat actors', 'threat intelligence', 'apt', 'ransomware group',
  'ransomware gang', 'campaign', 'indicator', 'indicators', 'ioc', 'iocs', 'ttp', 'ttps',
  'backdoor', 'spyware', 'stealer', 'infostealer', 'rootkit', 'command and control',
  'c2 server', 'lateral movement', 'persistence', 'mitre att&ck', 'att&ck', 'kill chain',
  'cyber espionage', 'espionage', 'nation state', 'nation-state', 'supply chain attack',
  'vulnerability exploited', 'actively exploited', 'malicious actor',
];

/** Nigeria-related indicators (geography, agencies, official bodies). */
export const NIGERIA_KEYWORDS = [
  'nigeria', 'nigerian', 'lagos', 'abuja', 'abuja-based', 'naira',
  'ncc', 'ndpc', 'nitda', 'ngcert', 'efcc', 'npc', 'cbn', 'nnpc',
  'federal government', 'fg', 'national assembly', 'nigerian communications commission',
  'national information technology development agency',
  'nigeria data protection commission', 'fed govt',
];

/**
 * Escape a phrase for use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `phrase` occurs in `text` on word boundaries (case-insensitive).
 * Phrases are matched as a run of adjacent whitespace-separated words.
 * @param {string} text  already lower-cased
 * @param {string} phrase
 * @returns {boolean}
 */
function hits(text, phrase) {
  if (!text) return false;
  const words = phrase.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${words}([^\\p{L}\\p{N}]|$)`, 'u').test(text);
}

/**
 * Does any keyword hit in the given text?
 * @param {string} text lower-cased
 * @param {string[]} keywords
 * @returns {boolean}
 */
function anyHit(text, keywords) {
  return keywords.some((kw) => hits(text, kw));
}

/**
 * Deterministic keyword pre-tag for one event.
 *
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.summary]
 * @param {string} [input.region] the source region code (e.g. 'NG'); 'NG' counts
 *   as a Nigeria-related signal.
 * @returns {{ isCybersecurity: boolean, isThreatIntel: boolean, isNigeriaRelated: boolean }}
 *   each flag is true on any hit; FALSE means "no keyword hit" (the caller
 *   leaves the column NULL so the AI pass can still fill it).
 */
export function pretagEvent({ title, summary, region } = {}) {
  const t = String(title ?? '').toLowerCase();
  const s = String(summary ?? '').toLowerCase();
  const both = s ? `${t}\n${s}` : t;

  // Title hits are checked against the title alone and combined with summary
  // hits; a title hit therefore always sets the flag (it dominates the summary).
  const isCybersecurity = anyHit(t, CYBER_KEYWORDS) || anyHit(s, CYBER_KEYWORDS);
  const isThreatIntel = anyHit(t, THREAT_KEYWORDS) || anyHit(s, THREAT_KEYWORDS);
  const isNigeriaRelated =
    anyHit(both, NIGERIA_KEYWORDS) || String(region ?? '').toUpperCase() === 'NG';

  return { isCybersecurity, isThreatIntel, isNigeriaRelated };
}

export default { pretagEvent, CYBER_KEYWORDS, THREAT_KEYWORDS, NIGERIA_KEYWORDS };
