// trainermatch.html
//   trainee: grid of ranked trainer cards, removable filter chips, search,
//            shortlist (heart) + compare (+), detail sheet with "why you
//            matched" and Request session.
//   trainer: incoming session requests (accept / decline) and accepted clients.
//   visitor: explanation + sign-up prompt.
(function () {
  const TS = window.TS;
  const $ = s => document.querySelector(s);
  const root = $('[data-m-root]');
  const DAY = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const PART = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };
  const GOALS = { 'fat-loss': 'Fat loss', 'muscle-gain': 'Muscle gain', strength: 'Strength', endurance: 'Endurance', 'mobility-yoga': 'Mobility & yoga', 'sport-specific': 'Sport-specific', 'general-fitness': 'General fitness', 'beginner-onboarding': 'Beginners' };
  const MODES = { in_person_gym: 'At a gym', home: 'At home', online: 'Online', outdoor: 'Outdoors' };
  const FACTOR_LABEL = { goals: 'Goals', schedule: 'Schedule', style: 'Coaching style', distance: 'Distance', personality: 'Personality', budget: 'Budget', level: 'Experience level', interests: 'Interests', modality: 'Training mode', quality: 'Ratings' };
  const FILTERS = [
    ['goal', 'Goal', Object.entries(GOALS)],
    ['maxPrice', 'Budget', [['800', 'Up to ₹800'], ['1200', 'Up to ₹1,200'], ['1800', 'Up to ₹1,800'], ['2500', 'Up to ₹2,500']]],
    ['maxKm', 'Distance', [['2', 'Within 2 km'], ['5', 'Within 5 km'], ['10', 'Within 10 km']]],
    ['mode', 'Mode', Object.entries(MODES)],
    ['language', 'Language', ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Malayalam'].map(l => [l, l])],
  ];
  const state = { filters: {}, q: '', savedOnly: false, trainers: [], shortlist: new Set(), compare: new Set() };

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // own icon markup only
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const iconBtn = (name, label, attrs = {}) => h('button', { type: 'button', class: 'ts-icon-btn ts-icon-btn--sm', 'aria-label': label, html: TS.icon(name), ...attrs });
  const slotText = s => { const [d, p] = s.split(':'); return `${DAY[d]} ${PART[p]}`; };

  // ------------------------------------------------------------ trainee
  function renderFilters() {
    const box = $('[data-m-filters]');
    box.hidden = false;
    box.replaceChildren();
    for (const [key, label, options] of FILTERS) {
      const v = state.filters[key];
      if (v) {
        const text = (options.find(o => o[0] === v) || [v, v])[1];
        box.append(h('span', { class: 'ts-chip ts-chip--active' }, `${label}: ${text}`,
          h('button', { type: 'button', class: 'ts-chip__x', 'aria-label': `Remove ${label} filter`, html: TS.icon('close'), onclick: () => { delete state.filters[key]; load(); } })));
      } else {
        const sel = h('select', { 'aria-label': `Filter by ${label.toLowerCase()}` }, h('option', { value: '', text: `${label}` }), options.map(([ov, ot]) => h('option', { value: ov, text: ot })));
        sel.addEventListener('change', () => { if (sel.value) { state.filters[key] = sel.value; load(); } });
        box.append(sel);
      }
    }
  }

  function card(t) {
    const heart = iconBtn('heart', t.shortlisted ? `Remove ${t.name} from shortlist` : `Shortlist ${t.name}`, { class: 'ts-icon-btn ts-icon-btn--sm m-card__heart', 'aria-pressed': String(state.shortlist.has(t.trainerId)) });
    heart.addEventListener('click', e => { e.stopPropagation(); toggleShortlist(t, heart); });
    const plus = iconBtn('plus', `Compare ${t.name}`, { class: 'ts-icon-btn ts-icon-btn--sm m-card__plus', 'aria-pressed': String(state.compare.has(t.trainerId)) });
    plus.addEventListener('click', e => { e.stopPropagation(); toggleCompare(t, plus); });
    const open = h('button', { type: 'button', class: 'm-card__open', 'aria-label': `View ${t.name}: ${t.score}% match` });
    open.addEventListener('click', () => openTrainer(t.trainerId));
    return h('article', { class: 'm-card', 'data-trainer': t.trainerId },
      open,
      h('div', { class: 'm-card__media' },
        h('span', { class: 'ts-pill-score m-card__score', text: `${t.score}%` }),
        h('span', { class: 'm-avatar', 'aria-hidden': 'true', text: t.initials }),
        heart,
        t.sample ? h('span', { class: 'ts-tag ts-tag--warm m-card__sample', text: 'Sample profile' }) : null),
      h('div', { class: 'm-card__body' },
        h('div', { class: 'm-card__name' }, t.name, t.verified ? h('span', { html: TS.icon('verified'), title: 'Certification on profile', 'aria-label': 'Certification listed' }) : null),
        h('div', { class: 'm-card__meta', text: [t.specializations.slice(0, 2).map(s => GOALS[s] || s).join(' · '), t.years ? `${t.years} yrs` : null].filter(Boolean).join(' · ') }),
        h('div', { class: 'm-card__meta', text: [t.distance, t.gym || t.locality].filter(Boolean).join(' · ') || t.city }),
        t.reasons.slice(0, 2).map(r => h('p', { class: 'm-card__reason', text: r }))),
      h('div', { class: 'm-card__foot' },
        h('span', { class: 'm-price' }, t.price ? `₹${t.price.toLocaleString('en-IN')}` : '', h('span', { text: ' / session' })),
        plus));
  }

  function renderGrid() {
    const list = state.savedOnly ? state.trainers.filter(t => state.shortlist.has(t.trainerId)) : state.trainers;
    if (!list.length) {
      root.replaceChildren(h('div', { class: 'p-card ts-glass m-empty' }, h('span', { class: 'ts-badge', html: TS.icon('search') }),
        h('h2', { class: 'ts-h3', text: state.savedOnly ? 'No saved trainers yet' : 'No trainers match these filters' }),
        h('p', { class: 'ts-muted', text: state.savedOnly ? 'Tap the heart on a card to save it.' : 'Try removing a filter or widening the distance.' })));
      return;
    }
    root.replaceChildren(h('div', { class: 'm-grid' }, list.map(card)));
  }

  function updatePill() {
    const pill = $('[data-m-pill]');
    const n = state.shortlist.size;
    const c = state.compare.size;
    $('[data-m-pill-label]').textContent = `${n} shortlisted${c ? ` · ${c} to compare` : ''}`;
    $('[data-m-compare]').disabled = c < 2;
    pill.classList.toggle('is-visible', n > 0 || c > 0);
  }

  async function toggleShortlist(t, btn) {
    const on = !state.shortlist.has(t.trainerId);
    const res = await TS.api(`/api/match/shortlist/${t.trainerId}`, { method: on ? 'PUT' : 'DELETE' });
    if (!res.ok) return TS.toast(res.data.error || 'Could not update your shortlist.', { type: 'error' });
    if (on) state.shortlist.add(t.trainerId); else state.shortlist.delete(t.trainerId);
    btn.setAttribute('aria-pressed', String(on));
    updatePill();
    return undefined;
  }

  function toggleCompare(t, btn) {
    if (state.compare.has(t.trainerId)) state.compare.delete(t.trainerId);
    else if (state.compare.size >= 3) return TS.toast('Compare up to 3 trainers at a time.');
    else state.compare.add(t.trainerId);
    btn.setAttribute('aria-pressed', String(state.compare.has(t.trainerId)));
    updatePill();
    return undefined;
  }

  function openCompare() {
    const list = state.trainers.filter(t => state.compare.has(t.trainerId));
    const rows = [
      ['Match', t => `${t.score}%`], ['Specialises in', t => t.specializations.map(s => GOALS[s] || s).join(', ')],
      ['Experience', t => (t.years ? `${t.years} years` : '—')], ['Price', t => (t.price ? `₹${t.price}` : '—')],
      ['Distance', t => t.distance || '—'], ['Mode', t => t.modality.map(m => MODES[m] || m).join(', ')],
      ['Languages', t => t.languages.join(', ')], ['Rating', t => (t.rating ? `${t.rating.toFixed(1)} (${t.ratingCount})` : 'New')],
      ['Why', t => t.reasons.join('; ')],
    ];
    const table = h('table', { class: 'm-compare' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '' }), list.map(t => h('th', { scope: 'col', text: t.name })))),
      h('tbody', {}, rows.map(([label, fn]) => h('tr', {}, h('th', { scope: 'row', text: label }), list.map(t => h('td', { text: fn(t) }))))));
    showSheet(h('h2', { class: 'ts-h3', id: 'm-sheet-title', text: 'Compare trainers' }), h('div', { class: 'd-scroll' }, table));
  }

  async function openTrainer(id) {
    showSheet(h('div', { class: 'ts-skeleton p-skel' }));
    const res = await TS.api(`/api/match/trainers/${id}`);
    if (!res.ok) return showSheet(h('p', { class: 'ts-form-error', text: res.data.error || 'Could not load this trainer.' }));
    const t = res.data;
    const why = h('div', { class: 'm-why' }, Object.entries(t.breakdown).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const bar = h('span');
      bar.style.width = `${v}%`;
      return h('div', { class: 'ts-meter' }, h('span', { class: 'ts-meter__label', text: FACTOR_LABEL[k] || k }), h('span', { class: 'ts-progress' }, bar), h('span', { class: 'ts-meter__value', text: String(v) }));
    }));
    let slot = t.overlapSlots[0] || null;
    const slots = h('div', { class: 'm-slots', role: 'radiogroup', 'aria-label': 'Preferred time' });
    const slotOptions = t.overlapSlots.length ? t.overlapSlots : ['mon:morning', 'wed:evening', 'sat:morning'];
    if (!slot) slot = slotOptions[0];
    slotOptions.slice(0, 8).forEach(s => {
      const b = h('button', { type: 'button', role: 'radio', class: 'ts-chip ts-chip--static m-slot', 'aria-pressed': String(s === slot), 'aria-checked': String(s === slot), text: slotText(s) });
      b.addEventListener('click', () => { slot = s; slots.querySelectorAll('.m-slot').forEach(x => { const on = x === b; x.setAttribute('aria-pressed', String(on)); x.setAttribute('aria-checked', String(on)); }); });
      slots.append(b);
    });
    const typeSel = h('select', { class: 'ts-select', id: 'm-type' }, t.modality.map(m => h('option', { value: m, text: MODES[m] || m })));
    const msg = h('textarea', { class: 'ts-textarea', id: 'm-msg', maxlength: '500', placeholder: 'Say hello and share what you want to work on (optional).' });
    const status = t.request && ['pending', 'accepted'].includes(t.request.status) ? t.request.status : null;
    const send = h('button', { type: 'button', class: 'ts-btn ts-btn--gold ts-btn--lg ts-btn--block', text: status === 'pending' ? 'Request sent' : status === 'accepted' ? 'Accepted: see Dashboard for contact' : 'Request session', disabled: Boolean(status) });
    send.addEventListener('click', async () => {
      send.disabled = true;
      const r = await TS.api('/api/match/requests', { method: 'POST', body: { trainerId: t.trainerId, session_type: typeSel.value, slot, message: msg.value || undefined } });
      if (!r.ok) { send.disabled = false; return TS.toast(r.data.error || 'Could not send your request.', { type: 'error' }); }
      send.textContent = 'Request sent';
      TS.toast(`Request sent to ${t.name}. You'll be notified when they reply.`, { type: 'success' });
      return undefined;
    });
    const block = h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Block' });
    block.addEventListener('click', async () => {
      if (!window.confirm(`Block ${t.name}? They won't appear in your matches again.`)) return;
      await TS.api(`/api/match/block/${t.trainerId}`, { method: 'POST' });
      $('[data-m-sheet]').close();
      state.trainers = state.trainers.filter(x => x.trainerId !== t.trainerId);
      renderGrid();
      TS.toast('Blocked.');
    });
    const report = h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Report' });
    report.addEventListener('click', async () => {
      const reason = window.prompt('What is wrong with this profile? (spam, inappropriate, fake_profile, safety, other)', 'fake_profile');
      if (!reason) return;
      const r = await TS.api(`/api/match/report/${t.trainerId}`, { method: 'POST', body: { reason: ['spam', 'inappropriate', 'fake_profile', 'safety'].includes(reason) ? reason : 'other', details: reason } });
      TS.toast(r.ok ? 'Thanks. A person will review this report.' : 'Could not send the report.');
    });
    showSheet(
      h('div', { class: 'm-summary' }, h('span', { class: 'm-avatar', 'aria-hidden': 'true', text: t.initials }),
        h('div', {}, h('h2', { id: 'm-sheet-title', text: t.name }), h('p', { class: 'ts-muted', text: t.specializations.map(s => GOALS[s] || s).join(' · ') }),
          h('p', {}, h('span', { class: 'ts-pill-score', text: `${t.score}% match` }), t.sample ? h('span', { class: 'ts-tag ts-tag--warm', text: ' Sample profile' }) : null))),
      h('dl', { class: 'm-kv' },
        h('div', {}, h('dt', { text: 'Price' }), h('dd', { text: t.price ? `₹${t.price} / session` : '—' })),
        h('div', {}, h('dt', { text: 'Experience' }), h('dd', { text: t.years ? `${t.years} years` : '—' })),
        h('div', {}, h('dt', { text: 'Where' }), h('dd', { text: [t.distance, t.gym || t.locality].filter(Boolean).join(' · ') || t.city })),
        h('div', {}, h('dt', { text: 'Spots left' }), h('dd', { text: String(t.spotsLeft) }))),
      t.bio ? h('p', { class: 'ts-muted', text: t.bio }) : null,
      t.certifications.length ? h('p', { class: 'ts-hint', text: `Certifications (self-reported): ${t.certifications.join(', ')}` }) : null,
      h('p', { class: 'm-section-title', text: 'Why you matched' }),
      h('ul', { class: 'p-reason' }, t.reasons.map(r => h('li', { text: r }))), why,
      t.sample ? h('p', { class: 'ts-hint', text: 'This is a sample profile from our demo data, not a real person. Requests to it are for trying the flow.' }) : null,
      h('p', { class: 'm-section-title', text: 'Request a session' }),
      h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: 'm-type', text: 'Session type' }), typeSel),
      h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: t.overlapSlots.length ? 'Times you’re both free' : 'Preferred time' }), slots),
      h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: 'm-msg', text: 'Message' }), msg),
      send,
      h('p', { class: 'ts-hint', text: 'Your contact details are shared only if the trainer accepts.' }),
      h('div', { class: 'm-req__actions' }, block, report));
    return undefined;
  }

  function showSheet(...children) {
    const sheet = $('[data-m-sheet]');
    $('[data-m-sheet-body]').replaceChildren(...children);
    if (!sheet.open) sheet.showModal();
  }

  async function load() {
    renderFilters();
    root.replaceChildren(h('div', { class: 'm-grid' }, Array.from({ length: 6 }, () => h('div', { class: 'ts-skeleton m-card' }))));
    const params = new URLSearchParams({ ...state.filters, limit: '36', ...(state.q ? { q: state.q } : {}) });
    const res = await TS.api(`/api/match/recommendations?${params}`);
    if (!res.ok) { root.replaceChildren(h('p', { class: 'ts-form-error', text: res.data.error || 'Could not load trainers.' })); return; }
    if (res.data.consentRequired) {
      root.replaceChildren(h('div', { class: 'p-card ts-glass m-empty' }, h('span', { class: 'ts-badge', html: TS.icon('shield') }),
        h('h2', { class: 'ts-h3', text: 'Matching is switched off' }), h('p', { class: 'ts-muted', text: 'You chose not to use your profile for matching. Turn it on in Privacy & data to see ranked trainers.' }),
        h('a', { class: 'ts-btn ts-btn--gold', href: '/homepage1.html#privacy', text: 'Privacy & data' })));
      return;
    }
    state.trainers = res.data.trainers;
    $('[data-m-sub]').textContent = `${res.data.total} trainers fit your rules, ranked by fit${res.data.usesLocation ? '' : ' (turn on location for distance)'}. ${res.data.model.source === 'learned' ? 'Ranking weights learned from matching data.' : ''}`;
    renderGrid();
  }

  async function trainee() {
    $('[data-m-tools]').hidden = false;
    const sl = await TS.api('/api/match/shortlist');
    if (sl.ok) state.shortlist = new Set(sl.data.ids);
    let t;
    $('[data-m-q]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 350); });
    const saved = $('[data-m-saved]');
    saved.addEventListener('click', () => { state.savedOnly = !state.savedOnly; saved.setAttribute('aria-pressed', String(state.savedOnly)); renderGrid(); });
    $('[data-m-compare]').addEventListener('click', openCompare);
    updatePill();
    await load();
  }

  // ------------------------------------------------------------ trainer
  async function trainer() {
    $('[data-m-eyebrow]').textContent = 'Requests';
    $('[data-m-title]').textContent = 'People who want to train with you';
    $('[data-m-sub]').textContent = 'Ranked by how well they fit your coaching. Their contact details unlock when you accept.';
    const [reqs, contacts] = await Promise.all([TS.api('/api/match/requests'), TS.api('/api/match/contacts')]);
    const pending = (reqs.data.requests || []).filter(r => r.status === 'pending');
    const list = h('div', { class: 'm-list' });
    if (!pending.length) list.append(h('div', { class: 'p-card ts-glass m-empty' }, h('span', { class: 'ts-badge', html: TS.icon('bell') }), h('h2', { class: 'ts-h3', text: 'No pending requests' }), h('p', { class: 'ts-muted', text: 'Trainees who fit how you coach will appear here.' })));
    for (const r of pending) {
      const actions = h('div', { class: 'm-req__actions' });
      for (const [action, label, cls] of [['accept', 'Accept', 'ts-btn--gold'], ['decline', 'Decline', 'ts-btn--ghost']]) {
        actions.append(h('button', { type: 'button', class: `ts-btn ts-btn--sm ${cls}`, text: label, onclick: async e => {
          e.target.disabled = true;
          const res = await TS.api(`/api/match/requests/${r.requestId}/respond`, { method: 'POST', body: { action } });
          if (!res.ok) { e.target.disabled = false; return TS.toast(res.data.error || 'Could not update.', { type: 'error' }); }
          TS.toast(action === 'accept' ? `Accepted. ${r.name}'s contact details are now on your dashboard.` : 'Declined.', { type: action === 'accept' ? 'success' : 'info' });
          return trainer();
        } }));
      }
      list.append(h('article', { class: 'm-req ts-glass' },
        h('div', { class: 'm-req__top' }, h('strong', { text: r.name }), r.score ? h('span', { class: 'ts-pill-score', text: `${r.score}% fit` }) : null),
        h('p', { class: 'ts-muted', text: [r.goals.map(g => GOALS[g] || g).join(', '), r.experience, r.distance].filter(Boolean).join(' · ') }),
        h('p', { class: 'ts-hint', text: `${MODES[r.sessionType] || r.sessionType}, ${slotText(r.slot)} · ${r.overlap} shared free slots` }),
        r.message ? h('p', { class: 'm-card__reason', text: r.message }) : null, actions));
    }
    const clients = h('div', { class: 'm-list' }, (contacts.data.contacts || []).map(c => h('article', { class: 'm-req ts-glass' },
      h('strong', { text: c.name }), h('p', { class: 'ts-hint', text: `${c.email}${c.phone ? ` · ${c.phone}` : ''} · ${slotText(c.slot)}` }))));
    root.replaceChildren(h('section', { 'aria-label': 'Pending requests' }, list),
      h('h2', { class: 'm-section-title', text: 'Accepted clients' }),
      (contacts.data.contacts || []).length ? clients : h('p', { class: 'ts-hint', text: 'None yet.' }));
  }

  // ------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', async () => {
    $('[data-m-close]').addEventListener('click', () => $('[data-m-sheet]').close());
    const session = await TS.getSession();
    if (!session.loggedIn) {
      root.replaceChildren(h('div', { class: 'p-card ts-glass m-empty' }, h('span', { class: 'ts-badge', html: TS.icon('match') }),
        h('h2', { class: 'ts-h3', text: 'See trainers ranked for you' }),
        h('p', { class: 'ts-muted', text: 'Create a free profile and we’ll rank certified trainers by your goals, schedule, coaching style, budget and distance, and show you why each one fits.' }),
        h('div', { class: 'm-req__actions' }, h('a', { class: 'ts-btn ts-btn--gold', href: '/registration.html', text: 'Get started' }), h('a', { class: 'ts-btn ts-btn--ghost', href: '/login.html?next=/trainermatch.html', text: 'Log in' }))));
      return;
    }
    if (session.onboardingComplete === false) { location.replace('/onboarding.html'); return; }
    if (session.role === 'trainer') await trainer();
    else await trainee();
  });
})();
