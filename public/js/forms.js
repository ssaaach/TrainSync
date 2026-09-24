// Shared form behaviour: password toggles, error/success lines, busy state.
(function () {
  const TS = window.TS;

  // Show/hide password buttons.
  document.querySelectorAll('[data-pw-toggle]').forEach(btn => {
    const input = btn.parentElement.querySelector('input');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.innerHTML = TS.icon(show ? 'eye-off' : 'eye');
    });
  });

  // Puts a server/validation error in the form's alert line and marks the field.
  TS.formError = (form, data, fallback) => {
    const out = form.querySelector('#errorMessage');
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    const field = data && data.details && data.details[0] && data.details[0].field;
    if (field) {
      const input = form.querySelector(`[name="${CSS.escape(field)}"]`);
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    }
    out.classList.remove('ts-form-ok');
    out.textContent = (data && (data.error || data.message)) || fallback;
  };
  TS.formOk = (form, text) => {
    const out = form.querySelector('#errorMessage');
    out.classList.add('ts-form-ok');
    out.textContent = text;
  };

  // Busy state on submit buttons.
  TS.busy = (form, on) => {
    const btn = form.querySelector('button[type=submit]');
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
  };
})();
