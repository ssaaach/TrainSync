// WCAG AA text contrast measured on the real rendering, with the background
// video swapped for its brightest frame (tests/fixtures/media).
//
// For every visible element that directly contains text we record its colour
// and size, then hide all text and icons, screenshot the viewport, and read
// the pixels behind the element. The 98th-percentile brightest background
// pixel (ignoring a few anti-aliased edge pixels) must give ≥ 4.5:1 for body
// text and ≥ 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold).
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');
const { stablePage } = require('../setup/pageMocks');

const PAGES = ['/homepage.html', '/login.html', '/registration.html', '/privacy.html'];
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Text elements fully inside the viewport, in viewport coordinates.
async function textElements(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!ownText || el.closest('script,style,noscript,.ts-sr-only,.leaflet-container,[aria-hidden="true"]')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
      // Skip text a person can't see right now: clipped by a scroll/overflow
      // container, or covered by something else (e.g. the fixed nav).
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflow === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1) { clipped = true; break; }
      }
      if (clipped) continue;
      const probes = [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5]].map(([fx, fy]) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy));
      if (probes.some(hit => !hit || !(hit === el || el.contains(hit) || hit.contains(el)))) continue;
      const m = cs.color.match(/[\d.]+/g).map(Number);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      out.push({
        label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''} "${el.textContent.trim().slice(0, 40)}"`,
        rect: { x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) },
        color: m.slice(0, 3), alpha: m[3] ?? 1,
        large: size >= 24 || (bold && size >= 18.66),
      });
    }
    return out;
  });
}

test.describe('text contrast over the brightest video frame', () => {
  for (const vp of VIEWPORTS) {
    for (const url of PAGES) {
      test(`${url} @ ${vp.width}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize(vp);
        await stablePage(page, { brightest: true });
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: '.ts-nav.is-hidden{transform:none!important}' });

        const failures = new Map();
        let checked = 0;
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += Math.floor(vp.height * 0.7)) {
          await page.evaluate(top => window.scrollTo(0, top), y);
          await page.waitForTimeout(150);
          const els = await textElements(page);
          if (!els.length) continue;
          // Hide text + icons, keep every background.
          const hide = await page.addStyleTag({ content: '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important} svg.ts-icon,.ts-live-dot,input::placeholder{visibility:hidden!important} ::placeholder{color:transparent!important}' });
          const shot = await page.screenshot({ animations: 'disabled' });
          if (process.env.CONTRAST_DEBUG) require('fs').writeFileSync(`test-results/contrast-${vp.width}-${y}.png`, shot);
          const png = PNG.sync.read(shot);
          await hide.evaluate(n => n.remove());
          const scale = png.width / vp.width;
          for (const e of els) {
            const lums = [];
            for (let py = e.rect.y; py < e.rect.y + e.rect.h; py += 2) {
              for (let px = e.rect.x; px < e.rect.x + e.rect.w; px += 2) {
                const i = (png.width * Math.floor(py * scale) + Math.floor(px * scale)) << 2;
                lums.push(lum(png.data[i], png.data[i + 1], png.data[i + 2]));
              }
            }
            if (!lums.length) continue;
            lums.sort((a, b) => a - b);
            const bg = lums[Math.floor(lums.length * 0.98)];
            const text = lum(...e.color);
            const r = ratio(text, bg);
            const need = e.large ? 3 : 4.5;
            checked++;
            if (e.alpha < 0.99 || r < need) {
              const prev = failures.get(e.label);
              if (!prev || r < prev.ratio) failures.set(e.label, { ratio: Math.round(r * 100) / 100, need, alpha: e.alpha, y, rect: e.rect });
            }
          }
        }
        expect(checked, 'text elements measured').toBeGreaterThan(5);
        expect([...failures].map(([label, f]) => `${label}: ${f.ratio}:1 (needs ${f.need}:1${f.alpha < 0.99 ? `, text alpha ${f.alpha}` : ''})${process.env.CONTRAST_DEBUG ? ` @y=${f.y} ${JSON.stringify(f.rect)}` : ''}`)).toEqual([]);
      });
    }
  }
});
