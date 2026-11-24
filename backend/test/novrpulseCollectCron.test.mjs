import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Focused tests for the daily collection cron endpoint
 * (`POST /api/pulse/collect/run`).
 *
 * The endpoint's single decision point is `isPulseCollectAuthorized` plus the
 * `runPulseCollection` controller. These tests:
 *   - pin the guard's fail-closed behaviour (no secret / wrong secret → 401);
 *   - prove the correct bearer secret authorizes AND that the controller then
 *     calls `runCollection` (injected via the controller's `req._runCollection`
 *     test seam, so no network/DB runs);
 *   - prove an ADMIN session authorizes and a non-admin does not;
 *   - pin the `maxAgeDays` body validation;
 *   - confirm the route is mounted OUTSIDE `requireAuth`.
 *
 * No live database: the `user` delegate is shadowed for the ADMIN-session path
 * (the same shadow-prisma pattern as novrpulsePulseApi.test.mjs).
 */

const SECRET = 'test-collect-cron-secret-do-not-use-in-prod';

const { prisma } = await import('../src/utils/prisma.js');
const config = (await import('../src/config/env.js')).default;
const { isPulseCollectAuthorized, runPulseCollection, collectSchema } = await import(
  '../src/controllers/pulseController.js'
);

function withSecret(secret, fn) {
  const prev = config.novrpulse.collection.cronSecret;
  config.novrpulse.collection.cronSecret = secret;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.novrpulse.collection.cronSecret = prev;
    });
}

function fakeRes() {
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
  return res;
}

/**
 * Build a request. `runner` is the injectable collection seam; it records each
 * call so tests can assert the controller invoked it exactly once with the
 * right options.
 */
function makeReq({ authorization, body, user, calls } = {}) {
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  const req = {
    headers,
    body,
    get: (h) => headers[h.toLowerCase()],
    user,
  };
  if (calls) {
    req._runCollection = async (opts) => {
      calls.push(opts);
      return { path: 'in-app', stored: 7, skipped: 1, events: 7 };
    };
  }
  return req;
}

