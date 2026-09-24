// Prints row counts per table, split into real vs synthetic where applicable.
const TABLES = [
  ['users', 'is_synthetic'], ['trainees', null], ['trainers', null], ['gyms', 'is_synthetic'],
  ['exercises', 'is_synthetic'], ['foods', 'is_synthetic'], ['dishes', 'is_synthetic'], ['dish_ingredients', null],
  ['localities', null], ['body_assessments', null], ['synthetic_profiles', null], ['diets', null], ['workouts', null],
  ['matches', null],
];

async function printCounts(conn) {
  const rows = [];
  for (const [table, flag] of TABLES) {
    const [[r]] = await conn.query(
      flag ? `SELECT COUNT(*) total, SUM(${flag} = 1) synthetic FROM ${table}` : `SELECT COUNT(*) total FROM ${table}`
    );
    rows.push({ table, total: Number(r.total), synthetic: flag ? Number(r.synthetic || 0) : '—' });
  }
  console.log('\nRow counts:');
  console.table(rows);
  return rows;
}

module.exports = { printCounts };
