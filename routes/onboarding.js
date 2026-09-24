// /api/onboarding — the resumable, consent-first profile wizard.
//
//   GET    /                 steps for this role, progress, consents, profile, vocabularies
//   PUT    /consent          record consent decisions (first step)
//   PATCH  /steps/:step      validate + save one step (steps whose purpose isn't
//                            consented are refused with consent_required)
//   POST   /complete         finish (needs the required steps)
//   POST   /body-preview     body-composition estimate without saving
//
// Users must be 18+: DPDP requires verifiable parental consent for minors,
// which TrainSync does not collect.
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const vocab = require('../config/profile_vocab.json');
const { cities } = require('../config/cities.json');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { badRequest, forbidden } = require('../middleware/errors');
const consent = require('../services/consent');
const body = require('../services/bodyComposition');
const personality = require('../services/personality');

const router = express.Router();
router.use(requireAuth);

const CITY_KEYS = Object.keys(cities);
const j = v => (v === undefined ? undefined : v === null ? null : JSON.stringify(v));
const uniq = arr => [...new Set(arr)];
const multi = (values, { min = 0, max = values.length } = {}) =>
  z.array(z.enum(values)).min(min, `Choose at least ${min}`).max(max).transform(uniq);
const num = (min, max, label) => z.coerce.number({ message: `${label} must be a number` })
  .min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);
const int = (min, max, label) => num(min, max, label).int(`${label} must be a whole number`);
const style = z.object({
  structure: int(1, 5, 'Structure'), tone: int(1, 5, 'Tone'), checkin: int(1, 5, 'Check-ins'), data: int(1, 5, 'Data'),
});
const schedule = z.partialRecord(z.enum(vocab.days), multi(vocab.dayparts)).transform(s =>
  Object.fromEntries(Object.entries(s).filter(([, parts]) => parts.length)));
const coords = z.object({ lat: num(-90, 90, 'Latitude'), lng: num(-180, 180, 'Longitude') }).nullable().optional();

// ---------------------------------------------------------------- steps
// requires: consent purpose that must be granted to use the step.
// required: must be done before /complete.
const STEPS = {
  trainee: [
    { id: 'consent', title: 'Your data, your choice' },
    { id: 'basics', title: 'About you', required: true },
    { id: 'body', title: 'Body measurements', requires: 'body_metrics' },
    { id: 'goals', title: 'Goals & training', required: true },
    { id: 'health', title: 'Health check', requires: 'health' },
    { id: 'personality', title: 'Personality', requires: 'personality' },
    { id: 'interests', title: 'Interests', requires: 'interests' },
    { id: 'coaching', title: 'Coaching style' },
    { id: 'logistics', title: 'Schedule & budget', required: true },
  ],
  trainer: [
    { id: 'consent', title: 'Your data, your choice' },
    { id: 'basics', title: 'About you', required: true },
    { id: 'professional', title: 'Your coaching', required: true },
    { id: 'coaching', title: 'Coaching style' },
    { id: 'personality', title: 'Personality', requires: 'personality' },
    { id: 'interests', title: 'Interests', requires: 'interests' },
    { id: 'logistics', title: 'Schedule & area', required: true },
  ],
};

