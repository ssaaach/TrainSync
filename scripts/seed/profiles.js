// Row builders shared by the demo-account and synthetic seeders. Body type is
// always computed with the app's calculator (services/bodyComposition.js).
const { assess, METHOD } = require('../../services/bodyComposition');
const { nearest } = require('../../services/geo');

const j = v => (v === undefined || v === null ? null : JSON.stringify(v));

const TRAINEE_COLUMNS = [
  'user_id', 'age', 'gender', 'fitness_goal', 'location', 'city', 'locality', 'lat', 'lng', 'sex', 'height_cm',
  'weight_kg', 'waist_cm', 'neck_cm', 'hip_cm', 'wrist_cm', 'activity_level', 'experience_level', 'goal', 'goals',
  'days_per_week', 'session_minutes', 'equipment', 'diet_pref', 'allergens', 'budget_per_session_inr', 'body_type',
  'search_radius_km', 'modality', 'languages', 'trainer_gender_pref', 'big5', 'style_pref', 'schedule',
];

const TRAINER_COLUMNS = [
  'user_id', 'experience', 'certification', 'specialization', 'location', 'city', 'locality', 'lat', 'lng', 'gender',
  'years_experience', 'certifications', 'specializations', 'best_level', 'price_per_session_inr', 'max_clients',
  'active_clients', 'rating_avg', 'rating_count', 'bio', 'home_gym_id', 'travel_radius_km', 'coaching_style', 'big5',
  'schedule', 'languages', 'modality',
];

function bodyAssessment(p) {
  const inputs = {
    sex: p.sex, age: p.age, heightCm: p.height_cm, weightKg: p.weight_kg, waistCm: p.waist_cm, neckCm: p.neck_cm,
    hipCm: p.sex === 'female' ? p.hip_cm : undefined, wristCm: p.wrist_cm, activityLevel: p.activity_level, goal: p.goal,
  };
  const outputs = assess(inputs);
  return { method: METHOD, inputs, outputs, dominantType: outputs.dominantType };
}

function traineeRow(userId, p, bodyType) {
  const summary = (p.goals || []).map(g => g.replace(/-/g, ' ')).join(', ');
  return [
    userId, p.age, p.gender, summary || null, `${p.locality}, ${p.city}`, p.city, p.locality, p.lat, p.lng, p.sex,
    p.height_cm, p.weight_kg, p.waist_cm, p.neck_cm, p.hip_cm, p.wrist_cm, p.activity_level, p.experience_level,
    p.goal, j(p.goals), p.days_per_week, p.session_minutes, j(p.equipment), p.diet_pref, j(p.allergens),
    p.budget_per_session_inr, bodyType, p.search_radius_km, j(p.modality), j(p.languages), p.trainer_gender_pref,
    j(p.big5), j(p.style_pref), j(p.schedule),
  ];
}

function trainerRow(userId, p, homeGymId) {
  return [
    userId, p.years_experience, p.certifications[0] || null, (p.specializations || []).join(', '),
    `${p.locality}, ${p.city}`, p.city, p.locality, p.lat, p.lng, p.gender, p.years_experience, j(p.certifications),
    j(p.specializations), p.best_level, p.price_per_session_inr, p.max_clients, p.active_clients, p.rating_avg,
    p.rating_count, p.bio, homeGymId, p.travel_radius_km, j(p.coaching_style), j(p.big5), j(p.schedule),
    j(p.languages), j(p.modality),
  ];
}

// OSM/manual gyms with coordinates, grouped by city for nearest-gym lookup.
async function loadGymsByCity(conn) {
  const [gyms] = await conn.query('SELECT gym_id, city, lat, lng, name FROM gyms WHERE lat IS NOT NULL');
  const byCity = new Map();
  for (const g of gyms) {
    const key = g.city.toLowerCase() === 'bangalore' ? 'bengaluru' : g.city.toLowerCase();
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(g);
  }
  return byCity;
}

function homeGymFor(gymsByCity, p, radiusKm) {
  const hit = nearest(gymsByCity.get(p.city.toLowerCase()) || [], p.lat, p.lng, radiusKm);
  return hit ? hit.item.gym_id : null;
}

module.exports = { TRAINEE_COLUMNS, TRAINER_COLUMNS, bodyAssessment, traineeRow, trainerRow, loadGymsByCity, homeGymFor };
