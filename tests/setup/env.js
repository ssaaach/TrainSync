// Runs before every Jest test file: point the app at the disposable test DB.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'trainsync_test';