const SCHEMAS = {
  trainee: {
    basics: z.object({
      sex: z.enum(['male', 'female'], { message: 'Choose the sex used for body-composition formulas' }),
      gender: z.enum(['male', 'female', 'other']).optional(),
      age: int(18, 100, 'Age'),
      city: z.enum(CITY_KEYS, { message: 'Choose a city' }),
      locality: z.string().trim().max(150).optional(),
      coords,
      activity_level: z.enum(vocab.activityLevels),
    }),
    body: z.object({
      height_cm: num(120, 230, 'Height'),
      weight_kg: num(30, 250, 'Weight'),
      waist_cm: num(40, 200, 'Waist'),
      neck_cm: num(20, 70, 'Neck'),
      hip_cm: num(50, 200, 'Hip').optional(),
      wrist_cm: num(10, 25, 'Wrist').optional(),
    }),
    goals: z.object({
      goal: z.enum(vocab.bodyGoals),
      goals: multi(vocab.goals, { min: 1 }),
      experience_level: z.enum(vocab.experienceLevels),
      days_per_week: int(1, 7, 'Days per week'),
      session_minutes: int(15, 150, 'Session length'),
      equipment: multi(vocab.equipment, { min: 1 }),
      diet_pref: z.enum(vocab.dietPrefs),
      allergens: multi(vocab.allergens).default([]),
      cuisines: multi(vocab.cuisines).default([]),
      food_budget_inr_per_day: int(50, 5000, 'Food budget').nullable().optional(),
    }),
    health: z.object({
      parq: z.object(Object.fromEntries(vocab.parq.map(q => [q.id, z.boolean()]))),
      limitations: multi(vocab.limitations).default([]),
    }),
    personality: z.object({ answers: z.array(int(1, 5, 'Answer')).length(20) }),
    interests: z.object({ hobbies: z.string().trim().max(500).optional(), interests: multi(vocab.interests).default([]) }),
    coaching: z.object({ style }),
    logistics: z.object({
      modality: multi(vocab.modalities, { min: 1 }),
      schedule,
      languages: multi(vocab.languages, { min: 1 }),
      budget_per_session_inr: int(0, 20000, 'Budget'),
      search_radius_km: num(1, 25, 'Search radius'),
      trainer_gender_pref: z.enum(['male', 'female']).nullable().optional(),
    }),
  },
  trainer: {
    basics: z.object({
      gender: z.enum(['male', 'female', 'other']),
      city: z.enum(CITY_KEYS, { message: 'Choose a city' }),
      locality: z.string().trim().max(150).optional(),
      coords,
    }),
    professional: z.object({
      years_experience: int(0, 60, 'Years of experience'),
      certifications: z.array(z.string().trim().min(2).max(80)).max(10).transform(uniq),
      specializations: multi(vocab.goals, { min: 1 }),
      best_level: z.enum(vocab.experienceLevels),
      price_per_session_inr: int(100, 20000, 'Price'),
      max_clients: int(1, 60, 'Maximum clients'),
      bio: z.string().trim().max(1000).optional(),
      home_gym_id: z.coerce.number().int().positive().nullable().optional(),
    }),
    coaching: z.object({ style }),
    personality: z.object({ answers: z.array(int(1, 5, 'Answer')).length(20) }),
    interests: z.object({ hobbies: z.string().trim().max(500).optional(), interests: multi(vocab.interests).default([]) }),
    logistics: z.object({
      modality: multi(vocab.modalities, { min: 1 }),
      schedule,
      languages: multi(vocab.languages, { min: 1 }),
      travel_radius_km: num(0, 50, 'Travel radius'),
    }),
  },
};

const TABLE = { trainee: 'trainees', trainer: 'trainers' };

