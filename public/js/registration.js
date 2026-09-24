// registration.html
(function () {
  const TS = window.TS;
  const form = document.getElementById('registerForm');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = {
      email: form.email.value.trim(),
      name: form.name.value.trim(),
      role: form.querySelector('input[name=role]:checked').value,
      password: form.password.value,
      confirmPassword: form.confirmPassword.value,
    };
    if (body.password !== body.confirmPassword) {
      return TS.formError(form, { error: 'Passwords do not match', details: [{ field: 'confirmPassword' }] });
    }
    TS.busy(form, true);
    try {
      const { ok, data } = await TS.api('/api/auth/register', { method: 'POST', body });
      if (ok) return location.assign(data.next || '/login.html?registered=1');
      TS.formError(form, data, 'Registration failed.');
    } catch {
      TS.formError(form, null, 'Something went wrong. Please try again.');
    } finally {
      TS.busy(form, false);
    }
  });
})();
