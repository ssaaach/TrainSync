// Purpose-bound consent (DPDP Act 2023 principles).
//
//   Every decision is appended to `consent_ledger`; the current state is the
//   latest row per (user, purpose). No row means "not granted".
//   Withdrawing consent erases the data collected for that purpose (DPDP
//   s.8(7)): future features simply degrade to their fallback.
//   Code that reads personal data asks this module first (can / requireConsent).
const config = require('../config');
const db = require('../config/db');
const { forbidden } = require('../middleware/errors');

const PURPOSES = ['body_metrics', 'health', 'personality', 'interests', 'location', 'matching'];
const POLICY_VERSION = config.consent.policyVersion;

// Columns each purpose governs (erased on withdrawal), per role table.
const PURPOSE_COLUMNS = {
  body_metrics: {
    trainees: ['height_cm', 'weight_kg', 'waist_cm', 'neck_cm', 'hip_cm', 'wrist_cm', 'body_type', 'body_type_override'],
    trainers: [],
  },
  health: { trainees: ['limitations'], trainers: [] },
  personality: { trainees: ['big5', 'cluster_id', 'cluster_version'], trainers: ['big5', 'cluster_id', 'cluster_version'] },
  interests: { trainees: ['hobbies', 'interests'], trainers: ['hobbies', 'interests'] },
  location: { trainees: ['lat', 'lng', 'locality'], trainers: ['lat', 'lng', 'locality'] },
  matching: { trainees: [], trainers: [] },
};

// Extra rows removed on withdrawal (tables keyed by user_id).
const PURPOSE_TABLES = {
  body_metrics: ['body_assessments', 'progress_logs'],
  health: ['health_screens'],
};

const empty = () => Object.fromEntries(PURPOSES.map(p => [p, false]));

async function getConsents(userId, conn = db) {
  const [rows] = await conn.query(
    `SELECT c.purpose, c.granted, c.policy_version, c.created_at
       FROM consent_ledger c
       JOIN (SELECT purpose, MAX(ledger_id) AS id FROM consent_ledger WHERE user_id = ? GROUP BY purpose) latest
         ON latest.id = c.ledger_id`,
    [userId]
  );
  const state = empty();
  const detail = {};
  for (const r of rows) {
    state[r.purpose] = r.granted === 1;
    detail[r.purpose] = { granted: r.granted === 1, policyVersion: r.policy_version, at: r.created_at };
  }
  return { state, detail, decided: rows.length > 0 };
}

async function can(userId, purpose) {
  const { state } = await getConsents(userId);
  return state[purpose] === true;
}

// Erases what a purpose covered, for one user.
async function eraseFor(conn, userId, role, purpose) {
  const table = role === 'trainer' ? 'trainers' : 'trainees';
  const cols = PURPOSE_COLUMNS[purpose][table];
  if (cols.length) {
    // lat/lng feed a NOT NULL generated POINT column; NULL coordinates become
    // POINT(0 0), which every radius query already excludes.
    await conn.query(`UPDATE ${table} SET ${cols.map(c => `${c} = NULL`).join(', ')} WHERE user_id = ?`, [userId]);
  }
  for (const t of PURPOSE_TABLES[purpose] || []) {
    await conn.query(`DELETE FROM ${t} WHERE user_id = ?`, [userId]);
  }
  if (purpose === 'health' && table === 'trainees') {
    await conn.query('UPDATE trainees SET health_flagged = 0 WHERE user_id = ?', [userId]);
  }
}

/**
 * Records consent decisions. `changes` = { purpose: boolean }. Only purposes
 * whose state actually changes get a ledger row (plus every purpose on the
 * first decision). Withdrawals erase that purpose's data in the same
 * transaction. Returns the new state and the purposes that were erased.
 */
async function setConsents(user, changes, source) {
  const unknown = Object.keys(changes).filter(p => !PURPOSES.includes(p));
  if (unknown.length) throw new Error(`Unknown consent purpose(s): ${unknown.join(', ')}`);
  return db.withTransaction(async conn => {
    const { state, decided } = await getConsents(user.user_id, conn);
    const next = { ...state, ...changes };
    const rows = [];
    const erased = [];
    for (const p of PURPOSES) {
      const changed = next[p] !== state[p];
      if (changed || !decided) rows.push([user.user_id, p, next[p] ? 1 : 0, POLICY_VERSION, source]);
      if (state[p] && !next[p]) {
        await eraseFor(conn, user.user_id, user.role, p);
        erased.push(p);
      }
    }
    if (rows.length) {
      await conn.query('INSERT INTO consent_ledger (user_id, purpose, granted, policy_version, source) VALUES ?', [rows]);
    }
    return { state: next, erased };
  });
}

// Express guard: 403 with a clear code when a purpose isn't consented.
function requireConsent(purpose) {
  return async (req, res, next) => {
    try {
      if (await can(req.session.user.user_id, purpose)) return next();
      return next(forbidden(`This needs your consent for "${purpose.replace('_', ' ')}". You can turn it on in Privacy & data.`, 'consent_required'));
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { PURPOSES, POLICY_VERSION, PURPOSE_COLUMNS, getConsents, setConsents, can, requireConsent, eraseFor };
