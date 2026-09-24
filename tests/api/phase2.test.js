// Phase 2 acceptance on the disposable test DB: spatial index use, distance
// agreement, purge semantics, new match constraints.
const db = require('../../config/db');
const { store } = require('../../config/session');
const geo = require('../../services/geo');
const { purgeAll } = require('../../scripts/seed/purge');

const CENTER = { lat: 12.9716, lng: 77.6412 };
const SYN = '@synthetic.trainsync.test';

async function cleanup() {
  await db.query("DELETE FROM users WHERE email LIKE '%@phase2.trainsync.test' OR email LIKE ?", [`%${SYN}`]);
  await db.query("DELETE FROM gyms WHERE name LIKE 'P2 %'");
}

beforeAll(async () => {
  await cleanup();
  // 3,000 synthetic gyms spread over Bengaluru + 2 manual ones, so the optimiser has a reason to use the index.
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    rows.push([`P2 synthetic ${i}`, 'Bengaluru', 12.83 + ((i * 7919) % 3000) / 3000 * 0.31, 77.45 + ((i * 104729) % 3000) / 3000 * 0.33, 'synthetic', 1]);
  }
  rows.push(['P2 manual near', 'Bengaluru', 12.9720, 77.6420, 'manual', 0]);
  rows.push(['P2 manual far', 'Mumbai', 19.07, 72.87, 'manual', 0]);
  await db.query('INSERT INTO gyms (name, city, lat, lng, source, is_synthetic) VALUES ?', [rows]);
  await db.query('ANALYZE TABLE gyms');
});

afterAll(async () => {
  await cleanup();
  await store.close();
  await db.end();
});

function gymRadiusSql(radiusKm) {
  const q = geo.radiusQuery('g', CENTER.lat, CENTER.lng, radiusKm);
  return {
    sql: `SELECT g.gym_id, g.name, g.lat, g.lng, ${q.distance} AS km FROM gyms g WHERE ${q.where} ORDER BY km`,
    params: [...q.distanceParams, ...q.whereParams],
  };
}

describe('spatial radius queries', () => {
  test('EXPLAIN uses the spatial index (range scan on sp_gyms_geo)', async () => {
    const { sql, params } = gymRadiusSql(5);
    const [plan] = await db.query(`EXPLAIN ${sql}`, params);
    expect(plan[0]).toMatchObject({ type: 'range', key: 'sp_gyms_geo' });
  });

  test('returns exactly the gyms within the radius, sorted, matching JS haversine', async () => {
    const { sql, params } = gymRadiusSql(5);
    const [rows] = await db.query(sql, params);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.map(r => r.name)).toContain('P2 manual near');
    expect(rows.map(r => r.name)).not.toContain('P2 manual far');
    for (let i = 1; i < rows.length; i++) expect(rows[i].km).toBeGreaterThanOrEqual(rows[i - 1].km);
    for (const r of rows) {
      const js = geo.haversineKm(CENTER.lat, CENTER.lng, Number(r.lat), Number(r.lng));
      expect(Math.abs(js - r.km)).toBeLessThan(Math.max(0.002, js * 0.001)); // < 0.1 % apart
      expect(r.km).toBeLessThanOrEqual(5);
    }
    // Nothing inside the radius was missed by the bounding-box prefilter.
    const [all] = await db.query("SELECT lat, lng FROM gyms WHERE name LIKE 'P2 %' AND lat IS NOT NULL");
    const expected = all.filter(g => geo.haversineKm(CENTER.lat, CENTER.lng, Number(g.lat), Number(g.lng)) <= 4.99).length;
    expect(rows.length).toBeGreaterThanOrEqual(expected);
  });

  test('rows without coordinates never match (their geo is POINT(0 0))', async () => {
    await db.query("INSERT INTO gyms (name, city, source) VALUES ('P2 no coords', 'Bengaluru', 'manual')");
    const q = geo.radiusQuery('g', 0.0001, 0.0001, 50);
    const [rows] = await db.query(`SELECT g.name FROM gyms g WHERE ${q.where}`, q.whereParams);
    expect(rows.map(r => r.name)).not.toContain('P2 no coords');
  });
});

