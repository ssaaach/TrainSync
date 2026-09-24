// v3 Phase A: CSRF, login throttling/lockout, input limits, health probes,
// cron auth, absolute session timeout, shared rate-limit store, DB retry.
const request = require('supertest');
const app = require('../../app');
const db = require('../../config/db');
const config = require('../../config');
const { store } = require('../../config/session');
const { client, resetRateLimits } = require('../setup/client');
const { MySqlRateLimitStore } = require('../../services/rateLimitStore');

const DOMAIN = '@backbone.trainsync.test';
const PASSWORD = 'backbone-pass-1';

async function cleanup() {
  await resetRateLimits(db);
  await db.execute('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
}

beforeAll(async () => {
  await cleanup();
  await client(app).post('/api/auth/register', {
    email: `lock${DOMAIN}`, name: 'Lock', role: 'trainee', password: PASSWORD, confirmPassword: PASSWORD,
  });
  await client(app).post('/api/auth/register', {
    email: `other${DOMAIN}`, name: 'Other', role: 'trainer', password: PASSWORD, confirmPassword: PASSWORD,
  });
});
afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

describe('CSRF', () => {
  test('state-changing requests without a valid token are rejected with 403', async () => {
    const agent = request.agent(app);
    const none = await agent.post('/api/auth/login').send({ email: `other${DOMAIN}`, password: PASSWORD });
    expect(none.status).toBe(403);
    expect(none.body.code).toBe('csrf_invalid');
    await agent.get('/api/auth/csrf');
    const wrong = await agent.post('/api/auth/login').set('x-csrf-token', 'x'.repeat(64))
      .send({ email: `other${DOMAIN}`, password: PASSWORD });
    expect(wrong.status).toBe(403);
  });

  test('a token from one session does not work in another', async () => {
    const a = client(app);
    const token = await a.csrf();
    const b = request.agent(app);
    await b.get('/api/auth/csrf');
    const res = await b.post('/api/auth/login').set('x-csrf-token', token).send({ email: `other${DOMAIN}`, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  test('login rotates the token; the pre-login token stops working', async () => {
    const api = client(app);
    const before = await api.csrf();
    const res = await api.post('/api/auth/login', { email: `other${DOMAIN}`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.csrfToken).not.toBe(before);
    const stale = await api.agent.patch('/api/profile').set('x-csrf-token', before).send({ location: 'X' });
    expect(stale.status).toBe(403);
    expect((await api.patch('/api/profile', { location: 'HSR' })).status).toBe(200);
  });

  test('GET requests need no token', async () => {
    expect((await request(app).get('/api/auth/session')).status).toBe(200);
  });
});

describe('login throttling and lockout', () => {
  const [tier] = config.auth.rateLimit.loginFailures.account;

  test(`locks an account after ${tier.max} failures, even for the right password`, async () => {
    const api = client(app);
    for (let i = 0; i < tier.max; i++) {
      const res = await api.post('/api/auth/login', { email: `lock${DOMAIN}`, password: 'wrong-password' });
      expect(res.status).toBe(400);
    }
    const locked = await api.post('/api/auth/login', { email: `lock${DOMAIN}`, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('account_locked');
    expect(locked.body.error).toMatch(/Try again in \d+ minutes?/);
  });

  test('the lockout is per account: other accounts still log in', async () => {
    const res = await client(app).post('/api/auth/login', { email: `other${DOMAIN}`, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('unknown emails lock out the same way (no account enumeration)', async () => {
    const api = client(app);
    for (let i = 0; i < tier.max; i++) await api.post('/api/auth/login', { email: `ghost${DOMAIN}`, password: 'nope' });
    const res = await api.post('/api/auth/login', { email: `ghost${DOMAIN}`, password: 'nope' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('account_locked');
  });

  test('successful logins do not count toward the lockout', async () => {
    await resetRateLimits(db);
    const api = client(app);
    for (let i = 0; i < tier.max + 2; i++) {
      expect((await api.post('/api/auth/login', { email: `other${DOMAIN}`, password: PASSWORD })).status).toBe(200);
    }
  });

  test('unknown-email and wrong-password logins take comparable time', async () => {
    await resetRateLimits(db);
    const time = async email => {
      const api = client(app);
      await api.csrf();
      const t0 = process.hrtime.bigint();
      await api.post('/api/auth/login', { email, password: 'wrong-password' });
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    await time(`warmup${DOMAIN}`);
    const known = await time(`other${DOMAIN}`);
    const unknown = await time(`nobody${DOMAIN}`);
    // Both pay one bcrypt compare (~50 ms at cost 10); without the dummy
    // compare the unknown path would be a few ms.
    expect(unknown).toBeGreaterThan(known * 0.4);
    await resetRateLimits(db);
  });
});

describe('input limits', () => {
  test('an email over 100 characters is a 400, not a 500', async () => {
    const email = `${'a'.repeat(95)}${DOMAIN}`;
    const res = await client(app).post('/api/auth/register', { email, name: 'Long', role: 'trainee', password: PASSWORD, confirmPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 100/);
  });

  test('a password over 72 bytes is rejected instead of silently truncated', async () => {
    const password = 'é'.repeat(40); // 80 bytes in UTF-8
    const res = await client(app).post('/api/auth/register', { email: `long${DOMAIN}`, name: 'Long', role: 'trainee', password, confirmPassword: password });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/72 bytes/);
  });

  test('malformed JSON is a 400 with a code', async () => {
    const api = client(app);
    const token = await api.csrf();
    const res = await api.agent.post('/api/auth/login').set('x-csrf-token', token)
      .set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });
});

describe('sessions', () => {
  test('the session ends after the absolute lifetime even if it stays active', async () => {
    const api = client(app);
    await api.post('/api/auth/login', { email: `other${DOMAIN}`, password: PASSWORD });
    expect((await api.get('/api/auth/session')).body.loggedIn).toBe(true);
    // Age the stored session's login time past the absolute limit.
    const [rows] = await db.query('SELECT session_id, data FROM sessions');
    for (const r of rows) {
      const data = JSON.parse(r.data);
      if (data.user && data.user.email === `other${DOMAIN}`) {
        data.loginAt = Date.now() - config.session.absoluteTimeoutMs - 1000;
        await db.query('UPDATE sessions SET data = ? WHERE session_id = ?', [JSON.stringify(data), r.session_id]);
      }
    }
    expect((await api.get('/api/auth/session')).body.loggedIn).toBe(false);
  });

  test('the session cookie is httpOnly, SameSite=Lax and rolling', async () => {
    const api = client(app);
    const login = await api.post('/api/auth/login', { email: `other${DOMAIN}`, password: PASSWORD });
    expect(login.headers['set-cookie'].join(';')).toMatch(/trainsync\.sid=.*HttpOnly.*SameSite=Lax/i);
    const again = await api.get('/api/auth/session');
    expect((again.headers['set-cookie'] || []).join(';')).toMatch(/trainsync\.sid=/); // renewed
  });
});

describe('health probes', () => {
  test('/healthz is always 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('/readyz checks the DB and migrations', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.checks.db.ok).toBe(true);
    expect(res.body.checks.migrations).toEqual({ ok: true, pending: [] });
  });

  test('/readyz is 503 while draining', async () => {
    app.locals.shuttingDown = true;
    try {
      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
    } finally {
      app.locals.shuttingDown = false;
    }
  });

  test('every response carries a request id; a sane upstream id is kept', async () => {
    const res = await request(app).get('/api/auth/session').set('x-request-id', 'edge-abc.123');
    expect(res.headers['x-request-id']).toBe('edge-abc.123');
    const bad = await request(app).get('/api/nope').set('x-request-id', '<script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(bad.body.requestId).toBe(bad.headers['x-request-id']);
  });
});

describe('cron', () => {
  test('rejects calls without the bearer secret', async () => {
    expect((await request(app).get('/api/cron/daily')).status).toBe(401);
    expect((await request(app).get('/api/cron/daily').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });
});

describe('MySQL rate-limit store', () => {
  test('parallel increments are counted exactly once each', async () => {
    const s = new MySqlRateLimitStore({ prefix: 'jest:' });
    s.init({ windowMs: 60_000 });
    await s.resetKey('k');
    const results = await Promise.all(Array.from({ length: 40 }, () => s.increment('k')));
    expect(Math.max(...results.map(r => r.totalHits))).toBe(40);
    expect((await s.get('k')).totalHits).toBe(40);
    await s.decrement('k');
    expect((await s.get('k')).totalHits).toBe(39);
    await s.resetKey('k');
    expect(await s.get('k')).toBeUndefined();
  });

  test('an elapsed window restarts at 1', async () => {
    const s = new MySqlRateLimitStore({ prefix: 'jest:' });
    s.init({ windowMs: 50 });
    await s.resetKey('w');
    await s.increment('w');
    await s.increment('w');
    await new Promise(r => setTimeout(r, 80));
    expect((await s.increment('w')).totalHits).toBe(1);
    await s.resetKey('w');
  });
});

describe('DB retry', () => {
  test('read-only statements retry connection errors; writes do not', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      return 'ok';
    };
    await expect(db.withRetry(flaky, db.isConnectionError, { retries: 3, baseMs: 1, maxMs: 2 })).resolves.toBe('ok');
    expect(calls).toBe(3);

    calls = 0;
    const deadlocked = async () => {
      calls++;
      throw Object.assign(new Error('Deadlock'), { errno: 1213 });
    };
    await expect(db.withRetry(deadlocked, db.isConnectionError, { retries: 3, baseMs: 1, maxMs: 2 })).rejects.toThrow('Deadlock');
    expect(calls).toBe(1);
  });

  test('withTransaction retries a deadlocked transaction and commits once', async () => {
    let attempts = 0;
    const result = await db.withTransaction(async conn => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
      const [[row]] = await conn.query('SELECT 42 AS n');
      return row.n;
    });
    expect(result).toBe(42);
    expect(attempts).toBe(2);
  });
});
