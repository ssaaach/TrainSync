// Constraint-based, periodised workout generator (deterministic for a seed).
//
//   generate(profile, library, { seed, weeks }) -> plan JSON
//   weekView(plan, week)                         -> sessions with that week's prescriptions
//   adapt(plan, logs, week)                      -> next-week adjustments from logged sets
//   swapExercise(plan, sessionKey, slot, id, library) -> plan with one exercise swapped
//
// Hard constraints (property-tested over random profiles):
//   - only equipment the user has (bodyweight always allowed)
//   - no exercise, pattern or category contraindicated by a reported limitation
//     or a flagged PAR-Q+ screen; effort capped when required
//   - every session (in its heaviest week) fits the user's session length
//   - weekly hard sets per muscle group within the experience-level cap
// All numbers are tunables in config/training.json and config/contraindications.json.
const T = require('../config/training.json');
const CI = require('../config/contraindications.json');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MUSCLE_GROUP = {
  chest: 'chest', lats: 'back', 'middle back': 'back', 'lower back': 'back', traps: 'shoulders', shoulders: 'shoulders',
  quadriceps: 'quads', hamstrings: 'hamstrings & glutes', glutes: 'hamstrings & glutes', adductors: 'hamstrings & glutes',
  abductors: 'hamstrings & glutes', calves: 'calves', biceps: 'arms', triceps: 'arms', forearms: 'arms', abdominals: 'core', neck: 'other',
};
const PATTERN_FALLBACK = { 'push-v': ['push-h'], 'pull-v': ['pull-h'], squat: ['lunge', 'hinge'], lunge: ['squat', 'hinge'], hinge: ['squat'], carry: ['core'], 'push-h': ['push-v'], 'pull-h': ['pull-v'] };
const HOLD_RE = /\b(plank|hold|hang|wall sit|isometric|l-sit|hollow)\b/i;
const STAPLES = Object.fromEntries(Object.entries(T.staples.patterns).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, new RegExp(v, 'i')]));
const NEEDS_BAR = new RegExp(T.needsBar.names, 'i');
const NEEDS_BENCH = new RegExp(T.needsBench.names, 'i');
const VARIANT = new RegExp(T.staples.variantPenalty.regex, 'i');
const LOW_IMPACT_CARDIO = /bicycl|cycling|bike|rowing|row machine|elliptical|walk|stair|recumbent/i;

// ---------------------------------------------------------------- utils
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Seeded Fisher–Yates shuffle (returns a new array).
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;
const groupOf = ex => MUSCLE_GROUP[(ex.primary_muscles || [])[0]] || 'other';

function normaliseLibrary(rows) {
  return rows.map(r => ({
    ...r,
    exercise_id: Number(r.exercise_id),
    primary_muscles: parse(r.primary_muscles) || [],
    secondary_muscles: parse(r.secondary_muscles) || [],
    instructions: parse(r.instructions) || [],
    images: parse(r.images) || [],
    is_compound: Number(r.is_compound) === 1,
  }));
}

// ---------------------------------------------------------------- profile -> rules
function emphasisFor(p) {
  const goals = p.goals || [];
  for (const rule of T.emphasis.rules) {
    const c = rule.if;
    if (c.goals && goals.includes(c.goals) && (!c.only || goals.length === 1)) return rule.then;
    if (c.goal && c.goal.includes(p.goal)) return rule.then;
  }
  return T.emphasis.default;
}

// Combined safety rules for the user's limitations (+ PAR-Q+ flag).
function safetyFor(p) {
  const keys = [...(p.limitations || [])];
  if (p.health_flagged) keys.push('_parq_flagged');
  if (p.health_unknown && !p.health_flagged) keys.push('_health_unknown');
  const rules = keys.map(k => CI.rules[k]).filter(Boolean);
  const patterns = new Set(rules.flatMap(r => r.patterns || []));
  const categories = new Set(rules.flatMap(r => r.categories || []));
  const names = rules.map(r => r.names).filter(Boolean);
  const nameRe = names.length ? new RegExp(names.join('|'), 'i') : null;
  const caps = rules.map(r => r.rpeCap).filter(Boolean);
  const notices = [];
  for (const k of keys) if (CI.notices[k]) notices.push(CI.notices[k]);
  const plain = (p.limitations || []).filter(k => !CI.notices[k]).map(k => CI.rules[k] && CI.rules[k].label).filter(Boolean);
  if (plain.length) notices.push(CI.notices.default.replace('{labels}', plain.join(', ')));
  return {
    patterns, categories, nameRe,
    rpeCap: caps.length ? Math.min(...caps) : null,
    noFinisher: rules.some(r => r.noFinisher) || Boolean(p.health_flagged),
    lowImpact: keys.some(k => ['knee', 'ankle_foot', 'hip', 'pregnancy', 'heart_condition', 'recent_surgery', '_parq_flagged'].includes(k)),
    notices,
    labels: [...new Set((p.limitations || []).map(k => CI.rules[k] && CI.rules[k].label).filter(Boolean))],
    active: keys.length > 0,
  };
}

