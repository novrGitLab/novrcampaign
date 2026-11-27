/**
 * Reviewed allow-list DATA for the F7 public-tier name control.
 *
 * Extracted from `f7.js` to keep the detection LOGIC there separate from the
 * reviewed, hand-maintained word lists here. Behaviour is identical: a `Set`
 * de-duplicates at runtime, so collapsing duplicated literals changes nothing
 * the gate observes. The token SETS are byte-identical to before extraction.
 *
 * SECURITY INVARIANT (unchanged, now also guarded by a test): no token that is a
 * plausible personal name may be added to any list below. These are "safe if
 * trusted" lists, never "known-good names" lists. See
 * `backend/test/novrpulseProjection.test.mjs` ("allow-list guard").
 */

/**
 * Trusted function words, common English content words, and domain vocabulary
 * that are never a personal name on their own.
 *
 * CASE-INSENSITIVE DETECTION (defect R3): the detector now tokenises
 * case-insensitively, so this list is compared in lower case and must cover the
 * ordinary words that legitimately appear in a public-tier item of this kind.
 * It is deliberately over-inclusive: trusting more COMMON words only reduces
 * absurd over-blocking; a genuine name is still never on this list, so a name
 * token is always flagged regardless of its casing.
 *
 * SECURITY INVARIANT: no token that is a plausible personal name may be added
 * here. This is a "safe if trusted" list, never a "known-good names" list.
 */
