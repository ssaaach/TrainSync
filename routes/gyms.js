// /api/gyms
//   GET /near?lat=&lng=&radius_km=&limit=   gyms within a radius, nearest first
//   GET /:city                             gyms in a city (aliases handled)
// Gyms are public places, so exact coordinates are returned (people's
// locations never are). Every gym carries Google Maps / OSM links.
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const geo = require('../services/geo');
const { validate } = require('../middleware/validate');
const { citySpellings, cityKey } = require('../services/normalize');

const router = express.Router();

const GYM_COLUMNS = `g.gym_id, g.name, g.address, g.locality, g.city, g.lat, g.lng, g.phone, g.email, g.website,
  g.opening_hours, g.amenities, g.price_tier, g.source,
  COALESCE(g.maps_url, IF(g.address LIKE 'http%', g.address, NULL)) AS maps_url`;

function shape(row) {
  const amenities = typeof row.amenities === 'string' ? JSON.parse(row.amenities) : row.amenities;
  const hasCoords = row.lat != null && row.lng != null;
  return {
    ...row,
    // Manual rows stored a map link in `address`; don't show it as an address.
    address: row.address && !/^https?:/i.test(row.address) ? row.address : null,
    amenities: amenities || [],
    distance_km: row.distance_km != null ? Math.round(row.distance_km * 100) / 100 : undefined,
    links: hasCoords ? geo.mapLinks(row.lat, row.lng) : null,
  };
}

const nearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().min(0.5).max(25).default(5),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

router.get('/near', validate({ query: nearQuery }), async (req, res, next) => {
  const { lat, lng, radius_km: radiusKm, limit } = req.valid.query;
  const q = geo.radiusQuery('g', lat, lng, radiusKm);
  try {
    const [rows] = await db.query(
      `SELECT ${GYM_COLUMNS}, ${q.distance} AS distance_km
         FROM gyms g
        WHERE ${q.where}
        ORDER BY distance_km
        LIMIT ?`,
      [...q.distanceParams, ...q.whereParams, limit]
    );
    res.set('Cache-Control', 'public, max-age=300').json({ center: { lat, lng }, radius_km: radiusKm, gyms: rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

router.get('/:city', async (req, res, next) => {
  const city = cityKey(req.params.city);
  if (!city || city.length > 100) return res.status(400).json({ error: 'City is required', code: 'validation' });
  const names = citySpellings(city);
  try {
    const [gyms] = await db.query(`SELECT ${GYM_COLUMNS} FROM gyms g WHERE g.city IN (?) ORDER BY g.name LIMIT 1000`, [names]);
    res.json(gyms.map(shape));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