function allowedEquipment(p) {
  const eq = new Set(p.equipment && p.equipment.length ? p.equipment : ['body only']);
  eq.add('body only');
  return eq;
}

function contraindicated(ex, safety) {
  if (safety.patterns.has(ex.movement_pattern)) return true;
  if (safety.categories.has(ex.category)) return true;
  if (safety.nameRe && safety.nameRe.test(ex.name)) return true;
  return false;
}

// ---------------------------------------------------------------- selection
function makePicker(library, p, safety, rng) {
  const eq = allowedEquipment(p);
  const levels = new Set(T.levels[p.experience_level] || T.levels.beginner);
  const technical = new Set(['olympic weightlifting', 'strongman']);
  const usable = library.filter(ex => {
    if (ex.is_synthetic) return false;
    const equipOk = ex.equipment ? eq.has(ex.equipment) : ex.movement_pattern === 'mobility';
    if (!equipOk) return false;
    if (NEEDS_BAR.test(ex.name) && !T.needsBar.equipmentAny.some(e => eq.has(e))) return false;
    if (NEEDS_BENCH.test(ex.name) && !T.needsBench.equipmentAny.some(e => eq.has(e))) return false;
    if (!levels.has(ex.level || 'beginner')) return false;
    if (technical.has(ex.category) && p.experience_level !== 'advanced') return false;
    return !contraindicated(ex, safety);
  });
  const byPattern = new Map();
  for (const ex of usable) {
    if (!byPattern.has(ex.movement_pattern)) byPattern.set(ex.movement_pattern, []);
    byPattern.get(ex.movement_pattern).push(ex);
  }

  function score(ex, slot, weekUsed) {
    let s = 0;
    if (weekUsed && weekUsed.has(ex.exercise_id)) s -= T.staples.repeatPenalty;
    if (VARIANT.test(ex.name)) s -= T.staples.variantPenalty[slot.role] || 0;
    if (slot.role === 'compound' || slot.role === 'accessory') s += ex.is_compound ? 4 : -2;
    if (ex.level === p.experience_level || (p.experience_level === 'advanced' && ex.level === 'expert')) s += 2;
    if (p.experience_level === 'beginner' && ex.level === 'beginner') s += 2;
    const staple = STAPLES[ex.movement_pattern];
    if (staple && staple.test(ex.name)) s += T.staples.bonus;
    if (ex.images.length) s += 2;
    if (ex.instructions.length >= 2) s += 1;
    if (ex.category === 'plyometrics' && slot.role !== 'conditioning') s -= 3;
    if (ex.category === 'stretching') s -= 5;
    if (/\b(bosu|chains?|band[s]? with|one[- ]arm.*kettlebell|smith|on (a )?ball)\b/i.test(ex.name)) s -= 1;
    if (p.emphasis === 'strength' && ex.equipment === 'barbell' && slot.role === 'compound') s += 2;
    if (p.experience_level === 'beginner' && ['dumbbell', 'body only', 'machine', 'cable'].includes(ex.equipment)) s += 1;
    return s + rng() * 1.5; // seeded tie-break -> "regenerate" gives variety
  }

  function candidates(slot, sessionUsed) {
    let pool = byPattern.get(slot.pattern) || [];
    if (slot.muscles) pool = pool.filter(ex => slot.muscles.includes(ex.primary_muscles[0]));
    if (slot.role === 'compound' || slot.role === 'accessory') pool = pool.filter(ex => ex.category !== 'stretching');
    return pool.filter(ex => !sessionUsed.has(ex.exercise_id));
  }

  // Returns { exercise, pattern, substituted } or null. Never repeats an
  // exercise inside a session; repeats across the week cost points.
  function pick(slot, sessionUsed, weekUsed) {
    const tries = [slot.pattern, ...(PATTERN_FALLBACK[slot.pattern] || [])];
    for (const pattern of tries) {
      const pool = candidates({ ...slot, pattern }, sessionUsed);
      if (!pool.length) continue;
      const ranked = pool.map(ex => ({ ex, s: score(ex, slot, weekUsed) })).sort((a, b) => b.s - a.s);
      const choice = ranked[0].ex;
      return { exercise: choice, pattern, substituted: pattern !== slot.pattern };
    }
    return null;
  }

  // Up to n alternatives: same pattern, same primary muscle first.
  function alternatives(ex, n = 3) {
    const pool = (byPattern.get(ex.movement_pattern) || []).filter(o => o.exercise_id !== ex.exercise_id);
    const same = pool.filter(o => o.primary_muscles[0] === ex.primary_muscles[0]);
    const rest = pool.filter(o => o.primary_muscles[0] !== ex.primary_muscles[0]);
    const rank = arr => arr.map(o => ({ o, s: (o.images.length ? 1 : 0) + (o.level === ex.level ? 1 : 0) + (o.equipment === ex.equipment ? 0.5 : 0) }))
      .sort((a, b) => b.s - a.s || a.o.exercise_id - b.o.exercise_id).map(x => x.o);
    return [...rank(same), ...rank(rest)].slice(0, n);
  }

  return { pick, alternatives, usable, byPattern };
}

