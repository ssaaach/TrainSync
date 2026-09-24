// homepage1.html — role-aware dashboard.
(function () {
  const TS = window.TS;
  const $ = s => document.querySelector(s);
  const root = $('[data-db-root]');
  const SLOT = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
  const PURPOSES = {
    body_metrics: ['Body metrics', 'Measurements for body-fat and calorie estimates'],
    health: ['Health & injuries', 'Keeps unsafe exercises out of your plan'],
    personality: ['Personality', 'Personality fit in matching'],
    interests: ['Interests', 'Shared interests in matching'],
    location: ['Location', 'Distance to trainers and gyms'],
    matching: ['Matching', 'Show your profile to potential matches'],
  };

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // own icon/SVG markup only
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const card = (title, iconName, id, ...children) => h('section', { class: 'db-card ts-glass', id, 'aria-labelledby': `${id}-t` },
    h('h2', { id: `${id}-t` }, h('span', { html: TS.icon(iconName), 'aria-hidden': 'true' }), title), ...children);
  const stat = (v, l) => h('div', { class: 'db-stat' }, h('strong', { text: String(v) }), h('span', { text: l }));
  const row = (a, b) => h('div', { class: 'db-row' }, h('span', {}, a), h('span', { text: b }));
  const link = (href, text, cls = 'ts-btn--ghost') => h('a', { class: `ts-btn ts-btn--sm ${cls}`, href, text });

  // ------------------------------------------------------------ tiles
  function bodyTile(d) {
    if (!d.consents.body_metrics) return card('Your body', 'chart', 'body', h('p', { class: 'ts-muted', text: 'Body metrics are off, so plans use general targets.' }), link('#privacy', 'Turn on in Privacy & data'));
    if (!d.body) return card('Your body', 'chart', 'body', h('p', { class: 'ts-muted', text: 'Add a few tape measurements for body-fat, lean-mass and calorie estimates.' }), link('/onboarding.html#body', 'Add measurements', 'ts-btn--gold'));
    const b = d.body;
    // Somatochart: X = ecto − endo, Y = 2·meso − (endo + ecto), plotted in a triangle.
    const x = 110 + Math.max(-8, Math.min(8, b.somatotype.x)) * 11;
    const y = 120 - Math.max(-8, Math.min(12, b.somatotype.y)) * 7;
    const svg = `<svg viewBox="0 0 220 200" class="db-tri" role="img" aria-label="Somatotype ${b.label}: endomorphy ${b.somatotype.endomorphy}, mesomorphy ${b.somatotype.mesomorphy}, ectomorphy ${b.somatotype.ectomorphy}">
      <path d="M110 20 L200 170 L20 170 Z" fill="none" stroke="rgba(255,255,255,0.25)"/>
      <text x="110" y="14" fill="#b5aea8" font-size="10" text-anchor="middle">meso</text><text x="14" y="186" fill="#b5aea8" font-size="10">endo</text><text x="206" y="186" fill="#b5aea8" font-size="10" text-anchor="end">ecto</text>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#ffcc00" stroke="#111" stroke-width="2"/></svg>`;
    return card('Your body', 'chart', 'body',
      h('div', { html: svg }),
      h('div', { class: 'db-stats' }, stat(`${b.bodyFatPct}%`, 'Body fat (est.)'), stat(b.bmi, 'BMI'), stat(b.ffmiNormalized, 'FFMI'), Object.assign(stat(b.label.replace(/-/g, '‑'), 'Build'), { className: 'db-stat db-stat--cap' }), stat(b.bmr, 'BMR kcal'), stat(b.tdee, 'TDEE kcal')),
      h('p', { class: 'ts-hint', text: `Estimate (circumference method), confidence ${Math.round(b.confidence * 100)}%. Re-measure every few weeks.` }),
      link('/onboarding.html#body', 'Re-measure'));
  }

  function workoutTile(d) {
    if (!d.workout) return card('Today’s workout', 'dumbbell', 'workout', h('p', { class: 'ts-muted', text: 'Build a periodised plan around your goals, equipment and schedule.' }), link('/workoutplans.html', 'Build my plan', 'ts-btn--gold'));
    const w = d.workout;
    const body = w.today
      ? [h('p', {}, h('strong', { text: w.today.name }), ` · ${w.today.focus} · ~${w.today.minutes} min`),
        ...w.today.exercises.map(e => row(e.name, e.sets && e.reps ? `${e.sets} × ${e.reps[0]}–${e.reps[1]}${e.unit === 'sec' ? ' s' : ''}` : ''))]
      : [h('p', { class: 'ts-muted', text: `Rest day. Aim for ${w.stepsTarget.toLocaleString('en-IN')} steps and good sleep.` })];
    return card('Today’s workout', 'dumbbell', 'workout', h('p', { class: 'ts-hint', text: `${w.split} · week ${w.week} of ${w.weeks}${d.adherence != null ? ` · ${Math.round(d.adherence * 100)}% of sessions logged (4 wks)` : ''}` }),
      ...body, link('/workoutplans.html', w.today ? 'Start & log sets' : 'See my plan', 'ts-btn--gold'));
  }

  function dietTile(d) {
    const t = d.targets;
    const head = h('div', { class: 'db-stats' }, stat(t.kcal, 'kcal target'), stat(`${t.protein_g} g`, 'Protein'), stat(`${t.carbs_g} g`, 'Carbs'), stat(`${t.fat_g} g`, 'Fat'));
    if (!d.diet) return card('Today’s meals', 'bowl', 'diet', head, link('/dietplans.html', 'Build my meal plan', 'ts-btn--gold'));
    return card('Today’s meals', 'bowl', 'diet', head, ...d.diet.meals.map(m => row(h('span', {}, h('strong', { text: `${SLOT[m.slot] || m.slot}: ` }), m.name), `${m.kcal} kcal · ${m.protein_g} g P`)),
      link('/dietplans.html', 'Full week & groceries'));
  }

  function progressTile(d) {
    if (!d.consents.body_metrics) return null;
    const pts = (d.progress || []).filter(p => p.weight_kg != null);
    let chart = h('p', { class: 'ts-hint', text: 'Log your weight a few times a week to see your trend.' });
    if (pts.length >= 2) {
      const ws = pts.map(p => Number(p.weight_kg));
      const lo = Math.min(...ws) - 0.5;
      const hi = Math.max(...ws) + 0.5;
      const xy = ws.map((w, i) => [(i / (ws.length - 1)) * 300, 150 - ((w - lo) / (hi - lo)) * 140]);
      const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      chart = h('div', { html: `<svg class="db-chart" viewBox="0 0 300 160" preserveAspectRatio="none" role="img" aria-label="Weight from ${ws[0]} kg to ${ws[ws.length - 1]} kg over ${ws.length} entries"><path class="area" d="${line} L300 160 L0 160 Z"/><path class="line" d="${line}"/></svg>` });
    }
    const date = h('input', { class: 'ts-input', type: 'date', 'aria-label': 'Date', value: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) });
    const weight = h('input', { class: 'ts-input', type: 'number', step: '0.1', min: '30', max: '250', placeholder: 'kg', 'aria-label': 'Weight in kg' });
    const waist = h('input', { class: 'ts-input', type: 'number', step: '0.5', min: '40', max: '200', placeholder: 'waist cm', 'aria-label': 'Waist in cm' });
    const btn = h('button', { class: 'ts-btn ts-btn--gold ts-btn--sm', type: 'submit', text: 'Log' });
    const form = h('form', { class: 'db-form' }, date, weight, waist, btn);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { date: date.value };
      if (weight.value) body.weight_kg = Number(weight.value);
      if (waist.value) body.waist_cm = Number(waist.value);
      const r = await TS.api('/api/dashboard/progress', { method: 'POST', body });
      if (!r.ok) return TS.toast(r.data.error || 'Could not save.', { type: 'error' });
      TS.toast('Logged.', { type: 'success' });
      return load();
    });
    const last = pts[pts.length - 1];
    return card('Progress', 'chart', 'progress', chart, last ? h('p', { class: 'ts-hint', text: `Latest: ${last.weight_kg} kg on ${last.date}${pts.length > 1 ? ` (${(last.weight_kg - pts[0].weight_kg).toFixed(1)} kg since ${pts[0].date})` : ''}` }) : null, form);
  }

  async function matchesTile(d) {
    const tile = card('Your matches', 'match', 'matches');
    if (!d.consents.matching) { tile.append(h('p', { class: 'ts-muted', text: 'Matching is off.' }), link('#privacy', 'Turn on')); return tile; }
    const r = await TS.api('/api/match/recommendations?limit=3');
    for (const t of (r.ok ? r.data.trainers : [])) tile.append(row(h('span', {}, h('strong', { text: t.name }), ` · ${t.reasons[0] || ''}`), `${t.score}%`));
    for (const q of d.requests || []) tile.append(row(`Request to ${q.name}`, q.status));
    for (const c of d.contacts || []) tile.append(row(h('strong', { text: c.name }), `${c.email}${c.phone ? ` · ${c.phone}` : ''}`));
    tile.append(link('/trainermatch.html', 'Browse trainers', 'ts-btn--gold'));
    return tile;
  }

  async function gymsTile(d) {
    const tile = card('Gyms near you', 'pin', 'gyms');
    if (!d.location) { tile.append(h('p', { class: 'ts-muted', text: 'Turn on location to see gyms near you, or search by city.' }), link('/gyms.html', 'Find gyms')); return tile; }
    const r = await TS.api(`/api/gyms/near?lat=${d.location.lat}&lng=${d.location.lng}&radius_km=5&limit=5`);
    const gyms = r.ok ? r.data.gyms : [];
    for (const g of gyms.slice(0, 3)) {
      tile.append(row(h('strong', { text: g.name }), ''), h('div', { class: 'db-actions' }, h('span', { class: 'ts-hint', text: `${g.distance_km} km` }),
        g.links ? h('a', { class: 'ts-btn ts-btn--sm ts-btn--ghost', href: g.links.directions, target: '_blank', rel: 'noopener', text: 'Directions ↗' }) : null));
    }
    if (!gyms.length) tile.append(h('p', { class: 'ts-muted', text: 'No gyms mapped within 5 km yet.' }));
    tile.append(link('/gyms.html', 'Open the gym map'), h('p', { class: 'ts-hint', text: '© OpenStreetMap contributors' }));
    return tile;
  }

  async function notificationsTile() {
    const r = await TS.api('/api/match/notifications');
    const list = r.ok ? r.data.notifications : [];
    const TEXT = { session_request: p => `${p.from} requested a session`, request_accepted: p => `${p.from} accepted your request. Contact details unlocked.`, request_cancelled: p => `${p.from} cancelled a session request` };
    const tile = card('Notifications', 'bell', 'notifications',
      list.length ? h('ul', { class: 'db-notes' }, list.slice(0, 6).map(n => h('li', { class: n.read_at ? '' : 'is-unread', text: (TEXT[n.type] || (() => n.type))(n.payload || {}) }))) : h('p', { class: 'ts-muted', text: 'Nothing new.' }));
    if (list.some(n => !n.read_at)) tile.append(h('button', { type: 'button', class: 'ts-btn ts-btn--sm ts-btn--ghost', text: 'Mark all read', onclick: async () => { await TS.api('/api/match/notifications/read', { method: 'POST' }); load(); } }));
    return tile;
  }

  function privacyTile(d) {
    const box = h('div', { class: 'db-consent' });
    for (const [p, [name, desc]] of Object.entries(PURPOSES)) {
      const input = h('input', { type: 'checkbox', role: 'switch', checked: d.consents[p], 'aria-label': name });
      input.addEventListener('change', async () => {
        if (!input.checked && !window.confirm(`Turn off ${name}? Data collected for it will be deleted.`)) { input.checked = true; return; }
        const r = await TS.api('/api/me/consent', { method: 'PUT', body: { purposes: { [p]: input.checked } } });
        if (!r.ok) { input.checked = !input.checked; TS.toast('Could not update.', { type: 'error' }); return; }
        TS.toast(input.checked ? `${name} on.` : `${name} off. Its data was deleted.`);
        load();
      });
      box.append(h('label', { class: 'db-purpose' }, h('span', {}, name, h('small', { text: desc })), h('span', { class: 'ts-switch' }, input, h('span'))));
    }
    const del = h('button', { type: 'button', class: 'ts-btn ts-btn--sm ts-btn--ghost', text: 'Delete my account' });
    del.addEventListener('click', async () => {
      const confirmText = window.prompt('This permanently deletes your account and data. Type DELETE to confirm.');
      if (confirmText !== 'DELETE') return;
      const password = window.prompt('Enter your password to confirm.');
      if (!password) return;
      const r = await TS.api('/api/me', { method: 'DELETE', body: { password, confirm: 'DELETE' } });
      if (!r.ok) return TS.toast(r.data.error || 'Could not delete.', { type: 'error' });
      location.assign('/homepage.html');
      return undefined;
    });
    return card('Privacy & data', 'shield', 'privacy', box,
      h('div', { class: 'db-actions' }, h('a', { class: 'ts-btn ts-btn--sm ts-btn--gold', href: '/api/me/export', download: '', text: 'Download my data' }), link('/onboarding.html', 'Edit profile'), del),
      h('p', { class: 'ts-hint' }, 'See the ', h('a', { href: '/privacy.html', class: 'ts-gold', text: 'privacy policy' }), '.'));
  }

  function trainerTiles(d) {
    const tiles = [];
    tiles.push(card('Requests', 'match', 'requests', h('div', { class: 'db-stats' }, stat(d.pendingRequests, 'Pending'), stat(`${d.capacity.active}/${d.capacity.max}`, 'Clients'), d.traineesNearby != null ? stat(d.traineesNearby, 'Trainees in your area') : null),
      link('/trainermatch.html', 'Review requests', 'ts-btn--gold')));
    const bar = h('span');
    bar.style.width = `${d.completeness}%`;
    tiles.push(card('Profile completeness', 'user', 'profile', h('div', { class: 'ts-progress' }, bar), h('p', { class: 'ts-hint', text: `${d.completeness}% complete${d.missing.length ? `. Add: ${d.missing.map(m => m.replace(/_/g, ' ')).join(', ')}` : ''}.` }), link('/onboarding.html', 'Complete profile')));
    tiles.push(card('Clients', 'user', 'clients', (d.contacts || []).length ? (d.contacts || []).map(c => row(h('strong', { text: c.name }), `${c.email}${c.phone ? ` · ${c.phone}` : ''}`)) : h('p', { class: 'ts-muted', text: 'Accepted clients appear here with contact details.' })));
    return tiles;
  }

  // ------------------------------------------------------------ boot
  async function load() {
    const r = await TS.api('/api/dashboard');
    if (!r.ok) { root.replaceChildren(h('p', { class: 'ts-form-error', text: r.data.error || 'Could not load your dashboard.' })); return; }
    const d = r.data;
    $('[data-db-hello]').textContent = `Hi ${String(d.name || '').split(' ')[0]}. Sore today, stronger tomorrow.`;
    const tiles = d.role === 'trainer'
      ? [...trainerTiles(d), await notificationsTile(), privacyTile(d)]
      : [workoutTile(d), dietTile(d), bodyTile(d), progressTile(d), await matchesTile(d), await gymsTile(d), await notificationsTile(), privacyTile(d)];
    root.replaceChildren(...tiles.filter(Boolean));
    if (location.hash) { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const session = await TS.requireLogin();
    if (session.onboardingComplete === false) { location.replace('/onboarding.html'); return; }
    $('[data-db-date]').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    await load();
  });
})();
