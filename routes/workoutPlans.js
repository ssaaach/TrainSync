// /api/plans/workout
//   POST /preview               public: a plan from the form (nothing saved)
//   POST /                      trainee: generate from the profile (+ optional tweaks), save as active
//   GET  /active                trainee: active plan + this week's prescriptions
//   GET  /:id/week/:n           a week's prescriptions
//   POST /:id/swap              swap an exercise for one of its safe alternatives
//   POST /:id/logs              log sets for an exercise on a date
//   GET  /:id/logs?week=n       logged sets for a plan week
//   GET  /:id/adapt?week=n      next-week adjustments from the logs
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const vocab = require('../config/profile_vocab.json');
const T = require('../config/training.json');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { badRequest, notFound } = require('../middleware/errors');
const gen = require('../services/workoutGenerator');
const library = require('../services/exerciseLibrary');
const { loadTraineeProfile } = require('../services/profileLoader');

const router = express.Router();
const DAY_MS = 86_400_000;

const tweaks = {
  days_per_week: z.coerce.number().int().min(1).max(7).optional(),
  session_minutes: z.coerce.number().int().min(15).max(150).optional(),
  weeks: z.coerce.number().int().min(T.weeks.min).max(T.weeks.max).optional(),
  seed: z.coerce.number().int().min(1).max(2 ** 31 - 1).optional(),
  equipment: z.array(z.enum(vocab.equipment)).max(vocab.equipment.length).optional(),
};

const previewSchema = z.object({
  goal: z.enum(vocab.bodyGoals),
  goals: z.array(z.enum(vocab.goals)).max(8).default([]),
  experience_level: z.enum(vocab.experienceLevels),
  days_per_week: z.coerce.number().int().min(1).max(7),
  session_minutes: z.coerce.number().int().min(15).max(150),
  equipment: z.array(z.enum(vocab.equipment)).max(vocab.equipment.length).default(['body only']),
  limitations: z.array(z.enum(vocab.limitations)).max(vocab.limitations.length).default([]),
  weeks: tweaks.weeks,
  seed: tweaks.seed,
});

const currentWeek = (createdAt, total) => Math.min(total, Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / (7 * DAY_MS)) + 1));

async function ownedPlan(req) {
  const [[row]] = await db.query(
    "SELECT plan_id, plan, created_at, seed, is_active FROM user_plans WHERE plan_id = ? AND user_id = ? AND kind = 'workout'",
    [req.params.id, req.session.user.user_id]
  );
  if (!row) throw notFound('Plan not found');
  return { ...row, plan: typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan };
}

