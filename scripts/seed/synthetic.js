#!/usr/bin/env node
// npm run seed:synthetic [-- --skip-generate] [--trainees=N --trainers=N]
// 1. runs ml/generate_synthetic.py (unless --skip-generate),
// 2. replaces all synthetic users (is_synthetic=1, reserved email domain) with
//    the generated population. Demo accounts are re-created by `npm run seed`.
// Synthetic users get one shared, random, unusable password hash (they are not
// meant to log in).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcrypt');
const db = require('../../config/db');
const config = require('../../config');
const { runPython } = require('../py');
const { parseArgs } = require('../import/lib');
const { TRAINEE_COLUMNS, TRAINER_COLUMNS, bodyAssessment, traineeRow, trainerRow, loadGymsByCity, homeGymFor } = require('./profiles');
const { purgeSyntheticUsers } = require('./purge');
const { printCounts } = require('./counts');

const DATA = path.join(__dirname, '..', '..', 'ml', 'data', 'synthetic');

async function readJsonl(file) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) out.push(JSON.parse(line));
  return out;
}

async function insertUsers(conn, people, role, hash) {
  const ids = new Map();
  const batch = config.seed.insertBatchSize;
  for (let i = 0; i < people.length; i += batch) {
    const part = people.slice(i, i + batch);
    await conn.query(
      'INSERT INTO users (name, email, password, role, is_synthetic, onboarding_complete, created_at) VALUES ?',
      [part.map(p => [p.name, p.email, hash, role, 1, 1, new Date(Date.now() - Math.floor(Math.random() * 365) * 864e5)])]
    );
    const [rows] = await conn.query('SELECT user_id, email FROM users WHERE email IN (?)', [part.map(p => p.email)]);
    for (const r of rows) ids.set(r.email, r.user_id);
  }
  return ids;
}

async function main() {
  const args = parseArgs();
  if (!args['skip-generate']) {
    const pyArgs = ['ml/generate_synthetic.py'];
    if (args.trainees) pyArgs.push('--trainees', String(args.trainees));
    if (args.trainers) pyArgs.push('--trainers', String(args.trainers));
    const status = runPython(pyArgs);
    if (status !== 0) throw new Error('ml/generate_synthetic.py failed');
  }
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
  const trainees = await readJsonl(path.join(DATA, 'trainees.jsonl'));
  const trainers = await readJsonl(path.join(DATA, 'trainers.jsonl'));
  const domain = `@${config.seed.syntheticEmailDomain}`;
  for (const p of [...trainees, ...trainers]) {
    if (!p.email.endsWith(domain)) throw new Error(`Synthetic email outside the reserved domain: ${p.email}`);
  }

  const conn = await db.getConnection();
  try {
    const t0 = Date.now();
    const removed = await purgeSyntheticUsers(conn, { onlyDomain: config.seed.syntheticEmailDomain });
    console.log(`  removed ${removed} previous synthetic users`);
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), config.auth.bcryptRounds);
    const gymsByCity = await loadGymsByCity(conn);
    const batch = config.seed.insertBatchSize;

    await conn.beginTransaction();
    // Trainees + body assessments (computed with the app's calculator).
    const traineeIds = await insertUsers(conn, trainees, 'trainee', hash);
    const typeCounts = {};
    for (let i = 0; i < trainees.length; i += batch) {
      const part = trainees.slice(i, i + batch);
      const rows = [], assessments = [], hidden = [];
      for (const p of part) {
        const id = traineeIds.get(p.email);
        const body = bodyAssessment(p);
        typeCounts[body.outputs.label] = (typeCounts[body.outputs.label] || 0) + 1;
        rows.push(traineeRow(id, p, body.dominantType));
        assessments.push([id, body.method, JSON.stringify(body.inputs), JSON.stringify(body.outputs), body.dominantType]);
        hidden.push([id, p.archetype, JSON.stringify({ ...p.latent, noised_blocks: p.noised_blocks, ext_id: p.ext_id }), meta.generator_version]);
      }
      await conn.query(`INSERT INTO trainees (${TRAINEE_COLUMNS.join(', ')}) VALUES ?`, [rows]);
      await conn.query('INSERT INTO body_assessments (user_id, method_version, inputs, outputs, dominant_type) VALUES ?', [assessments]);
      await conn.query('INSERT INTO synthetic_profiles (user_id, archetype, latent, generator_version) VALUES ?', [hidden]);
    }

    // Trainers + nearest real gym within the configured radius.
    const trainerIds = await insertUsers(conn, trainers, 'trainer', hash);
    let withGym = 0;
    for (let i = 0; i < trainers.length; i += batch) {
      const part = trainers.slice(i, i + batch);
      const rows = [], hidden = [];
      for (const p of part) {
        const id = trainerIds.get(p.email);
        const gymId = homeGymFor(gymsByCity, p, config.seed.homeGymRadiusKm);
        if (gymId) withGym++;
        rows.push(trainerRow(id, p, gymId));
        hidden.push([id, p.archetype, JSON.stringify({ ...p.latent, noised_blocks: p.noised_blocks, ext_id: p.ext_id }), meta.generator_version]);
      }
      await conn.query(`INSERT INTO trainers (${TRAINER_COLUMNS.join(', ')}) VALUES ?`, [rows]);
      await conn.query('INSERT INTO synthetic_profiles (user_id, archetype, latent, generator_version) VALUES ?', [hidden]);
    }
    await conn.commit();

    console.log(`✔ synthetic: ${trainees.length} trainees, ${trainers.length} trainers (${meta.generator_version}, seed ${meta.seed}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  trainers with a home gym within ${config.seed.homeGymRadiusKm} km: ${withGym}/${trainers.length}`);
    console.log('  computed body types:', Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
    await printCounts(conn);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch(err => { console.error('seed:synthetic failed:', err.message); process.exit(1); });
