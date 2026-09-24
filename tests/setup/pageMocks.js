// Deterministic page state for browser tests: fixed public stats and nearby
// gyms (the test DB is nearly empty), no OSM tile downloads, reduced motion
// (poster instead of video, no reveal animation).
const path = require('path');
const fs = require('fs');

const STATS = { gyms: 709, cities: 7, exercises: 876, foods: 402, dishes: 182, trainers: 5, trainees: 6, note: 'fixture' };
const NEAR = {
  center: { lat: 12.9716, lng: 77.6412 },
  radius_km: 4,
  gyms: [
    [12.9720, 77.6409], [12.9781, 77.6402], [12.9658, 77.6371], [12.9699, 77.6495], [12.9790, 77.6310], [12.9601, 77.6450],
  ].map(([lat, lng], i) => ({ gym_id: i + 1, name: `Fixture Gym ${i + 1}`, lat, lng, city: 'Bengaluru', distance_km: i * 0.6 })),
};

async function stablePage(page, { brightest = false } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/stats', r => r.fulfill({ json: STATS }));
  await page.route('**/api/gyms/near**', r => r.fulfill({ json: NEAR }));
  await page.route(/tile\.openstreetmap\.org/, r => r.abort());
  if (brightest) {
    // Swap the background posters for the brightest frame of each video.
    const dir = path.join(__dirname, '..', 'fixtures', 'media');
    for (const v of ['smoke-wide', 'smoke-tall', 'coach']) {
      const body = fs.readFileSync(path.join(dir, `${v}-brightest.jpg`));
      await page.route(`**/media/${v}.webp`, r => r.fulfill({ body, contentType: 'image/jpeg' }));
    }
  }
}

module.exports = { stablePage, STATS, NEAR };
