// Fixtures were computed independently (by hand and in Python), not by this module.
const bc = require('../../services/bodyComposition');

const male = { sex: 'male', age: 30, heightCm: 175, weightKg: 75, waistCm: 85, neckCm: 38, activityLevel: 'moderate', goal: 'cut' };
const female = { sex: 'female', age: 28, heightCm: 160, weightKg: 60, waistCm: 75, hipCm: 98, neckCm: 32, activityLevel: 'light', goal: 'lean-bulk' };

describe('formulas', () => {
  test('BMI', () => {
    expect(bc.bmi(75, 175)).toBeCloseTo(24.49, 2);
  });

  test('U.S. Navy body fat (male / female)', () => {
    expect(bc.navyBodyFat(male)).toBeCloseTo(16.94, 2);
    expect(bc.navyBodyFat(female)).toBeCloseTo(30.31, 2);
  });

  test('Navy formula rejects impossible or missing measurements', () => {
    expect(() => bc.navyBodyFat({ ...male, waistCm: 38 })).toThrow(RangeError);
    expect(() => bc.navyBodyFat({ ...female, hipCm: undefined })).toThrow(/Hip/);
    expect(() => bc.navyBodyFat({ ...male, sex: 'other' })).toThrow(/sex/);
  });

  test('FFMI raw and normalised', () => {
    const f = bc.ffmi(75, 175, 16.94);
    expect(f.raw).toBeCloseTo(20.34, 2);
    expect(f.normalized).toBeCloseTo(20.65, 2);
  });

  test('Mifflin–St Jeor BMR', () => {
    expect(bc.bmrMifflin(male)).toBeCloseTo(1698.75, 2);
    expect(bc.bmrMifflin(female)).toBeCloseTo(1299, 0);
  });
});

describe('ectomorphy (exact Heath–Carter HWR branches)', () => {
  // weight = (height / HWR)^3 produces an exact HWR.
  const atHwr = hwr => bc.ectomorphy(100, (100 / hwr) ** 3);

  test('HWR ≥ 40.75 uses 0.732·HWR − 28.58', () => {
    expect(atHwr(40.75).rating).toBeCloseTo(0.732 * 40.75 - 28.58, 6);
    expect(atHwr(44).rating).toBeCloseTo(0.732 * 44 - 28.58, 6);
  });
  test('38.25 < HWR < 40.75 uses 0.463·HWR − 17.63', () => {
    expect(atHwr(39).rating).toBeCloseTo(0.463 * 39 - 17.63, 6);
    expect(atHwr(40.74).rating).toBeCloseTo(0.463 * 40.74 - 17.63, 6);
  });
  test('HWR ≤ 38.25 gives 0.1', () => {
    expect(atHwr(38.25).rating).toBe(0.1);
    expect(atHwr(35).rating).toBe(0.1);
  });
  test('fixture', () => {
    const e = bc.ectomorphy(175, 75);
    expect(e.hwr).toBeCloseTo(41.497, 3);
    expect(e.rating).toBeCloseTo(1.796, 3);
  });
});

describe('piecewise anchors (endomorphy / mesomorphy)', () => {
  test('hits anchors exactly and interpolates between them', () => {
    expect(bc.endomorphy(8, 'male')).toBeCloseTo(1.5, 6);
    expect(bc.endomorphy(15, 'male')).toBeCloseTo(3, 6);
    expect(bc.endomorphy(20, 'male')).toBeCloseTo(4, 6);
    expect(bc.endomorphy(16.94, 'male')).toBeCloseTo(3.388, 3);
    expect(bc.mesomorphy(20.65, 'male')).toBeCloseTo(4.433, 3);
  });
  test('female anchors are shifted (+7 BF points, −3 FFMI)', () => {
    expect(bc.endomorphy(22, 'female')).toBeCloseTo(3, 6);
    expect(bc.endomorphy(15, 'male')).toBeCloseTo(bc.endomorphy(22, 'female'), 6);
    expect(bc.mesomorphy(17, 'female')).toBeCloseTo(bc.mesomorphy(20, 'male'), 6);
  });
  test('clamps: ≥ last anchor is the max; far below extrapolates then clamps to the min', () => {
    expect(bc.endomorphy(32, 'male')).toBe(7);
    expect(bc.endomorphy(45, 'male')).toBe(7);
    expect(bc.endomorphy(2, 'male')).toBe(0.5);
    expect(bc.endomorphy(6, 'male')).toBeCloseTo(1.5 - (1.5 / 7) * 2, 6); // extrapolated, above floor
    expect(bc.mesomorphy(10, 'male')).toBe(1);
    expect(bc.mesomorphy(30, 'male')).toBe(7);
  });
});

