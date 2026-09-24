// Builds the planner input for a trainee from their profile, reading only the
// categories they have consented to (services/consent.js). Missing categories
// degrade gracefully: no body metrics -> general targets; no health info ->
// cautious plans.
const db = require('../config/db');
const consent = require('./consent');

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

async function loadTraineeProfile(userId) {
  const [[row]] = await db.query('SELECT * FROM trainees WHERE user_id = ?', [userId]);
  if (!row) return null;
  const { state } = await consent.getConsents(userId);
  const body = state.body_metrics;
  const health = state.health;
  return {
    sex: row.sex,
    age: row.age,
    goal: row.goal,
    goals: parse(row.goals) || [],
    experience_level: row.experience_level,
    activity_level: row.activity_level,
    days_per_week: row.days_per_week,
    session_minutes: row.session_minutes,
    equipment: parse(row.equipment) || ['body only'],
    diet_pref: row.diet_pref,
    allergens: parse(row.allergens) || [],
    cuisines: parse(row.cuisines) || [],
    food_budget_inr_per_day: row.food_budget_inr_per_day,
    schedule: parse(row.schedule) || null,
    // consent-gated
    height_cm: body ? row.height_cm : null,
    weight_kg: body ? row.weight_kg : null,
    waist_cm: body ? row.waist_cm : null,
    neck_cm: body ? row.neck_cm : null,
    hip_cm: body ? row.hip_cm : null,
    body_type: body ? (row.body_type_override || row.body_type) : null,
    limitations: health ? parse(row.limitations) || [] : [],
    health_flagged: health ? row.health_flagged === 1 : false,
    health_unknown: !health,
    consents: state,
  };
}

module.exports = { loadTraineeProfile };
