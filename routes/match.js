// /api/match — trainer discovery, shortlists and session requests.
//   GET    /recommendations        trainee: ranked trainers (filters: goal, maxPrice, maxKm, mode, language, q)
//   GET    /trainers/:id           trainee: one trainer + "why you matched"
//   GET    /shortlist              trainee: shortlisted trainer ids
//   PUT    /shortlist/:id          add;  DELETE /shortlist/:id  remove
//   POST   /requests               trainee: request a session
//   GET    /requests               both roles: sent / received requests
//   POST   /requests/:id/respond   trainer: accept | decline;  trainee: cancel
//   GET    /contacts               accepted matches with contact details
//   POST   /block/:id, /report/:id block or report a user
//   GET    /notifications, POST /notifications/read
// Before a request is accepted nobody sees email, phone or exact location.
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const vocab = require('../config/profile_vocab.json');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { badRequest, notFound, forbidden, conflict } = require('../middleware/errors');
const { citySpellings } = require('../services/normalize');
const consent = require('../services/consent');
const matching = require('../services/matching');

const router = express.Router();
router.use(requireAuth);

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const firstName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
const TRAINER_COLS = `t.user_id, u.name, u.is_synthetic, t.gender, t.city, t.locality, t.lat, t.lng, t.years_experience, t.certifications,
  t.specializations, t.best_level, t.price_per_session_inr, t.max_clients, t.active_clients, t.rating_avg, t.rating_count, t.bio,
  t.home_gym_id, g.name AS gym_name, t.travel_radius_km, t.coaching_style, t.big5, t.schedule, t.languages, t.modality, t.hobbies, t.interests`;

// Latest consent per (user, purpose) for many users at once.
async function consentMap(userIds) {
  if (!userIds.length) return new Map();
  const [rows] = await db.query(
    `SELECT c.user_id, c.purpose, c.granted FROM consent_ledger c
       JOIN (SELECT user_id, purpose, MAX(ledger_id) id FROM consent_ledger WHERE user_id IN (?) GROUP BY user_id, purpose) l ON l.id = c.ledger_id`,
    [userIds]
  );
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, {});
    m.get(r.user_id)[r.purpose] = r.granted === 1;
  }
  return m;
}

async function blockedIds(userId) {
  const [rows] = await db.query('SELECT blocked_user_id id FROM blocks WHERE blocker_user_id = ? UNION SELECT blocker_user_id FROM blocks WHERE blocked_user_id = ?', [userId, userId]);
  return new Set(rows.map(r => r.id));
}

async function traineeRow(userId) {
  const [[t]] = await db.query('SELECT * FROM trainees WHERE user_id = ?', [userId]);
  if (!t) throw notFound('Profile not found');
  return t;
}

// Consent-gated trainee view used for matching.
async function matchingTrainee(userId) {
  const t = await traineeRow(userId);
  const { state } = await consent.getConsents(userId);
  if (!state.personality) t.big5 = null;
  if (!state.interests) { t.hobbies = null; t.interests = null; }
  if (!state.location) { t.lat = null; t.lng = null; }
  return { t, state };
}

async function candidateTrainers(t, userId, { max = 400 } = {}) {
  const wantsOnline = (parse(t.modality) || []).includes('online');
  const [rows] = await db.query(
    `SELECT ${TRAINER_COLS} FROM trainers t JOIN users u USING (user_id) LEFT JOIN gyms g ON g.gym_id = t.home_gym_id
      WHERE u.onboarding_complete = 1 AND t.specializations IS NOT NULL
        AND (t.city IN (?) ${wantsOnline ? "OR JSON_CONTAINS(t.modality, '\"online\"')" : ''})
      LIMIT ?`,
    [t.city ? citySpellings(t.city) : ['__none__'], max * 4]
  );
  const blocked = await blockedIds(userId);
  const list = rows.filter(r => !blocked.has(r.user_id) && r.user_id !== userId);
  const consents = await consentMap(list.map(r => r.user_id));
  return list.filter(r => (consents.get(r.user_id) || {}).matching).map(r => {
    const c = consents.get(r.user_id) || {};
    return { ...r, consent_location: c.location ? 1 : 0, consent_personality: c.personality ? 1 : 0, consent_interests: c.interests ? 1 : 0 };
  });
}

