// workoutplans.html — periodised plan viewer + builder.
//   visitors / trainers: build a preview from a short form (nothing saved)
//   trainees:            generate from their profile, then browse weeks/days,
//                        swap exercises, log sets and see next-week adjustments
(function () {
  const TS = window.TS;
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const EMPHASIS = { strength: 'Strength', hypertrophy: 'Muscle gain', 'fat-loss': 'Fat loss', endurance: 'Endurance', mobility: 'Mobility', general: 'General fitness' };

  const state = { mode: 'visitor', planId: null, plan: null, weeks: [], week: 1, currentWeek: 1, day: null, logs: [], adapt: null, form: null };
  const $ = s => document.querySelector(s);
  const root = $('[data-p-root]');

  // ------------------------------------------------------------ DOM helper
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // only for our own icon markup
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const icon = name => h('span', { html: TS.icon(name), class: 'p-card__icon', 'aria-hidden': 'true' });
  const tag = (text, cls = '') => h('span', { class: `ts-tag ${cls}`, text });
  const fmtReps = (ex, reps) => (ex.unit === 'sec' ? `${reps[0]}–${reps[1]} s` : reps[0] === reps[1] ? `${reps[0]}` : `${reps[0]}–${reps[1]}`);

  const fmtRest = sec => { const m = Math.floor(sec / 60); const r = sec % 60; return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`; };

  // ------------------------------------------------------------ data
  function sessionForWeek(key) {
    const s = state.plan.sessions[key];
    if (!s || s.mobilityOnly) return s;
    const w = state.weeks[state.week - 1];
    const rx = (w && w.rx[key]) || {};
    return {
      ...s,
      exercises: s.exercises.map(ex => {
        const r = rx[ex.slot];
        return r ? { ...ex, sets: r[0], reps: r[1], rpe: r[2] } : ex;
      }),
    };
  }

  function todayKey() {
    return DAYS[(new Date().getDay() + 6) % 7];
  }

  async function loadWeekExtras() {
    if (state.mode !== 'trainee' || !state.planId) return;
    const [logs, adapt] = await Promise.all([
      TS.api(`/api/plans/workout/${state.planId}/logs?week=${state.week}`),
      TS.api(`/api/plans/workout/${state.planId}/adapt?week=${state.week}`),
    ]);
    state.logs = logs.ok ? logs.data.logs : [];
    state.adapt = adapt.ok ? adapt.data : null;
  }

  // ------------------------------------------------------------ header
  function renderHead() {
    const p = state.plan;
    $('[data-p-title]').textContent = p ? `${p.summary.split} · ${p.summary.weeks} weeks` : 'Training built around you';
    $('[data-p-sub]').textContent = p
      ? `${p.summary.schemeLabel}.`
      : 'Periodised plans from 870+ exercises, fitted to your goal, equipment, time and injuries.';
    const chips = $('[data-p-chips]');
    chips.replaceChildren();
    if (p) {
      chips.append(
        tag(EMPHASIS[p.summary.emphasis] || p.summary.emphasis, 'ts-tag--gold'),
        tag(`${p.profile.daysPerWeek} days / week`),
        tag(`${p.profile.sessionMinutes} min sessions`),
        tag(`Effort RPE ${p.summary.rpeTarget}`),
        tag(`${p.summary.stepsTarget.toLocaleString('en-IN')} steps / day`),
      );
      if (state.mode !== 'trainee') chips.append(tag('Preview', 'ts-tag--warm'));
    }
    const actions = $('[data-p-actions]');
    actions.replaceChildren();
    if (p && state.mode === 'trainee') {
      actions.append(
        h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Adjust plan', onclick: openAdjust }),
        h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Regenerate', onclick: regenerate }),
        h('button', { type: 'button', class: 'ts-btn ts-btn--dark ts-btn--sm', text: 'Print', onclick: () => window.print() }),
      );
    } else if (p) {
      actions.append(h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Change answers', onclick: () => renderBuilder() }));
    }
  }

  // ------------------------------------------------------------ plan view
  function renderPlan() {
    renderHead();
    const p = state.plan;
    const main = h('div', { class: 'p-main' });
    const side = h('aside', { class: 'p-side', 'aria-label': 'About this plan' });

    if (state.mode !== 'trainee') {
      main.append(h('div', { class: 'p-cta' },
        h('p', {}, h('strong', { text: 'Like it? ' }), 'Create a free account to save your plan, log your sets and get weekly adjustments.'),
        h('a', { class: 'ts-btn ts-btn--gold ts-btn--sm', href: '/registration.html', text: 'Save my plan' })));
    }
    for (const n of p.safety.notices) {
      main.append(h('div', { class: 'o-note o-note--gold', role: 'note' }, icon('info'), h('span', { text: n })));
    }

    // Week picker
    const weeks = h('div', { class: 'p-weeks', role: 'tablist', 'aria-label': 'Weeks' });
    state.weeks.forEach(w => {
      const phase = w.deload ? 'Deload' : w.phase[0].toUpperCase() + w.phase.slice(1);
      weeks.append(h('button', {
        type: 'button', role: 'tab', class: `p-week${w.week === state.currentWeek && state.mode === 'trainee' ? ' p-week--now' : ''}`,
        'aria-selected': String(w.week === state.week), onclick: async () => { state.week = w.week; await loadWeekExtras(); renderPlan(); },
      }, h('strong', { text: `Week ${w.week}` }), phase));
    });
    const wk = state.weeks[state.week - 1];
    main.append(h('section', { class: 'p-card ts-glass', 'aria-label': 'Week and day' },
      weeks,
      h('p', { class: 'ts-hint', text: wk.note }),
      dayPicker()));

    main.append(sessionCard());

    // Side: why, volume, progression, this week
    side.append(h('section', { class: 'p-card ts-glass' },
      h('h2', { class: 'p-card__title' }, icon('spark'), 'Why this plan'),
      h('ul', { class: 'p-reason' }, p.reasoning.map(r => h('li', { text: r })))));
    side.append(volumeCard());
    side.append(h('section', { class: 'p-card ts-glass' },
      h('h2', { class: 'p-card__title' }, icon('chart'), 'How to progress'),
      h('p', { class: 'ts-hint', text: p.progression.rule }),
      h('p', { class: 'ts-hint', text: p.progression.rpeGuide })));
    if (state.mode === 'trainee' && state.adapt) side.append(adaptCard());

    root.replaceChildren(h('div', { class: 'p-layout' }, main, side));
  }

  function dayPicker() {
    const p = state.plan;
    if (!state.day) {
      const today = todayKey();
      state.day = p.schedule[today] ? today : DAYS.find(d => p.schedule[d]) || 'mon';
    }
    const days = h('div', { class: 'p-days', role: 'tablist', 'aria-label': 'Days' });
    for (const d of DAYS) {
      const key = p.schedule[d];
      const name = key ? p.sessions[key].name : 'Rest';
      days.append(h('button', {
        type: 'button', role: 'tab', class: `p-day${key ? '' : ' p-day--rest'}`, 'aria-selected': String(d === state.day),
        'aria-label': `${DAY_NAMES[d]}: ${name}`, onclick: () => { state.day = d; renderPlan(); },
      }, h('strong', { text: DAY_NAMES[d] }), h('span', { text: name })));
    }
    return days;
  }

  function sessionCard() {
    const key = state.plan.schedule[state.day];
    if (!key) {
      return h('section', { class: 'p-card ts-glass p-rest' },
        h('span', { class: 'ts-badge', html: TS.icon('leaf') }),
        h('h2', { class: 'ts-h3', text: 'Rest day' }),
        h('p', { class: 'ts-muted', text: `Recovery is where you adapt. Aim for ${state.plan.summary.stepsTarget.toLocaleString('en-IN')} steps, get 7–9 hours of sleep, and keep your protein up.` }));
    }
    const s = sessionForWeek(key);
    const card = h('section', { class: 'p-card ts-glass', 'aria-labelledby': 'p-session-title' });
    if (s.mobilityOnly) {
      card.append(h('div', { class: 'p-session__head' }, h('h2', { id: 'p-session-title', text: s.name }), tag(`${s.estMinutes} min`)),
        h('p', { class: 'p-block-title', text: 'Mobility flow' }),
        h('ul', { class: 'p-list' }, s.drills.map(d => h('li', {}, h('span', { text: d.name }), h('span', { text: d.dose })))));
      return card;
    }
    card.append(h('div', { class: 'p-session__head' },
      h('div', {}, h('p', { class: 'ts-eyebrow', text: `${DAY_NAMES[state.day]} · week ${state.week}` }), h('h2', { id: 'p-session-title', text: s.name }), h('p', { class: 'ts-muted', text: s.focus })),
      h('div', { class: 'p-session__meta' },
        tag(`~${s.estMinutes} min`),
        s.estKcal ? tag(`~${s.estKcal} kcal (est.)`) : null,
        s.format === 'circuit' ? tag(`Circuit × ${s.circuit.rounds}`, 'ts-tag--gold') : null)));

    card.append(h('p', { class: 'p-block-title', text: `Warm-up · ${s.warmupMin} min` }),
      h('ul', { class: 'p-list' }, s.warmup.map(w => h('li', {}, h('span', { text: w.name }), h('span', { text: w.dose || `${w.minutes} min` })))));

    card.append(h('p', { class: 'p-block-title', text: s.format === 'circuit' ? `Circuit: ${s.circuit.rounds} rounds, minimal rest` : 'Main work' }));
    s.exercises.forEach((ex, i) => card.append(exerciseRow(s, ex, i)));

    if (s.mobilityBlock) {
      card.append(h('p', { class: 'p-block-title', text: 'Mobility block' }),
        h('ul', { class: 'p-list' }, s.mobilityBlock.map(m => h('li', {}, h('span', { text: m.name }), h('span', { text: m.dose })))));
    }
    if (s.finisher) {
      card.append(h('p', { class: 'p-block-title', text: `Finisher · ${s.finisher.minutes} min` }),
        h('ul', { class: 'p-list' }, h('li', {}, h('span', { text: s.finisher.name }), h('span', { text: s.finisher.protocol }))),
        h('p', { class: 'ts-hint', text: s.finisher.why }));
    }
    card.append(h('p', { class: 'p-block-title', text: `Cool-down · ${s.cooldownMin} min` }),
      h('ul', { class: 'p-list' }, s.cooldown.map(c => h('li', {}, h('span', { text: c.name }), h('span', { text: c.dose })))));
    return card;
  }

  function exerciseRow(session, ex, i) {
    const wrap = h('article', { class: `p-ex${ex.role === 'compound' ? ' p-ex--main' : ''}`, 'data-exercise': ex.exerciseId });
    const bodyId = `p-ex-${session.key}-${ex.slot}`;
    const rx = `${ex.sets} × ${fmtReps(ex, ex.reps)} · RPE ${ex.rpe} · rest ${fmtRest(ex.restSec)}`;
    const row = h('div', { class: 'p-ex__row', role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'p-ex__num', text: String(i + 1) }),
      ex.images[0] ? h('img', { class: 'p-ex__img', src: ex.images[0], alt: '', loading: 'lazy', width: '64', height: '48' }) : h('span', { class: 'p-ex__img' }),
      h('div', {}, h('div', { class: 'p-ex__name', text: ex.name }), h('div', { class: 'p-ex__rx', text: rx }),
        h('div', { class: 'p-ex__sub', text: `${ex.primaryMuscles.join(', ')} · ${ex.equipment || 'bodyweight'}` })),
      h('span', { class: 'p-ex__chev', html: TS.icon('arrow-right') }));
    const toggle = () => {
      const open = wrap.toggleAttribute('data-open');
      row.setAttribute('aria-expanded', String(open));
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

    const body = h('div', { class: 'p-ex__body', id: bodyId });
    body.append(h('div', { class: 'p-ex__imgs' }, ex.images.map((src, k) => h('img', { src, alt: `${ex.name}, position ${k + 1}`, loading: 'lazy' }))));
    const detail = h('div', { class: 'ts-stack' },
      ex.instructions.length ? h('ol', { class: 'p-ex__steps' }, ex.instructions.map(t => h('li', { text: t }))) : null,
      h('p', { class: 'p-why' }, h('strong', { text: 'Why this: ' }), ex.why));
    if (ex.alternatives.length) {
      const alts = h('div', { class: 'p-alts' });
      for (const a of ex.alternatives) {
        alts.append(h('button', {
          type: 'button', class: 'ts-chip ts-chip--static', text: `Swap for ${a.name}`, disabled: state.mode !== 'trainee',
          onclick: () => swap(session.key, ex.slot, a.exerciseId, a.name),
        }));
      }
      detail.append(h('p', { class: 'ts-label', text: state.mode === 'trainee' ? 'Swap for a safe alternative' : 'Safe alternatives (log in to swap)' }), alts);
    }
    if (state.mode === 'trainee') detail.append(logger(ex));
    body.append(detail);
    wrap.append(row, body);
    return wrap;
  }

  function logger(ex) {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const existing = state.logs.filter(l => l.exerciseId === ex.exerciseId && l.date === date);
    const rows = [];
    const grid = h('div', { class: 'p-log', role: 'group', 'aria-label': `Log sets for ${ex.name}` },
      h('div', { class: 'p-log__row p-log__head' }, h('span', { text: 'Set' }), h('span', { text: ex.unit === 'sec' ? 'Secs' : 'Reps' }), h('span', { text: 'kg' }), h('span', { text: 'RPE' }), h('span', { text: 'Done' })));
    for (let k = 0; k < ex.sets; k++) {
      const prev = existing[k] || {};
      const reps = h('input', { class: 'ts-input', type: 'number', min: '0', max: '200', inputmode: 'numeric', 'aria-label': `Set ${k + 1} reps`, value: prev.reps ?? '' });
      const load = h('input', { class: 'ts-input', type: 'number', min: '0', max: '500', step: '0.5', inputmode: 'decimal', 'aria-label': `Set ${k + 1} load in kg`, value: prev.load_kg ?? '' });
      const rpe = h('input', { class: 'ts-input', type: 'number', min: '1', max: '10', step: '0.5', inputmode: 'decimal', 'aria-label': `Set ${k + 1} RPE`, value: prev.rpe ?? '' });
      const done = h('input', { class: 'p-log__done', type: 'checkbox', 'aria-label': `Set ${k + 1} done`, checked: prev.done || false });
      rows.push({ reps, load, rpe, done });
      grid.append(h('div', { class: 'p-log__row' }, h('span', { class: 'p-log__set', text: String(k + 1) }), reps, load, rpe, done));
    }
    const save = h('button', { type: 'button', class: 'ts-btn ts-btn--gold ts-btn--sm', text: existing.length ? 'Update sets' : 'Save sets' });
    save.addEventListener('click', async () => {
      const num = el => (el.value === '' ? null : Number(el.value));
      const sets = rows.map(r => ({ reps: num(r.reps), load_kg: num(r.load), rpe: num(r.rpe), done: r.done.checked }));
      save.disabled = true;
      const res = await TS.api(`/api/plans/workout/${state.planId}/logs`, { method: 'POST', body: { date, exerciseId: ex.exerciseId, sets } });
      save.disabled = false;
      if (!res.ok) return TS.toast(res.data.error || 'Could not save your sets.', { type: 'error' });
      TS.toast('Sets saved.', { type: 'success' });
      await loadWeekExtras();
      const side = document.querySelector('[data-p-adapt]');
      if (side && state.adapt) side.replaceWith(adaptCard());
      return undefined;
    });
    return h('div', { class: 'ts-stack' }, h('p', { class: 'ts-label', text: `Log today (${date})` }), grid, save);
  }

  function volumeCard() {
    const vol = state.plan.summary.weeklySetsByGroup;
    const entries = Object.entries(vol).filter(([g]) => g !== 'other').sort((a, b) => b[1] - a[1]);
    const max = Math.max(22, ...entries.map(e => e[1]));
    const band = { beginner: [6, 12], intermediate: [10, 20], advanced: [12, 22] }[state.plan.profile.experience];
    return h('section', { class: 'p-card ts-glass' },
      h('h2', { class: 'p-card__title' }, icon('dumbbell'), 'Weekly sets per muscle'),
      h('div', { class: 'p-vol' }, entries.map(([g, n]) => {
        const fill = h('span', { class: 'p-bar__fill' });
        fill.style.width = `${(n / max) * 100}%`;
        const bandEl = h('span', { class: 'p-bar__band' });
        bandEl.style.left = `${(band[0] / max) * 100}%`;
        bandEl.style.width = `${((band[1] - band[0]) / max) * 100}%`;
        return h('div', { class: 'p-bar' }, h('span', { text: g[0].toUpperCase() + g.slice(1) }), h('span', { class: 'p-bar__track', role: 'img', 'aria-label': `${n} sets` }, bandEl, fill), h('strong', { text: String(n) }));
      })),
      h('p', { class: 'ts-hint', text: `Dashed lines: the ${band[0]}–${band[1]} sets/week range for your level.` }));
  }

  function adaptCard() {
    const a = state.adapt;
    return h('section', { class: 'p-card ts-glass', 'data-p-adapt': '' },
      h('h2', { class: 'p-card__title' }, icon('calendar'), `Week ${a.week} so far`),
      h('p', { class: 'ts-hint', text: `${a.doneDays} of ${a.planned} sessions logged.` }),
      h('div', { class: 'ts-progress' }, (() => { const s = h('span'); s.style.width = `${Math.round(a.adherence * 100)}%`; return s; })()),
      a.adjustments.length ? h('ul', { class: 'p-adj' }, a.adjustments.slice(0, 6).map(x => h('li', { class: `is-${x.change}` }, h('strong', { text: x.name }), x.detail))) : h('p', { class: 'ts-hint', text: 'Log your sets and next week’s loads will appear here.' }),
      ...a.notes.map(n => h('p', { class: 'ts-hint', text: n })));
  }

  // ------------------------------------------------------------ actions
  async function swap(sessionKey, slot, exerciseId, name) {
    const res = await TS.api(`/api/plans/workout/${state.planId}/swap`, { method: 'POST', body: { sessionKey, slot, exerciseId } });
    if (!res.ok) return TS.toast(res.data.error || 'Swap failed.', { type: 'error' });
    state.plan.sessions[sessionKey] = res.data.session;
    TS.toast(`Swapped in ${name}.`, { type: 'success' });
    renderPlan();
    const el = document.querySelector(`[data-exercise="${exerciseId}"]`);
    if (el) { el.setAttribute('data-open', ''); el.scrollIntoView({ block: 'center' }); }
    return undefined;
  }

  async function generate(body = {}) {
    root.replaceChildren(h('div', { class: 'ts-skeleton p-skel' }));
    const res = await TS.api('/api/plans/workout', { method: 'POST', body });
    if (!res.ok) {
      root.replaceChildren(h('div', { class: 'p-card ts-glass' }, h('p', { class: 'ts-form-error', text: res.data.error || 'Could not build your plan.' }),
        res.data.code === 'profile_incomplete' ? h('a', { class: 'ts-btn ts-btn--gold', href: '/onboarding.html#goals', text: 'Finish my profile' }) : null));
      return;
    }
    Object.assign(state, { planId: res.data.planId, plan: res.data.plan, weeks: res.data.weeks, week: 1, currentWeek: 1, day: null });
    await loadWeekExtras();
    renderPlan();
    TS.toast('Your new plan is ready.', { type: 'gold' });
  }

  function regenerate() {
    if (!window.confirm('Build a fresh variation of your plan? Your logged sets stay in your history.')) return;
    generate({ weeks: state.plan.summary.weeks, days_per_week: state.plan.profile.daysPerWeek, session_minutes: state.plan.profile.sessionMinutes });
  }

  function openAdjust() {
    const sheet = $('[data-p-sheet]');
    const body = $('[data-p-sheet-body]');
    const p = state.plan.profile;
    const range = (name, label, value, min, max, step, fmt) => {
      const id = `adj-${name}`;
      const out = h('span', { class: 'o-range__value', text: fmt(value) });
      const input = h('input', { type: 'range', id, name, min, max, step, value });
      input.addEventListener('input', () => { out.textContent = fmt(input.value); });
      return h('div', { class: 'o-range' }, h('label', { class: 'ts-label', for: id }, `${label} `, out), input);
    };
    const form = h('form', { class: 'p-builder' },
      h('h2', { class: 'ts-h3', id: 'p-sheet-title', text: 'Adjust your plan' }),
      range('days_per_week', 'Days per week', p.daysPerWeek, 1, 7, 1, v => `${v}`),
      range('session_minutes', 'Minutes per session', p.sessionMinutes, 15, 120, 5, v => `${v} min`),
      range('weeks', 'Block length', state.plan.summary.weeks, 4, 12, 1, v => `${v} weeks`),
      h('p', { class: 'ts-hint', text: 'Equipment, goals and injuries come from your profile. Change them there.' }),
      h('button', { type: 'submit', class: 'ts-btn ts-btn--gold ts-btn--block', text: 'Rebuild plan' }));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      sheet.close();
      generate({ days_per_week: Number(fd.get('days_per_week')), session_minutes: Number(fd.get('session_minutes')), weeks: Number(fd.get('weeks')) });
    });
    body.replaceChildren(form);
    sheet.showModal();
  }

  // ------------------------------------------------------------ builder (visitors)
  function chips(name, label, options, selected) {
    const set = new Set(selected);
    const row = h('div', { class: 'o-chips', role: 'group', 'aria-label': label });
    for (const [v, t] of options) {
      const b = h('button', { type: 'button', class: 'o-chip', 'aria-pressed': String(set.has(v)), text: t });
      b.addEventListener('click', () => { if (set.has(v)) set.delete(v); else set.add(v); b.setAttribute('aria-pressed', String(set.has(v))); });
      row.append(b);
    }
    return { el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), row), get: () => [...set] };
  }
  function cards(name, label, options, value) {
    let cur = value;
    const grid = h('div', { class: 'o-cards', role: 'radiogroup', 'aria-label': label });
    const btns = options.map(([v, t, d]) => {
      const b = h('button', { type: 'button', class: 'o-option', role: 'radio', 'aria-checked': String(v === cur) }, h('strong', { text: t }), d ? h('small', { text: d }) : null);
      b.addEventListener('click', () => { cur = v; btns.forEach((x, i) => x.setAttribute('aria-checked', String(options[i][0] === v))); });
      return b;
    });
    grid.append(...btns);
    return { el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), grid), get: () => cur };
  }
  function slider(name, label, value, min, max, step, fmt) {
    const id = `b-${name}`;
    const out = h('span', { class: 'o-range__value', text: fmt(value) });
    const input = h('input', { type: 'range', id, min, max, step, value });
    input.addEventListener('input', () => { out.textContent = fmt(input.value); });
    return { el: h('div', { class: 'o-range' }, h('label', { class: 'ts-label', for: id }, `${label} `, out), input), get: () => Number(input.value) };
  }

  function renderBuilder(message) {
    state.plan = null;
    renderHead();
    const f = state.form || {};
    const goal = cards('goal', 'Your main goal', [['cut', 'Lose fat', 'Keep muscle, drop fat'], ['lean-bulk', 'Lean bulk', 'Slow muscle gain'], ['bulk', 'Bulk', 'Faster gain'], ['maintenance', 'Get fitter', 'Stay at this weight']], f.goal || 'cut');
    const focus = chips('goals', 'Also important (optional)', [['strength', 'Strength'], ['muscle-gain', 'Muscle'], ['endurance', 'Endurance'], ['mobility-yoga', 'Mobility'], ['fat-loss', 'Fat loss']], f.goals || []);
    const exp = cards('experience_level', 'Training experience', [['beginner', 'Beginner', 'New or returning'], ['intermediate', 'Intermediate', '6+ months consistent'], ['advanced', 'Advanced', '2+ years structured']], f.experience_level || 'beginner');
    const days = slider('days', 'Days per week', f.days_per_week || 3, 1, 7, 1, v => `${v}`);
    const mins = slider('mins', 'Minutes per session', f.session_minutes || 45, 15, 120, 5, v => `${v} min`);
    const equipment = chips('equipment', 'Equipment you have', [['dumbbell', 'Dumbbells'], ['barbell', 'Barbell'], ['kettlebells', 'Kettlebells'], ['bands', 'Bands'], ['bench', 'Bench'], ['pull-up bar', 'Pull-up bar'], ['cable', 'Cables'], ['machine', 'Machines']], f.equipment || ['dumbbell']);
    const limits = chips('limitations', 'Anything to work around?', [['knee', 'Knee'], ['lower_back', 'Lower back'], ['shoulder', 'Shoulder'], ['wrist_elbow', 'Wrist/elbow'], ['hip', 'Hip'], ['ankle_foot', 'Ankle/foot'], ['pregnancy', 'Pregnancy']], f.limitations || []);
    const err = h('p', { class: 'ts-form-error', role: 'alert', text: message || '' });
    const submit = h('button', { type: 'submit', class: 'ts-btn ts-btn--gold ts-btn--lg', text: 'Build my plan' });
    const form = h('form', { class: 'p-card ts-glass p-builder', 'aria-label': 'Build a workout plan' },
      goal.el, focus.el, exp.el, h('div', { class: 'o-grid-2' }, days.el, mins.el), equipment.el, limits.el,
      h('p', { class: 'ts-hint', text: 'Bodyweight exercises are always included. Previews stay moderate because we don’t know your health history. Create an account and share it for a fully tailored plan.' }),
      err, submit);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      state.form = { goal: goal.get(), goals: focus.get(), experience_level: exp.get(), days_per_week: days.get(), session_minutes: mins.get(), equipment: ['body only', ...equipment.get()], limitations: limits.get() };
      submit.disabled = true;
      const res = await TS.api('/api/plans/workout/preview', { method: 'POST', body: state.form });
      submit.disabled = false;
      if (!res.ok) { err.textContent = res.data.error || 'Could not build a plan.'; return; }
      Object.assign(state, { plan: res.data.plan, weeks: res.data.weeks, week: 1, day: null });
      renderPlan();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    root.replaceChildren(form);
  }

  // ------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', async () => {
    $('[data-p-sheet-close]').addEventListener('click', () => $('[data-p-sheet]').close());
    const session = await TS.getSession();
    if (!session.loggedIn || session.role !== 'trainee') {
      state.mode = session.loggedIn ? 'trainer' : 'visitor';
      renderBuilder();
      return;
    }
    if (session.onboardingComplete === false) { location.replace('/onboarding.html'); return; }
    state.mode = 'trainee';
    const res = await TS.api('/api/plans/workout/active');
    if (res.ok && res.data.plan) {
      Object.assign(state, { planId: res.data.planId, plan: res.data.plan, weeks: res.data.weeks, week: res.data.currentWeek, currentWeek: res.data.currentWeek });
      await loadWeekExtras();
      renderPlan();
      return;
    }
    renderHead();
    root.replaceChildren(h('section', { class: 'p-card ts-glass p-rest' },
      h('span', { class: 'ts-badge', html: TS.icon('dumbbell') }),
      h('h2', { class: 'ts-h3', text: 'Build your training plan' }),
      h('p', { class: 'ts-muted', text: 'We’ll use your goals, experience, equipment, schedule and any injuries from your profile.' }),
      h('button', { type: 'button', class: 'ts-btn ts-btn--gold ts-btn--lg', text: 'Build my plan', onclick: () => generate({}) })));
  });
})();
