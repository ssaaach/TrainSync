#!/usr/bin/env node
// npm run import:localities
// Geocodes a curated list of neighbourhoods with OpenStreetMap Nominatim
// (ODbL; policy: max 1 request/s, cached, identifiable User-Agent) and writes
// db/seeds/localities.csv. The CSV is committed so seeding works offline.
const fs = require('fs');
const path = require('path');
const { cities } = require('../../config/cities.json');
const { cachedDownload, hash } = require('./lib');

const OUT = path.join(__dirname, '..', '..', 'db', 'seeds', 'localities.csv');

const NAMES = {
  bengaluru: ['Indiranagar', 'Koramangala', 'HSR Layout', 'Jayanagar', 'JP Nagar', 'BTM Layout', 'Whitefield',
    'Marathahalli', 'Bellandur', 'Electronic City', 'Hebbal', 'Yelahanka', 'Malleshwaram', 'Rajajinagar',
    'Basavanagudi', 'Banashankari', 'Vijayanagar', 'RT Nagar', 'Frazer Town', 'Ulsoor', 'Shivajinagar', 'Domlur',
    'Banaswadi', 'Kalyan Nagar', 'HBR Layout', 'Hennur', 'Thanisandra', 'Yeshwanthpur', 'Peenya', 'Kengeri',
    'Rajarajeshwari Nagar', 'Hulimavu', 'Bommanahalli', 'Mahadevapura', 'KR Puram', 'Brookefield', 'CV Raman Nagar',
    'Sadashivanagar', 'Richmond Town', 'Wilson Garden', 'Nagarbhavi', 'Kammanahalli', 'Sarjapura', 'Kadugodi'],
  mumbai: ['Andheri West', 'Bandra West', 'Powai', 'Goregaon', 'Malad', 'Borivali', 'Dadar', 'Chembur',
    'Lower Parel', 'Juhu', 'Colaba', 'Santacruz'],
  delhi: ['Connaught Place', 'Saket', 'Hauz Khas', 'Lajpat Nagar', 'Dwarka', 'Rohini', 'Vasant Kunj', 'Karol Bagh',
    'Rajouri Garden', 'Greater Kailash', 'Mayur Vihar', 'Janakpuri'],
  chennai: ['T. Nagar', 'Adyar', 'Anna Nagar', 'Velachery', 'Mylapore', 'Nungambakkam', 'Porur', 'Besant Nagar',
    'Kilpauk', 'Perungudi', 'Tambaram'],
  hyderabad: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Madhapur', 'Kondapur', 'Kukatpally', 'Begumpet',
    'Ameerpet', 'Secunderabad', 'Miyapur', 'Dilsukhnagar'],
  pune: ['Koregaon Park', 'Kothrud', 'Viman Nagar', 'Baner', 'Aundh', 'Wakad', 'Hadapsar', 'Kalyani Nagar',
    'Shivajinagar', 'Deccan Gymkhana', 'Magarpatta', 'Pimple Saudagar'],
};

function inBbox([s, w, n, e], lat, lng) {
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

async function geocode(cityKey, name) {
  const city = cities[cityKey];
  const [s, w, n, e] = city.bbox;
  const params = new URLSearchParams({
    q: `${name}, ${city.name}, India`, format: 'jsonv2', limit: '1', countrycodes: 'in',
    viewbox: `${w},${n},${e},${s}`, bounded: '1',
  });
  const file = await cachedDownload(`https://nominatim.openstreetmap.org/search?${params}`,
    `nominatim/${cityKey}-${hash(name)}.json`, { minGapMs: 1100 });
  const [hit] = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!inBbox(city.bbox, lat, lng)) return null;
  return { lat: lat.toFixed(6), lng: lng.toFixed(6), osm_id: `${hit.osm_type}/${hit.osm_id}` };
}

async function main() {
  const lines = ['city,name,lat,lng,osm_id,source'];
  const missing = [];
  for (const [cityKey, names] of Object.entries(NAMES)) {
    let ok = 0;
    for (const name of names) {
      const g = await geocode(cityKey, name).catch(err => { console.error(`  ${name}: ${err.message}`); return null; });
      if (!g) { missing.push(`${cities[cityKey].name}/${name}`); continue; }
      lines.push([cities[cityKey].name, `"${name}"`, g.lat, g.lng, g.osm_id, 'nominatim'].join(','));
      ok++;
    }
    console.log(`✔ ${cities[cityKey].name}: ${ok}/${names.length} localities geocoded`);
  }
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`Wrote ${lines.length - 1} localities to db/seeds/localities.csv (© OpenStreetMap contributors, ODbL).`);
  if (missing.length) console.log(`  Not found (skipped): ${missing.join(', ')}`);
}

main().catch(err => { console.error('import:localities failed:', err.message); process.exit(1); });
