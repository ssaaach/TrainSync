// Geo helpers. Tables store lat/lng plus a generated `geo` POINT (SRID 4326,
// POINT(lng, lat)) with a SPATIAL INDEX; radius queries prefilter on the
// bounding box (index range scan) and then compute exact distance.

const EARTH_RADIUS_KM = 6371.0088;
const toRad = d => (d * Math.PI) / 180;

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Bounding box that contains every point within radiusKm of (lat, lng).
function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.320 * Math.cos(toRad(lat)));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

// WKT polygon for the bbox, written long-lat and parsed with axis-order=long-lat.
function bboxPolygonWkt({ south, north, west, east }) {
  const f = n => Number(n).toFixed(6);
  return `POLYGON((${f(west)} ${f(south)}, ${f(east)} ${f(south)}, ${f(east)} ${f(north)}, ${f(west)} ${f(north)}, ${f(west)} ${f(south)}))`;
}

/**
 * SQL fragments for "rows of `alias` within radiusKm of (lat, lng)", ordered by distance.
 * Returns { where, distance, params } — `where` uses the spatial index (MBRContains)
 * and an exact ST_Distance_Sphere filter; params are positional in order:
 * [distance-select params..., where params...].
 */
function radiusQuery(alias, lat, lng, radiusKm) {
  const wkt = bboxPolygonWkt(boundingBox(lat, lng, radiusKm));
  const point = 'ST_SRID(POINT(?, ?), 4326)';
  return {
    distance: `ST_Distance_Sphere(${alias}.geo, ${point}) / 1000`,
    distanceParams: [lng, lat],
    where: `MBRContains(ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ${alias}.geo)
            AND ${alias}.lat IS NOT NULL
            AND ST_Distance_Sphere(${alias}.geo, ${point}) <= ?`,
    whereParams: [wkt, lng, lat, radiusKm * 1000],
  };
}

// Nearest candidate (objects with lat/lng) within maxKm, or null.
function nearest(candidates, lat, lng, maxKm = Infinity) {
  let best = null;
  let bestKm = maxKm;
  for (const c of candidates) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d <= bestKm) { best = c; bestKm = d; }
  }
  return best ? { item: best, km: bestKm } : null;
}

module.exports = { haversineKm, boundingBox, bboxPolygonWkt, radiusQuery, nearest, EARTH_RADIUS_KM };
