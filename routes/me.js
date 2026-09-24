// /api/me — the logged-in user's data rights (DPDP Act 2023 principles).
//   GET    /consent   current consent per purpose (+ when/which policy version)
//   PUT    /consent   change consent; withdrawing erases that purpose's data
//   GET    /export    everything we hold about the user, as a JSON download
//   DELETE /          delete the account (password + typed confirmation)
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../config/db');
const config = require('../config');
const { cookieClearOptions } = require('../config/session');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const consent = require('../services/consent');

const router = express.Router();
router.use(requireAuth);

const PURPOSE_INFO = {
  body_metrics: 'Height, weight and circumferences for body-composition estimates and calorie targets.',
  health: 'PAR-Q+ answers and injuries, so plans leave out movements that are not safe for you.',
  personality: 'Your Mini-IPIP answers, used for personality fit in matching.',
  interests: 'Hobbies and interests, used to find trainers you will get along with.',
  location: 'Your locality or device location, for distance to trainers and gyms.',
  matching: 'Showing your profile to potential matches and ranking them for you.',
};

router.get('/consent', async (req, res, next) => {
  try {
    const { state, detail } = await consent.getConsents(req.session.user.user_id);
    res.set('Cache-Control', 'no-store').json({
      policyVersion: consent.POLICY_VERSION,
      purposes: consent.PURPOSES.map(p => ({ purpose: p, description: PURPOSE_INFO[p], granted: state[p], ...(detail[p] || {}) })),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/consent', validate({ body: z.object({ purposes: z.partialRecord(z.enum(consent.PURPOSES), z.boolean()) }) }), async (req, res, next) => {
  try {
    const result = await consent.setConsents(req.session.user, req.valid.body.purposes, 'settings');
    res.json({ consents: result.state, erased: result.erased });
  } catch (err) {
    next(err);
  }
});

// Tables exported per user (column holding the user's id).
const EXPORT_TABLES = [
  ['body_assessments', 'user_id'],
  ['health_screens', 'user_id'],
  ['progress_logs', 'user_id'],
  ['user_plans', 'user_id'],
  ['workout_logs', 'user_id'],
  ['notifications', 'user_id'],
  ['match_interactions', 'actor_user_id'],
  ['blocks', 'blocker_user_id'],
  ['reports', 'reporter_user_id'],
  ['consent_ledger', 'user_id'],
];
const OPTIONAL_TABLES = [['shortlists', 'user_id'], ['session_requests', 'trainee_user_id'], ['plan_feedback', 'user_id']];

async function tableExists(name) {
  const [rows] = await db.query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [name]);
  return rows.length > 0;
}

router.get('/export', async (req, res, next) => {
  const user = req.session.user;
  try {
    const [[account]] = await db.query(
      'SELECT user_id, name, email, role, created_at, last_active_at, onboarding_complete FROM users WHERE user_id = ?', [user.user_id]
    );
    const roleTable = user.role === 'trainer' ? 'trainers' : 'trainees';
    const [[profile]] = await db.query(`SELECT * FROM ${roleTable} WHERE user_id = ?`, [user.user_id]);
    if (profile) delete profile.geo; // binary spatial column; lat/lng are included
    const data = {};
    for (const [table, col] of EXPORT_TABLES) {
      const [rows] = await db.query(`SELECT * FROM ${table} WHERE ${col} = ?`, [user.user_id]);
      data[table] = rows;
    }
    for (const [table, col] of OPTIONAL_TABLES) {
      if (await tableExists(table)) {
        const [rows] = await db.query(`SELECT * FROM ${table} WHERE ${col} = ?`, [user.user_id]);
        data[table] = rows;
      }
    }
    const id = profile ? (user.role === 'trainer' ? profile.trainer_id : profile.trainee_id) : null;
    if (id) {
      const [rows] = await db.query(`SELECT * FROM matches WHERE ${user.role === 'trainer' ? 'trainer_id' : 'trainee_id'} = ?`, [id]);
      data.matches = rows;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="trainsync-export-${stamp}.json"`,
      'Cache-Control': 'no-store',
    }).send(JSON.stringify({
      exportedAt: new Date().toISOString(),
      policyVersion: consent.POLICY_VERSION,
      note: 'Everything TrainSync stores about your account. Passwords are stored only as a one-way hash and are not included.',
      account,
      profile: profile || null,
      ...data,
    }, null, 2));
  } catch (err) {
    next(err);
  }
});

const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }),
});

router.delete('/', validate({ body: deleteSchema }), async (req, res, next) => {
  const user = req.session.user;
  try {
    const [[row]] = await db.query('SELECT password FROM users WHERE user_id = ?', [user.user_id]);
    if (!row || !(await bcrypt.compare(req.valid.body.password, row.password))) {
      return res.status(400).json({ error: 'Password is incorrect', code: 'invalid_credentials', details: [{ field: 'password' }], requestId: req.id });
    }
    await db.withTransaction(async conn => {
      // Minimal proof the withdrawal was honoured: id, purpose, time, policy version.
      await conn.query('INSERT INTO consent_ledger (user_id, purpose, granted, policy_version, source) VALUES ?', [
        consent.PURPOSES.map(p => [user.user_id, p, 0, consent.POLICY_VERSION, 'deletion']),
      ]);
      // Everything else cascades from users (role row, assessments, plans,
      // logs, matches, interactions, notifications, blocks, reports).
      await conn.query('DELETE FROM users WHERE user_id = ?', [user.user_id]);
    });
    req.log.info({ userId: user.user_id }, 'account deleted by user');
    req.session.destroy(() => {
      for (const name of [config.session.cookieName, ...config.session.legacyCookieNames]) res.clearCookie(name, cookieClearOptions);
      res.json({ deleted: true });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
