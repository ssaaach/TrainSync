// Workout generator: hard constraints over 500 random profiles, plus
// determinism, periodisation, adaptation and swaps. Uses the committed
// free-exercise-db snapshot, so no database is needed.
const g = require('../../services/workoutGenerator');
const T = require('../../config/training.json');
const CI = require('../../config/contraindications.json');
const vocab = require('../../config/profile_vocab.json');
const LIB = require('../fixtures/exercises.json').exercises;

const byId = new Map(g.normaliseLibrary(LIB).map(e => [e.exercise_id, e]));
const NEEDS_BAR = new RegExp(T.needsBar.names, 'i');
const NEEDS_BENCH = new RegExp(T.needsBench.names, 'i');

function randomProfile(rng) {
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const some = (arr, max) => arr.filter(() => rng() < max / arr.length);
  const equipment = rng() < 0.35 ? ['body only'] : ['body only', ...some(vocab.equipment.filter(e => e !== 'body only'), 4)];
  return {
    goal: pick(vocab.bodyGoals),
    goals: some(vocab.goals, 2),
    experience_level: pick(vocab.experienceLevels),
    days_per_week: 1 + Math.floor(rng() * 7),
    session_minutes: pick([15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120]),
    equipment,
    limitations: rng() < 0.45 ? some(vocab.limitations, 2) : [],
    health_flagged: rng() < 0.15,
    body_type: pick(['ectomorph', 'mesomorph', 'endomorph', null]),
    weight_kg: 50 + Math.floor(rng() * 50),
  };
}

function allExerciseIds(plan) {
  const ids = [];
  for (const s of Object.values(plan.sessions)) {
    if (s.mobilityOnly) { ids.push(...s.drills.map(d => d.exerciseId)); continue; }
    ids.push(...s.exercises.map(e => e.exerciseId));
    ids.push(...s.warmup.filter(w => w.exerciseId).map(w => w.exerciseId));
    ids.push(...s.cooldown.map(c => c.exerciseId));
    if (s.finisher && s.finisher.exerciseId) ids.push(s.finisher.exerciseId);
    if (s.mobilityBlock) ids.push(...s.mobilityBlock.map(m => m.exerciseId));
  }
  return ids;
}

