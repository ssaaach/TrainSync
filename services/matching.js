// Trainer ↔ trainee compatibility: hard filters, then an explainable weighted
// sum of per-factor scores (each 0–1). Weights come from the learned ranker
// artifact (ml/artifacts/ranker.json, fitted offline in Python) when present,
// otherwise from config defaults — so matching never fails if the model is
// missing. Consent-gated factors (personality, interests, location) are
// skipped, and their weight redistributed, when either side hasn't consented.
const fs = require('fs');
const path = require('path');
const geo = require('./geo');

const ARTIFACT = path.join(__dirname, '..', 'ml', 'artifacts', 'ranker.json');
const DEFAULT_WEIGHTS = {
  goals: 0.22, schedule: 0.14, style: 0.13, distance: 0.12, personality: 0.1, budget: 0.08, level: 0.07, interests: 0.06, modality: 0.04, quality: 0.04,
};
const FACTORS = Object.keys(DEFAULT_WEIGHTS);
const D0_KM = 3; // distance decay
const LEVELS = ['beginner', 'intermediate', 'advanced'];

let model = { version: 'rules-v1', weights: DEFAULT_WEIGHTS, source: 'default' };
function loadModel() {
  try {
    const a = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
    const ok = FACTORS.every(f => typeof a.weights[f] === 'number' && a.weights[f] >= 0);
    // 80% learned + 20% rule weights: the synthetic ground truth has no signal
    // for interests / ratings / modality, so the blend keeps them in play.
    if (ok) {
      const weights = Object.fromEntries(FACTORS.map(k => [k, 0.8 * a.weights[k] + 0.2 * DEFAULT_WEIGHTS[k]]));
      model = { version: a.version, weights, source: 'learned', metrics: a.metrics };
    }
  } catch {
    model = { version: 'rules-v1', weights: DEFAULT_WEIGHTS, source: 'default' };
  }
  return model;
}
loadModel();

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const clamp01 = v => Math.max(0, Math.min(1, v));

function slots(schedule) {
  const out = new Set();
  for (const [day, parts] of Object.entries(parse(schedule) || {})) {
    const wk = ['sat', 'sun'].includes(day) ? 'weekend' : 'weekday';
    for (const p of parts || []) out.add(`${day}:${p}`), out.add(`${wk}_${p}`);
  }
  return out;
}

const tokens = s => new Set(String(s || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3));

// ---------------------------------------------------------------- factors
function factors(t, tr, ctx = {}) {
  const f = {};
  // goals ↔ specialisations: share of the trainee's goals the trainer covers
  const goals = parse(t.goals) || [];
  const spec = new Set(parse(tr.specializations) || []);
  f.goals = goals.length ? goals.filter(g => spec.has(g)).length / goals.length : 0.5;

  // coaching style: 4 axes on 1–5
  const sp = parse(t.style_pref);
  const cs = parse(tr.coaching_style);
  f.style = sp && cs
    ? 1 - ['structure', 'tone', 'checkin', 'data'].reduce((s, k) => s + Math.abs((sp[k] || 3) - (cs[k] || 3)), 0) / 16
    : null;

  // personality: similarity on C, O, E plus a supportive-coach bonus for anxious trainees
  const b1 = parse(t.big5);
  const b2 = parse(tr.big5);
  if (b1 && b2 && ctx.personality !== false) {
    const sim = 1 - (Math.abs(b1.C - b2.C) + Math.abs(b1.O - b2.O) + Math.abs(b1.E - b2.E)) / 3;
    const bonus = b1.N > 0.6 ? 0.15 * b2.A : 0;
    f.personality = clamp01(sim * 0.9 + bonus);
  } else f.personality = null;

  // schedule: share of the trainee's free day-slots the trainer also has
  const s1 = [...slots(t.schedule)].filter(x => x.includes(':'));
  const s2 = slots(tr.schedule);
  f.schedule = s1.length ? s1.filter(x => s2.has(x)).length / s1.length : 0.5;

  // distance
  const bothOnline = (parse(t.modality) || []).includes('online') && (parse(tr.modality) || []).includes('online');
  if (ctx.distanceKm != null) f.distance = Math.exp(-ctx.distanceKm / D0_KM);
  else f.distance = bothOnline ? 1 : null;
  if (bothOnline && f.distance != null) f.distance = Math.max(f.distance, 0.8);

  // budget
  const budget = Number(t.budget_per_session_inr) || 0;
  const price = Number(tr.price_per_session_inr) || 0;
  f.budget = !budget || !price ? 0.5 : price <= budget ? 1 : Math.exp(-(price - budget) / budget);

  // experience level fit
  const a = LEVELS.indexOf(t.experience_level);
  const b = LEVELS.indexOf(tr.best_level);
  f.level = a < 0 || b < 0 ? 0.5 : 1 - Math.abs(a - b) / 2;

  // modality overlap
  const m1 = parse(t.modality) || [];
  const m2 = new Set(parse(tr.modality) || []);
  f.modality = m1.length ? m1.filter(m => m2.has(m)).length / m1.length : 0.5;

  // quality: Bayesian-average rating (prior 4.0, weight 10), scaled 0–1
  const n = Number(tr.rating_count) || 0;
  const avg = Number(tr.rating_avg) || 4;
  f.quality = clamp01(((10 * 4 + n * avg) / (10 + n) - 1) / 4);

  // interests: tag overlap + hobby words
  if (ctx.interests !== false) {
    const i1 = new Set([...(parse(t.interests) || []), ...tokens(t.hobbies)]);
    const i2 = new Set([...(parse(tr.interests) || []), ...tokens(tr.hobbies)]);
    const inter = [...i1].filter(x => i2.has(x)).length;
    f.interests = i1.size && i2.size ? Math.min(1, inter / Math.min(3, i1.size)) : null;
  } else f.interests = null;
  return f;
}