describe('classification', () => {
  const ctx = { sex: 'male', bodyFatPct: 18 };
  test('single dominant type when the top two differ by more than 0.5', () => {
    const c = bc.classify({ endomorph: 3, mesomorph: 4.5, ectomorph: 1 }, ctx);
    expect(c).toMatchObject({ dominantType: 'mesomorph', secondaryType: null, label: 'mesomorph' });
  });
  test('secondary type when within 0.5 (boundary inclusive)', () => {
    const c = bc.classify({ endomorph: 4, mesomorph: 4.5, ectomorph: 1 }, ctx);
    expect(c).toMatchObject({ dominantType: 'mesomorph', secondaryType: 'endomorph', label: 'endo-mesomorph' });
  });
  test('confidence grows with the gap and is capped below 1 (it is an estimate)', () => {
    const close = bc.classify({ endomorph: 4, mesomorph: 4.1, ectomorph: 1 }, ctx).confidence;
    const clear = bc.classify({ endomorph: 1, mesomorph: 6, ectomorph: 1 }, ctx).confidence;
    expect(clear).toBeGreaterThan(close);
    expect(clear).toBeLessThanOrEqual(0.9);
  });
  test('confidence drops when body fat is outside the reliable range', () => {
    const r = { endomorph: 3, mesomorph: 4.5, ectomorph: 1 };
    expect(bc.classify(r, { sex: 'male', bodyFatPct: 40 }).confidence)
      .toBeLessThan(bc.classify(r, ctx).confidence);
  });
});

describe('assess() end-to-end fixtures', () => {
  test('male, moderate, cut', () => {
    const a = bc.assess(male);
    expect(a).toMatchObject({
      method: 'hc-approx-v1', isEstimate: true, bmi: 24.5, bodyFatPct: 16.9, ffmi: 20.3, ffmiNormalized: 20.6,
      dominantType: 'mesomorph', secondaryType: null, label: 'mesomorph', bmr: 1699, tdee: 2633,
      targets: { kcal: 2172, protein_g: 165, fat_g: 60, carbs_g: 243 },
    });
    expect(a.somatotype).toMatchObject({ endomorphy: 3.4, mesomorphy: 4.4, ectomorphy: 1.8 });
    expect(a.confidence).toBeCloseTo(0.68, 2);
  });

  test('female, light, lean-bulk → meso-endomorph', () => {
    const a = bc.assess(female);
    expect(a).toMatchObject({
      bodyFatPct: 30.3, dominantType: 'endomorph', secondaryType: 'mesomorph', label: 'meso-endomorph',
      bmr: 1299, tdee: 1786, targets: { kcal: 1920, protein_g: 108, fat_g: 54, carbs_g: 251 },
    });
    expect(a.somatotype.ectomorphy).toBeCloseTo(1.3, 1);
  });

  test('goal changes the calorie target in the documented direction', () => {
    const k = g => bc.assess({ ...male, goal: g }).targets.kcal;
    const tdee = bc.assess(male).tdee;
    expect(k('maintenance')).toBe(tdee);
    expect(k('cut')).toBeLessThan(tdee * 0.85);
    expect(k('lean-bulk')).toBeGreaterThan(tdee * 1.05);
    expect(k('bulk')).toBeGreaterThan(tdee * 1.1);
  });

  test('rejects unknown activity level / goal', () => {
    expect(() => bc.assess({ ...male, activityLevel: 'couch' })).toThrow(/activity/);
    expect(() => bc.assess({ ...male, goal: 'shred' })).toThrow(/goal/);
  });
});
