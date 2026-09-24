// Maps a free-exercise-db record to a movement pattern used by the workout
// generator's slot templates. Rules are checked in order; first match wins.
//
// Patterns: squat, hinge, push-h, push-v, pull-h, pull-v, lunge, carry, core,
// cardio (conditioning), isolation (single-joint accessories), mobility.

const LOWER = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);

const RULES = [
  ['mobility', e => e.category === 'stretching' || /\b(stretch|smr|foam roll|mobility)\b/.test(e.name) || e.equipment === 'foam roll'],
  ['cardio', e => e.category === 'cardio'],
  ['cardio', e => e.category === 'plyometrics' && LOWER.has(e.primary)],
  ['carry', e => /\b(farmer|carry|yoke|suitcase|waiter'?s? walk|sled drag|sled push)\b/.test(e.name)],
  ['lunge', e => /\b(lunges?|split squats?|step[- ]?ups?|bulgarian|pistol)\b/.test(e.name)],
  ['hinge', e => /\b(deadlift|good ?morning|hip thrust|glute bridge|bridge|kettlebell swing|swing|romanian|rdl|pull[- ]through|hyperextension|back extension|clean|snatch|glute ham|reverse hyper)\b/.test(e.name)],
  ['squat', e => /\b(squat|leg press|hack)\b/.test(e.name)],
  ['core', e => e.primary === 'abdominals' || /\b(plank|crunch|sit-?up|ab roller|rollout|russian twist|leg raise|v-up|dead bug|pallof|flutter kick)\b/.test(e.name)],
  ['pull-v', e => /\b(pull-?ups?|chin-?ups?|pulldown|pull-down|muscle-?up)\b/.test(e.name)],
  ['isolation', e => /\b(upright row|internal rotation|external rotation)\b/.test(e.name)],
  ['pull-h', e => /\b(rows?|rowing|face pull)\b/.test(e.name)],
  ['push-v', e => e.primary === 'shoulders' && e.force === 'push' && /\b(press|jerk|handstand|pike)\b/.test(e.name)],
  ['push-h', e => e.force === 'push' && /\b(bench|push-?ups?|press-?ups?|chest press|floor press|dips?|fly|flye)\b/.test(e.name) && e.mechanic !== 'isolation'],
  ['isolation', e => e.mechanic === 'isolation'],
  ['isolation', e => e.primary === 'traps' || e.primary === 'forearms' || e.primary === 'neck' || e.primary === 'calves'],
  // Remaining compound movements: fall back to the prime mover.
  ['squat', e => e.primary === 'quadriceps'],
  ['hinge', e => ['hamstrings', 'glutes', 'lower back'].includes(e.primary)],
  ['push-h', e => e.primary === 'chest' || (e.primary === 'triceps' && e.force === 'push')],
  ['push-v', e => e.primary === 'shoulders' && e.force === 'push'],
  ['pull-v', e => e.primary === 'lats'],
  ['pull-h', e => e.primary === 'middle back' || (e.primary === 'shoulders' && e.force === 'pull')],
  ['cardio', e => e.category === 'plyometrics'],
];

function movementPattern(raw) {
  const e = {
    name: String(raw.name || '').toLowerCase(),
    category: raw.category,
    equipment: raw.equipment,
    force: raw.force,
    mechanic: raw.mechanic,
    primary: (raw.primaryMuscles || [])[0],
  };
  for (const [pattern, test] of RULES) if (test(e)) return pattern;
  return 'isolation';
}

// Compound = multi-joint strength work (mobility/cardio drills don't count).
function isCompound(raw, pattern = movementPattern(raw)) {
  return raw.mechanic === 'compound' && !['mobility', 'cardio', 'isolation'].includes(pattern);
}

module.exports = { movementPattern, isCompound };