function score(f, weights = model.weights) {
  let wsum = 0;
  let s = 0;
  for (const k of FACTORS) {
    if (f[k] == null) continue;
    wsum += weights[k];
    s += weights[k] * f[k];
  }
  return wsum ? Math.round((s / wsum) * 1000) / 10 : 0;
}

// ---------------------------------------------------------------- hard filters
function passes(t, tr, ctx) {
  const reasons = [];
  const l1 = parse(t.languages) || [];
  const l2 = new Set(parse(tr.languages) || []);
  if (l1.length && l2.size && !l1.some(l => l2.has(l))) reasons.push('language');
  if (t.trainer_gender_pref && tr.gender && t.trainer_gender_pref !== tr.gender) reasons.push('gender');
  if (Number(tr.active_clients) >= Number(tr.max_clients)) reasons.push('capacity');
  const bothOnline = (parse(t.modality) || []).includes('online') && (parse(tr.modality) || []).includes('online');
  if (ctx.distanceKm != null && !bothOnline) {
    const limit = Math.min(Number(t.search_radius_km) || 8, (Number(tr.travel_radius_km) || 5) + 3);
    if (ctx.distanceKm > limit) reasons.push('distance');
  }
  return reasons;
}

// ---------------------------------------------------------------- explanations
const GOAL_TEXT = { 'fat-loss': 'fat loss', 'muscle-gain': 'muscle gain', strength: 'strength', endurance: 'endurance', 'mobility-yoga': 'mobility & yoga', 'sport-specific': 'sport-specific training', 'general-fitness': 'general fitness', 'beginner-onboarding': 'getting started' };
function reasons(t, tr, f, ctx) {
  const out = [];
  const spec = new Set(parse(tr.specializations) || []);
  const shared = (parse(t.goals) || []).filter(g => spec.has(g)).map(g => GOAL_TEXT[g] || g);
  const items = [
    [f.goals, shared.length ? `Specialises in ${shared.slice(0, 2).join(' and ')} (your goal${shared.length > 1 ? 's' : ''})` : null],
    [f.schedule, f.schedule >= 0.5 ? `Free at ${Math.round(f.schedule * 100)}% of the times you are` : null],
    [f.style, f.style >= 0.75 ? 'Coaches the way you like to be coached' : null],
    [f.distance, ctx.distanceKm != null && f.distance >= 0.3 ? `About ${ctx.distanceKm < 1 ? '1' : Math.round(ctx.distanceKm)} km away${tr.gym_name ? `, trains at ${tr.gym_name}` : ''}` : (f.distance === 1 ? 'Coaches online, like you want' : null)],
    [f.personality, f.personality >= 0.75 ? 'Similar personality: organised and motivated the same way' : null],
    [f.budget, f.budget === 1 && tr.price_per_session_inr ? `₹${tr.price_per_session_inr}/session, within your budget` : null],
    [f.level, f.level === 1 ? `Works best with ${t.experience_level || 'people at your level'}s` : null],
    [f.interests, f.interests >= 0.34 ? 'You share interests outside training' : null],
  ];
  for (const [, text] of items.sort((a, b) => (b[0] || 0) - (a[0] || 0))) if (text && out.length < 3) out.push(text);
  return out;
}

/**
 * Ranks trainers for a trainee. ctx: { consents (trainee), trainerConsents(map) }
 * Each trainer row may carry lat/lng; distances are computed here and only an
 * approximate value leaves the server.
 */
function rank(trainee, trainers, { traineeConsents = {}, limit = 50, weights } = {}) {
  const hasLoc = traineeConsents.location !== false && trainee.lat != null;
  const out = [];
  for (const tr of trainers) {
    const trLoc = tr.consent_location !== 0 && tr.lat != null;
    const distanceKm = hasLoc && trLoc ? geo.haversineKm(trainee.lat, trainee.lng, tr.lat, tr.lng) : null;
    const ctx = {
      distanceKm,
      personality: traineeConsents.personality !== false && tr.consent_personality !== 0,
      interests: traineeConsents.interests !== false && tr.consent_interests !== 0,
    };
    if (passes(trainee, tr, ctx).length) continue;
    const f = factors(trainee, tr, ctx);
    const s = score(f, weights);
    const bothOnline = (parse(trainee.modality) || []).includes('online') && (parse(tr.modality) || []).includes('online');
    const onlineOnly = bothOnline && distanceKm != null && distanceKm > (Number(trainee.search_radius_km) || 8);
    out.push({ trainer: tr, score: s, factors: f, distanceKm, onlineOnly, reasons: reasons(trainee, tr, f, onlineOnly ? { ...ctx, distanceKm: null } : ctx) });
  }
  out.sort((a, b) => b.score - a.score || (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  return out.slice(0, limit);
}

const approxKm = d => (d == null ? null : d < 1 ? '<1 km' : `~${Math.round(d)} km`);

module.exports = { factors, score, passes, rank, reasons, loadModel, approxKm, FACTORS, DEFAULT_WEIGHTS, model: () => model };
