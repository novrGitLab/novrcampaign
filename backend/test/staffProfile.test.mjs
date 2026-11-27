import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolveStaffProfile } from '../src/services/staffProfile.js';
import { prisma } from '../src/utils/prisma.js';
import { digest } from '../src/services/staffSession.js';
import { requireAuth } from '../src/middleware/auth.js';

test('verified staff are provisioned once and returning staff retain their assigned access', async t => {
  const id = randomUUID();
  const issuer = 'https://identity.example';
  const email = 'staff-' + id + '@cybernovr.com';
  const otherEmail = 'other-' + id + '@cybernovr.com';
  const identity = { sub: id, email, email_verified: true, name: 'News editor', role: 'ADMIN' };
  const prevRole = process.env.OIDC_DEFAULT_ROLE;
  const prevDomains = process.env.OIDC_ALLOWED_EMAIL_DOMAINS;
  process.env.OIDC_ALLOWED_EMAIL_DOMAINS = 'cybernovr.com';
  delete process.env.OIDC_DEFAULT_ROLE;
  t.after(async () => {
    if (prevRole === undefined) delete process.env.OIDC_DEFAULT_ROLE; else process.env.OIDC_DEFAULT_ROLE = prevRole;
    if (prevDomains === undefined) delete process.env.OIDC_ALLOWED_EMAIL_DOMAINS; else process.env.OIDC_ALLOWED_EMAIL_DOMAINS = prevDomains;
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await prisma.$disconnect();
  });
  for (const untrusted of [{ email_verified: false }, { email: 'person@outside.example' }, { email: 'person@cybernovr.com.other.example' }, { sub: '' }]) {
    await assert.rejects(resolveStaffProfile(issuer, { ...identity, ...untrusted }));
  }
  const [first, retry] = await Promise.all([resolveStaffProfile(issuer, identity), resolveStaffProfile(issuer, identity)]);
  assert.equal(first.id, retry.id);
  assert.equal(first.role, 'ADMIN');
  await prisma.user.update({ where: { id: first.id }, data: { role: 'VIEWER' } });
  const returning = await resolveStaffProfile(issuer, { ...identity, name: 'Updated name' });
  assert.equal(returning.role, 'VIEWER');
  assert.equal(returning.name, 'Updated name');
  await assert.rejects(resolveStaffProfile(issuer, { ...identity, sub: 'another-subject' }));
  const token = randomUUID();
  await prisma.staffSession.create({ data: { userId: first.id, hash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
  async function authorize(method) { let rejection; await requireAuth({ cookies: { pulse_staff: token }, method }, {}, e => { rejection = e; }); return rejection; }
  assert.equal(await authorize('GET'), undefined);
  assert.equal((await authorize('POST')).statusCode, 403);
  const legacy = await prisma.user.create({ data: { email: otherEmail.toUpperCase(), role: 'SENDER' } });
  const linked = await resolveStaffProfile(issuer, { ...identity, sub: 'legacy-' + id, email: otherEmail });
  assert.equal(linked.id, legacy.id);
  assert.equal(linked.role, 'SENDER');
  await assert.rejects(resolveStaffProfile(issuer, { ...identity, email: otherEmail }));
});

