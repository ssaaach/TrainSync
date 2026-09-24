// Creates and migrates the disposable test database before any test runs,
// clears shared rate-limit counters left by earlier runs, and loads the
// exercise library snapshot if the test DB has none.
// Shared by Jest (globalSetup) and Playwright (globalSetup).
module.exports = async function globalSetup() {
  require('./env');
  const { migrate } = require('../../scripts/migrate');
  await migrate({ database: process.env.DB_NAME, log: () => {} });
  const mysql = require('mysql2/promise');
  const config = require('../../config');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: process.env.DB_NAME,
  });
  await conn.query('DELETE FROM rate_limit_hits');

  // Plans need the exercise library: the committed free-exercise-db snapshot.
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM exercises');
  if (n === 0) {
    const { exercises } = require('../fixtures/exercises.json');
    const j = v => (v == null ? null : JSON.stringify(v));
    await conn.query(
      `INSERT INTO exercises (exercise_id, ext_id, name, force_type, level, mechanic, equipment, category, primary_muscles,
         secondary_muscles, instructions, images, movement_pattern, is_compound, source, is_synthetic) VALUES ?`,
      [exercises.map(e => [e.exercise_id, e.ext_id, e.name, e.force_type, e.level, e.mechanic, e.equipment, e.category,
        j(e.primary_muscles), j(e.secondary_muscles), j(e.instructions), j(e.images), e.movement_pattern, e.is_compound,
        'free-exercise-db', 0])]
    );
  }
  const [[{ nd }]] = await conn.query('SELECT COUNT(*) AS nd FROM dishes');
  if (nd === 0) {
    const nut = require('../fixtures/nutrition.json');
    const ins = async (table, rows) => {
      if (!rows.length) return;
      const cols = Object.keys(rows[0]);
      const val = v => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
      await conn.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ?`, [rows.map(r => cols.map(c => val(r[c])))]);
    };
    await ins('foods', nut.foods);
    await ins('dishes', nut.dishes);
    await ins('dish_ingredients', nut.dish_ingredients);
  }
  await conn.end();
};