// ---------------------------------------------------------------- prescriptions
function repRange(role, ex, p) {
  const scheme = T.schemes[p.emphasis];
  if (HOLD_RE.test(ex.name)) return { unit: 'sec', range: p.emphasis === 'endurance' ? [40, 60] : [20, 45] };
  if (role === 'carry') return { unit: 'sec', range: [30, 45] };
  if (role === 'core') return { unit: 'reps', range: [10, 15] };
  if (role === 'compound' && p.emphasis === 'strength' && p.experience_level === 'beginner') return { unit: 'reps', range: [...T.beginnerStrengthReps] };
  return { unit: 'reps', range: [...(scheme[role] || scheme.accessory)] };
}

function baseSets(role, slot, p, mod) {
  const scheme = T.schemes[p.emphasis];
  let sets = scheme.sets;
  if (role === 'isolation' || role === 'core' || role === 'carry') sets = Math.min(3, Math.max(2, sets - 1));
  if (role === 'accessory') sets = Math.max(2, sets - (p.emphasis === 'strength' ? 1 : 0));
  if (p.experience_level === 'beginner' && role !== 'compound') sets = Math.max(2, sets - 1);
  if (mod.extraSetOnMain && slot.priority === 1 && role === 'compound') sets += 1;
  return sets;
}

function restFor(role, p) {
  const s = T.schemes[p.emphasis];
  if (role === 'compound') return s.restCompound;
  if (role === 'isolation' || role === 'core' || role === 'carry') return s.restIsolation;
  return s.restAccessory;
}

function modulationFor(p) {
  const table = T.bodyTypeModulation[p.body_type] || T.bodyTypeModulation.unknown;
  return { ...(table.default || {}), ...(table[p.goal] || {}) };
}

// ---------------------------------------------------------------- timing
const workSec = role => T.timing.workSec[role] || 40;

function exerciseSeconds(ex, sets) {
  return sets * (workSec(ex.role) + ex.restSec) + T.timing.transitionSec;
}

// Heaviest week adds periodisation setsDelta to the main (priority-1) lifts.
const MAX_SETS_DELTA = Math.max(...T.periodization.pattern.map(w => w.setsDelta));

function sessionMinutes(session, { heaviest = true } = {}) {
  if (session.mobilityOnly) return T.timing.mobilitySessionMin;
  let s = (session.warmupMin + session.cooldownMin) * 60;
  for (const ex of session.exercises) {
    const extra = heaviest && ex.priority === 1 && session.format !== 'circuit' ? MAX_SETS_DELTA : 0;
    s += exerciseSeconds(ex, ex.sets + extra);
  }
  if (session.finisher) s += session.finisher.minutes * 60;
  if (session.format === 'circuit') s = (session.warmupMin + session.cooldownMin) * 60 + session.circuit.rounds * session.circuit.roundSec + (session.finisher ? session.finisher.minutes * 60 : 0);
  return s / 60;
}

// Trims a session until its heaviest week fits the time budget.
function fitToTime(session, minutes) {
  // Cheapest cuts first; whole exercises go last, main lifts never.
  const steps = [
    () => { if (session.finisher && session.finisher.optional) { session.finisher = null; return true; } return false; },
    () => shortenRests(session),
    () => reduceSets(session, 3),
    () => { if (session.finisher && session.finisher.minutes > 5) { session.finisher.minutes -= 1; return true; } return false; },
    () => reduceSets(session, 2),
    () => { if (session.warmupMin > 4) { session.warmupMin = 4; session.cooldownMin = 2; return true; } return false; },
    () => dropSlot(session, 3),
    () => reduceSets(session, 1),
    () => dropSlot(session, 2),
  ];
  let guard = 200;
  while (sessionMinutes(session) > minutes && guard-- > 0) {
    let changed = false;
    for (const step of steps) {
      if (step()) { changed = true; break; }
    }
    if (!changed) break;
  }
  if (sessionMinutes(session) > minutes) toCircuit(session, minutes);
}

function reduceSets(session, priority) {
  const ex = session.exercises.filter(e => e.priority === priority && e.sets > 2).sort((a, b) => b.sets - a.sets)[0];
  if (!ex) {
    const one = session.exercises.filter(e => e.priority === priority && e.sets > 1 && priority === 1)[0];
    if (one) { one.sets -= 1; return true; }
    return false;
  }
  ex.sets -= 1;
  return true;
}

function dropSlot(session, priority) {
  const i = session.exercises.map(e => e.priority).lastIndexOf(priority);
  if (i === -1 || priority === 1) return false;
  session.dropped.push(session.exercises[i].name);
  session.exercises.splice(i, 1);
  return true;
}

