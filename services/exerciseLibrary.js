// In-process cache of the exercise library (read-mostly reference data).
const db = require('../config/db');

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, rows: null, byId: null };

async function load() {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache;
  const [rows] = await db.query(
    `SELECT exercise_id, ext_id, name, force_type, level, mechanic, equipment, category, primary_muscles,
            secondary_muscles, instructions, images, movement_pattern, is_compound, is_synthetic
       FROM exercises`
  );
  cache = { at: Date.now(), rows, byId: new Map(rows.map(r => [Number(r.exercise_id), r])) };
  return cache;
}

module.exports = { load, reset: () => { cache = { at: 0, rows: null, byId: null }; } };
