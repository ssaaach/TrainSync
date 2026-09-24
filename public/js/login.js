// login.html
(async function () {
  const TS = window.TS;
  const form = document.getElementById('loginForm');
  const next = new URLSearchParams(location.search).get('next');
  // Only same-site paths are allowed as a post-login destination.
  const destination = next && /^\/(?!\/)[\w\-./#?=&]*$/.test(next) ? next : '/homepage1.html';

  if (new URLSearchParams(location.search).has('registered')) {
    TS.formOk(form, 'Account created. Log in to continue.');
  }

  // Unfinished onboarding always comes first.
  const after = user => (user && user.onboardingComplete === false ? '/onboarding.html' : destination);
  const session = await TS.getSession();
  if (session.loggedIn) location.replace(after(session));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return TS.formError(form, null, 'Enter your email and password.');
    TS.busy(form, true);
    try {
      const { ok, data } = await TS.api('/api/auth/login', { method: 'POST', body: { email, password } });
      if (ok) return location.assign(after(data.user));
      TS.formError(form, data, 'Invalid email or password');
    } catch {
      TS.formError(form, null, 'Something went wrong. Please try again.');
    } finally {
      TS.busy(form, false);
    }
  });
})();
