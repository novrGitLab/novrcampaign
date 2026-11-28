import { BadRequest } from '../utils/AppError.js';

export const publicOrigin = (process.env.PUBLIC_SITE_URL || 'https://pulse.cybernovr.com').replace(/\/$/, '');
const uploadPath = /^\/api\/media\/files\/[a-f0-9]{64}\.webp$/;
export function mediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, publicOrigin);
    if (url.username || url.password) return null;
    if (url.origin === publicOrigin && uploadPath.test(url.pathname) && !url.search && !url.hash)
      return url.href;
    return url.origin === 'https://images.pexels.com' ? url.href : null;
  } catch {
    return null;
  }
}
export function normalizePhotos(input) {
  if (!Array.isArray(input) || input.length > 12) throw BadRequest('Choose up to 12 photographs per story.');
  const urls = new Set();
  return input.map((photo) => {
    const url = mediaUrl(photo?.url);
    if (!url || urls.has(url)) throw BadRequest('Choose distinct photographs from uploads or Pexels.');
    urls.add(url);
    const alt = typeof photo.alt === 'string' ? photo.alt.trim() : '';
    const credit = photo.credit ?? '';
    if (!alt || alt.length > 250 || typeof credit !== 'string' || credit.length > 160)
      throw BadRequest(
        'Each photograph needs a description of up to 250 characters and a credit of up to 160.',
      );
    const page = photo.page;
    if (
      page !== undefined &&
      page !== null &&
      (typeof page !== 'string' ||
        page.length > 1024 ||
        !/^https:\/\/www\.pexels\.com\/photo\/[\w-]+\/?$/.test(page))
    )
      throw BadRequest('Choose a valid Pexels photo credit link.');
    return { url, alt, credit: credit.trim() || null, ...(page && { page }) };
  });
}

export function displayPhotos(link) {
  const raw =
    link.photos ??
    (link.imageAlt && link.imageUrl
      ? [{ url: link.imageUrl, alt: link.imageAlt, credit: link.imageCredit }]
      : []);
  return raw.flatMap((photo) => {
    try {
      return normalizePhotos([photo]);
    } catch {
      return [];
    }
  });
}

export function leadColumns(photos) {
  const lead = photos[0];
  return {
    photos,
    imageUrl: lead?.url ?? null,
    imageAlt: lead?.alt ?? null,
    imageCredit: lead?.credit ?? null,
  };
}

// Lock editable editions before changing the pictures their editors signed off on.
// A sending or published edition keeps the images captured in its section items.
export async function syncEditionPhotos(tx, target, photos) {
  const links = await tx.briefingSectionItem.findMany({
    where: { publishItem: target, section: { briefing: { publishedAt: null, sendingAt: null } } },
    select: { id: true, section: { select: { id: true, briefingId: true } } },
  });
  const ids = [...new Set(links.map((link) => link.section.briefingId))].sort();
  for (const id of ids) {
    const open =
      await tx.$queryRaw`SELECT id FROM "briefing" WHERE id = ${id} AND "publishedAt" IS NULL AND "sendingAt" IS NULL FOR UPDATE`;
    if (!open.length) continue;
    const selected = links.filter((link) => link.section.briefingId === id);
    await tx.briefingSectionItem.updateMany({
      where: { id: { in: selected.map((link) => link.id) } },
      data: leadColumns(photos),
    });
    await tx.briefingSection.updateMany({
      where: { id: { in: selected.map((link) => link.section.id) } },
      data: { state: 'awaiting' },
    });
  }
}