describe('purge:synthetic', () => {
  test('removes synthetic users with all dependent rows and synthetic gyms; keeps real rows', async () => {
    const mk = async (email, role, synthetic) => {
      const [r] = await db.query('INSERT INTO users (name, email, password, role, is_synthetic) VALUES (?, ?, ?, ?, ?)',
        ['P2', email, 'x', role, synthetic]);
      await db.query(`INSERT INTO ${role}s (user_id, lat, lng) VALUES (?, 12.97, 77.64)`, [r.insertId]);
      return r.insertId;
    };
    const synTrainee = await mk(`t${SYN}`, 'trainee', 1);
    const synTrainer = await mk(`c${SYN}`, 'trainer', 1);
    const realTrainee = await mk('real@phase2.trainsync.test', 'trainee', 0);
    await db.query("INSERT INTO body_assessments (user_id, method_version, inputs, outputs) VALUES (?, 'x', '{}', '{}'), (?, 'x', '{}', '{}')", [synTrainee, realTrainee]);
    await db.query("INSERT INTO synthetic_profiles (user_id, archetype, latent, generator_version) VALUES (?, 'a', '{}', 'v')", [synTrainee]);
    await db.query("INSERT INTO notifications (user_id, type) VALUES (?, 'x')", [synTrainer]);
    await db.query("INSERT INTO match_interactions (actor_user_id, target_user_id, action) VALUES (?, ?, 'like'), (?, ?, 'like')",
      [realTrainee, synTrainer, synTrainee, synTrainer]);
    const [[t]] = await db.query('SELECT trainee_id FROM trainees WHERE user_id = ?', [realTrainee]);
    const [[c]] = await db.query('SELECT trainer_id FROM trainers WHERE user_id = ?', [synTrainer]);
    await db.query("INSERT INTO matches (trainee_id, trainer_id, status) VALUES (?, ?, 'pending_trainer')", [t.trainee_id, c.trainer_id]);

    const conn = await db.getConnection();
    let removed;
    try { removed = await purgeAll(conn); } finally { conn.release(); }

    expect(removed.users).toBeGreaterThanOrEqual(2);
    expect(removed.gyms).toBeGreaterThanOrEqual(3000);
    const count = async (sql, p = []) => Number((await db.query(sql, p))[0][0].n);
    expect(await count('SELECT COUNT(*) n FROM users WHERE is_synthetic = 1')).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM users WHERE user_id = ?', [realTrainee])).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM trainees WHERE user_id = ?', [realTrainee])).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM body_assessments WHERE user_id = ?', [realTrainee])).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM body_assessments WHERE user_id = ?', [synTrainee])).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM synthetic_profiles')).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM match_interactions WHERE target_user_id = ?', [synTrainer])).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM matches WHERE trainee_id = ?', [t.trainee_id])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM gyms WHERE name LIKE 'P2 manual%'")).toBe(2);
    expect(await count('SELECT COUNT(*) n FROM gyms WHERE is_synthetic = 1')).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM trainees t LEFT JOIN users u USING (user_id) WHERE u.user_id IS NULL')).toBe(0);
  });
});

describe('matches schema (v2)', () => {
  test('new status values, default pending_trainer and one row per pair', async () => {
    const mk = async (email, role) => {
      const [r] = await db.query("INSERT INTO users (name, email, password, role) VALUES ('P2', ?, 'x', ?)", [email, role]);
      await db.query(`INSERT INTO ${role}s (user_id) VALUES (?)`, [r.insertId]);
      const [[row]] = await db.query(`SELECT ${role}_id id FROM ${role}s WHERE user_id = ?`, [r.insertId]);
      return row.id;
    };
    const traineeId = await mk('mt@phase2.trainsync.test', 'trainee');
    const trainerId = await mk('mc@phase2.trainsync.test', 'trainer');
    await db.query('INSERT INTO matches (trainee_id, trainer_id) VALUES (?, ?)', [traineeId, trainerId]);
    const [[m]] = await db.query('SELECT status FROM matches WHERE trainee_id = ?', [traineeId]);
    expect(m.status).toBe('pending_trainer');
    await expect(db.query('INSERT INTO matches (trainee_id, trainer_id) VALUES (?, ?)', [traineeId, trainerId]))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await expect(db.query("UPDATE matches SET status = 'accepted' WHERE trainee_id = ?", [traineeId]))
      .rejects.toMatchObject({ code: 'WARN_DATA_TRUNCATED' });
  });
});