describe('hard constraints over 500 random profiles', () => {
  const rng = g.mulberry32(20260924);
  const cases = Array.from({ length: 500 }, (_, i) => {
    const profile = randomProfile(rng);
    return { profile, plan: g.generate(profile, LIB, { seed: i + 1 }) };
  });

  test('only the user\'s equipment (bodyweight always allowed; bar/bench work only when available)', () => {
    const bad = [];
    for (const { profile, plan } of cases) {
      const eq = g.allowedEquipment(profile);
      for (const id of allExerciseIds(plan)) {
        const ex = byId.get(id);
        const ok = ex.equipment ? eq.has(ex.equipment) : ex.movement_pattern === 'mobility';
        const bar = !NEEDS_BAR.test(ex.name) || T.needsBar.equipmentAny.some(e => eq.has(e));
        const bench = !NEEDS_BENCH.test(ex.name) || T.needsBench.equipmentAny.some(e => eq.has(e));
        if (!ok || !bar || !bench) bad.push(`${ex.name} (${ex.equipment}) for ${[...eq]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('nothing contraindicated by limitations or a flagged health screen (incl. warm-ups and finishers)', () => {
    const bad = [];
    for (const { profile, plan } of cases) {
      const safety = g.safetyFor(profile);
      for (const id of allExerciseIds(plan)) {
        if (g.contraindicated(byId.get(id), safety)) bad.push(`${byId.get(id).name} with ${profile.limitations}${profile.health_flagged ? ' +flag' : ''}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every session fits the time budget in its heaviest week', () => {
    const over = [];
    for (const { profile, plan } of cases) {
      for (const s of Object.values(plan.sessions)) {
        if (s.mobilityOnly) continue;
        const m = g.sessionMinutes(s);
        if (m > profile.session_minutes + 1e-9) over.push(`${s.name}: ${m.toFixed(1)} > ${profile.session_minutes}`);
      }
    }
    expect(over).toEqual([]);
  });

  test('weekly hard sets per muscle group never exceed the level cap, in any week', () => {
    const over = [];
    for (const { profile, plan } of cases) {
      const cap = T.weeklySetsPerMuscle[profile.experience_level][1];
      for (let w = 1; w <= plan.weeks.length; w++) {
        const view = g.weekView(plan, w);
        const vol = {};
        for (const key of Object.values(plan.schedule).filter(Boolean)) {
          const s = view.sessions[key];
          if (s.mobilityOnly) continue;
          for (const ex of s.exercises) if (ex.role !== 'carry' && ex.group !== 'other') vol[ex.group] = (vol[ex.group] || 0) + ex.sets;
        }
        for (const [grp, n] of Object.entries(vol)) if (n > cap) over.push(`${grp} ${n} > ${cap} (week ${w})`);
      }
    }
    expect(over).toEqual([]);
  });

  test('effort is capped whenever a limitation or the health screen requires it', () => {
    const bad = [];
    for (const { profile, plan } of cases) {
      const caps = [...profile.limitations.map(l => CI.rules[l] && CI.rules[l].rpeCap), profile.health_flagged ? CI.rules._parq_flagged.rpeCap : null].filter(Boolean);
      if (!caps.length) continue;
      const cap = Math.min(...caps);
      for (let w = 1; w <= plan.weeks.length; w++) {
        for (const s of Object.values(g.weekView(plan, w).sessions)) {
          for (const ex of s.exercises || []) if (ex.rpe > cap) bad.push(`${ex.name} RPE ${ex.rpe} > ${cap}`);
        }
      }
      if (profile.health_flagged) {
        for (const s of Object.values(plan.sessions)) if (s.finisher) bad.push(`finisher despite flag: ${s.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('sessions are never empty, prescriptions are well-formed and schedules match the days', () => {
    for (const { profile, plan } of cases) {
      expect(Object.values(plan.schedule).filter(Boolean)).toHaveLength(profile.days_per_week);
      for (const s of Object.values(plan.sessions)) {
        if (s.mobilityOnly) { expect(s.drills.length).toBeGreaterThan(0); continue; }
        expect(s.exercises.length).toBeGreaterThan(0);
        for (const ex of s.exercises) {
          expect(ex.sets).toBeGreaterThanOrEqual(1);
          expect(ex.reps[0]).toBeLessThanOrEqual(ex.reps[1]);
          expect(ex.why.length).toBeGreaterThan(10);
        }
      }
      expect(plan.reasoning.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('behaviour', () => {
  const profile = {
    goal: 'lean-bulk', goals: ['muscle-gain'], experience_level: 'intermediate', days_per_week: 4, session_minutes: 60,
    equipment: ['barbell', 'dumbbell', 'cable', 'machine'], limitations: [], body_type: 'mesomorph', weight_kg: 70,
  };

  test('deterministic for a seed; a new seed gives a variation', () => {
    const a = g.generate(profile, LIB, { seed: 5 });
    const b = g.generate(profile, LIB, { seed: 5 });
    const c = g.generate(profile, LIB, { seed: 99 });
    const ids = p => Object.values(p.sessions).flatMap(s => s.exercises.map(e => e.exerciseId));
    expect(ids(a)).toEqual(ids(b));
    expect(ids(c)).not.toEqual(ids(a));
  });

  test('emphasis follows goals', () => {
    expect(g.emphasisFor({ goals: ['strength'], goal: 'cut' })).toBe('strength');
    expect(g.emphasisFor({ goals: [], goal: 'bulk' })).toBe('hypertrophy');
    expect(g.emphasisFor({ goals: ['fat-loss'], goal: 'maintenance' })).toBe('fat-loss');
    expect(g.emphasisFor({ goals: ['mobility-yoga'], goal: 'maintenance' })).toBe('mobility');
    expect(g.emphasisFor({ goals: [], goal: 'maintenance' })).toBe('general');
  });

  test('splits by days and a deload every 4th week', () => {
    expect(g.generate({ ...profile, days_per_week: 3 }, LIB).summary.split).toBe('Full body (A/B/C)');
    expect(g.generate({ ...profile, days_per_week: 6 }, LIB).summary.split).toBe('Push / pull / legs ×2');
    const plan = g.generate(profile, LIB, { weeks: 12 });
    expect(plan.weeks.filter(w => w.deload).map(w => w.week)).toEqual([4, 8, 12]);
    const w1 = g.weekView(plan, 1);
    const w3 = g.weekView(plan, 3);
    const w4 = g.weekView(plan, 4);
    const main = view => Object.values(view.sessions)[0].exercises[0];
    expect(main(w3).reps[1]).toBeLessThan(main(w1).reps[1]); // intensification: lower reps
    expect(main(w4).sets).toBeLessThan(main(w3).sets);       // deload: fewer sets
    expect(main(w4).rpe).toBeLessThan(main(w3).rpe);
  });

  test('body-type modulation: endomorph cutting gets finishers; ectomorph bulking gets none and more steps are lower', () => {
    const endo = g.generate({ ...profile, goal: 'cut', goals: ['fat-loss'], body_type: 'endomorph' }, LIB);
    const ecto = g.generate({ ...profile, goal: 'bulk', goals: ['muscle-gain'], body_type: 'ectomorph' }, LIB);
    expect(Object.values(endo.sessions).every(s => s.finisher)).toBe(true);
    expect(Object.values(ecto.sessions).some(s => s.finisher)).toBe(false);
    expect(endo.summary.stepsTarget).toBeGreaterThan(ecto.summary.stepsTarget);
  });

  test('uses the user\'s free days when the schedule allows', () => {
    const plan = g.generate({ ...profile, days_per_week: 3, schedule: { tue: ['morning'], thu: ['evening'], sat: ['morning'], sun: ['morning'] } }, LIB);
    const days = Object.entries(plan.schedule).filter(([, v]) => v).map(([d]) => d);
    expect(days.every(d => ['tue', 'thu', 'sat', 'sun'].includes(d))).toBe(true);
  });

  test('adapt(): progress, hold and reduce from logged sets; low adherence trims volume', () => {
    const plan = g.generate(profile, LIB, { seed: 3 });
    const view = g.weekView(plan, 1);
    const [a, b, c] = Object.values(view.sessions)[0].exercises;
    const logs = [
      ...Array.from({ length: a.sets }, (_, i) => ({ date: '2026-09-21', exerciseId: a.exerciseId, set: i + 1, reps: a.reps[1], load_kg: 60, rpe: a.rpe - 0.5, done: true })),
      ...Array.from({ length: b.sets }, (_, i) => ({ date: '2026-09-21', exerciseId: b.exerciseId, set: i + 1, reps: b.reps[0], load_kg: 40, rpe: b.rpe, done: true })),
      ...Array.from({ length: c.sets }, (_, i) => ({ date: '2026-09-21', exerciseId: c.exerciseId, set: i + 1, reps: c.reps[0], load_kg: 20, rpe: c.rpe + 2, done: true })),
    ];
    const out = g.adapt(plan, logs, 1);
    const change = id => out.adjustments.find(x => x.exerciseId === id).change;
    expect(change(a.exerciseId)).toBe('progress');
    expect(change(b.exerciseId)).toBe('hold');
    expect(change(c.exerciseId)).toBe('reduce');
    expect(out.adherence).toBe(0.25);
    expect(out.volumeChange).toBe(-1);
    expect(out.notes.join(' ')).toMatch(/1 of 4 sessions/);
  });

  test('swapExercise only accepts the listed safe alternatives', () => {
    const plan = g.generate(profile, LIB, { seed: 3 });
    const [key] = Object.keys(plan.sessions);
    const ex = plan.sessions[key].exercises[0];
    const originalId = ex.exerciseId;
    const alt = ex.alternatives[0];
    g.swapExercise(plan, key, ex.slot, alt.exerciseId, LIB);
    expect(plan.sessions[key].exercises[0].exerciseId).toBe(alt.exerciseId);
    // The swapped-out exercise becomes one of the alternatives (you can swap back).
    expect(plan.sessions[key].exercises[0].alternatives.map(a => a.exerciseId)).toContain(originalId);
    expect(() => g.swapExercise(plan, key, 0, 999999, LIB)).toThrow(/safe alternatives/);
  });

  test('pregnancy and heart conditions: no supine/impact work, capped effort, clear notices', () => {
    const plan = g.generate({ ...profile, limitations: ['pregnancy'] }, LIB);
    const names = Object.values(plan.sessions).flatMap(s => s.exercises.map(e => e.name)).join(' | ');
    expect(names).not.toMatch(/bench press|crunch|lying|jump/i);
    expect(plan.summary.rpeCap).toBe(6);
    expect(plan.safety.notices.join(' ')).toMatch(/obstetrician|midwife/);
    const heart = g.generate({ ...profile, limitations: ['heart_condition'] }, LIB);
    expect(Object.values(heart.sessions).some(s => s.finisher)).toBe(false);
  });
});
