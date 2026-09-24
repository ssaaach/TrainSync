// GET /api/localities?city=bengaluru — neighbourhood names (with their public
// OSM centroids) for the onboarding locality picker.
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const { cities } = require('../config/cities.json');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.get('/', validate({ query: z.object({ city: z.enum(Object.keys(cities)) }) }), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT name, lat, lng FROM localities WHERE city = ? ORDER BY name', [cities[req.valid.query.city].name]);
    res.set('Cache-Control', 'public, max-age=3600').json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
