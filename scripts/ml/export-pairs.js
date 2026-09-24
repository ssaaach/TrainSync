#!/usr/bin/env node
// Exports trainee x trainer pairs for training the ranker (ml/train_ranker.py).
// Features are the app's own factor scores (services/matching.js), so the
// learned weights plug straight into the JS scorer. The label is a HIDDEN
// ground truth built from the synthetic generator's latent state
// (synthetic_profiles: archetype, chemistry vector, motivation, patience) plus
// noise — information the app never sees, so the evaluation isn't circular.
//   node scripts/ml/export-pairs.js [--trainees=1500] [--per=40]
const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const matching = require('../../services/matching');
const geo = require('../../services/geo');
const { canonicalCity } = require('../../services/normalize');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const N = Number(args.trainees) || 1500;
const PER = Number(args.per) || 40;
const OUT = path.join(__dirname, '..', '..', 'ml', 'data', 'synthetic', 'pairs.csv');

let seed = 20260925;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

(async () => {
  const [trainees] = await db.query(
    `SELECT t.*, sp.archetype, sp.latent FROM trainees t JOIN users u USING (user_id) JOIN synthetic_profiles sp USING (user_id)
      WHERE u.is_synthetic = 1 ORDER BY t.user_id LIMIT ?`, [N]
  );
  const [trainers] = await db.query(
    `SELECT t.*, sp.archetype, sp.latent FROM trainers t JOIN users u USING (user_id) JOIN synthetic_profiles sp USING (user_id)
      WHERE u.is_synthetic = 1`
  );
  const byCity = new Map();
  for (const tr of trainers) {
    const c = canonicalCity(tr.city);
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(tr);
  }
  const header = ['qid', 'trainee', 'trainer', ...matching.FACTORS, 'dist_km', 'gt', 'gender', 'same_arch'];
  const lines = [header.join(',')];
  for (const t of trainees) {
    const pool = byCity.get(canonicalCity(t.city)) || [];
    if (pool.length < PER) continue;
    const lt = parse(t.latent);
    // sample PER candidates: half from nearby, half random (like a real feed)
    const withD = pool.map(tr => ({ tr, d: geo.haversineKm(t.lat, t.lng, tr.lat, tr.lng) })).sort((a, b) => a.d - b.d);
    const pick = new Set();
    for (const x of withD.slice(0, PER / 2)) pick.add(x);
    while (pick.size < PER) pick.add(withD[Math.floor(rnd() * withD.length)]);
    for (const { tr, d } of pick) {
      const f = matching.factors(t, tr, { distanceKm: d });
      const la = parse(tr.latent);
      const chem = lt.chemistry.reduce((s, v, i) => s + v * la.chemistry[i], 0);
      const same = t.archetype === tr.archetype ? 1 : 0;
      // Hidden truth: archetype fit, chemistry, a patience x structure
      // interaction, travel friction and noise. Not a linear function of the
      // factors the app computes.
      const sp = parse(t.style_pref) || {};
      const cs = parse(tr.coaching_style) || {};
      const gt = 1.1 * same + 0.7 * chem
        + 0.5 * (la.patience - 0.5) * (lt.motivation < 0.5 ? 1 : 0)
        + 0.3 * (1 - Math.abs((sp.structure || 3) - (cs.structure || 3)) / 4) * lt.motivation
        + 0.6 * f.goals + 0.35 * f.schedule - 0.08 * Math.min(d, 15) + 0.25 * f.budget
        + 0.3 * gauss();
      lines.push([t.user_id, t.user_id, tr.user_id, ...matching.FACTORS.map(k => (f[k] == null ? '' : f[k].toFixed(4))), d.toFixed(2), gt.toFixed(4), tr.gender || '', same].join(','));
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`✔ ${lines.length - 1} pairs for ${new Set(lines.slice(1).map(l => l.split(',')[0])).size} trainees -> ${path.relative(process.cwd(), OUT)}`);
  await db.end();
})().catch(err => { console.error(err); process.exit(1); });
