import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { resolveStaffLogin } from '../src/services/staffProfile.js';
import { deliverStaffNotices } from '../src/services/staffAccessMail.js';
import { setRequestCookie } from '../src/routes/staffAccessRoutes.js';
import { prisma } from '../src/utils/prisma.js';
import { digest } from '../src/services/staffSession.js';

test('first sign-in, request, administrator decision and transactional notifications', async (t) => {
  const id = randomUUID();
  const issuer = 'https://identity.example';
  const domain = 'cybernovr.com';
  const identity = { sub: id, email: id + '@' + domain, email_verified: true, name: '<Desk editor>' };
  const actorEmail = 'admin-' + identity.email;
  const legacyEmail = 'legacy-' + identity.email;
  const legacyIdentity = { ...identity, sub: 'legacy-' + id, email: legacyEmail };
  const origin = config.frontendUrl.split(',')[0].trim();
  const actor = await prisma.user.create({
    data: { email: actorEmail, role: 'ADMIN', oidcSubject: issuer + '#admin-' + id },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/api';
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.staffAccessRequest.deleteMany({ where: { email: { in: [identity.email, legacyEmail] } } });
    await prisma.user.deleteMany({ where: { email: { in: [identity.email, actorEmail, legacyEmail] } } });
    await prisma.$disconnect();
  });
  function http(path, cookie, body, requestOrigin = origin) {
    return fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  function applicantCookie(requestId) {
    let cookie;
    setRequestCookie(
      {
        cookie(name, value, options) {
          assert.equal(options.path, '/api/auth/access');
          assert.equal(options.httpOnly, true);
          cookie = name + '=' + value;
        },
      },
      requestId,
    );
    return cookie;
  }
  async function session(userId) {
    const token = randomUUID();
    await prisma.staffSession.create({
      data: { userId, hash: digest(token), expiresAt: new Date(Date.now() + 60000) },
    });
    return 'pulse_staff=' + token;
  }
  const adminCookie = await session(actor.id);
  for (const untrusted of [
    { email_verified: false },
    { email: 'person@other.example' },
    { email: 'person@cybernovr.com.other.example' },
    { sub: '' },
  ]) {
    await assert.rejects(resolveStaffLogin(issuer, { ...identity, ...untrusted }));
  }
  const [first, repeat] = await Promise.all([
    resolveStaffLogin(issuer, identity),
    resolveStaffLogin(issuer, identity),
  ]);
  assert.equal(first.request.status, 'NEW');
  assert.equal(first.request.id, repeat.request.id);
  const requestId = first.request.id;
  const cookie = applicantCookie(requestId);
  const notices = () => prisma.staffAccessNotice.findMany({ where: { requestId } });
  assert.deepEqual(
    (await notices()).map((n) => n.kind),
    ['WELCOME'],
  );
  assert.equal(await prisma.user.count({ where: { email: identity.email } }), 0);
  assert.equal((await http('/auth/me', cookie)).status, 401);
  assert.equal((await http('/staff-access', cookie)).status, 401);
  assert.equal((await http('/auth/access', cookie, {}, 'https://other.example')).status, 403);
  const submissions = await Promise.all([http('/auth/access', cookie, {}), http('/auth/access', cookie, {})]);
  for (const response of submissions) assert.equal((await response.json()).status, 'PENDING');
  const queued = await notices();
  assert.equal(queued.filter((n) => n.kind === 'REVIEW' && n.recipient === actorEmail).length, 1);
  assert.equal(queued.filter((n) => n.kind === 'RECEIVED' && n.recipient === identity.email).length, 1);
  assert.equal((await http('/auth/me', cookie)).status, 401);
  const review = '/staff-access/' + requestId + '/decision';
  assert.equal((await http(review, cookie, { action: 'approve', role: 'ADMIN' })).status, 401);
  assert.equal((await http(review, adminCookie, { action: 'approve', role: 'owner' })).status, 400);
  const decisions = await Promise.all([
    http(review, adminCookie, { action: 'approve', role: 'VIEWER' }),
    http(review, adminCookie, { action: 'approve', role: 'VIEWER' }),
  ]);
  assert.deepEqual(decisions.map((d) => d.status).sort(), [200, 409]);
  const saved = await prisma.staffAccessRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(saved.decidedBy, actor.id);
  assert.equal((await (await http('/auth/access', cookie)).json()).status, 'APPROVED');
  assert.equal((await http('/auth/me', cookie)).status, 401);
  const { user } = await resolveStaffLogin(issuer, { ...identity, role: 'ADMIN', name: 'Updated name' });
  assert.equal(user.role, 'VIEWER');
  assert.equal(user.name, 'Updated name');
  const viewerCookie = await session(user.id);
  assert.equal((await http('/staff-access', viewerCookie)).status, 403);
  assert.equal((await http(review, viewerCookie, { action: 'decline' })).status, 403);
  await assert.rejects(resolveStaffLogin(issuer, { ...identity, sub: 'other-' + id }));
  const delivered = new Map();
  const transport = async (email, content, key) => {
    assert.equal(delivered.has(key), false);
    delivered.set(key, { email, ...content });
  };
  await deliverStaffNotices(async () => {
    throw Error('Temporary mail outage');
  }, requestId);
  await prisma.staffAccessNotice.updateMany({ where: { requestId }, data: { availableAt: new Date() } });
  await Promise.all([deliverStaffNotices(transport, requestId), deliverStaffNotices(transport, requestId)]);
  assert.ok(
    [...delivered.values()].some(
      (m) => m.email === identity.email && m.subject.includes('granted') && m.body.includes('VIEWER'),
    ),
  );
  assert.ok(
    [...delivered.values()].some(
      (m) =>
        m.email === actorEmail && m.body.includes('&lt;Desk editor&gt;') && m.body.includes('/staff-access'),
    ),
  );
  assert.ok((await notices()).every((n) => n.sentAt && n.attempts === 2));
  const legacy = await prisma.user.create({ data: { email: legacyEmail, role: 'ADMIN' } });
  const legacyRequest = (await resolveStaffLogin(issuer, legacyIdentity)).request;
  assert.equal(legacyRequest.status, 'NEW');
  const legacyCookie = applicantCookie(legacyRequest.id);
  await http('/auth/access', legacyCookie, {});
  const legacyReview = '/staff-access/' + legacyRequest.id + '/decision';
  const legacySession = await session(legacy.id);
  assert.equal((await http(legacyReview, legacySession, { action: 'approve', role: 'ADMIN' })).status, 401);
  assert.equal((await http(legacyReview, adminCookie, { action: 'decline' })).status, 200);
  assert.equal((await resolveStaffLogin(issuer, legacyIdentity)).request.status, 'DECLINED');
  assert.equal((await http('/auth/me', legacyCookie)).status, 401);
  assert.equal(
    await prisma.staffAccessNotice.count({
      where: { requestId: legacyRequest.id, kind: 'DECLINED', recipient: legacyEmail },
    }),
    1,
  );
});