function restFloor(ex) {
  const frac = T.restFloors[ex.emphasis] || T.restFloors.default;
  const abs = ex.role === 'compound' ? T.restFloors.absoluteMinCompound : T.restFloors.absoluteMinOther;
  return Math.max(abs, Math.round((ex.baseRest * frac) / 15) * 15);
}

function shortenRests(session) {
  let changed = false;
  for (const ex of session.exercises) {
    const floor = restFloor(ex);
    if (ex.restSec > floor) { ex.restSec = Math.max(floor, ex.restSec - 15); changed = true; }
  }
  return changed;
}

// Uses leftover time: adds sets (accessories first, then main lifts) while
// the heaviest week still fits.
function topUp(session, minutes, p) {
  if (session.format === 'circuit') return;
  // 1) give back rest that was trimmed (main lifts first)
  for (const ex of [...session.exercises].sort((a, b) => a.priority - b.priority)) {
    while (ex.restSec < ex.baseRest) {
      ex.restSec += 15;
      if (sessionMinutes(session) > minutes) { ex.restSec -= 15; break; }
    }
  }
  // 2) then add sets
  const max = T.timing.maxSets;
  let guard = 60;
  while (guard-- > 0) {
    const order = [...session.exercises].sort((a, b) => a.sets - b.sets || a.priority - b.priority);
    let added = false;
    for (const ex of order) {
      const cap = Math.min(max[ex.role] || 4, p.experience_level === 'beginner' ? 4 : 5);
      if (ex.sets >= cap) continue;
      ex.sets += 1;
      if (sessionMinutes(session) <= minutes) { added = true; break; }
      ex.sets -= 1;
    }
    if (!added) return;
  }
}

// Last resort for very short sessions: priority-1 lifts as a timed circuit.
function toCircuit(session, minutes) {
  session.warmupMin = 3;
  session.cooldownMin = 2;
  session.exercises = session.exercises.filter(e => e.priority === 1);
  for (const ex of session.exercises) { ex.restSec = 15; ex.priority = 3; } // circuits don't get extra sets
  const roundSec = session.exercises.reduce((s, e) => s + workSec(e.role) + 15, 0) + 60;
  const available = (minutes - 5 - (session.finisher ? session.finisher.minutes : 0)) * 60;
  if (available < roundSec) session.finisher = null;
  const rounds = clamp(Math.floor(((minutes - 5 - (session.finisher ? session.finisher.minutes : 0)) * 60) / roundSec), 1, 4);
  session.format = 'circuit';
  session.circuit = { rounds, roundSec };
  for (const ex of session.exercises) ex.sets = rounds;
}

// ---------------------------------------------------------------- warm-up, finisher, mobility
function warmupFor(session, mobility, rng) {
  const drills = mobility.filter(m => /dynamic|circle|swing|cat|world|leg swing|arm circle|hip|thoracic|ankle/i.test(m.name));
  const pool = drills.length >= 2 ? drills : mobility;
  const chosen = shuffle(pool, rng).slice(0, 2);
  return [
    { name: 'Easy cardio to warm up (brisk walk, bike or skipping on the spot)', minutes: 3 },
    ...chosen.map(m => ({ exerciseId: m.exercise_id, name: m.name, dose: '2 × 30 s' })),
    { name: 'Two light ramp-up sets of your first lift', dose: '8 and 5 reps' },
  ];
}

function cooldownFor(session, mobility, rng) {
  const muscles = new Set(session.exercises.flatMap(e => e.primaryMuscles));
  const matched = mobility.filter(m => muscles.has(m.primary_muscles[0]) && /stretch/i.test(m.name));
  const pool = matched.length >= 2 ? matched : mobility.filter(m => /stretch/i.test(m.name));
  return shuffle(pool, rng).slice(0, 2).map(m => ({ exerciseId: m.exercise_id, name: m.name, dose: '2 × 30 s each side' }));
}

function finisherFor(picker, p, safety, mod, rng) {
  if (safety.noFinisher) return null;
  const wants = mod.finisher || p.emphasis === 'fat-loss' || p.emphasis === 'endurance';
  if (!wants) return null;
  let pool = (picker.byPattern.get('cardio') || []);
  if (safety.lowImpact) pool = pool.filter(ex => LOW_IMPACT_CARDIO.test(ex.name));
  const ex = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  const minutes = p.emphasis === 'endurance' ? 12 : T.timing.finisherMin;
  return {
    exerciseId: ex ? ex.exercise_id : null,
    name: ex ? ex.name : (safety.lowImpact ? 'Brisk incline walk' : 'Brisk walk or easy jog'),
    minutes,
    protocol: p.experience_level === 'beginner' || safety.lowImpact
      ? `${minutes} min steady, at a pace where you can talk in short sentences`
      : `${minutes} min intervals: 30 s hard / 30 s easy`,
    why: mod.note || (p.emphasis === 'fat-loss' ? 'Extra energy burn to support your calorie deficit.' : 'Builds your aerobic base.'),
    optional: p.emphasis !== 'fat-loss' && p.emphasis !== 'endurance',
  };
}

