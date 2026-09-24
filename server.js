const app = require('./app');
const config = require('./config');
const db = require('./config/db');

(async () => {
  try {
    await db.execute('SELECT 1');
    console.log('✅ Database connected successfully!');
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
  }
})();

app.listen(config.port, () => {
  console.log(`✅ Server running on http://localhost:${config.port}`);
});