async function update(conn, table, userId, fields) {
  const cols = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (!cols.length) return;
  await conn.query(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE user_id = ?`,
    [...cols.map(c => fields[c]), userId]);
}

async function loadRow(userId, role, conn = db) {
  const [[row]] = await conn.query(`SELECT * FROM ${TABLE[role]} WHERE user_id = ?`, [userId]);
  return row || {};
}

// City/locality/coordinates: coordinates and locality only with location consent.
async function placeFields(data, consents) {
  const city = cities[data.city];
  const out = { city: city.name, location: city.name };
  if (consents.location) {
    out.locality = data.locality || null;
    let point = data.coords || null;
    if (!point && data.locality) {
      const [[loc]] = await db.query('SELECT lat, lng FROM localities WHERE city = ? AND name = ?', [city.name, data.locality]);
      if (loc) point = loc;
    }
    if (!point) point = { lat: city.center[0], lng: city.center[1] };
    out.lat = Math.round(point.lat * 1e6) / 1e6;
    out.lng = Math.round(point.lng * 1e6) / 1e6;
    if (data.locality) out.location = `${data.locality}, ${city.name}`;
  } else {
    Object.assign(out, { locality: null, lat: null, lng: null });
  }
  return out;
}

function assessFrom(row, measures) {
  const m = { ...row, ...measures };
  return body.assess({
    sex: m.sex, age: m.age, heightCm: Number(m.height_cm), weightKg: Number(m.weight_kg),
    waistCm: Number(m.waist_cm), neckCm: Number(m.neck_cm), hipCm: m.sex === 'female' ? Number(m.hip_cm) : undefined,
    activityLevel: m.activity_level || 'moderate', goal: m.goal || 'maintenance',
  });
}

// ---------------------------------------------------------------- savers
const SAVERS = {
  async basics(conn, user, data, consents) {
    const place = await placeFields(data, consents);
    if (user.role === 'trainee') {
      await update(conn, 'trainees', user.user_id, {
        sex: data.sex, gender: data.gender || data.sex, age: data.age, activity_level: data.activity_level, ...place,
      });
    } else {
      await update(conn, 'trainers', user.user_id, { gender: data.gender, ...place });
    }
  },

  async body(conn, user, data) {
    const row = await loadRow(user.user_id, 'trainee', conn);
    if (!row.sex || !row.age) throw badRequest('Complete "About you" first.', 'step_order');
    if (row.sex === 'female' && !data.hip_cm) throw badRequest('Hip measurement is needed for the female formula.', 'validation', { details: [{ field: 'hip_cm', message: 'Required' }] });
    let result;
    try {
      result = assessFrom(row, data);
    } catch (err) {
      if (err instanceof RangeError) throw badRequest(`Those measurements don't work together: ${err.message}.`, 'validation');
      throw err;
    }
    await update(conn, 'trainees', user.user_id, { ...data, hip_cm: row.sex === 'female' ? data.hip_cm : null, body_type: result.dominantType });
    await conn.query(
      'INSERT INTO body_assessments (user_id, method_version, inputs, outputs, dominant_type) VALUES (?, ?, ?, ?, ?)',
      [user.user_id, result.method, JSON.stringify({ ...data, sex: row.sex, age: row.age }), JSON.stringify(result), result.dominantType]
    );
    return { assessment: result };
  },

  async goals(conn, user, data) {
    await update(conn, 'trainees', user.user_id, {
      ...data,
      goals: j(data.goals), equipment: j(data.equipment), allergens: j(data.allergens), cuisines: j(data.cuisines),
      fitness_goal: data.goals.map(g => g.replace(/-/g, ' ')).join(', '),
    });
  },

  async health(conn, user, data) {
    const flagged = Object.values(data.parq).some(Boolean);
    await conn.query('INSERT INTO health_screens (user_id, answers, flagged, version) VALUES (?, ?, ?, ?)',
      [user.user_id, JSON.stringify(data.parq), flagged ? 1 : 0, 'parq-plus-2023-short']);
    await update(conn, 'trainees', user.user_id, { limitations: j(data.limitations), health_flagged: flagged ? 1 : 0 });
    return { flagged };
  },

  async personality(conn, user, data) {
    const big5 = personality.scoreMiniIpip(data.answers);
    await update(conn, TABLE[user.role], user.user_id, { big5: j(big5) });
    return { big5 };
  },

  async interests(conn, user, data) {
    await update(conn, TABLE[user.role], user.user_id, { hobbies: data.hobbies || null, interests: j(data.interests) });
  },

  async coaching(conn, user, data) {
    const col = user.role === 'trainer' ? 'coaching_style' : 'style_pref';
    await update(conn, TABLE[user.role], user.user_id, { [col]: j(data.style) });
  },

  async logistics(conn, user, data) {
    const common = { modality: j(data.modality), schedule: j(data.schedule), languages: j(data.languages) };
    if (user.role === 'trainee') {
      await update(conn, 'trainees', user.user_id, {
        ...common, budget_per_session_inr: data.budget_per_session_inr, search_radius_km: data.search_radius_km,
        trainer_gender_pref: data.trainer_gender_pref ?? null,
      });
    } else {
      await update(conn, 'trainers', user.user_id, { ...common, travel_radius_km: data.travel_radius_km });
    }
  },

  async professional(conn, user, data) {
    if (data.home_gym_id) {
      const [[gym]] = await conn.query('SELECT gym_id FROM gyms WHERE gym_id = ?', [data.home_gym_id]);
      if (!gym) throw badRequest('That gym was not found.', 'validation');
    }
    await update(conn, 'trainers', user.user_id, {
      ...data,
      certifications: j(data.certifications), specializations: j(data.specializations),
      bio: data.bio || null, home_gym_id: data.home_gym_id || null,
      // legacy columns kept in sync
      experience: data.years_experience, certification: data.certifications[0] || null,
      specialization: data.specializations.map(s => s.replace(/-/g, ' ')).join(', '),
    });
  },
};

// ---------------------------------------------------------------- helpers
const PROFILE_OMIT = new Set(['geo', 'trainee_id', 'trainer_id', 'user_id', 'cluster_id', 'cluster_version', 'rating_avg', 'rating_count', 'active_clients']);

