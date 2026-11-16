// Derive sourceType/sourceName from a pasted URL — hostname only, no network.

const REGULATOR_HOSTS = [
  'ncc.gov.ng',
  'cbn.gov.ng',
  'nitda.gov.ng',
  'ndpc.gov.ng',
  'cert.gov.ng',
  'ngcert.gov.ng',
];

const isRegulatorHost = (host) =>
  host === 'gov.ng' ||
  host.endsWith('.gov.ng') ||
  REGULATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

// "www.some-news-site.com" -> "Some News Site"
function humanizeHost(host) {
  const bare = host.replace(/^www\./, '');
  const base = bare.split('.').slice(0, -1).join('.') || bare;
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @param {string} rawUrl
 * @returns {{ sourceType?: 'x'|'news'|'regulator'|'other', sourceName?: string } | null}
 */
export function prefillFromUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'x.com' || host === 'twitter.com') {
    return { sourceType: 'x', sourceName: 'X' };
  }
  if (isRegulatorHost(host)) {
    return { sourceType: 'regulator', sourceName: humanizeHost(host) };
  }
  return { sourceType: 'news', sourceName: humanizeHost(host) };
}
