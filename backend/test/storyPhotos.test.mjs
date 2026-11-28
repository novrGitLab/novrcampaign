import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhotos, displayPhotos, publicOrigin } from '../src/services/newsroomPhoto.js';
import { confirmationEmail } from '../src/services/confirmationEmail.js';
const path = '/api/media/files/' + 'a'.repeat(64) + '.webp';
const photo = { url: path, alt: 'Fibre optic cables', credit: 'Newsroom' };
test('stored, legacy and uploaded photographs resolve to email-safe absolute URLs', () => {
  const stored = normalizePhotos([photo]);
  assert.equal(stored[0].url, publicOrigin + path);
  assert.deepEqual(normalizePhotos(stored), stored);
  assert.deepEqual(displayPhotos({ imageUrl: path, imageAlt: photo.alt, imageCredit: photo.credit }), stored);
  assert.deepEqual(displayPhotos({ photos: [], imageUrl: path, imageAlt: 'Former cover' }), []);
  for (const invalid of [
    [photo, photo],
    [{ ...photo, alt: '' }],
    [{ ...photo, url: 'https://example.org/photo.png' }],
    [{ ...photo, page: 'javascript:alert(1)' }],
    Array(13).fill(photo),
  ]) {
    assert.throws(() => normalizePhotos(invalid), { statusCode: 400 });
  }
});
test('confirmation email includes the confirmation action, publication credit and mascot with remote images disabled', () => {
  const html = confirmationEmail(publicOrigin + '/subscribe/confirm#fixture');
  assert.ok(html.includes('href="' + publicOrigin + '/subscribe/confirm#fixture"'));
  assert.match(html, /Confirm email address/);
  assert.match(html, /alt="NovrPulse kingfisher"/);
  assert.match(html, /https:\/\/cybernovr\.com/);
  assert.match(html, /24 hours/);
});
