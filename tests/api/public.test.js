// Public endpoints used by the landing page: /api/stats and /api/gyms/near.
const request = require('supertest');
const app = require('../../app');
const db = require('../../config/db');
const { store } = require('../../config/session');
const stats = require('../../routes/stats');

async function cleanup() {
  await db.query("DELETE FROM gyms WHERE name LIKE 'PUB %'");
  await db.query("DELETE FROM users WHERE email LIKE '%@public.trainsync.test'");
}

beforeAll(async () => {
  await cleanup();
  await db.query('INSERT INTO gyms (name, city, lat, lng, source, is_synthetic) VALUES ?', [[
    ['PUB near', 'Bangalore', 12.9720, 77.6420, 'manual', 0],
    ['PUB mid', 'Bengaluru', 12.9900, 77.6412, 'osm', 0],
    ['PUB far', 'Bengaluru', 13.1500, 77.6412, 'osm', 0],
    ['PUB synthetic', 'Bengaluru', 12.9716, 77.6413, 'synthetic', 1],
  ]]);
  await db.query('INSERT INTO users (email, name, role, password, is_synthetic) VALUES ?', [[
    ['real@public.trainsync.test', 'Real', 'trainer', 'x', 0],
    ['fake@public.trainsync.test', 'Fake', 'trainer', 'x', 1],
  ]]);
  stats.resetCache();
});
afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

test('/api/stats counts only real rows and merges city spellings', async () => {
  const res = await request(app).get('/api/stats');
  expect(res.status).toBe(200);
  const [[g]] = await db.query('SELECT COUNT(*) n FROM gyms WHERE is_synthetic = 0');
  const [[t]] = await db.query("SELECT COUNT(*) n FROM users WHERE is_synthetic = 0 AND role = 'trainer'");
  expect(res.body.gyms).toBe(g.n);
  expect(res.body.trainers).toBe(t.n);
  const [cities] = await db.query('SELECT DISTINCT city FROM gyms WHERE is_synthetic = 0');
  const raw = new Set(cities.map(c => c.city.toLowerCase()));
  // "Bangalore" and "Bengaluru" count once.
  expect(res.body.cities).toBe(raw.size - (raw.has('bangalore') && raw.has('bengaluru') ? 1 : 0));
  expect(res.headers['cache-control']).toMatch(/max-age=300/);
});

test('/api/gyms/near returns gyms inside the radius, nearest first, with map links', async () => {
  const res = await request(app).get('/api/gyms/near?lat=12.9716&lng=77.6412&radius_km=3');
  expect(res.status).toBe(200);
  const names = res.body.gyms.map(g => g.name).filter(n => n.startsWith('PUB'));
  expect(names).toEqual(['PUB synthetic', 'PUB near', 'PUB mid']); // 0.01, 0.09, 2.0 km; 'PUB far' is ~20 km
  const dists = res.body.gyms.map(g => g.distance_km);
  expect([...dists].sort((a, b) => a - b)).toEqual(dists);
  const near = res.body.gyms.find(g => g.name === 'PUB near');
  expect(near.distance_km).toBeLessThan(0.2);
  expect(near.links.directions).toBe('https://www.google.com/maps/dir/?api=1&destination=12.972000,77.642000');
  expect(near.links.google).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
});

test('/api/gyms/near validates its query', async () => {
  expect((await request(app).get('/api/gyms/near?lat=95&lng=77')).status).toBe(400);
  expect((await request(app).get('/api/gyms/near?lat=12&lng=77&radius_km=100')).status).toBe(400);
  expect((await request(app).get('/api/gyms/near?lng=77')).status).toBe(400);
});

test('/api/gyms/:city matches spelling variants', async () => {
  const a = await request(app).get('/api/gyms/bangalore');
  const b = await request(app).get('/api/gyms/Bengaluru');
  expect(a.body.map(g => g.gym_id).sort()).toEqual(b.body.map(g => g.gym_id).sort());
  expect(a.body.some(g => g.name === 'PUB near')).toBe(true);
});