async function withUser(record, fn) {
  const had = Object.prototype.hasOwnProperty.call(prisma, 'user');
  Object.defineProperty(prisma, 'user', {
    value: { findUnique: async () => record },
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (!had) delete prisma.user;
  }
}

after(() => {
  delete prisma.user;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Guard predicate — fail-closed.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse collect: guard predicate (fail-closed)', () => {
  test('no secret configured and no session → not authorized', async () => {
    await withSecret('', async () => {
      assert.equal(isPulseCollectAuthorized(makeReq()), false);
    });
  });

  test('no Authorization header → not authorized', async () => {
    await withSecret(SECRET, async () => {
      assert.equal(isPulseCollectAuthorized(makeReq()), false);
    });
  });

  test('a wrong bearer secret → not authorized (and never a match)', async () => {
    await withSecret(SECRET, async () => {
      assert.equal(isPulseCollectAuthorized(makeReq({ authorization: 'Bearer wrong-secret' })), false);
      // Same length, different bytes → still false (constant-time compare).
      assert.equal(
        isPulseCollectAuthorized(makeReq({ authorization: `Bearer ${SECRET.slice(0, -1)}X` })),
        false,
      );
    });
  });

  test('the correct bearer secret → authorized', async () => {
    await withSecret(SECRET, async () => {
      assert.equal(isPulseCollectAuthorized(makeReq({ authorization: `Bearer ${SECRET}` })), true);
    });
  });

  test('an ADMIN session authorizes; a non-admin does not', async () => {
    await withSecret('', async () => {
      assert.equal(isPulseCollectAuthorized(makeReq({ user: { role: 'ADMIN' } })), true);
      assert.equal(isPulseCollectAuthorized(makeReq({ user: { role: 'VIEWER' } })), false);
      assert.equal(isPulseCollectAuthorized(makeReq({ user: { role: 'SENDER' } })), false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Controller — 401 without a valid secret/session; 200 with the secret.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse collect: controller auth and run', () => {
  test('no secret and no session → 401 with no run', async () => {
    const calls = [];
    await withSecret('', async () => {
      await assert.rejects(() => runPulseCollection(makeReq({ calls }), fakeRes()), (err) => {
        assert.equal(err.statusCode, 401);
        return true;
      });
      assert.equal(calls.length, 0, 'no run must start when unauthorized');
    });
  });

  test('wrong bearer secret → 401 with no run', async () => {
    const calls = [];
    await withSecret(SECRET, async () => {
      await assert.rejects(
        () => runPulseCollection(makeReq({ authorization: 'Bearer nope', calls }), fakeRes()),
        (err) => {
          assert.equal(err.statusCode, 401);
          return true;
        },
      );
      assert.equal(calls.length, 0);
    });
  });

  test('the correct bearer secret → 200 and runCollection is called once', async () => {
    const calls = [];
    await withSecret(SECRET, async () => {
      const res = fakeRes();
      await runPulseCollection(
        makeReq({ authorization: `Bearer ${SECRET}`, body: {}, calls }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.path, 'in-app');
      assert.equal(res.payload.stored, 7);
      assert.equal(calls.length, 1, 'runCollection must be called exactly once');
      // Default maxAgeDays is applied by the schema.
      assert.equal(calls[0].maxAgeDays, 3);
    });
  });

  test('an ADMIN session (a valid JWT) → 200 and runCollection runs', async () => {
    const calls = [];
    const jwt = (await import('jsonwebtoken')).default;
    await withSecret('', async () => {
      await withUser({ id: 'u1', email: 'a@b.c', name: 'Admin', role: 'ADMIN' }, async () => {
        const token = jwt.sign({ sub: 'u1' }, config.jwt.secret, { algorithm: 'HS256' });
        const res = fakeRes();
        await runPulseCollection(
          makeReq({ authorization: `Bearer ${token}`, body: {}, calls }),
          res,
        );
        assert.equal(res.statusCode, 200);
        assert.equal(calls.length, 1);
      });
    });
  });

  test('a non-admin session (valid JWT, VIEWER) → 401 with no run', async () => {
    const calls = [];
    const jwt = (await import('jsonwebtoken')).default;
    await withSecret('', async () => {
      await withUser({ id: 'u2', email: 'v@b.c', name: 'Viewer', role: 'VIEWER' }, async () => {
        const token = jwt.sign({ sub: 'u2' }, config.jwt.secret, { algorithm: 'HS256' });
        await assert.rejects(
          () => runPulseCollection(makeReq({ authorization: `Bearer ${token}`, body: {}, calls }), fakeRes()),
          (err) => {
            assert.equal(err.statusCode, 401);
            return true;
          },
        );
        assert.equal(calls.length, 0);
      });
    });
  });

  test('a maxAgeDays override is passed through to runCollection', async () => {
    const calls = [];
    await withSecret(SECRET, async () => {
      await runPulseCollection(
        makeReq({ authorization: `Bearer ${SECRET}`, body: { maxAgeDays: 7 }, calls }),
        fakeRes(),
      );
      assert.equal(calls.at(-1).maxAgeDays, 7);
    });
  });

  test('an invalid maxAgeDays is rejected with 400 before any run', async () => {
    const calls = [];
    await withSecret(SECRET, async () => {
      await assert.rejects(
        () =>
          runPulseCollection(
            makeReq({ authorization: `Bearer ${SECRET}`, body: { maxAgeDays: 0 }, calls }),
            fakeRes(),
          ),
        (err) => {
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
      assert.equal(calls.length, 0, 'no run must start on invalid input');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Body schema — defaults and bounds.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse collect: body schema', () => {
  test('defaults maxAgeDays to 3 and accepts the 1–30 range', () => {
    assert.equal(collectSchema.validate({}).value.maxAgeDays, 3);
    assert.equal(collectSchema.validate({ maxAgeDays: 1 }).error, undefined);
    assert.equal(collectSchema.validate({ maxAgeDays: 30 }).error, undefined);
    assert.equal(collectSchema.validate({ maxAgeDays: undefined }).value.maxAgeDays, 3);
  });

  test('rejects out-of-range and non-integer maxAgeDays', () => {
    assert.notEqual(collectSchema.validate({ maxAgeDays: 0 }).error, undefined);
    assert.notEqual(collectSchema.validate({ maxAgeDays: 31 }).error, undefined);
    assert.notEqual(collectSchema.validate({ maxAgeDays: 2.5 }).error, undefined);
    assert.notEqual(collectSchema.validate({ maxAgeDays: 'soon' }).error, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Route wiring — mounted OUTSIDE requireAuth (a cron has no session).
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse collect: route wiring', () => {
  test('the collect router is mounted before the requireAuth-guarded /pulse mount', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/index.js', import.meta.url));
    const text = await readFile(path, 'utf8');

    const collectAt = text.indexOf("router.use('/pulse/collect', pulseCollectRoutes)");
    const guardedAt = text.indexOf("router.use('/pulse', requireAuth, pulseRoutes)");
    assert.ok(collectAt >= 0, 'collect router must be mounted');
    assert.ok(guardedAt >= 0, 'guarded pulse router must be mounted');
    assert.ok(
      collectAt < guardedAt,
      'the cron-guarded collect mount must precede the requireAuth /pulse mount',
    );
    assert.ok(
      !/router\.use\('\/pulse\/collect',\s*requireAuth/.test(text),
      'collect must NOT be behind requireAuth (a cron has no session)',
    );
  });

  test('the collect router registers POST /run with the controller', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/pulseCollectRoutes.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.post\('\/run',\s*asyncHandler\(pulseController\.runPulseCollection\)\);/,
      'POST /run must be registered with the guarded controller',
    );
  });

  test('vercel.json schedules the collection cron at 05:00 UTC', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../vercel.json', import.meta.url));
    const json = JSON.parse(await readFile(path, 'utf8'));
    const entry = (json.crons ?? []).find((c) => c.path === '/api/pulse/collect/run');
    assert.ok(entry, 'the /api/pulse/collect/run cron entry must exist');
    assert.equal(entry.schedule, '0 5 * * *');
    // The existing drive cron must be untouched.
    assert.ok(
      (json.crons ?? []).find(
        (c) => c.path === '/api/drive/maintenance' && c.schedule === '0 3 * * *',
      ),
      'the 3 AM drive cron must remain',
    );
  });
});
