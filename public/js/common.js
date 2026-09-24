// Shared browser helpers: API wrapper, session, escaping, navbar behaviour.
// Exposed as window.TS (plain script, no bundler).
(function () {
  // Pages are normally served by Express on the same origin. When opened via
  // VS Code Live Server (:5500) the API still lives on :5000.
  const API_BASE = window.TS_API_BASE
    || (location.port === '5500' ? `${location.protocol}//${location.hostname}:5000` : '');

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
  }

  // Only http(s) links may reach an href; anything else becomes "#".
  function safeUrl(value) {
    try {
      const url = new URL(String(value ?? ''), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
    } catch {
      return '#';
    }
  }

  // Escapes text and turns both real newlines and literal "\n" sequences
  // (as stored in the curated plan rows) into <br>.
  function multiline(value) {
    return escapeHTML(value).replace(/\\n|\r?\n/g, '<br>');
  }

  // CSRF token for state-changing requests (kept in memory, fetched lazily).
  let csrfToken = null;
  async function getCsrfToken(refresh = false) {
    if (!csrfToken || refresh) {
      const res = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' });
      csrfToken = res.ok ? (await res.json()).csrfToken : null;
    }
    return csrfToken;
  }

  // fetch wrapper: JSON in/out, cookies and CSRF token included. Never throws
  // on HTTP errors; returns { ok, status, data }. A stale CSRF token (e.g. the
  // session expired) is refreshed and the request retried once.
  async function api(path, { method = 'GET', body, headers } = {}, retried = false) {
    const mutating = !['GET', 'HEAD'].includes(method.toUpperCase());
    const res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(mutating ? { 'x-csrf-token': await getCsrfToken() } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    data = data || {};
    if (mutating && res.status === 403 && data.code === 'csrf_invalid' && !retried) {
      await getCsrfToken(true);
      return api(path, { method, body, headers }, true);
    }
    // Login/logout rotate the session, and with it the token.
    if (data.csrfToken) csrfToken = data.csrfToken;
    if (/\/api\/auth\/logout$/.test(path)) csrfToken = null;
    return { ok: res.ok, status: res.status, data };
  }

  let sessionPromise = null;
  function getSession({ refresh = false } = {}) {
    if (!sessionPromise || refresh) {
      sessionPromise = api('/api/auth/session')
        .then(r => (r.ok ? r.data : { loggedIn: false }))
        .catch(() => ({ loggedIn: false }));
    }
    return sessionPromise;
  }

  async function logout(redirectTo = 'homepage.html') {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = redirectTo;
  }

  // Redirects to the login page unless logged in; resolves with the session.
  async function requireLogin() {
    const session = await getSession();
    if (!session.loggedIn) {
      location.replace('login.html');
      return new Promise(() => {}); // halt the caller while navigating
    }
    return session;
  }

  // Existing navbar behaviour: hide when scrolling down, show when scrolling up.
  function hideNavbarOnScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    let lastScrollTop = 0;
    window.addEventListener('scroll', () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      navbar.classList.toggle('hidden-navbar', scrollTop > lastScrollTop);
      lastScrollTop = scrollTop;
    });
  }

  window.TS = { API_BASE, api, escapeHTML, safeUrl, multiline, getSession, logout, requireLogin, hideNavbarOnScroll };
})();
