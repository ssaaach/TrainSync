// Body-type estimate, method "hc-approx-v1".
//
// A true Heath–Carter somatotype needs skinfold calipers and bone breadths,
// which the app doesn't collect. This is a documented approximation:
//   ectomorphy  — exact Heath–Carter height-weight-ratio (HWR) formula
//   endomorphy  — piecewise-linear map from U.S. Navy body-fat %
//   mesomorphy  — piecewise-linear map from normalised FFMI
// All anchors live in config/app.config.json -> bodyComposition. Pure functions only.
const config = require('../config');

const C = config.bodyComposition;
const TYPES = ['endomorph', 'mesomorph', 'ectomorph'];
const PREFIX = { endomorph: 'endo', mesomorph: 'meso', ectomorph: 'ecto' };

const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function bmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

// U.S. Navy circumference method (all measurements in cm).
function navyBodyFat({ sex, heightCm, waistCm, neckCm, hipCm }) {
  let bf;
  if (sex === 'male') {
    if (!(waistCm > neckCm)) throw new RangeError('Waist must be larger than neck');
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else if (sex === 'female') {
    if (!(hipCm > 0)) throw new RangeError('Hip measurement is required for females');
    if (!(waistCm + hipCm > neckCm)) throw new RangeError('Waist + hip must be larger than neck');
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    throw new RangeError('sex must be "male" or "female" for the body-fat formula');
  }
  return clamp(bf, C.bodyFatClampPct[0], C.bodyFatClampPct[1]);
}

// FFMI = lean mass / h²; normalised to 1.8 m: FFMI + 6.1·(1.8 − h).
function ffmi(weightKg, heightCm, bodyFatPct) {
  const h = heightCm / 100;
  const raw = (weightKg * (1 - bodyFatPct / 100)) / (h * h);
  return { raw, normalized: raw + 6.1 * (1.8 - h) };
}

// Exact Heath–Carter ectomorphy from HWR = height / weight^(1/3).
function ectomorphy(heightCm, weightKg) {
  const hwr = heightCm / Math.cbrt(weightKg);
  let rating;
  if (hwr >= 40.75) rating = 0.732 * hwr - 28.58;
  else if (hwr > 38.25) rating = 0.463 * hwr - 17.63;
  else rating = 0.1;
  return { hwr, rating: Math.max(0.1, rating) };
}

// Linear interpolation through [x, y] anchors; extrapolates below the first
// anchor with the first segment's slope, flat above the last; then clamps.
function piecewise(x, anchors, [lo, hi]) {
  const [x0, y0] = anchors[0];
  const [x1, y1] = anchors[1];
  let y;
  if (x <= x0) y = y0 + ((y1 - y0) / (x1 - x0)) * (x - x0);
  else if (x >= anchors[anchors.length - 1][0]) y = anchors[anchors.length - 1][1];
  else {
    for (let i = 1; i < anchors.length; i++) {
      const [xa, ya] = anchors[i - 1];
      const [xb, yb] = anchors[i];
      if (x <= xb) { y = ya + ((yb - ya) * (x - xa)) / (xb - xa); break; }
    }
  }
  return clamp(y, lo, hi);
}

const endomorphy = (bodyFatPct, sex) => piecewise(bodyFatPct, C.endomorphy.anchors[sex], C.endomorphy.range);
const mesomorphy = (ffmiNorm, sex) => piecewise(ffmiNorm, C.mesomorphy.anchors[sex], C.mesomorphy.range);

// Dominant type, optional secondary (top two within `secondaryWithin`), and a
// heuristic confidence that grows with the gap between the top two ratings and
// drops when body fat is outside the range where the Navy formula is reliable.
function classify(ratings, { sex, bodyFatPct }) {
  const ranked = TYPES.map(t => ({ type: t, rating: ratings[t] })).sort((a, b) => b.rating - a.rating);
  const [first, second] = ranked;
  const gap = first.rating - second.rating;
  const secondaryType = gap <= C.secondaryWithin ? second.type : null;
  const label = secondaryType ? `${PREFIX[secondaryType]}-${first.type}` : first.type;

  const k = C.confidence;
  const [lo, hi] = k.reliableBodyFat[sex];
  let confidence = k.base + k.gapWeight * Math.min(gap / k.gapFull, 1);
  if (bodyFatPct < lo || bodyFatPct > hi) confidence -= k.outOfRangePenalty;
  return { dominantType: first.type, secondaryType, label, confidence: clamp(confidence, k.min, k.max) };
}

// Mifflin–St Jeor.
function bmrMifflin({ sex, weightKg, heightCm, age }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

function energyTargets({ sex, weightKg, heightCm, age, activityLevel = 'moderate', goal = 'maintenance' }) {
  const multiplier = C.activityMultipliers[activityLevel];
  if (!multiplier) throw new RangeError(`Unknown activity level "${activityLevel}"`);
  if (!(goal in C.goalCalorieAdjust)) throw new RangeError(`Unknown goal "${goal}"`);
  const bmr = bmrMifflin({ sex, weightKg, heightCm, age });
  const tdee = bmr * multiplier;
  const kcal = tdee * (1 + C.goalCalorieAdjust[goal]);
  const protein = C.proteinPerKg[goal] * weightKg;
  const fat = C.fatPerKg[goal] * weightKg;
  const carbs = Math.max(0, (kcal - 4 * protein - 9 * fat) / 4);
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targets: { kcal: Math.round(kcal), protein_g: Math.round(protein), fat_g: Math.round(fat), carbs_g: Math.round(carbs) },
  };
}

/**
 * Full assessment. Required: sex, age, heightCm, weightKg, waistCm, neckCm
 * (+ hipCm for females). Optional: activityLevel, goal, wristCm (recorded only).
 */
function assess(input) {
  const { sex, heightCm, weightKg } = input;
  const bodyFatPct = navyBodyFat(input);
  const f = ffmi(weightKg, heightCm, bodyFatPct);
  const ecto = ectomorphy(heightCm, weightKg);
  const ratings = {
    endomorph: endomorphy(bodyFatPct, sex),
    mesomorph: mesomorphy(f.normalized, sex),
    ectomorph: ecto.rating,
  };
  const cls = classify(ratings, { sex, bodyFatPct });
  const energy = energyTargets(input);
  return {
    method: C.method,
    bmi: round(bmi(weightKg, heightCm), 1),
    bodyFatPct: round(bodyFatPct, 1),
    ffmi: round(f.raw, 1),
    ffmiNormalized: round(f.normalized, 1),
    hwr: round(ecto.hwr, 2),
    somatotype: {
      endomorphy: round(ratings.endomorph, 1),
      mesomorphy: round(ratings.mesomorph, 1),
      ectomorphy: round(ratings.ectomorph, 1),
      // Somatochart coordinates: X = ecto − endo, Y = 2·meso − (endo + ecto).
      x: round(ratings.ectomorph - ratings.endomorph, 2),
      y: round(2 * ratings.mesomorph - (ratings.endomorph + ratings.ectomorph), 2),
    },
    ...cls,
    confidence: round(cls.confidence, 2),
    ...energy,
    isEstimate: true,
  };
}

module.exports = { assess, bmi, navyBodyFat, ffmi, ectomorphy, endomorphy, mesomorphy, piecewise, classify, bmrMifflin, energyTargets, METHOD: C.method };