export const NON_PERSON_TOKENS = new Set([
  // Function words / determiners / prepositions / conjunctions / auxiliaries.
  'the', 'a', 'an', 'and', 'or', 'but', 'nor', 'of', 'in', 'on', 'at', 'to',
  'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'am', 'has', 'have', 'had', 'do', 'does', 'did', 'it', 'its', 'his',
  'her', 'hers', 'their', 'theirs', 'our', 'ours', 'your', 'yours', 'my',
  'mine', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'them', 'we',
  'us', 'you', 'i', 'who', 'whom', 'whose', 'which', 'what', 'when', 'where',
  'why', 'how', 'if', 'then', 'than', 'so', 'such', 'no', 'not', 'only', 'both',
  'each', 'either', 'neither', 'all', 'any', 'some', 'more', 'most', 'much',
  'many', 'one', 'two', 'three', 'other', 'another', 'same', 'very', 'also',
  'again', 'over', 'under', 'into', 'onto', 'upon', 'about', 'after', 'before',
  'during', 'between', 'among', 'across', 'through', 'against', 'within',
  'without', 'toward', 'towards', 'around', 'near', 'off', 'out', 'up', 'down',
  'still', 'yet', 'just', 'even', 'ever', 'never', 'now', 'here',
  'there', 'because', 'while', 'though', 'although', 'since', 'until', 'unless',
  // Newsroom / editorial vocabulary that legitimately appears in a brief.
  'new', 'alleged', 'allegedly', 'says', 'said', 'say', 'police', 'court',
  'agency', 'agencies', 'report', 'reports', 'reported', 'reporting', 'source',
  'sources', 'confidence', 'confirmed', 'claimed', 'claim', 'claims', 'stated',
  'statement', 'arrest', 'arrested', 'arrests', 'arresting', 'detain',
  'detained', 'detains', 'detaining', 'arraign', 'arraigned', 'arraigns',
  'issued', 'issue', 'issues', 'issuing', 'announce', 'announced', 'announces',
  'charge', 'charges', 'charged', 'charging', 'suspect', 'suspects', 'accused',
  'accuse', 'accuses', 'allege', 'alleges', 'fraud', 'frauds', 'defraud',
  'defrauded', 'defrauds', 'investigate', 'investigated', 'investigation',
  'involved', 'involves', 'notice', 'advisory', 'advisories', 'consumer',
  'executive', 'executives', 'employee', 'employees', 'fintech', 'bank',
  'banking', 'official', 'officials', 'spokesperson', 'released',
  'incident', 'quarter', 'quarters', 'man', 'woman', 'person', 'individual',
  'unnamed', 'people', 'fled', 'yesterday', 'today', 'overnight',
  'morning', 'evening', 'week', 'month', 'year', 'day', 'days', 'time',
  'investors', 'customers', 'customer', 'users', 'user', 'victims', 'victim',
  'criminal', 'criminals', 'funds', 'money', 'fund', 'transaction',
  'transactions', 'account', 'accounts', 'device', 'devices', 'phone', 'online',
  'network', 'networks', 'data', 'system', 'systems', 'service', 'services',
  'platform', 'platforms', 'market', 'markets', 'share', 'shares', 'company',
  'companies', 'group', 'groups', 'team', 'staff', 'office', 'offices',
  'government', 'federal', 'state', 'national', 'public', 'private', 'regulator',
  'regulators', 'regulatory', 'commission', 'commissioner', 'ministry',
  'minister', 'director', 'directors', 'general', 'chief', 'president',
  'chairman', 'secretary', 'council', 'committee', 'panel', 'taskforce',
  'security', 'cyber', 'cybercrime', 'crime', 'crimes', 'law', 'legal',
  'conviction', 'convicted', 'guilty', 'trial', 'judge',
  'ruling', 'order', 'orders', 'fine', 'fines', 'penalty', 'sentence',
  'sentenced', 'custody', 'detention', 'bail', 'remand', 'prosecution',
  'prosecutor', 'allegation', 'allegations', 'misconduct', 'offence', 'offences',
  'offense', 'offenses', 'scandal', 'abuse', 'abused', 'steal', 'stole',
  'stolen', 'hack', 'hacked', 'hacking', 'breach', 'breached', 'leak', 'leaked',
  'extort', 'extortion', 'bribe', 'bribery', 'laundering', 'corruption',
  'corrupt', 'terror', 'terrorism', 'terrorist', 'terrorists', 'kidnap',
  'kidnapped', 'kidnapping', 'attack', 'attacked', 'attacks', 'vulnerable',
  'vulnerability', 'vulnerabilities', 'malware', 'ransomware', 'phishing',
  'scam', 'scams', 'scheme', 'schemes', 'ring', 'syndicate', 'gang',
  'telecom', 'telecommunications', 'communications', 'communication', 'internet',
  'software', 'hardware', 'technology', 'technologies', 'digital', 'information',
  'aired', 'broadcast', 'published', 'publish', 'media', 'outlet', 'outlets',
  'press', 'news', 'daily', 'weekly', 'journal', 'journalist', 'editor',
  'editorial', 'features', 'opinion', 'blog', 'podcast', 'radio', 'television',
  'tv', 'web', 'website', 'portal', 'post', 'posts', 'tweet',
  'sim', 'swap', 'sim-swap', 'card', 'cards', 'atm', 'pos', 'mobile',
  'stakeholders', 'stakeholder', 'sector', 'sectors',
  'industry', 'business', 'economy', 'economic', 'financial', 'finance',
  'currency', 'naira', 'dollar', 'funding', 'payment', 'payments', 'loan',
  'loans', 'credit', 'debit', 'insurance', 'tax', 'taxes', 'revenue', 'budget',
  'policy', 'policies', 'reform', 'reforms', 'initiative', 'initiatives',
  'programme', 'program', 'project', 'projects', 'campaign', 'drive',
  'awareness', 'guideline', 'guidelines', 'directive', 'directives',
  'regulation', 'regulations', 'compliance', 'enforcement', 'inspection',
  'tollfree', 'number', 'numbers', 'email', 'address', 'contact',
  'several', 'multiple', 'various', 'recent', 'latest', 'ongoing',
  'current', 'former', 'deputy', 'assistant', 'acting', 'senior', 'junior',
  'suspected', 'unidentified', 'unknown', 'unclear', 'possible',
  'potential', 'serious', 'major', 'minor', 'local', 'international', 'global',
  'regional', 'urban', 'rural', 'northern', 'southern', 'eastern', 'western',
  'central', 'north', 'south', 'east', 'west',
  // Frequent ordinary verbs/nouns that appear in briefs (reduce false denies).
  'raised', 'raise', 'raises', 'lowered', 'lower', 'reduce', 'reduced', 'increase',
  'increased', 'warned', 'warn', 'warns', 'opened', 'opens', 'open',
  'closed', 'close', 'high', 'low', 'operator',
  'operators', 'monetary', 'rate', 'rates',
  'launched', 'launch', 'deployed', 'deploy', 'approved', 'approve', 'denied',
  'deny', 'ordered', 'directed', 'direct', 'asked', 'urged', 'urge',
  'calls', 'called', 'call', 'seeks', 'sought', 'seek', 'received', 'receive',
  'records', 'record', 'recorded', 'signed', 'sign', 'sustained', 'sustain',
  'scheduled', 'pending', 'stalled', 'listed',
  'named', 'names', 'name', 'read', 'wrote', 'writes', 'write', 'told', 'tells',
  'tell', 'toll', 'hotline',
  'confirms', 'intruders', 'accessed', 'personal', 'intrusion', 'exposed',
  'governing', 'body', 'working', 'attributed', 'taken', 'reference',
]);

