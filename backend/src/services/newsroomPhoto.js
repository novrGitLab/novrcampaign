export const publicOrigin = (process.env.PUBLIC_SITE_URL || 'https://pulse.cybernovr.com').replace(/\/$/, '');
export function mediaUrl(value) {
  if (typeof value !== 'string') return null;
  if (/^\/api\/media\/files\/[a-f0-9]{64}\.webp$/.test(value)) return publicOrigin + value;
  try {
    const url = new URL(value);
    return url.origin === 'https://images.pexels.com' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