function mobilitySession(mobility, rng) {
  const chosen = shuffle(mobility, rng).slice(0, 7);
  return chosen.map(m => ({ exerciseId: m.exercise_id, name: m.name, dose: '2 × 45 s', images: m.images, instructions: m.instructions }));
}

// ---------------------------------------------------------------- explanations
function whyExercise(ex, slot, p, safety, substituted) {
  const parts = [];
  const roleText = { compound: 'Main lift', accessory: 'Supporting lift', isolation: 'Targeted accessory', core: 'Core work', carry: 'Loaded carry' }[slot.role];
  parts.push(`${roleText} for the ${slot.pattern.replace('-h', ' (horizontal)').replace('-v', ' (vertical)')} pattern`);
  if (substituted) parts.push(`stands in for ${slot.originalPattern} work, which your profile rules out`);
  if (ex.equipment === 'body only') parts.push('needs no equipment');
  else parts.push(`uses your ${ex.equipment}`);
  if (p.experience_level === 'beginner' && ex.level === 'beginner') parts.push('beginner-friendly');
  if (safety.active && safety.labels.length) parts.push(`safe with your ${safety.labels.join(' / ')} note`);
  return `${parts.join('; ')}.`;
}

// ---------------------------------------------------------------- schedule
function trainingDays(p, count) {
  const available = DAYS.filter(d => p.schedule && p.schedule[d] && p.schedule[d].length);
  const layout = T.dayLayouts[String(count)];
  if (available.length >= count) {
    // Spread across the user's free days: take evenly spaced picks.
    const out = [];
    for (let i = 0; i < count; i++) out.push(available[Math.floor((i * available.length) / count)]);
    return [...new Set(out)].length === count ? out : available.slice(0, count);
  }
  return layout;
}

function periodisedWeeks(total) {
  const pat = T.periodization.pattern;
  const weeks = [];
  for (let w = 1; w <= total; w++) {
    const tmpl = pat[(w - 1) % T.periodization.blockLength];
    weeks.push({ week: w, block: Math.floor((w - 1) / T.periodization.blockLength) + 1, ...tmpl, deload: tmpl.phase === 'deload' });
  }
  return weeks;
}

// ---------------------------------------------------------------- main
/**
 * profile: { goal, goals[], experience_level, days_per_week, session_minutes,
 *            equipment[], limitations[], health_flagged, body_type, sex, weight_kg,
 *            schedule{} }
 * library: exercise rows (DB or tests/fixtures/exercises.json)
 */