// ---------------------------------------------------------------- public preview
router.post('/preview', validate({ body: previewSchema }), async (req, res, next) => {
  try {
    const { rows } = await library.load();
    const { weeks, seed, ...profile } = req.valid.body;
    // Visitors haven't shared health info: the plan stays in cautious mode.
    const plan = gen.generate({ ...profile, health_unknown: true }, rows, { seed: seed || 1, weeks });
    res.json({ plan, weeks: gen.allWeekRx(plan), preview: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- trainee plans
router.post('/', requireRole('trainee'), validate({ body: z.object(tweaks) }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const profile = await loadTraineeProfile(user.user_id);
    if (!profile || !profile.goal || !profile.experience_level) {
      throw badRequest('Finish "Goals & training" in your profile first.', 'profile_incomplete');
    }
    const { weeks, seed, ...overrides } = req.valid.body;
    const useSeed = seed || (Math.floor(Math.random() * 2 ** 31) || 1);
    const { rows } = await library.load();
    const plan = gen.generate({ ...profile, ...overrides }, rows, { seed: useSeed, weeks });
    const planId = await db.withTransaction(async conn => {
      await conn.query("UPDATE user_plans SET is_active = 0 WHERE user_id = ? AND kind = 'workout'", [user.user_id]);
      const [r] = await conn.query(
        "INSERT INTO user_plans (user_id, kind, plan, generator_version, seed, is_active) VALUES (?, 'workout', ?, ?, ?, 1)",
        [user.user_id, JSON.stringify(plan), plan.generatorVersion, useSeed]
      );
      return r.insertId;
    });
    res.status(201).json({ planId, plan, currentWeek: 1, weeks: gen.allWeekRx(plan) });
  } catch (err) {
    next(err);
  }
});

router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      "SELECT plan_id, plan, created_at FROM user_plans WHERE user_id = ? AND kind = 'workout' AND is_active = 1 ORDER BY plan_id DESC LIMIT 1",
      [req.session.user.user_id]
    );
    if (!row) return res.json({ plan: null });
    const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan;
    const wk = currentWeek(row.created_at, plan.weeks.length);
    res.set('Cache-Control', 'no-store').json({ planId: row.plan_id, plan, createdAt: row.created_at, currentWeek: wk, weeks: gen.allWeekRx(plan) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/week/:n', requireAuth, validate({ params: z.object({ id: z.coerce.number().int().positive(), n: z.coerce.number().int().min(1).max(12) }) }), async (req, res, next) => {
  try {
    const { plan } = await ownedPlan(req);
    res.json(gen.weekView(plan, req.valid.params.n));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/swap', requireAuth, validate({ body: z.object({
  sessionKey: z.string().max(20), slot: z.coerce.number().int().min(0).max(20), exerciseId: z.coerce.number().int().positive(),
}) }), async (req, res, next) => {
  try {
    const owned = await ownedPlan(req);
    const { rows } = await library.load();
    const { sessionKey, slot, exerciseId } = req.valid.body;
    try {
      gen.swapExercise(owned.plan, sessionKey, slot, exerciseId, rows);
    } catch (err) {
      if (err instanceof RangeError) throw badRequest(err.message, 'invalid_swap');
      throw err;
    }
    await db.query('UPDATE user_plans SET plan = ? WHERE plan_id = ?', [JSON.stringify(owned.plan), owned.plan_id]);
    res.json({ session: owned.plan.sessions[sessionKey] });
  } catch (err) {
    next(err);
  }
});

const logSchema = z.object({
  date: z.iso.date(),
  exerciseId: z.coerce.number().int().positive(),
  sets: z.array(z.object({
    reps: z.coerce.number().int().min(0).max(200).nullable().optional(),
    load_kg: z.coerce.number().min(0).max(500).nullable().optional(),
    rpe: z.coerce.number().min(1).max(10).nullable().optional(),
    done: z.boolean().default(true),
  })).min(1).max(12),
});

router.post('/:id/logs', requireAuth, validate({ body: logSchema }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const owned = await ownedPlan(req);
    const { date, exerciseId, sets } = req.valid.body;
    const inPlan = Object.values(owned.plan.sessions).some(s => (s.exercises || []).some(e => e.exerciseId === exerciseId));
    if (!inPlan) throw badRequest('That exercise is not in this plan.', 'validation');
    await db.withTransaction(async conn => {
      await conn.query('DELETE FROM workout_logs WHERE user_id = ? AND plan_id = ? AND exercise_id = ? AND date = ?', [user.user_id, owned.plan_id, exerciseId, date]);
      await conn.query('INSERT INTO workout_logs (user_id, plan_id, exercise_id, date, sets, reps, load_kg, rpe, done) VALUES ?', [
        sets.map((s, i) => [user.user_id, owned.plan_id, exerciseId, date, i + 1, s.reps ?? null, s.load_kg ?? null, s.rpe ?? null, s.done ? 1 : 0]),
      ]);
    });
    res.status(201).json({ logged: sets.length });
  } catch (err) {
    next(err);
  }
});

async function weekLogs(owned, userId, week) {
  const start = new Date(new Date(owned.created_at).getTime() + (week - 1) * 7 * DAY_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, exercise_id AS exerciseId, sets AS \`set\`, reps, load_kg, rpe, done = 1 AS done
       FROM workout_logs WHERE user_id = ? AND plan_id = ? AND date >= DATE(?) AND date < DATE(?) ORDER BY date, exercise_id, sets`,
    [userId, owned.plan_id, start, end]
  );
  return rows.map(r => ({ ...r, done: Boolean(r.done) }));
}

const weekQuery = z.object({ week: z.coerce.number().int().min(1).max(12).optional() });

router.get('/:id/logs', requireAuth, validate({ query: weekQuery }), async (req, res, next) => {
  try {
    const owned = await ownedPlan(req);
    const week = req.valid.query.week || currentWeek(owned.created_at, owned.plan.weeks.length);
    res.json({ week, logs: await weekLogs(owned, req.session.user.user_id, week) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/adapt', requireAuth, validate({ query: weekQuery }), async (req, res, next) => {
  try {
    const owned = await ownedPlan(req);
    const week = req.valid.query.week || currentWeek(owned.created_at, owned.plan.weeks.length);
    res.json(gen.adapt(owned.plan, await weekLogs(owned, req.session.user.user_id, week), week));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
