// Demo accounts with complete Bengaluru profiles. Password comes from
// DEMO_PASSWORD in .env. They are fictional, so they are flagged
// is_synthetic=1 (purge:synthetic removes them; `npm run seed` recreates them).
const bcrypt = require('bcrypt');
const config = require('../../config');
const { TRAINEE_COLUMNS, TRAINER_COLUMNS, bodyAssessment, traineeRow, trainerRow, loadGymsByCity, homeGymFor } = require('./profiles');

const INDIRANAGAR = { city: 'Bengaluru', locality: 'Indiranagar', lat: 12.973291, lng: 77.640467 };
const MORNINGS = { mon: ['morning'], tue: ['morning'], wed: ['morning'], thu: ['morning'], fri: ['morning'], sat: ['morning'] };

const DEMO_TRAINEE = {
  name: 'Demo Trainee', sex: 'female', gender: 'female', age: 29, ...INDIRANAGAR, lat: 12.9719, lng: 77.6412,
  height_cm: 162, weight_kg: 68, waist_cm: 84, neck_cm: 33, hip_cm: 102, wrist_cm: 15.2,
  activity_level: 'light', experience_level: 'beginner', goal: 'cut', goals: ['fat-loss', 'general-fitness'],
  days_per_week: 4, session_minutes: 45, equipment: ['body only', 'dumbbell', 'bands'], diet_pref: 'veg', allergens: [],
  budget_per_session_inr: 1200, search_radius_km: 8, modality: ['in_person_gym', 'online'], languages: ['English', 'Hindi', 'Kannada'],
  trainer_gender_pref: null, big5: { O: 0.7, C: 0.75, E: 0.55, A: 0.7, N: 0.45 },
  style_pref: { structure: 4, tone: 2, checkin: 5, data: 4 }, schedule: MORNINGS,
};

const DEMO_TRAINER = {
  name: 'Demo Trainer', gender: 'female', ...INDIRANAGAR, lat: 12.9746, lng: 77.6389,
  years_experience: 7, certifications: ['ACE-CPT', 'Precision Nutrition L1'], specializations: ['fat-loss', 'general-fitness', 'beginner-onboarding'],
  best_level: 'beginner', price_per_session_inr: 1000, max_clients: 15, active_clients: 6, rating_avg: 4.6, rating_count: 38,
  bio: '[Demo profile] Fat-loss and beginner coach in Indiranagar. Structured plans, daily check-ins, supportive style.',
  travel_radius_km: 6, coaching_style: { structure: 4, tone: 2, checkin: 5, data: 4 },
  big5: { O: 0.65, C: 0.85, E: 0.7, A: 0.8, N: 0.3 }, schedule: { ...MORNINGS, sun: ['morning'] },
  languages: ['English', 'Hindi', 'Kannada'], modality: ['in_person_gym', 'online'],
};

function upsertSql(table, columns) {
  const updates = columns.filter(c => c !== 'user_id').map(c => `${c} = VALUES(${c})`).join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`;
}

async function upsertUser(conn, email, name, role, hash) {
  await conn.query(
    `INSERT INTO users (email, name, role, password, is_synthetic, onboarding_complete) VALUES (?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), password = VALUES(password),
       is_synthetic = 1, onboarding_complete = 1`,
    [email, name, role, hash]
  );
  const [[{ user_id: id }]] = await conn.query('SELECT user_id FROM users WHERE email = ?', [email]);
  return id;
}

async function seedDemoAccounts(conn) {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < config.auth.passwordMinLength) {
    throw new Error(`Set DEMO_PASSWORD in .env (at least ${config.auth.passwordMinLength} characters) to create the demo accounts.`);
  }
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const emails = config.seed.demoEmails;

  const traineeId = await upsertUser(conn, emails.trainee, DEMO_TRAINEE.name, 'trainee', hash);
  const body = bodyAssessment(DEMO_TRAINEE);
  await conn.query(upsertSql('trainees', TRAINEE_COLUMNS), traineeRow(traineeId, DEMO_TRAINEE, body.dominantType));
  await conn.query('DELETE FROM body_assessments WHERE user_id = ?', [traineeId]);
  await conn.query(
    'INSERT INTO body_assessments (user_id, method_version, inputs, outputs, dominant_type) VALUES (?, ?, ?, ?, ?)',
    [traineeId, body.method, JSON.stringify(body.inputs), JSON.stringify(body.outputs), body.dominantType]
  );

  const trainerId = await upsertUser(conn, emails.trainer, DEMO_TRAINER.name, 'trainer', hash);
  const homeGym = homeGymFor(await loadGymsByCity(conn), DEMO_TRAINER, config.seed.homeGymRadiusKm);
  await conn.query(upsertSql('trainers', TRAINER_COLUMNS), trainerRow(trainerId, DEMO_TRAINER, homeGym));

  return { trainee: emails.trainee, trainer: emails.trainer, bodyType: body.outputs.label, homeGym };
}

module.exports = { seedDemoAccounts };