function generate(profileIn, libraryRows, { seed = 1, weeks } = {}) {
  const library = normaliseLibrary(libraryRows);
  const p = {
    goal: profileIn.goal || 'maintenance',
    goals: profileIn.goals || [],
    experience_level: profileIn.experience_level || 'beginner',
    days_per_week: clamp(Number(profileIn.days_per_week) || 3, 1, 7),
    session_minutes: clamp(Number(profileIn.session_minutes) || 45, 15, 150),
    equipment: profileIn.equipment || ['body only'],
    limitations: profileIn.limitations || [],
    health_flagged: Boolean(profileIn.health_flagged),
    health_unknown: Boolean(profileIn.health_unknown),
    body_type: profileIn.body_type || 'unknown',
    weight_kg: Number(profileIn.weight_kg) || null,
    schedule: profileIn.schedule || null,
  };
  p.emphasis = emphasisFor(p);
  const rng = mulberry32(seed);
  const safety = safetyFor(p);
  const mod = modulationFor(p);
  const picker = makePicker(library, p, safety, rng);
  const mobility = (picker.byPattern.get('mobility') || []);
  const baseRpe = T.rpe[p.experience_level];
  const rpeCap = safety.rpeCap || (p.health_flagged ? T.cautiousRpeCap : null);
  const totalWeeks = clamp(weeks || T.weeks.default[p.experience_level], T.weeks.min, T.weeks.max);
  const split = T.splits[String(p.days_per_week)];

  const used = new Set();
  const sessions = {};
  const unfilled = [];
  for (const key of split.sessions) {
    const tpl = T.templates[key];
    if (tpl.mobilityOnly) {
      sessions[key] = { key, name: tpl.name, focus: tpl.focus, mobilityOnly: true, drills: mobilitySession(mobility, rng), estMinutes: T.timing.mobilitySessionMin };
      continue;
    }
    const session = { key, name: tpl.name, focus: tpl.focus, warmupMin: T.timing.warmupMin, cooldownMin: T.timing.cooldownMin, exercises: [], dropped: [], format: 'sets' };
    const sessionUsed = new Set();
    for (const slot of tpl.slots) {
      const hit = picker.pick(slot, sessionUsed, used);
      if (!hit) { unfilled.push(`${tpl.name}: ${slot.pattern}`); continue; }
      const ex = hit.exercise;
      sessionUsed.add(ex.exercise_id);
      used.add(ex.exercise_id);
      const role = hit.pattern === 'core' && slot.role === 'carry' ? 'core' : slot.role;
      const reps = repRange(role, ex, p);
      session.exercises.push({
        slot: session.exercises.length,
        role,
        priority: slot.priority,
        pattern: hit.pattern,
        exerciseId: ex.exercise_id,
        name: ex.name,
        equipment: ex.equipment,
        primaryMuscles: ex.primary_muscles,
        group: groupOf(ex),
        images: ex.images.slice(0, 2),
        instructions: ex.instructions,
        sets: baseSets(role, slot, p, mod),
        unit: reps.unit,
        reps: reps.range,
        rpe: rpeCap ? Math.min(baseRpe, rpeCap) : baseRpe,
        restSec: restFor(role, p),
        baseRest: restFor(role, p),
        emphasis: p.emphasis,
        why: whyExercise(ex, { ...slot, role, originalPattern: slot.pattern }, p, safety, hit.substituted),
        alternatives: picker.alternatives(ex).map(o => ({ exerciseId: o.exercise_id, name: o.name, equipment: o.equipment })),
      });
    }
    session.finisher = finisherFor(picker, p, safety, mod, rng);
    fitToTime(session, p.session_minutes);
    topUp(session, p.session_minutes, p);
    session.warmup = warmupFor(session, mobility, rng);
    session.cooldown = cooldownFor(session, mobility, rng);
    if (p.emphasis === 'mobility') {
      session.mobilityBlock = shuffle(mobility, rng).slice(0, 2).map(m => ({ exerciseId: m.exercise_id, name: m.name, dose: '2 × 45 s' }));
    }
    sessions[key] = session;
  }

  enforceVolumeCaps(sessions, split.sessions, p);
  for (const s of Object.values(sessions)) if (!s.mobilityOnly) s.estMinutes = Math.round(sessionMinutes(s, { heaviest: false }));

  const days = trainingDays(p, split.sessions.length);
  const schedule = Object.fromEntries(DAYS.map(d => [d, null]));
  days.forEach((d, i) => { schedule[d] = split.sessions[i]; });

  const kcalPerMin = met => (p.weight_kg ? (met * 3.5 * p.weight_kg) / 200 : null);
  for (const s of Object.values(sessions)) {
    const met = s.mobilityOnly ? T.met.mobility : (s.format === 'circuit' ? T.met.circuit : T.met.resistance);
    const perMin = kcalPerMin(met);
    s.estKcal = perMin ? Math.round(perMin * s.estMinutes) : null;
  }

  const weeksOut = periodisedWeeks(totalWeeks);
  const scheme = T.schemes[p.emphasis];
  const volume = weeklyVolume(sessions, split.sessions);
  const plan = {
    kind: 'workout',
    generatorVersion: T.version,
    seed,
    createdAt: new Date().toISOString(),
    profile: {
      goal: p.goal, goals: p.goals, emphasis: p.emphasis, experience: p.experience_level, daysPerWeek: p.days_per_week,
      sessionMinutes: p.session_minutes, equipment: [...allowedEquipment(p)], limitations: p.limitations,
      healthFlagged: p.health_flagged, bodyType: p.body_type,
    },
    summary: {
      split: split.name,
      weeks: totalWeeks,
      emphasis: p.emphasis,
      schemeLabel: scheme.label,
      stepsTarget: mod.steps || 8000,
      rpeTarget: rpeCap ? Math.min(baseRpe, rpeCap) : baseRpe,
      rpeCap,
      weeklySetsByGroup: volume,
    },
    safety: { notices: safety.notices, capped: Boolean(rpeCap), excludedFor: safety.labels },
    sessions,
    schedule,
    weeks: weeksOut,
    progression: progressionRule(p),
    reasoning: reasoning(p, split, scheme, mod, safety, volume, totalWeeks, unfilled),
  };
  return plan;
}

// Weekly hard sets per muscle group (primary muscle; sessions as scheduled).
function weeklyVolume(sessions, order) {
  const out = {};
  for (const key of order) {
    const s = sessions[key];
    if (!s || s.mobilityOnly) continue;
    for (const ex of s.exercises) {
      if (ex.role === 'carry') continue;
      out[ex.group] = (out[ex.group] || 0) + ex.sets;
    }
  }
  return out;
}

