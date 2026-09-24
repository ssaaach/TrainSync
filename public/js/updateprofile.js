// updateprofile.html — role-aware profile editor (logged-in users only).
const FIELDS = {
  common: ['name', 'location'],
  trainee: ['age', 'gender', 'fitness_goal'],
  trainer: ['experience', 'certification', 'specialization'],
};

document.addEventListener('DOMContentLoaded', async () => {
  const session = await TS.requireLogin();
  const role = session.role;
  const form = document.getElementById('profileForm');
  const message = document.getElementById('errorMessage');

  // Show only this role's fields.
  document.querySelectorAll('[data-role]').forEach(el => {
    el.hidden = el.dataset.role !== role;
  });

  const { ok, data } = await TS.api('/api/profile');
  if (ok) {
    const values = { name: data.name, ...data.profile };
    if (values.location === 'Unknown') values.location = null; // DB default, not user input
    for (const field of [...FIELDS.common, ...FIELDS[role]]) {
      const input = document.getElementById(field);
      if (input && values[field] !== null && values[field] !== undefined) input.value = values[field];
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    message.innerText = '';
    const body = {};
    for (const field of [...FIELDS.common, ...FIELDS[role]]) {
      body[field] = document.getElementById(field).value;
    }
    try {
      const res = await TS.api('/api/profile', { method: 'PATCH', body });
      message.innerText = res.ok ? 'Profile saved.' : (res.data.error || 'Could not save profile.');
    } catch (err) {
      console.error('Profile update error:', err);
      message.innerText = 'Something went wrong. Try again.';
    }
  });
});
