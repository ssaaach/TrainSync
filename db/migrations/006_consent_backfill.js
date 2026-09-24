// Synthetic and demo users (is_synthetic = 1) were generated with every
// category filled in, so they are recorded as consenting to every purpose.
// Real users get no rows: they are asked in onboarding.
const PURPOSES = ['body_metrics', 'health', 'personality', 'interests', 'location', 'matching'];

exports.up = async conn => {
  for (const purpose of PURPOSES) {
    await conn.query(
      `INSERT INTO consent_ledger (user_id, purpose, granted, policy_version, source)
       SELECT u.user_id, ?, 1, '2026-09-24', 'synthetic' FROM users u
        WHERE u.is_synthetic = 1
          AND NOT EXISTS (SELECT 1 FROM consent_ledger c WHERE c.user_id = u.user_id AND c.purpose = ?)`,
      [purpose, purpose]
    );
  }
  // Real users who finished the old flow still need the new consent step.
  await conn.query('UPDATE users SET onboarding_complete = 0, onboarding_step = 0 WHERE is_synthetic = 0');
};