// Trims accessory sets where a muscle group exceeds the level's weekly cap
// (in the heaviest week).
function enforceVolumeCaps(sessions, order, p) {
  const [, cap] = T.weeklySetsPerMuscle[p.experience_level];
  const heavy = () => {
    const v = {};
    for (const key of order) {
      const s = sessions[key];
      if (!s || s.mobilityOnly) continue;
      for (const ex of s.exercises) {
        if (ex.role === 'carry') continue;
        v[ex.group] = (v[ex.group] || 0) + ex.sets + (ex.priority === 1 && s.format !== 'circuit' ? MAX_SETS_DELTA : 0);
      }
    }
    return v;
  };
  let guard = 500;
  for (let v = heavy(); guard-- > 0; v = heavy()) {
    const over = Object.entries(v).find(([g, n]) => g !== 'other' && n > cap);
    if (!over) break;
    const [group] = over;
    const candidates = order.flatMap(k => (sessions[k].exercises || []).filter(e => e.group === group && e.sets > 1))
      .sort((a, b) => b.priority - a.priority || b.sets - a.sets);
    if (!candidates.length) break;
    candidates[0].sets -= 1;
  }
}

function progressionRule(p) {
  const lower = p.experience_level === 'beginner' ? '2.5 kg' : '5 kg';
  return {
    rule: `Double progression: when you reach the top of the rep range on every set at or below the target RPE, add weight next time (about 2.5 kg for upper-body lifts, ${lower} for lower-body lifts, or the next dumbbell up) and start again at the bottom of the range. For bodyweight moves, add reps, slow the lowering phase, or pick the harder variation.`,
    rpeGuide: 'RPE 10 = could not do another rep; RPE 8 = 2 reps left; RPE 7 = 3 reps left; RPE 6 = 4 or more left.',
  };
}

function reasoning(p, split, scheme, mod, safety, volume, weeks, unfilled) {
  const out = [];
  out.push(`${split.name} split for ${p.days_per_week} day${p.days_per_week > 1 ? 's' : ''} a week: every major movement pattern is trained ${p.days_per_week >= 4 ? 'twice' : p.days_per_week === 1 ? 'once' : 'at least once'} a week.`);
  out.push(`${scheme.label}, because your goal is ${p.emphasis.replace('-', ' ')}.`);
  out.push(`Effort target RPE ${safety.rpeCap ? Math.min(T.rpe[p.experience_level], safety.rpeCap) : T.rpe[p.experience_level]} for a ${p.experience_level}: hard, but with reps in reserve so technique stays clean.`);
  out.push(`A ${weeks}-week block: build volume, then intensity, with a lighter deload week every 4th week so you recover and keep progressing.`);
  out.push(`Every session is built to fit your ${p.session_minutes} minutes, including warm-up and cool-down, even in the heaviest week.`);
  const groups = Object.entries(volume).filter(([g]) => g !== 'other').map(([g, n]) => `${g} ${n}`).join(', ');
  if (groups) out.push(`Weekly hard sets per muscle group: ${groups} (kept within ${T.weeklySetsPerMuscle[p.experience_level].join('–')} for your level).`);
  if (mod.note) out.push(mod.note);
  if (p.body_type && p.body_type !== 'unknown') out.push(`Daily step target ${mod.steps || 8000}, set for an estimated ${p.body_type} build with a ${p.goal} goal.`);
  if (safety.active) out.push(...safety.notices);
  if (unfilled.length) out.push(`Some slots had no safe match with your equipment (${unfilled.join('; ')}); adding equipment in your profile widens the choice.`);
  return out;
}

// ---------------------------------------------------------------- week view
function weekView(plan, weekNo) {
  const week = plan.weeks[clamp(weekNo, 1, plan.weeks.length) - 1];
  const cap = plan.summary.rpeCap;
  const sessions = {};
  for (const [key, s] of Object.entries(plan.sessions)) {
    if (s.mobilityOnly) { sessions[key] = s; continue; }
    sessions[key] = {
      ...s,
      exercises: s.exercises.map(ex => {
        const extra = ex.priority === 1 && s.format !== 'circuit' ? week.setsDelta : (week.deload ? -1 : 0);
        const shift = ex.unit === 'reps' && ex.role !== 'core' ? week.repShift : 0;
        const lo = Math.max(1, ex.reps[0] - shift);
        const hi = Math.max(lo, ex.reps[1] - shift);
        let rpe = ex.rpe + week.rpeDelta;
        if (cap) rpe = Math.min(rpe, cap);
        return { ...ex, sets: Math.max(1, ex.sets + extra), reps: [lo, hi], rpe: clamp(round1(rpe), 5, 9.5) };
      }),
    };
  }
  return { week: week.week, phase: week.phase, deload: week.deload, note: week.note, schedule: plan.schedule, sessions };
}

// Compact prescriptions for every week: { week, phase, deload, note,
// rx: { sessionKey: { slot: [sets, [lo, hi], rpe] } } } — the client merges
// these onto plan.sessions instead of downloading full week views.
function allWeekRx(plan) {
  return plan.weeks.map(w => {
    const v = weekView(plan, w.week);
    const rx = {};
    for (const [key, s] of Object.entries(v.sessions)) {
      if (s.mobilityOnly) continue;
      rx[key] = Object.fromEntries(s.exercises.map(e => [e.slot, [e.sets, e.reps, e.rpe]]));
    }
    return { week: w.week, phase: w.phase, deload: w.deload, note: w.note, rx };
  });
}

