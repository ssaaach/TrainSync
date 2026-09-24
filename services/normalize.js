// Normalises free-text body-type / goal / role inputs to the DB enums.
// Inputs stay free text in the UI; this is where typos and variants are mapped.
const config = require('../config');

const GOAL_ALIASES = {
  cut: 'cut', cutting: 'cut', 'fat loss': 'cut', 'fat-loss': 'cut', 'weight loss': 'cut', lose: 'cut',
  bulk: 'bulk', bulking: 'bulk', 'muscle gain': 'bulk', gain: 'bulk',
  'lean bulk': 'lean-bulk', 'lean-bulk': 'lean-bulk', leanbulk: 'lean-bulk', 'lean bulking': 'lean-bulk',
  maintenance: 'maintenance', maintainance: 'maintenance', maintain: 'maintenance',
  maintenence: 'maintenance', maintainence: 'maintenance', maintaince: 'maintenance',
};

const BODY_TYPE_ALIASES = {
  ecto: 'ectomorph', ectomorph: 'ectomorph', ectomorphic: 'ectomorph',
  meso: 'mesomorph', mesomorph: 'mesomorph', mesomorphic: 'mesomorph',
  endo: 'endomorph', endomorph: 'endomorph', endomorphic: 'endomorph',
};

function clean(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

function lookup(value, aliases, allowed) {
  const v = clean(value);
  if (allowed.includes(v)) return v;
  if (aliases[v]) return aliases[v];
  const spaced = v.replace(/-/g, ' ');
  return aliases[spaced] || null;
}

const normalizeGoal = v => lookup(v, GOAL_ALIASES, config.vocab.goals);
const normalizeBodyType = v => lookup(v, BODY_TYPE_ALIASES, config.vocab.bodyTypes);
const normalizeRole = v => {
  const r = clean(v);
  return config.roles.includes(r) ? r : null;
};

// City spelling variants -> every spelling that should match, canonical first.
const CITY_GROUPS = [
  ['bengaluru', 'bangalore'],
  ['mumbai', 'bombay'],
  ['chennai', 'madras'],
  ['delhi', 'new delhi'],
  ['gurugram', 'gurgaon'],
  ['kolkata', 'calcutta'],
];
const CITY_INDEX = new Map(CITY_GROUPS.flatMap(g => g.map(name => [name, g])));

const cityKey = v => String(v ?? '').trim().toLowerCase().replace(/s+/g, ' ');
// All spellings to query for a city ("Bangalore" -> ['bengaluru', 'bangalore']).
const citySpellings = v => CITY_INDEX.get(cityKey(v)) || [cityKey(v)];
// One canonical key per city ("Bangalore" and "Bengaluru" -> 'bengaluru').
const canonicalCity = v => citySpellings(v)[0];

module.exports = { normalizeGoal, normalizeBodyType, normalizeRole, clean, citySpellings, canonicalCity, cityKey };
