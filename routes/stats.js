// GET /api/stats — public counts for the landing page. Synthetic demo data is
// excluded, so every number shown publicly is real. Cached briefly in-process.
const express = require('express');
const db = require('../config/db');
const { canonicalCity } = require('../services/normalize');

const router = express.Router();
const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

async function compute() {
  const [[gyms]] = await db.query('SELECT COUNT(*) AS n FROM gyms WHERE is_synthetic = 0');
  const [cityRows] = await db.query('SELECT DISTINCT city FROM gyms WHERE is_synthetic = 0');
  const cities = new Set(cityRows.map(r => canonicalCity(r.city)));
  const [[ex]] = await db.query('SELECT COUNT(*) AS n FROM exercises WHERE is_synthetic = 0');
  const [[foods]] = await db.query('SELECT COUNT(*) AS n FROM foods WHERE is_synthetic = 0');
  const [[dishes]] = await db.query('SELECT COUNT(*) AS n FROM dishes WHERE is_synthetic = 0');
  const [roles] = await db.query('SELECT role, COUNT(*) AS n FROM users WHERE is_synthetic = 0 GROUP BY role');
  const byRole = Object.fromEntries(roles.map(r => [r.role, r.n]));
  return {
    gyms: gyms.n,
    cities: cities.size,
    exercises: ex.n,
    foods: foods.n,
    dishes: dishes.n,
    trainers: byRole.trainer || 0,
    trainees: byRole.trainee || 0,
    note: 'Counts exclude synthetic demo data.',
    generatedAt: new Date().toISOString(),
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!cache.data || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), data: await compute() };
    res.set('Cache-Control', 'public, max-age=300').json(cache.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.resetCache = () => { cache = { at: 0, data: null }; };
