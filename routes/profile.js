// /api/profile — read and update the logged-in user's role profile.
const express = require('express');
const { z } = require('zod');
const db = require('../config/db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// An empty form field clears the column; an omitted field leaves it untouched.
const blankToNull = v => (v === '' ? null : v);

const text = max => z.preprocess(
  v => (typeof v === 'string' ? blankToNull(v.trim()) : v),
  z.string().max(max).nullable().optional()
);

const int = (min, max, label) => z.preprocess(
  v => (typeof v === 'string' ? blankToNull(v.trim()) : v),
  z.coerce.number().int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`)
    .nullable().optional()
);

const gender = z.preprocess(
  v => (typeof v === 'string' ? blankToNull(v.trim().toLowerCase()) : v),
  z.enum(config.vocab.genders, { message: 'Gender must be male, female or other' }).nullable().optional()
);

const common = {
  name: z.preprocess(v => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1, 'Name cannot be empty').max(100).optional()),
  location: text(255),
  city: text(100),
  locality: text(150),
};

const traineeSchema = z.object({
  ...common,
  age: int(13, 100, 'Age'),
  gender,
  fitness_goal: text(1000),
  goal: text(1000), // legacy field name from the old update-profile form
}).transform(({ goal, ...rest }) => ({
  ...rest,
  fitness_goal: rest.fitness_goal !== undefined ? rest.fitness_goal : goal,
}));

const trainerSchema = z.object({
  ...common,
  experience: int(0, 70, 'Experience'),
  certification: text(255),
  specialization: text(1000),
});

const PROFILE_COLUMNS = {
  trainee: ['age', 'gender', 'fitness_goal', 'location', 'city', 'locality'],
  trainer: ['experience', 'certification', 'specialization', 'location', 'city', 'locality'],
};
const TABLE = { trainee: 'trainees', trainer: 'trainers' };

async function loadProfile(user) {
  const table = TABLE[user.role];
  const cols = PROFILE_COLUMNS[user.role].join(', ');
  const [[u]] = await db.execute('SELECT user_id, name, email, role FROM users WHERE user_id = ?', [user.user_id]);
  const [[p]] = await db.execute(`SELECT ${cols} FROM ${table} WHERE user_id = ?`, [user.user_id]);
  return { ...u, profile: p || {} };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await loadProfile(req.session.user));
  } catch (err) {
    next(err);
  }
});

// Role-specific body validation (the schema depends on the session role).
function validateForRole(req, res, next) {
  const schema = req.session.user.role === 'trainer' ? trainerSchema : traineeSchema;
  return validate({ body: schema })(req, res, next);
}

async function updateProfile(req, res, next) {
  const user = req.session.user;
  const { name, ...fields } = req.valid.body;
  const table = TABLE[user.role];
  const cols = PROFILE_COLUMNS[user.role].filter(c => fields[c] !== undefined);
  try {
    await db.withTransaction(async conn => {
      if (name !== undefined) {
        await conn.execute('UPDATE users SET name = ? WHERE user_id = ?', [name, user.user_id]);
      }
      // Older accounts may be missing their role row.
      await conn.execute(`INSERT IGNORE INTO ${table} (user_id) VALUES (?)`, [user.user_id]);
      if (cols.length) {
        await conn.execute(
          `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE user_id = ?`,
          [...cols.map(c => fields[c]), user.user_id]
        );
      }
    });
    if (name !== undefined) req.session.user.name = name;
    const profile = await loadProfile(user);
    res.json({ message: `${user.role === 'trainer' ? 'Trainer' : 'Trainee'} profile updated successfully`, ...profile });
  } catch (err) {
    next(err);
  }
}

router.patch('/', requireAuth, validateForRole, updateProfile);

module.exports = router;
module.exports.legacyUpdate = [requireAuth, validateForRole, updateProfile];