function card(entry, shortlisted) {
  const tr = entry.trainer;
  return {
    trainerId: tr.user_id,
    name: firstName(tr.name),
    sample: tr.is_synthetic === 1,
    initials: String(tr.name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(),
    specializations: parse(tr.specializations) || [],
    certifications: parse(tr.certifications) || [],
    verified: (parse(tr.certifications) || []).length > 0,
    years: tr.years_experience,
    price: tr.price_per_session_inr,
    rating: tr.rating_avg ? Number(tr.rating_avg) : null,
    ratingCount: tr.rating_count,
    languages: parse(tr.languages) || [],
    modality: parse(tr.modality) || [],
    locality: tr.consent_location ? tr.locality : null,
    city: tr.city,
    gym: tr.gym_name || null,
    distance: entry.onlineOnly ? 'Online' : matching.approxKm(entry.distanceKm),
    online: Boolean(entry.onlineOnly),
    score: Math.round(entry.score),
    reasons: entry.reasons,
    shortlisted: shortlisted.has(tr.user_id),
    spotsLeft: Math.max(0, tr.max_clients - tr.active_clients),
  };
}

const recQuery = z.object({
  goal: z.enum(vocab.goals).optional(),
  maxPrice: z.coerce.number().int().min(0).max(50000).optional(),
  maxKm: z.coerce.number().min(1).max(50).optional(),
  mode: z.enum(vocab.modalities).optional(),
  language: z.enum(vocab.languages).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

router.get('/recommendations', requireRole('trainee'), validate({ query: recQuery }), async (req, res, next) => {
  const userId = req.session.user.user_id;
  try {
    const { t, state } = await matchingTrainee(userId);
    if (!state.matching) {
      return res.json({ trainers: [], consentRequired: true, model: matching.model().source });
    }
    const f = req.valid.query;
    let pool = await candidateTrainers(t, userId);
    if (f.goal) pool = pool.filter(r => (parse(r.specializations) || []).includes(f.goal));
    if (f.maxPrice) pool = pool.filter(r => !r.price_per_session_inr || r.price_per_session_inr <= f.maxPrice);
    if (f.mode) pool = pool.filter(r => (parse(r.modality) || []).includes(f.mode));
    if (f.language) pool = pool.filter(r => (parse(r.languages) || []).includes(f.language));
    if (f.q) {
      const q = f.q.toLowerCase();
      pool = pool.filter(r => `${r.name} ${r.bio || ''} ${r.gym_name || ''} ${r.locality || ''} ${(parse(r.specializations) || []).join(' ')}`.toLowerCase().includes(q));
    }
    let ranked = matching.rank(t, pool, { traineeConsents: state, limit: 400 });
    if (f.maxKm) ranked = ranked.filter(e => e.distanceKm == null || e.distanceKm <= f.maxKm);
    const [sl] = await db.query('SELECT trainer_user_id id FROM shortlists WHERE user_id = ?', [userId]);
    const shortlisted = new Set(sl.map(r => r.id));
    res.set('Cache-Control', 'no-store').json({
      trainers: ranked.slice(0, f.limit).map(e => card(e, shortlisted)),
      total: ranked.length,
      model: { source: matching.model().source, version: matching.model().version },
      usesLocation: state.location && t.lat != null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/trainers/:id', requireRole('trainee'), validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res, next) => {
  const userId = req.session.user.user_id;
  try {
    const { t, state } = await matchingTrainee(userId);
    const [[row]] = await db.query(`SELECT ${TRAINER_COLS} FROM trainers t JOIN users u USING (user_id) LEFT JOIN gyms g ON g.gym_id = t.home_gym_id WHERE t.user_id = ?`, [req.valid.params.id]);
    if (!row || (await blockedIds(userId)).has(row.user_id)) throw notFound('Trainer not found');
    const c = (await consentMap([row.user_id])).get(row.user_id) || {};
    if (!c.matching) throw notFound('Trainer not found');
    const tr = { ...row, consent_location: c.location ? 1 : 0, consent_personality: c.personality ? 1 : 0, consent_interests: c.interests ? 1 : 0 };
    const [entry] = matching.rank(t, [tr], { traineeConsents: state, limit: 1 });
    const e = entry || { trainer: tr, score: 0, factors: {}, distanceKm: null, reasons: [] };
    const [sl] = await db.query('SELECT trainer_user_id id FROM shortlists WHERE user_id = ?', [userId]);
    const s1 = slots(t.schedule);
    const overlap = [...slots(tr.schedule)].filter(x => s1.has(x));
    const [[req0]] = await db.query("SELECT request_id, status FROM session_requests WHERE trainee_user_id = ? AND trainer_user_id = ? ORDER BY request_id DESC LIMIT 1", [userId, tr.user_id]);
    res.json({
      ...card(e, new Set(sl.map(r => r.id))),
      bio: tr.bio,
      coachingStyle: parse(tr.coaching_style),
      breakdown: Object.fromEntries(matching.FACTORS.map(k => [k, e.factors[k] == null ? null : Math.round(e.factors[k] * 100)])),
      weights: matching.model().weights,
      excluded: entry ? [] : ['Filtered out by a hard rule (language, gender preference, capacity or distance)'],
      overlapSlots: overlap,
      request: req0 || null,
    });
  } catch (err) {
    next(err);
  }
});

function slots(schedule) {
  const out = new Set();
  for (const [d, parts] of Object.entries(parse(schedule) || {})) for (const p of parts || []) out.add(`${d}:${p}`);
  return out;
}

// ---------------------------------------------------------------- shortlist
router.get('/shortlist', requireRole('trainee'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT trainer_user_id id FROM shortlists WHERE user_id = ? ORDER BY created_at', [req.session.user.user_id]);
    res.json({ ids: rows.map(r => r.id) });
  } catch (err) { next(err); }
});
const idParam = validate({ params: z.object({ id: z.coerce.number().int().positive() }) });
router.put('/shortlist/:id', requireRole('trainee'), idParam, async (req, res, next) => {
  try {
    const [[tr]] = await db.query('SELECT user_id FROM trainers WHERE user_id = ?', [req.valid.params.id]);
    if (!tr) throw notFound('Trainer not found');
    await db.query('INSERT IGNORE INTO shortlists (user_id, trainer_user_id) VALUES (?, ?)', [req.session.user.user_id, tr.user_id]);
    res.json({ shortlisted: true });
  } catch (err) { next(err); }
});
router.delete('/shortlist/:id', requireRole('trainee'), idParam, async (req, res, next) => {
  try {
    await db.query('DELETE FROM shortlists WHERE user_id = ? AND trainer_user_id = ?', [req.session.user.user_id, req.valid.params.id]);
    res.json({ shortlisted: false });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- session requests
async function notify(conn, userId, type, payload) {
  await conn.query('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)', [userId, type, JSON.stringify(payload)]);
}

const requestSchema = z.object({
  trainerId: z.coerce.number().int().positive(),
  session_type: z.enum(vocab.modalities),
  slot: z.string().regex(/^(mon|tue|wed|thu|fri|sat|sun):(morning|afternoon|evening)$/, 'Choose a time slot'),
  message: z.string().trim().max(500).optional(),
});

router.post('/requests', requireRole('trainee'), validate({ body: requestSchema }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const { t, state } = await matchingTrainee(user.user_id);
    if (!state.matching) throw forbidden('Turn on "Use my profile for matching" in Privacy & data to request sessions.', 'consent_required');
    const b = req.valid.body;
    const [[row]] = await db.query(`SELECT ${TRAINER_COLS} FROM trainers t JOIN users u USING (user_id) LEFT JOIN gyms g ON g.gym_id = t.home_gym_id WHERE t.user_id = ?`, [b.trainerId]);
    if (!row || (await blockedIds(user.user_id)).has(row.user_id)) throw notFound('Trainer not found');
    if (!(parse(row.modality) || []).includes(b.session_type)) throw badRequest('This trainer does not offer that session type.', 'validation');
    if (row.active_clients >= row.max_clients) throw conflict('This trainer is fully booked right now.', 'full');
    const [entry] = matching.rank(t, [{ ...row, consent_location: 1, consent_personality: 1, consent_interests: 1 }], { traineeConsents: state, limit: 1 });
    const id = await db.withTransaction(async conn => {
      const [[open]] = await conn.query(
        "SELECT request_id FROM session_requests WHERE trainee_user_id = ? AND trainer_user_id = ? AND status IN ('pending','accepted') FOR UPDATE",
        [user.user_id, row.user_id]
      );
      if (open) throw conflict('You already have an open request with this trainer.', 'duplicate');
      const [r] = await conn.query(
        'INSERT INTO session_requests (trainee_user_id, trainer_user_id, session_type, slot, message, price_inr, score, score_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user.user_id, row.user_id, b.session_type, b.slot, b.message || null, row.price_per_session_inr, entry ? entry.score : null, entry ? JSON.stringify(entry.factors) : null]
      );
      await notify(conn, row.user_id, 'session_request', { requestId: r.insertId, from: firstName(user.name) });
      return r.insertId;
    });
    res.status(201).json({ requestId: id, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

router.get('/requests', async (req, res, next) => {
  const user = req.session.user;
  try {
    if (user.role === 'trainer') {
      const [rows] = await db.query(
        `SELECT r.*, u.name, te.goals, te.experience_level, te.lat, te.lng, te.schedule
           FROM session_requests r JOIN users u ON u.user_id = r.trainee_user_id LEFT JOIN trainees te ON te.user_id = r.trainee_user_id
          WHERE r.trainer_user_id = ? ORDER BY r.status = 'pending' DESC, r.score DESC, r.created_at DESC LIMIT 100`,
        [user.user_id]
      );
      const [[me]] = await db.query('SELECT lat, lng, schedule FROM trainers WHERE user_id = ?', [user.user_id]);
      const mine = slots(me && me.schedule);
      const geo = require('../services/geo');
      return res.json({ role: 'trainer', requests: rows.map(r => ({
        requestId: r.request_id, status: r.status, name: firstName(r.name), goals: parse(r.goals) || [], experience: r.experience_level,
        sessionType: r.session_type, slot: r.slot, message: r.message, score: r.score ? Math.round(r.score) : null,
        distance: me && me.lat != null && r.lat != null ? matching.approxKm(geo.haversineKm(me.lat, me.lng, r.lat, r.lng)) : null,
        overlap: [...slots(r.schedule)].filter(x => mine.has(x)).length, createdAt: r.created_at,
      })) });
    }
    const [rows] = await db.query(
      `SELECT r.*, u.name FROM session_requests r JOIN users u ON u.user_id = r.trainer_user_id WHERE r.trainee_user_id = ? ORDER BY r.created_at DESC LIMIT 100`,
      [user.user_id]
    );
    res.json({ role: 'trainee', requests: rows.map(r => ({
      requestId: r.request_id, trainerId: r.trainer_user_id, status: r.status, name: firstName(r.name), sessionType: r.session_type,
      slot: r.slot, price: r.price_inr, score: r.score ? Math.round(r.score) : null, createdAt: r.created_at,
    })) });
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/respond', validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ action: z.enum(['accept', 'decline', 'cancel']) }) }), async (req, res, next) => {
  const user = req.session.user;
  const { action } = req.valid.body;
  try {
    const out = await db.withTransaction(async conn => {
      const [[r]] = await conn.query('SELECT * FROM session_requests WHERE request_id = ? FOR UPDATE', [req.valid.params.id]);
      const isTrainer = r && r.trainer_user_id === user.user_id;
      const isTrainee = r && r.trainee_user_id === user.user_id;
      if (!r || (!isTrainer && !isTrainee)) throw notFound('Request not found');
      if ((action === 'cancel' && !isTrainee) || (action !== 'cancel' && !isTrainer)) throw forbidden();
      if (r.status !== 'pending' && !(action === 'cancel' && r.status === 'accepted')) throw conflict(`This request is already ${r.status}.`, 'not_pending');
      const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
      if (action === 'accept') {
        const [u] = await conn.query('UPDATE trainers SET active_clients = active_clients + 1 WHERE user_id = ? AND active_clients < max_clients', [r.trainer_user_id]);
        if (!u.affectedRows) throw conflict('You are at your client limit. Raise it in your profile first.', 'full');
      }
      if (action === 'cancel' && r.status === 'accepted') {
        await conn.query('UPDATE trainers SET active_clients = GREATEST(active_clients - 1, 0) WHERE user_id = ?', [r.trainer_user_id]);
      }
      await conn.query('UPDATE session_requests SET status = ?, responded_at = NOW() WHERE request_id = ?', [status, r.request_id]);
      // Declines stay silent to the trainee (no "you were rejected" message).
      if (action === 'accept') await notify(conn, r.trainee_user_id, 'request_accepted', { requestId: r.request_id, from: firstName(user.name) });
      if (action === 'cancel') await notify(conn, r.trainer_user_id, 'request_cancelled', { requestId: r.request_id, from: firstName(user.name) });
      return { requestId: r.request_id, status };
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/contacts', async (req, res, next) => {
  const user = req.session.user;
  try {
    const mineCol = user.role === 'trainer' ? 'trainer_user_id' : 'trainee_user_id';
    const otherCol = user.role === 'trainer' ? 'trainee_user_id' : 'trainer_user_id';
    const [rows] = await db.query(
      `SELECT r.request_id, r.slot, r.session_type, u.user_id, u.name, u.email, u.phone
         FROM session_requests r JOIN users u ON u.user_id = r.${otherCol}
        WHERE r.${mineCol} = ? AND r.status = 'accepted' ORDER BY r.responded_at DESC`,
      [user.user_id]
    );
    res.json({ contacts: rows.map(r => ({ requestId: r.request_id, userId: r.user_id, name: r.name, email: r.email, phone: r.phone, slot: r.slot, sessionType: r.session_type })) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- safety
router.post('/block/:id', idParam, async (req, res, next) => {
  try {
    if (req.valid.params.id === req.session.user.user_id) throw badRequest('You cannot block yourself.');
    await db.query('INSERT IGNORE INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)', [req.session.user.user_id, req.valid.params.id]);
    await db.query("UPDATE session_requests SET status = 'cancelled' WHERE status = 'pending' AND ((trainee_user_id = ? AND trainer_user_id = ?) OR (trainee_user_id = ? AND trainer_user_id = ?))",
      [req.session.user.user_id, req.valid.params.id, req.valid.params.id, req.session.user.user_id]);
    res.json({ blocked: true });
  } catch (err) { next(err); }
});
router.post('/report/:id', idParam, validate({ body: z.object({ reason: z.enum(['spam', 'inappropriate', 'fake_profile', 'safety', 'other']), details: z.string().trim().max(1000).optional() }) }), async (req, res, next) => {
  try {
    await db.query('INSERT INTO reports (reporter_user_id, reported_user_id, reason, details) VALUES (?, ?, ?, ?)',
      [req.session.user.user_id, req.valid.params.id, req.valid.body.reason, req.valid.body.details || null]);
    res.status(201).json({ reported: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- notifications
router.get('/notifications', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT notification_id id, type, payload, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY notification_id DESC LIMIT 30', [req.session.user.user_id]);
    res.set('Cache-Control', 'no-store').json({ unread: rows.filter(r => !r.read_at).length, notifications: rows.map(r => ({ ...r, payload: parse(r.payload) })) });
  } catch (err) { next(err); }
});
router.post('/notifications/read', async (req, res, next) => {
  try {
    await db.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.session.user.user_id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
