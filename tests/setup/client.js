// Supertest agent that behaves like the browser client: it fetches a CSRF
// token lazily, sends it on every state-changing request, and picks up the
// rotated token returned by login.
const request = require('supertest');

function client(app) {
  const agent = request.agent(app);
  let token = null;

  async function csrf(refresh = false) {
    if (!token || refresh) token = (await agent.get('/api/auth/csrf')).body.csrfToken;
    return token;
  }

  async function send(method, url, body) {
    const sent = await csrf(); // before creating the request: supertest starts its server on construction
    const req = agent[method](url).set('x-csrf-token', sent);
    const res = body === undefined ? await req : await req.send(body);
    if (res.body && res.body.csrfToken) token = res.body.csrfToken;
    if (url.endsWith('/logout')) token = null;
    return res;
  }

  return {
    agent,
    csrf,
    get: url => agent.get(url),
    post: (url, body) => send('post', url, body),
    patch: (url, body) => send('patch', url, body),
    put: (url, body) => send('put', url, body),
    delete: (url, body) => send('delete', url, body),
  };
}

// Clears shared rate-limit counters so repeated test runs start fresh.
async function resetRateLimits(db) {
  await db.execute('DELETE FROM rate_limit_hits');
}

module.exports = { client, resetRateLimits };