function profileView(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (PROFILE_OMIT.has(k)) continue;
    out[k] = typeof v === 'string' && /^[[{]/.test(v) ? safeJson(v) : v;
  }
  return out;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

async function status(user) {
  const [[u]] = await db.query('SELECT onboarding_step, onboarding_complete FROM users WHERE user_id = ?', [user.user_id]);
  return { step: u.onboarding_step, complete: u.onboarding_complete === 1 };
}

// ---------------------------------------------------------------- routes
router.get('/', async (req, res, next) => {
  const user = req.session.user;
  try {
    const [{ state, decided }, st, row] = await Promise.all([
      consent.getConsents(user.user_id), status(user), loadRow(user.user_id, user.role),
    ]);
    res.set('Cache-Control', 'no-store').json({
      role: user.role,
      steps: STEPS[user.role],
      currentStep: st.step,
      complete: st.complete,
      consentDecided: decided,
      consents: state,
      policyVersion: consent.POLICY_VERSION,
      profile: profileView(row),
      options: {
        cities: CITY_KEYS.map(k => ({ key: k, name: cities[k].name, center: cities[k].center })),
        ...vocab,
        miniIpip: { items: personality.publicItems(), scale: personality.scale, citation: personality.citation },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/consent', validate({ body: z.object({ purposes: z.partialRecord(z.enum(consent.PURPOSES), z.boolean()) }) }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const result = await consent.setConsents(user, req.valid.body.purposes, 'onboarding');
    await db.query('UPDATE users SET onboarding_step = GREATEST(onboarding_step, 1) WHERE user_id = ?', [user.user_id]);
    res.json({ consents: result.state, erased: result.erased });
  } catch (err) {
    next(err);
  }
});

router.patch('/steps/:step', async (req, res, next) => {
  const user = req.session.user;
  const steps = STEPS[user.role];
  const index = steps.findIndex(s => s.id === req.params.step);
  const schema = SCHEMAS[user.role][req.params.step];
  if (index < 1 || !schema) return next(badRequest('Unknown step', 'not_found'));
  const step = steps[index];
  try {
    const { state } = await consent.getConsents(user.user_id);
    if (step.requires && !state[step.requires]) {
      throw forbidden(`This step needs your consent for "${step.requires.replace('_', ' ')}".`, 'consent_required');
    }
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
      return res.status(400).json({ error: details[0].message, code: 'validation', details, requestId: req.id });
    }
    const result = await db.withTransaction(async conn => {
      await conn.query(`INSERT IGNORE INTO ${TABLE[user.role]} (user_id) VALUES (?)`, [user.user_id]);
      const out = await SAVERS[step.id](conn, user, parsed.data, state);
      await conn.query('UPDATE users SET onboarding_step = GREATEST(onboarding_step, ?) WHERE user_id = ?', [index + 1, user.user_id]);
      return out || {};
    });
    res.json({ saved: step.id, next: steps[index + 1] ? steps[index + 1].id : null, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/complete', async (req, res, next) => {
  const user = req.session.user;
  try {
    const row = await loadRow(user.user_id, user.role);
    const missing = [];
    if (!row.city) missing.push('basics');
    if (user.role === 'trainee' && !row.goal) missing.push('goals');
    if (user.role === 'trainer' && !row.specializations) missing.push('professional');
    if (!row.modality) missing.push('logistics');
    if (missing.length) {
      return res.status(400).json({ error: 'Please finish the required steps first.', code: 'incomplete', missing, requestId: req.id });
    }
    await db.query('UPDATE users SET onboarding_complete = 1 WHERE user_id = ?', [user.user_id]);
    req.session.user.onboardingComplete = true;
    res.json({ complete: true, next: '/homepage1.html' });
  } catch (err) {
    next(err);
  }
});

const previewSchema = SCHEMAS.trainee.body.extend({
  sex: z.enum(['male', 'female']), age: int(18, 100, 'Age'),
  activity_level: z.enum(vocab.activityLevels).optional(), goal: z.enum(vocab.bodyGoals).optional(),
});
router.post('/body-preview', consent.requireConsent('body_metrics'), validate({ body: previewSchema }), (req, res) => {
  try {
    res.json({ assessment: assessFrom({}, req.valid.body) });
  } catch (err) {
    res.status(400).json({ error: `Those measurements don't work together: ${err.message}.`, code: 'validation', requestId: req.id });
  }
});

module.exports = router;
module.exports.STEPS = STEPS;
