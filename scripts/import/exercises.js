#!/usr/bin/env node
// npm run import:exercises
// Imports free-exercise-db (Unlicense / public domain) into `exercises`,
// upserting on the dataset id. Adds movement_pattern + is_compound.
// If the source is unreachable and nothing is cached, loads a small fallback
// set flagged is_synthetic=1 (never labelled as the real dataset).
const path = require('path');
const db = require('../../config/db');
const { cachedDownload, parseArgs } = require('./lib');
const { movementPattern, isCompound } = require('./movementPatterns');

const SOURCE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const LEVELS = new Set(['beginner', 'intermediate', 'expert']);
const MECHANICS = new Set(['compound', 'isolation']);

async function loadSource(refresh) {
  try {
    const file = await cachedDownload(SOURCE_URL, 'free-exercise-db/exercises.json', { refresh });
    return { records: require(file), source: 'free-exercise-db', synthetic: 0 };
  } catch (err) {
    console.error(`⚠️  free-exercise-db unreachable (${err.message}). Loading the SYNTHETIC fallback set (is_synthetic=1).`);
    return { records: require(path.join(__dirname, '..', '..', 'db', 'seeds', 'fallback_exercises.json')), source: 'fallback', synthetic: 1 };
  }
}

async function main() {
  const args = parseArgs();
  const { records, source, synthetic } = await loadSource(Boolean(args.refresh));
  const rows = records.map(e => {
    const pattern = movementPattern(e);
    return [
      e.id,
      e.name,
      e.force || null,
      LEVELS.has(e.level) ? e.level : null,
      MECHANICS.has(e.mechanic) ? e.mechanic : null,
      e.equipment || null,
      e.category || null,
      JSON.stringify(e.primaryMuscles || []),
      JSON.stringify(e.secondaryMuscles || []),
      JSON.stringify(e.instructions || []),
      JSON.stringify((e.images || []).map(img => (/^https?:/.test(img) ? img : IMAGE_BASE + img))),
      pattern,
      isCompound(e, pattern) ? 1 : 0,
      source,
      synthetic,
    ];
  });

  const conn = await db.getConnection();
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await conn.query(
        `INSERT INTO exercises (ext_id, name, force_type, level, mechanic, equipment, category,
           primary_muscles, secondary_muscles, instructions, images, movement_pattern, is_compound, source, is_synthetic)
         VALUES ?
         ON DUPLICATE KEY UPDATE name = VALUES(name), force_type = VALUES(force_type), level = VALUES(level),
           mechanic = VALUES(mechanic), equipment = VALUES(equipment), category = VALUES(category),
           primary_muscles = VALUES(primary_muscles), secondary_muscles = VALUES(secondary_muscles),
           instructions = VALUES(instructions), images = VALUES(images), movement_pattern = VALUES(movement_pattern),
           is_compound = VALUES(is_compound), source = VALUES(source), is_synthetic = VALUES(is_synthetic)`,
        [rows.slice(i, i + 200)]
      );
    }
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM exercises WHERE source = ?', [source]);
    const [byPattern] = await conn.query('SELECT movement_pattern, COUNT(*) n FROM exercises GROUP BY movement_pattern ORDER BY n DESC');
    console.log(`✔ exercises: ${rows.length} upserted from ${source}; ${n} rows with source=${source}`);
    console.log('  by pattern:', byPattern.map(r => `${r.movement_pattern}=${r.n}`).join(', '));
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch(err => { console.error('import:exercises failed:', err.message); process.exit(1); });
