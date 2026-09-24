#!/usr/bin/env node
// npm run import:gyms [-- --city=bengaluru] [--refresh]
// Imports gyms from OpenStreetMap (ODbL, "© OpenStreetMap contributors") via
// the Overpass API: leisure=fitness_centre + amenity=gym inside each city's
// bbox. Upserts on osm_id; manual rows (source='manual') are never touched.
const fs = require('fs');
const db = require('../../config/db');
const { cities } = require('../../config/cities.json');
const { cachedDownload, parseArgs } = require('./lib');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function overpassQuery([s, w, n, e]) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];
(
  nwr["leisure"="fitness_centre"](${bbox});
  nwr["amenity"="gym"](${bbox});
);
out center tags;`;
}

const clip = (v, n) => (v ? String(v).trim().slice(0, n) : null);

function normaliseUrl(url) {
  if (!url) return null;
  const u = String(url).trim().split(';')[0];
  return clip(/^https?:\/\//i.test(u) ? u : `https://${u}`, 255);
}

function buildAddress(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const parts = [t['addr:full'] || street, t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city'], t['addr:postcode']];
  const address = [...new Set(parts.filter(Boolean))].join(', ');
  return clip(address, 255);
}

function amenities(t) {
  const out = new Set();
  for (const s of String(t.sport || '').split(';').map(x => x.trim()).filter(Boolean)) out.add(s);
  if (t.shower === 'yes') out.add('shower');
  if (t.air_conditioning === 'yes') out.add('air_conditioning');
  if (t.wheelchair === 'yes') out.add('wheelchair');
  if (t.female === 'yes' || t.female === 'only') out.add('women_only');
  if (t.swimming_pool === 'yes' || t.sport === 'swimming') out.add('swimming_pool');
  if (t.opening_hours === '24/7') out.add('24x7');
  return [...out];
}

// Pure mapping from an Overpass element to a gyms row (or null to skip).
function mapElement(el, cityName) {
  const t = el.tags || {};
  const name = t.name || t['name:en'] || t.brand;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || lat == null || lng == null) return null;
  return {
    osm_id: `${el.type}/${el.id}`,
    name: clip(name, 255),
    address: buildAddress(t),
    city: cityName,
    locality: clip(t['addr:suburb'] || t['addr:neighbourhood'] || t['addr:district'], 150),
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    phone: clip(t.phone || t['contact:phone'], 50),
    website: normaliseUrl(t.website || t['contact:website'] || t.url),
    email: clip(t.email || t['contact:email'], 255),
    opening_hours: clip(t.opening_hours, 255),
    amenities: amenities(t),
    maps_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

async function importCity(conn, key, refresh) {
  const city = cities[key];
  const file = await cachedDownload(OVERPASS_URL, `overpass/${key}.json`, {
    refresh,
    minGapMs: 2000,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: overpassQuery(city.bbox) }).toString(),
    },
  });
  const { elements = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  const rows = [];
  let unnamed = 0;
  for (const el of elements) {
    const row = mapElement(el, city.name);
    if (!row) { unnamed++; continue; }
    if (seen.has(row.osm_id)) continue; // an element can match both tag filters
    seen.add(row.osm_id);
    rows.push(row);
  }
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300).map(r => [
      r.osm_id, r.name, r.address, r.city, r.locality, r.lat, r.lng, r.phone, r.website, r.email,
      r.opening_hours, JSON.stringify(r.amenities), r.maps_url, 'osm', 0,
    ]);
    await conn.query(
      `INSERT INTO gyms (osm_id, name, address, city, locality, lat, lng, phone, website, email,
         opening_hours, amenities, maps_url, source, is_synthetic)
       VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), city = VALUES(city),
         locality = VALUES(locality), lat = VALUES(lat), lng = VALUES(lng), phone = VALUES(phone),
         website = VALUES(website), email = VALUES(email), opening_hours = VALUES(opening_hours),
         amenities = VALUES(amenities), maps_url = VALUES(maps_url)`,
      [chunk]
    );
  }
  return { city: city.name, elements: elements.length, imported: rows.length, skipped: unnamed };
}

async function main() {
  const args = parseArgs();
  const keys = args.city ? [String(args.city).toLowerCase()] : Object.keys(cities);
  for (const k of keys) if (!cities[k]) throw new Error(`Unknown city "${k}". Known: ${Object.keys(cities).join(', ')}`);

  const conn = await db.getConnection();
  const failed = [];
  try {
    for (const key of keys) {
      try {
        const r = await importCity(conn, key, Boolean(args.refresh));
        console.log(`✔ ${r.city}: ${r.imported} gyms upserted (${r.elements} OSM features, ${r.skipped} skipped: unnamed/no coords)`);
      } catch (err) {
        failed.push(key);
        console.error(`⚠️  ${cities[key].name}: Overpass unavailable (${err.message}). No gyms imported for this city;` +
          ' run again later. (No synthetic gyms are created under an OSM label.)');
      }
    }
    const [counts] = await conn.query('SELECT source, COUNT(*) n FROM gyms GROUP BY source');
    console.log('  gyms by source:', counts.map(c => `${c.source}=${c.n}`).join(', '));
    console.log('  Data © OpenStreetMap contributors, ODbL 1.0 — attribution is required wherever shown.');
  } finally {
    conn.release();
    await db.end();
  }
  if (failed.length) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(err => { console.error('import:gyms failed:', err.message); process.exit(1); });
}

module.exports = { mapElement, overpassQuery };
