#!/usr/bin/env node
// npm run seed — curated reference data + demo accounts (idempotent).
// Requires `npm run import:foods` first (dish macros are computed from foods).
const db = require('../../config/db');
const { seedLocalities, seedDishes } = require('./reference');
const { seedDemoAccounts } = require('./demo');
const { printCounts } = require('./counts');

(async () => {
  const conn = await db.getConnection();
  try {
    console.log(`✔ localities: ${await seedLocalities(conn)}`);
    console.log(`✔ dishes: ${await seedDishes(conn)} (macros computed from USDA ingredients)`);
    const demo = await seedDemoAccounts(conn);
    console.log(`✔ demo accounts: ${demo.trainee} (body type: ${demo.bodyType}), ${demo.trainer} (home gym id: ${demo.homeGym ?? 'none within radius'})`);
    await printCounts(conn);
  } catch (err) {
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await db.end();
  }
})();
