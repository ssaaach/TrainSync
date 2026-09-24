// Visual-regression helpers: freeze media, then compare screenshots against
// committed baselines with pixelmatch.
//
//   UPDATE_BASELINE=1 npx playwright test tests/visual   -> (re)write baselines
//   npx playwright test tests/visual                     -> compare
//
// A page may declare `compareHeight` (px) to compare only the top region that
// existed at baseline time, and `masks` ([{x,y,width,height}]) for regions
// where new content was intentionally added. Every use is listed in
// docs/UI_OVERRIDES.md.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const BASELINE_DIR = path.join(__dirname, 'baseline');
const DIFF_DIR = path.join(__dirname, '__diff__');
const MAX_DIFF_RATIO = 0.001; // 0.1 % of compared pixels
const PIXEL_THRESHOLD = 0.1;  // pixelmatch per-pixel colour tolerance

// Stop autoplay and hold every <video> on frame 0 so screenshots are deterministic.
async function freezeMedia(page) {
  await page.evaluate(async () => {
    const videos = Array.from(document.querySelectorAll('video'));
    await Promise.all(videos.map(v => new Promise(resolve => {
      v.autoplay = false;
      v.loop = false;
      v.pause();
      const done = () => { v.pause(); resolve(); };
      const seek = () => {
        if (v.currentTime === 0 && v.readyState >= 2) return done();
        v.addEventListener('seeked', done, { once: true });
        v.currentTime = 0;
      };
      if (v.readyState >= 2) seek();
      else {
        v.addEventListener('loadeddata', seek, { once: true });
        v.load();
      }
      setTimeout(resolve, 15000); // never hang the suite on a broken video
    })));
  });
  // Let the paused frame and any backdrop-filter composite settle.
  await page.waitForTimeout(300);
}

function crop(png, width, height) {
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);
  return out;
}

function applyMasks(png, masks) {
  for (const m of masks || []) {
    for (let y = Math.max(0, m.y); y < Math.min(png.height, m.y + m.height); y++) {
      for (let x = Math.max(0, m.x); x < Math.min(png.width, m.x + m.width); x++) {
        const i = (png.width * y + x) << 2;
        png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 255; png.data[i + 3] = 255;
      }
    }
  }
}

// Returns { ratio, diffPixels, compared } or writes the baseline in update mode.
function compareToBaseline(name, buffer, { compareHeight, masks } = {}) {
  const baselinePath = path.join(BASELINE_DIR, `${name}.png`);
  if (process.env.UPDATE_BASELINE === '1' || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath, buffer);
    return { written: true };
  }
  const base = PNG.sync.read(fs.readFileSync(baselinePath));
  const actual = PNG.sync.read(buffer);

  const width = Math.min(base.width, actual.width);
  const height = Math.min(compareHeight || base.height, base.height, actual.height);
  if (width !== base.width || (!compareHeight && actual.height < base.height)) {
    return { ratio: 1, diffPixels: -1, compared: 0, reason: `size ${actual.width}x${actual.height} vs baseline ${base.width}x${base.height}` };
  }
  if (!compareHeight && actual.height !== base.height) {
    return { ratio: 1, diffPixels: -1, compared: 0, reason: `height ${actual.height} vs baseline ${base.height} (declare compareHeight if content was appended)` };
  }

  const a = crop(base, width, height);
  const b = crop(actual, width, height);
  applyMasks(a, masks);
  applyMasks(b, masks);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: PIXEL_THRESHOLD });
  const compared = width * height;
  const ratio = diffPixels / compared;
  if (ratio > MAX_DIFF_RATIO) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIFF_DIR, `${name}.diff.png`), PNG.sync.write(diff));
    fs.writeFileSync(path.join(DIFF_DIR, `${name}.actual.png`), buffer);
  }
  return { ratio, diffPixels, compared };
}

module.exports = { freezeMedia, compareToBaseline, MAX_DIFF_RATIO };