// ---------------------------------------------------------------- adaptation
/**
 * logs: [{ date, exerciseId, set, reps, load_kg, rpe, done }] for the week.
 * Returns suggestions for the next week (never changes the stored plan by itself).
 */
function adapt(plan, logs, weekNo) {
  const view = weekView(plan, weekNo);
  const planned = Object.values(plan.schedule).filter(Boolean).length;
  const doneDays = new Set(logs.filter(l => l.done).map(l => l.date)).size;
  const adherence = planned ? doneDays / planned : 0;
  const byEx = new Map();
  for (const l of logs) {
    if (!byEx.has(l.exerciseId)) byEx.set(l.exerciseId, []);
    byEx.get(l.exerciseId).push(l);
  }
  const adjustments = [];
  for (const s of Object.values(view.sessions)) {
    for (const ex of s.exercises || []) {
      const sets = byEx.get(ex.exerciseId);
      if (!sets || !sets.length) continue;
      const rpes = sets.map(x => Number(x.rpe)).filter(Number.isFinite);
      const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
      const hitTop = sets.filter(x => x.done && Number(x.reps) >= ex.reps[1]).length >= ex.sets;
      const loads = sets.map(x => Number(x.load_kg)).filter(Number.isFinite);
      const load = loads.length ? Math.max(...loads) : null;
      const lower = ['squat', 'hinge', 'lunge'].includes(ex.pattern);
      if (avgRpe !== null && avgRpe > ex.rpe + 1) {
        adjustments.push({ exerciseId: ex.exerciseId, name: ex.name, change: 'reduce', detail: `Felt harder than planned (RPE ${round1(avgRpe)} vs ${ex.rpe}). Drop the load about 5%${load ? ` (to ~${round1(load * 0.95)} kg)` : ''} and rebuild.` });
      } else if (hitTop && (avgRpe === null || avgRpe <= ex.rpe)) {
        const inc = ex.equipment === 'body only' ? null : (lower ? (plan.profile.experience === 'beginner' ? 2.5 : 5) : 2.5);
        adjustments.push({ exerciseId: ex.exerciseId, name: ex.name, change: 'progress', detail: inc && load ? `All sets at the top of the range: go to ~${round1(load + inc)} kg.` : 'All sets at the top of the range: add reps or use a harder variation.' });
      } else {
        adjustments.push({ exerciseId: ex.exerciseId, name: ex.name, change: 'hold', detail: 'Stay at this weight and add reps until you hit the top of the range on every set.' });
      }
    }
  }
  const notes = [];
  let volumeChange = 0;
  if (planned && adherence < 0.6) {
    volumeChange = -1;
    notes.push(`You completed ${doneDays} of ${planned} sessions. Next week trims one set from accessories so the plan fits your week; consistency beats volume.`);
  } else if (adherence >= 0.9) {
    notes.push('Great consistency. Keep it up: progression only works when you show up.');
  }
  const next = plan.weeks[weekNo] || null;
  if (next) notes.push(`Next week (${next.phase}): ${next.note}`);
  return { week: weekNo, adherence: Math.round(adherence * 100) / 100, doneDays, planned, volumeChange, adjustments, notes };
}

// ---------------------------------------------------------------- swaps
function swapExercise(plan, sessionKey, slot, exerciseId, libraryRows) {
  const session = plan.sessions[sessionKey];
  if (!session || session.mobilityOnly) throw new RangeError('Unknown session');
  const ex = session.exercises.find(e => e.slot === slot);
  if (!ex) throw new RangeError('Unknown exercise slot');
  const alt = ex.alternatives.find(a => a.exerciseId === exerciseId);
  if (!alt) throw new RangeError('That exercise is not one of the safe alternatives for this slot');
  const lib = normaliseLibrary(libraryRows);
  const next = lib.find(e => e.exercise_id === exerciseId);
  if (!next) throw new RangeError('Exercise not found');
  const oldAlt = { exerciseId: ex.exerciseId, name: ex.name, equipment: ex.equipment };
  Object.assign(ex, {
    exerciseId: next.exercise_id, name: next.name, equipment: next.equipment, primaryMuscles: next.primary_muscles,
    group: groupOf(next), images: next.images.slice(0, 2), instructions: next.instructions,
    why: `${ex.why.split(';')[0]}; your swap.`,
    alternatives: [oldAlt, ...ex.alternatives.filter(a => a.exerciseId !== exerciseId)].slice(0, 3),
  });
  return plan;
}

module.exports = {
  generate, weekView, allWeekRx, adapt, swapExercise, sessionMinutes, weeklyVolume, safetyFor, emphasisFor, allowedEquipment,
  contraindicated, normaliseLibrary, mulberry32, VERSION: T.version,
};
