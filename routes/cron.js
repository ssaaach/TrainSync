// /api/cron/* — housekeeping triggered by Vercel Cron (GET with
// "Authorization: Bearer $CRON_SECRET") or by a scheduler on a VM.
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { purgeExpired } = require('../services/rateLimitStore');

const router = express.Router();

// Registered daily jobs; later phases add theirs (e.g. match expiry).
const dailyJobs = [['rateLimitRows', purgeExpired]];

function authorised(req) {
  if (!config.cronSecret) return false;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${config.cronSecret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

router.get('/daily', async (req, res, next) => {
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorised', code: 'unauthorized' });
  try {
    const results = {};
    for (const [name, job] of dailyJobs) results[name] = await job();
    req.log.info({ results }, 'daily cron');
    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.dailyJobs = dailyJobs;
