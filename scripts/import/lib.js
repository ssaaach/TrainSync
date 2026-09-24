// Shared helpers for import scripts: cached downloads, polite pacing, args.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'ml', 'data', 'raw');
require('../../config'); // loads .env
// OSM usage policies ask for an identifiable User-Agent; IMPORT_CONTACT (optional) adds a contact.
const USER_AGENT = `TrainSync-importer/2.0 (fitness app data import${process.env.IMPORT_CONTACT ? `; ${process.env.IMPORT_CONTACT}` : ''})`;

fs.mkdirSync(RAW_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Minimum gap between requests to the same host (OSM policies: max 1 req/s).
const lastHit = new Map();
async function pace(host, minGapMs) {
  const wait = (lastHit.get(host) || 0) + minGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/**
 * Downloads `url` into ml/data/raw/<cacheName> unless already cached.
 * Returns the local path. `init` is passed to fetch (e.g. POST body).
 */
async function cachedDownload(url, cacheName, { init, minGapMs = 1000, retries = 3, refresh = false } = {}) {
  const dest = path.join(RAW_DIR, cacheName);
  if (!refresh && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pace(host, minGapMs);
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init && init.headers) } });
      if (res.status === 429 || res.status >= 500) {
        // Rate-limited or overloaded: honour Retry-After, else back off 30 s per attempt.
        const retryAfter = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error(`HTTP ${res.status}`), { waitMs: (retryAfter > 0 ? retryAfter : 30 * attempt) * 1000 });
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { fatal: true });
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(`${dest}.part`, buf);
      fs.renameSync(`${dest}.part`, dest);
      return dest;
    } catch (err) {
      lastErr = err;
      if (err.fatal || attempt === retries) break;
      await sleep(err.waitMs || 2000 * attempt * attempt);
    }
  }
  throw lastErr;
}

const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// --key=value / --flag argument parsing.
function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

// Inserts rows in chunks with a single multi-row statement per chunk.
async function bulkInsert(conn, sqlPrefix, rows, { chunk = 500, suffix = '' } = {}) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await conn.query(`${sqlPrefix} VALUES ? ${suffix}`, [part]);
  }
}

module.exports = { ROOT, RAW_DIR, USER_AGENT, sleep, cachedDownload, hash, parseArgs, bulkInsert };
