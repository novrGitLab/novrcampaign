import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('concurrent requests send one confirmation and subscribe an existing contact after consent', async (t) => {
  const calls = [];
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, data: JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { id: 'fixture' } }));
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => new Promise(resolve => provider.close(resolve)));
  process.env.PLUNK_BASE_URL = 'http://127.0.0.1:' + provider.address().port;
  process.env.PLUNK_API_KEY = 'local-fixture';
  process.env.NP_PULSE_SEGMENT = 'daily';
  const { default: app } = await import('../src/app.js');
  const { prisma } = await import('../src/utils/prisma.js');
  const email = randomUUID() + '@example.test';
  t.after(async () => {
    await prisma.newsletterConfirmation.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });
  const origin = app.listen(0, '127.0.0.1');
  await once(origin, 'listening');
  t.after(() => new Promise(resolve => origin.close(resolve)));
  const send = (suffix, data) => fetch('http://127.0.0.1:' + origin.address().port + '/api/public/subscribe' + suffix, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const results = await Promise.all([send('', { email }), send('', { email })]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.deepEqual(calls.map(call => call.path), ['/v1/send']);
  assert.equal(calls[0].data.subscribed, undefined);
  const confirmation = calls[0].data.body.match(/subscribe\/confirm#([\w-]+)/)[1];
  assert.equal((await send('/confirm', { confirmation })).status, 200);
  assert.deepEqual(calls.slice(1), [
    { path: '/segments/daily/members', data: { emails: [email], createMissing: true, subscribed: false } },
    { path: '/contacts', data: { email, subscribed: true } },
  ]);
  assert.equal((await send('/confirm', { confirmation })).status, 400);
});

