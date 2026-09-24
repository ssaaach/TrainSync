// Validates process.env once at boot. Anything required that is missing or
// malformed stops the process with a readable list of problems.
const { z } = require('zod');

// .env files often contain `KEY=` for unset values; treat those as unset.
const optional = schema => z.preprocess(v => (v === '' ? undefined : v), schema.optional());

const schema = z.object({
  NODE_ENV: optional(z.enum(['development', 'production', 'test'])).default('development'),
  PORT: optional(z.coerce.number().int().min(1).max(65535)),
  LOG_LEVEL: optional(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])),

  DB_HOST: optional(z.string()).default('localhost'),
  DB_PORT: optional(z.coerce.number().int().min(1).max(65535)).default(3306),
  DB_USER: optional(z.string()).default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: optional(z.string().regex(/^[A-Za-z0-9_]+$/, 'letters, digits and _ only')).default('trainsync'),
  DB_POOL_SIZE: optional(z.coerce.number().int().min(1).max(100)),
  // Managed MySQL (e.g. Aiven) requires TLS. DB_SSL_CA holds the PEM text itself
  // (Vercel env vars can't reference files); literal "\n" sequences are accepted.
  DB_SSL: optional(z.enum(['true', 'false'])),
  DB_SSL_CA: optional(z.string()),

  SESSION_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
  DEMO_PASSWORD: optional(z.string().min(8, 'must be at least 8 characters')),
  CORS_ORIGINS: optional(z.string()),
  TRUST_PROXY: optional(z.string()),

  ML_SERVICE_URL: optional(z.url()),
  OLLAMA_URL: optional(z.url()),
  CRON_SECRET: optional(z.string().min(16)),
  IMPORT_CONTACT: optional(z.string().max(200)),
  UV_THREADPOOL_SIZE: optional(z.coerce.number().int().min(1).max(1024)),
  WEB_CONCURRENCY: optional(z.coerce.number().int().min(1).max(64)),
  VERCEL: optional(z.string()),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'is required in production' });
  }
});

function loadEnv(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(i => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    const err = new Error(`Invalid environment configuration (see .env.example):\n${lines.join('\n')}`);
    err.code = 'INVALID_ENV';
    throw err;
  }
  return result.data;
}

module.exports = { loadEnv, schema };