/**
 * Trusted, reviewed constant of common geographic / demonym tokens that are
 * never a personal name. Low-cardinality, code-reviewed data — NOT derived from
 * any untrusted input — so it is safe to allow-list (defect R2 #3 permits "a
 * small explicit constant"). This reduces over-blocking of the `{where}` slot
 * without trusting a model-produced label.
 *
 * SECURITY (defect R3 #2): geography is trusted ONLY from this constant (or the
 * reviewed registry), NEVER from the event's own `region`/`location` field. An
 * arbitrary value placed in `region` must not self-allow-list.
 */
export const GEOGRAPHIC_TOKENS = new Set([
  'lagos', 'abuja', 'kano', 'ibadan', 'port', 'harcourt', 'nigeria', 'nigerian',
  'ghana', 'ghanaian', 'kenya', 'kenyan', 'africa', 'african', 'senegal',
  'sa', 'south', 'rivers', 'state', 'fct', 'enugu', 'kaduna', 'owerri',
  'benin', 'asaba', 'jos', 'maiduguri', 'sokoto', 'aba', 'uyo', 'calabar',
  'gha', 'ke', 'ng', 'za', 'af', 'global', 'north', 'east', 'west', 'central',
]);

/**
 * Trusted acronyms. A real acronym (EFCC, NCC, NITDA, CBN, NDPC, FBI, SEC,
 * API, …) is NOT a person name and must not false-deny; the old detector
 * achieved this with a blanket "any all-caps token is safe" rule, which is
 * exactly the L2 leak (an ALL-CAPS *name* passed through). Instead we trust an
 * explicit, reviewed constant PLUS the reviewed source-registry ids (code data),
 * and treat every other all-caps token as a possible name (fail-closed).
 */
export const TRUSTED_ACRONYMS = new Set([
  'efcc', 'ncc', 'nitda', 'cbn', 'ndpc', 'ngcert', 'cert', 'npf', 'fbi', 'cia',
  'sec', 'api', 'apis', 'nca', 'icpc', 'fccpc', 'son', 'npopc', 'nimc', 'nbs',
  'nbc', 'nipost', 'nira', 'nnpc', 'nef', 'cisa', 'nist', 'gdpr', 'nis',
  'un', 'eu', 'uk', 'us', 'usa', 'au', 'ecowas', 'who', 'imf', 'itu', 'undp',
  'nato', 'ai', 'it', 'ict', 'sms', 'ussd', 'otp', 'pin', 'atm', 'pos',
  'url', 'https', 'http', 'www', 'id', 'ng', 'fifa', 'uefa', 'unicef', 'ap',
]);

/**
 * Recognised top-level domains (trusted, reviewed constant) used to decide
 * whether a dot-delimited token is a real URL host rather than a person name.
 *
 * SECURITY (defect R4): a bare dotted token is NOT sufficient evidence of a URL.
 * The previous second alternative, `\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\S*`,
 * treated `first.last` (e.g. `chinedu.okafor`) as a URL-like token and DELETED it
 * BEFORE tokenisation, so a dotted person name was neither redacted nor denied —
 * it leaked verbatim into the public F7 body, defeating the fail-closed contract.
 * A token is now stripped only when it is a genuine URL: it carries a scheme
 * (`://`), a `www.` prefix, or ends in a recognised TLD. A bare `first.last`
 * therefore survives to the tokenizer and is detected as a person name.
 *
 * This is a small, explicit, code-reviewed constant (not model output), so it is
 * safe to trust for the narrow purpose of URL recognition.
 */
export const URL_TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'info', 'biz',
  'ng', 'uk', 'us', 'za', 'gh', 'ke', 'ca', 'au', 'de', 'fr', 'eu', 'af', 'me',
  'tv', 'xyz', 'online', 'site', 'app', 'dev', 'news', 'press', 'media',
];
