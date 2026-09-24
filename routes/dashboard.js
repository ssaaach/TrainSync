// /api/dashboard — everything the logged-in home page needs in one call, plus
// progress logging. Every block respects consent (no data for declined purposes).
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');

const consent = require('../services/consent');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { targetsFor } = require('./dietPlans');
const { loadTraineeProfile } = require('../services/profileLoader');

const router = express.Router();
router.use(requireAuth);
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function activePlan(userId, kind) {
  const [[row]] = await db.query('SELECT plan_id, plan, created_at FROM user_plans WHERE user_id = ? AND kind = ? AND is_active = 1 ORDER BY plan_id DESC LIMIT 1', [userId, kind]);
  return row ? { planId: row.plan_id, plan: parse(row.plan), createdAt: row.created_at } : null;
}

router.get('/', async (req, res, next) => {
  const user = req.session.user;
  try {
    const { state } = await consent.getConsents(user.user_id);
    const [notes] = await db.query('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', [user.user_id]);
    const out = { role: user.role, name: user.name, consents: state, unread: notes[0].n };
    const today = DAYS[new Date().getDay()];

    if (user.role === 'trainee') {
      const p = await loadTraineeProfile(user.user_id);
      out.profile = { goal: p.goal, goals: p.goals, experience: p.experience_level, diet: p.diet_pref, city: null };
      if (state.body_metrics && p.weight_kg) {
        const [[a]] = await db.query('SELECT outputs, created_at FROM body_assessments WHERE user_id = ? ORDER BY assessment_id DESC LIMIT 1', [user.user_id]);
        out.body = a ? { ...parse(a.outputs), at: a.created_at } : null;
      }
      out.targets = targetsFor(p);
      const w = await activePlan(user.user_id, 'workout');
      if (w) {
        const week = Math.min(w.plan.weeks.length, Math.max(1, Math.floor((Date.now() - new Date(w.createdAt)) / 6048e5) + 1));
        const key = w.plan.schedule[today];
        const s = key && w.plan.sessions[key];
        out.workout = {
          planId: w.planId, split: w.plan.summary.split, week, weeks: w.plan.weeks.length, today: key ? {
            name: s.name, focus: s.focus, minutes: s.estMinutes,
            exercises: (s.exercises || s.drills || []).slice(0, 6).map(e => ({ name: e.name, sets: e.sets, reps: e.reps, unit: e.unit })),
          } : null,
          stepsTarget: w.plan.summary.stepsTarget,
        };
        const [[done]] = await db.query('SELECT COUNT(DISTINCT date) d FROM workout_logs WHERE user_id = ? AND plan_id = ? AND done = 1 AND date >= CURDATE() - INTERVAL 28 DAY', [user.user_id, w.planId]);
        const planned = Object.values(w.plan.schedule).filter(Boolean).length * 4;
        out.adherence = planned ? Math.min(1, done.d / planned) : null;
      }
      const d = await activePlan(user.user_id, 'diet');
      if (d) {
        const day = d.plan.days.find(x => x.day === today) || d.plan.days[0];
        out.diet = { planId: d.planId, meals: day.meals.map(m => ({ slot: m.slot, name: m.name, kcal: m.kcal, protein_g: m.protein_g })), totals: day.totals };
      }
      if (state.body_metrics) {
        const [logs] = await db.query("SELECT DATE_FORMAT(date, '%Y-%m-%d') date, weight_kg, waist_cm FROM progress_logs WHERE user_id = ? ORDER BY date DESC LIMIT 60", [user.user_id]);
        out.progress = logs.reverse();
      }
      const [[t]] = await db.query('SELECT lat, lng, city FROM trainees WHERE user_id = ?', [user.user_id]);
      out.location = state.location && t && t.lat != null ? { lat: t.lat, lng: t.lng } : null;
      out.city = t && t.city;
      const [reqs] = await db.query("SELECT r.request_id, r.status, r.slot, u.name FROM session_requests r JOIN users u ON u.user_id = r.trainer_user_id WHERE r.trainee_user_id = ? AND r.status IN ('pending','accepted') ORDER BY r.created_at DESC LIMIT 5", [user.user_id]);
      out.requests = reqs.map(r => ({ requestId: r.request_id, status: r.status, slot: r.slot, name: r.name.split(' ')[0] }));
    } else {
      const [[t]] = await db.query('SELECT * FROM trainers WHERE user_id = ?', [user.user_id]);
      const fields = ['specializations', 'certifications', 'price_per_session_inr', 'bio', 'home_gym_id', 'coaching_style', 'schedule', 'languages', 'modality', 'big5', 'hobbies'];
      out.completeness = Math.round((fields.filter(f => t && t[f] != null && t[f] !== '').length / fields.length) * 100);
      out.missing = fields.filter(f => !t || t[f] == null || t[f] === '');
      out.capacity = { active: t ? t.active_clients : 0, max: t ? t.max_clients : 0 };
      const [[pend]] = await db.query("SELECT COUNT(*) n FROM session_requests WHERE trainer_user_id = ? AND status = 'pending'", [user.user_id]);
      out.pendingRequests = pend.n;
      out.location = t && t.lat != null && state.location ? { lat: t.lat, lng: t.lng } : null;
      if (t && t.lat != null) {
        const [[near]] = await db.query(
          'SELECT COUNT(*) n FROM trainees WHERE lat IS NOT NULL AND ST_Distance_Sphere(geo, ST_SRID(POINT(?, ?), 4326)) <= ? * 1000',
          [t.lng, t.lat, Number(t.travel_radius_km) || 5]
        );
        out.traineesNearby = near.n;
      }
    }
    const [contacts] = await db.query(
      `SELECT u.name, u.email, u.phone, r.slot FROM session_requests r JOIN users u ON u.user_id = r.${user.role === 'trainer' ? 'trainee_user_id' : 'trainer_user_id'}
        WHERE r.${user.role === 'trainer' ? 'trainer_user_id' : 'trainee_user_id'} = ? AND r.status = 'accepted' LIMIT 10`, [user.user_id]
    );
    out.contacts = contacts;
    res.set('Cache-Control', 'no-store').json(out);
  } catch (err) {
    next(err);
  }
});

const progressSchema = z.object({
  date: z.iso.date(),
  weight_kg: z.coerce.number().min(30).max(250).optional(),
  waist_cm: z.coerce.number().min(40).max(200).optional(),
  notes: z.string().trim().max(500).optional(),
}).refine(v => v.weight_kg || v.waist_cm, { message: 'Enter weight or waist' });

router.post('/progress', requireRole('trainee'), consent.requireConsent('body_metrics'), validate({ body: progressSchema }), async (req, res, next) => {
  try {
    const b = req.valid.body;
    await db.query(
      `INSERT INTO progress_logs (user_id, date, weight_kg, waist_cm, notes) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE weight_kg = COALESCE(VALUES(weight_kg), weight_kg), waist_cm = COALESCE(VALUES(waist_cm), waist_cm), notes = VALUES(notes)`,
      [req.session.user.user_id, b.date, b.weight_kg ?? null, b.waist_cm ?? null, b.notes ?? null]
    );
    res.status(201).json({ saved: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

