// /api/gyms/:city
const express = require('express');
const db = require('../config/db');

const router = express.Router();

// Spelling variants that should find the same gyms.
const CITY_ALIASES = {
  bengaluru: ['bengaluru', 'bangalore'],
  bangalore: ['bengaluru', 'bangalore'],
  mumbai: ['mumbai', 'bombay'],
  bombay: ['mumbai', 'bombay'],
  chennai: ['chennai', 'madras'],
  madras: ['chennai', 'madras'],
  delhi: ['delhi', 'new delhi'],
  'new delhi': ['delhi', 'new delhi'],
  gurgaon: ['gurgaon', 'gurugram'],
  gurugram: ['gurgaon', 'gurugram'],
};

router.get('/:city', async (req, res, next) => {
  const city = String(req.params.city).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!city || city.length > 100) return res.status(400).json({ error: 'City is required' });
  const names = CITY_ALIASES[city] || [city];
  try {
    const [gyms] = await db.query(
      `SELECT gym_id, name, address, city, email, website, phone,
              COALESCE(maps_url, IF(address LIKE 'http%', address, NULL)) AS maps_url
         FROM gyms WHERE city IN (?) ORDER BY name`,
      [names]
    );
    res.json(gyms);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
