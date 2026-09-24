// Pure helpers added in Phase 2: geo, dish analysis, movement patterns, OSM mapping, normalisation.
const geo = require('../../services/geo');
const { analyseDish } = require('../../services/dishNutrition');
const { movementPattern, isCompound } = require('../../scripts/import/movementPatterns');
const { mapElement } = require('../../scripts/import/gyms');

describe('geo', () => {
  test('haversine: known distances (MySQL agreement is checked in tests/api/phase2.test.js)', () => {
    // 1° of latitude on a sphere of R = 6371.0088 km is 111.195 km.
    expect(geo.haversineKm(0, 0, 1, 0)).toBeCloseTo(111.195, 2);
    expect(geo.haversineKm(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
    const d = geo.haversineKm(12.973291, 77.640467, 12.935737, 77.624081);
    expect(d).toBeGreaterThan(4.4);
    expect(d).toBeLessThan(4.6);
  });

  test('bounding box contains every point on the radius circle', () => {
    const [lat, lng, r] = [12.97, 77.64, 5];
    const box = geo.boundingBox(lat, lng, r);
    for (let deg = 0; deg < 360; deg += 15) {
      // walk ~r km in each direction and check it stays inside the box
      const dLat = (r / 110.574) * Math.cos((deg * Math.PI) / 180) * 0.999;
      const dLng = (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin((deg * Math.PI) / 180) * 0.999;
      expect(lat + dLat).toBeGreaterThanOrEqual(box.south);
      expect(lat + dLat).toBeLessThanOrEqual(box.north);
      expect(lng + dLng).toBeGreaterThanOrEqual(box.west);
      expect(lng + dLng).toBeLessThanOrEqual(box.east);
    }
  });

  test('bbox WKT is long-lat and closed', () => {
    const wkt = geo.bboxPolygonWkt({ south: 1, north: 2, west: 3, east: 4 });
    expect(wkt).toBe('POLYGON((3.000000 1.000000, 4.000000 1.000000, 4.000000 2.000000, 3.000000 2.000000, 3.000000 1.000000))');
  });

  test('nearest respects the radius', () => {
    const pts = [{ id: 'a', lat: 12.97, lng: 77.64 }, { id: 'b', lat: 13.2, lng: 77.64 }];
    expect(geo.nearest(pts, 12.971, 77.641, 3).item.id).toBe('a');
    expect(geo.nearest(pts, 13.05, 77.64, 3)).toBeNull();
  });
});

describe('dish analysis', () => {
  const foods = new Map(Object.entries({
    rice: { kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3, diet_class: 'plant', jain_excluded: 0, allergens: '[]' },
    onion: { kcal: 40, protein_g: 1.1, carbs_g: 9.3, fat_g: 0.1, diet_class: 'plant', jain_excluded: 1, allergens: '[]' },
    ghee: { kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100, diet_class: 'dairy', jain_excluded: 0, allergens: '["dairy"]' },
    egg: { kcal: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, diet_class: 'egg', jain_excluded: 0, allergens: '["egg"]' },
    chicken: { kcal: 120, protein_g: 22.5, carbs_g: 0, fat_g: 2.6, diet_class: 'meat', jain_excluded: 0, allergens: '[]' },
  }));

  test('macros are the gram-weighted sum of per-100 g values', () => {
    const a = analyseDish({ rice: 200, ghee: 10 }, foods);
    expect(a).toMatchObject({ serving_g: 210, kcal: 350, protein_g: 5.4, carbs_g: 56.4, fat_g: 10.6 });
  });

  test.each([
    [{ rice: 100 }, 'vegan', ['vegan', 'veg', 'eggetarian', 'non-veg', 'jain']],
    [{ rice: 100, onion: 20 }, 'vegan', ['vegan', 'veg', 'eggetarian', 'non-veg']],
    [{ rice: 100, ghee: 5 }, 'veg', ['veg', 'eggetarian', 'non-veg', 'jain']],
    [{ rice: 100, egg: 50 }, 'eggetarian', ['eggetarian', 'non-veg']],
    [{ rice: 100, chicken: 100, egg: 50 }, 'non-veg', ['non-veg']],
  ])('%j → %s, suitable for %j', (grams, pref, suitable) => {
    const a = analyseDish(grams, foods);
    expect(a.diet_pref).toBe(pref);
    expect(a.suitable_for).toEqual(suitable);
  });

  test('allergens are the union of ingredient allergens', () => {
    expect(analyseDish({ ghee: 5, egg: 50 }, foods).allergens).toEqual(['dairy', 'egg']);
  });

  test('unknown ingredient or non-positive grams is an error', () => {
    expect(() => analyseDish({ tofu: 100 }, foods)).toThrow(/Unknown ingredient/);
    expect(() => analyseDish({ rice: 0 }, foods)).toThrow(/positive/);
  });
});

describe('movement patterns', () => {
  const ex = (name, extra = {}) => ({ name, force: 'push', mechanic: 'compound', equipment: 'barbell', category: 'strength', primaryMuscles: ['quadriceps'], ...extra });
  test.each([
    ['Barbell Squat', {}, 'squat'],
    ['Romanian Deadlift', { force: 'pull', primaryMuscles: ['hamstrings'] }, 'hinge'],
    ['Barbell Bench Press - Medium Grip', { primaryMuscles: ['chest'] }, 'push-h'],
    ['Standing Military Press', { primaryMuscles: ['shoulders'] }, 'push-v'],
    ['Bent Over Barbell Row', { force: 'pull', primaryMuscles: ['middle back'] }, 'pull-h'],
    ['Pullups', { force: 'pull', primaryMuscles: ['lats'], equipment: 'body only' }, 'pull-v'],
    ['Barbell Lunge', {}, 'lunge'],
    ["Farmer's Walk", { force: 'static', primaryMuscles: ['forearms'] }, 'carry'],
    ['Plank', { force: 'static', mechanic: 'isolation', primaryMuscles: ['abdominals'] }, 'core'],
    ['Jogging, Treadmill', { category: 'cardio', mechanic: null }, 'cardio'],
    ['Upright Row - With Bands', { force: 'pull', primaryMuscles: ['traps'] }, 'isolation'],
    ['Barbell Curl', { force: 'pull', mechanic: 'isolation', primaryMuscles: ['biceps'] }, 'isolation'],
    ['Kneeling Hip Flexor', { category: 'stretching', mechanic: null }, 'mobility'],
  ])('%s → %s', (name, extra, pattern) => {
    expect(movementPattern(ex(name, extra))).toBe(pattern);
  });

  test('compound flag excludes mobility/cardio/isolation patterns', () => {
    expect(isCompound(ex('Barbell Squat'))).toBe(true);
    expect(isCompound(ex('Box Jump', { category: 'plyometrics' }))).toBe(false);
  });
});

describe('OSM gym mapping', () => {
  test('maps tags, centre coordinates and builds an OSM link', () => {
    const row = mapElement({
      type: 'way', id: 42, center: { lat: 12.9711111, lon: 77.6411111 },
      tags: { name: 'Iron Den', 'addr:street': '100 Feet Rd', 'addr:suburb': 'Indiranagar', 'addr:city': 'Bengaluru',
        phone: '+91 80 1234', website: 'irondengym.in', opening_hours: '24/7', sport: 'fitness;yoga', shower: 'yes' },
    }, 'Bengaluru');
    expect(row).toMatchObject({
      osm_id: 'way/42', name: 'Iron Den', city: 'Bengaluru', locality: 'Indiranagar', lat: 12.971111, lng: 77.641111,
      address: '100 Feet Rd, Indiranagar, Bengaluru', website: 'https://irondengym.in', opening_hours: '24/7',
      maps_url: 'https://www.openstreetmap.org/way/42',
    });
    expect(row.amenities).toEqual(expect.arrayContaining(['fitness', 'yoga', 'shower', '24x7']));
  });

  test('skips unnamed features and features without coordinates', () => {
    expect(mapElement({ type: 'node', id: 1, lat: 1, lon: 2, tags: {} }, 'X')).toBeNull();
    expect(mapElement({ type: 'way', id: 2, tags: { name: 'No centre' } }, 'X')).toBeNull();
  });
});
