// Phase 1 acceptance: register → login → session → update profile → logout for
// both roles, plan lookup normalisation, gyms, migrations. (The legacy /auth/*
// aliases were removed in v3 Phase A.)
const request = require('supertest');
const { client, resetRateLimits } = require('../setup/client');
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const { migrate } = require('../../scripts/migrate');

const DOMAIN = '@jest.trainsync.test';
const PASSWORD = 'correct-horse-9';

async function cleanup() {
  await resetRateLimits(db);
  await db.execute('DELETE FROM users WHERE email LIKE ?', [`%${DOMAIN}`]);
  await db.execute("DELETE FROM workouts WHERE title LIKE 'JEST %'");
  await db.execute("DELETE FROM gyms WHERE name LIKE 'JEST %'");
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

function register(api, role, overrides = {}) {
  return api.post('/api/auth/register', {
    email: `${role}${DOMAIN}`, name: `Jest ${role}`, role, password: PASSWORD, confirmPassword: PASSWORD, ...overrides,
  });
}

describe.each(['trainee', 'trainer'])('%s account lifecycle', role => {
  const agent = client(app);

  test('registers (role is case/whitespace-insensitive) and creates the role row', async () => {
    const res = await register(agent, role, { role: `  ${role.toUpperCase()} ` });
    expect(res.status).toBe(201);
    const [[user]] = await db.execute('SELECT user_id, role FROM users WHERE email = ?', [`${role}${DOMAIN}`]);
    expect(user.role).toBe(role);
    const [rows] = await db.execute(`SELECT location FROM ${role}s WHERE user_id = ?`, [user.user_id]);
    expect(rows).toHaveLength(1);
  });

  test('rejects duplicate email', async () => {
    const res = await register(agent, role);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/);
  });

  test('logs in and stores user_id/email/role/name in the session', async () => {
    const res = await agent.post('/api/auth/login', { email: `${role}${DOMAIN}`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/trainsync\.sid=.*HttpOnly.*SameSite=Lax/i);
    const session = await agent.get('/api/auth/session');
    expect(session.body).toMatchObject({ loggedIn: true, email: `${role}${DOMAIN}`, role, name: `Jest ${role}` });
    expect(session.body.user_id).toEqual(expect.any(Number));
  });

  test('updates the role-specific profile', async () => {
    const body = role === 'trainee'
      ? { name: 'Jest Renamed', age: '29', gender: 'Female', goal: 'lose 4 kg', location: 'Indiranagar' }
      : { name: 'Jest Renamed', experience: '6', certification: 'ACE CPT', specialization: 'strength', location: 'HSR' };
    const res = await agent.patch('/api/profile', body);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jest Renamed');
    if (role === 'trainee') {
      expect(res.body.profile).toMatchObject({ age: 29, gender: 'female', fitness_goal: 'lose 4 kg', location: 'Indiranagar' });
    } else {
      expect(res.body.profile).toMatchObject({ experience: 6, certification: 'ACE CPT', specialization: 'strength', location: 'HSR' });
    }
    const session = await agent.get('/api/auth/session');
    expect(session.body.name).toBe('Jest Renamed');
  });

  test('profile update validates input', async () => {
    const ok = await agent.patch('/api/profile', { location: 'Koramangala' });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.location).toBe('Koramangala');
    const bad = await agent.patch('/api/profile', role === 'trainee' ? { age: 'abc' } : { experience: -3 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation');
  });

  test('logs out via POST, clears the cookie and ends the session', async () => {
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/trainsync\.sid=;/);
    const session = await agent.get('/api/auth/session');
    expect(session.body).toEqual({ loggedIn: false });
    expect((await agent.get('/api/profile')).status).toBe(401);
  });
});

describe('auth validation', () => {
  test('rejects an invalid role', async () => {
    const res = await register(client(app), 'coach', { email: `coach${DOMAIN}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trainer.*trainee/);
  });

  test('rejects mismatched passwords', async () => {
    const res = await register(client(app), 'trainee', { email: `mismatch${DOMAIN}`, confirmPassword: 'nope-nope-nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Passwords do not match');
  });

  test('unknown email and wrong password give the same error', async () => {
    const a = await client(app).post('/api/auth/login', { email: `nobody${DOMAIN}`, password: 'x' });
    const b = await client(app).post('/api/auth/login', { email: `trainee${DOMAIN}`, password: 'wrong' });
    expect(a.status).toBe(400);
    expect(a.body.error).toBe(b.body.error);
  });

  test('legacy /auth/* aliases and GET logout are gone', async () => {
    const agent = client(app);
    expect((await agent.post('/api/auth/login', { email: `trainer${DOMAIN}`, password: PASSWORD })).status).toBe(200);
    expect((await agent.get('/auth/session')).status).toBe(404);
    expect((await agent.get('/api/auth/logout')).status).toBe(404);
    expect((await agent.get('/api/auth/session')).body.loggedIn).toBe(true);
  });

  test('/home serves the dashboard only when logged in', async () => {
    const anon = await request(app).get('/home');
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe('/login.html');
    const agent = client(app);
    await agent.post('/api/auth/login', { email: `trainee${DOMAIN}`, password: PASSWORD });
    const res = await agent.get('/home');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Sore Today/);
  });
});

describe('curated plans and gyms', () => {
  beforeAll(async () => {
    await db.execute(
      "INSERT INTO workouts (title, body_type, goal, monday) VALUES ('JEST lean bulk', 'mesomorph', 'lean-bulk', 'Squat\\\\nBench')"
    );
    await db.execute(
      "INSERT INTO gyms (name, address, city) VALUES ('JEST Iron Temple', 'https://maps.example/iron', 'Bangalore')"
    );
  });

  test.each([
    ['mesomorph', 'lean bulk'],
    ['Mesomorph', 'Lean-Bulk'],
    ['meso', ' lean   bulk '],
  ])('normalises %s / %s', async (bodyType, goal) => {
    const res = await request(app).get(`/api/workouts/${encodeURIComponent(bodyType)}/${encodeURIComponent(goal)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('description');
  });

  test('"maintainance" typo maps to maintenance; unknown goal is a 400', async () => {
    const typo = await request(app).get('/api/diets/ectomorph/maintainance');
    expect([200, 404]).toContain(typo.status); // 404 only when no curated row exists
    const bad = await request(app).get('/api/diets/ectomorph/shred');
    expect(bad.status).toBe(400);
  });

  test('gyms: case-insensitive, Bengaluru/Bangalore alias, maps_url fallback', async () => {
    const res = await request(app).get('/api/gyms/BENGALURU');
    expect(res.status).toBe(200);
    const gym = res.body.find(g => g.name === 'JEST Iron Temple');
    expect(gym).toMatchObject({ maps_url: 'https://maps.example/iron' });
    expect((await request(app).get('/api/gyms/bangalore')).body.some(g => g.name === 'JEST Iron Temple')).toBe(true);
  });
});

describe('security headers and API 404', () => {
  test('helmet CSP is set and inline scripts are not allowed', async () => {
    const res = await request(app).get('/homepage.html');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self'/);
    expect(res.headers['content-security-policy']).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test('unknown API routes return JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Not found', code: 'not_found' });
  });
});

describe('migrations', () => {
  test('re-running is a no-op, and each file is idempotent when forced to re-apply', async () => {
    const log = () => {};
    expect(await migrate({ database: process.env.DB_NAME, log })).toBe(0);
    await db.execute('DELETE FROM schema_migrations');
    await expect(migrate({ database: process.env.DB_NAME, log })).resolves.toBeGreaterThan(0);
    expect(await migrate({ database: process.env.DB_NAME, log })).toBe(0);
  });
});
