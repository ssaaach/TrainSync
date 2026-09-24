// dietplans.html — 7-day meal plan viewer + builder.
(function () {
  const TS = window.TS;
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const SLOT = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
  const DIET = { veg: 'Vegetarian', 'non-veg': 'Non-veg', eggetarian: 'Eggetarian', vegan: 'Vegan', jain: 'Jain' };
  const state = { mode: 'visitor', planId: null, plan: null, day: DAYS[(new Date().getDay() + 6) % 7], form: null };
  const $ = s => document.querySelector(s);
  const root = $('[data-p-root]');

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
  const icon = name => h('span', { html: TS.icon(name), 'aria-hidden': 'true' });
  const tag = (text, cls = '') => h('span', { class: `ts-tag ${cls}`, text });

  function ring(t, target) {
    // Macro split ring (protein / carbs / fat by energy) drawn with SVG arcs.
    const p = t.protein_g * 4, c = t.carbs_g * 4, f = t.fat_g * 9;
    const total = p + c + f || 1;
    const R = 42, CIRC = 2 * Math.PI * R;
    const segs = [[p, '#ffcc00'], [c, '#d5ada6'], [f, '#8f8a86']];
    let off = 0;
    const circles = segs.map(([v, col]) => {
      const len = (v / total) * CIRC;
      const el = `<circle r="${R}" cx="50" cy="50" fill="none" stroke="${col}" stroke-width="12" stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`;
      off += len;
      return el;
    }).join('');
    const pct = Math.round((t.kcal / target) * 100);
    return h('div', { class: 'd-ring', role: 'img', 'aria-label': `${t.kcal} kcal, ${pct}% of target. Protein ${Math.round((p / total) * 100)}%, carbs ${Math.round((c / total) * 100)}%, fat ${Math.round((f / total) * 100)}% of energy.` },
      h('svg', { viewBox: '0 0 100 100', html: `<circle r="${R}" cx="50" cy="50" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>${circles}` }),
      h('div', { class: 'd-ring__label' }, h('strong', { text: String(t.kcal) }), h('span', { text: 'kcal' })));
  }

  function meter(label, value, target, unit) {
    const pct = Math.min(130, Math.round((value / target) * 100));
    const bar = h('span');
    bar.style.width = `${Math.min(100, pct)}%`;
    return h('div', { class: 'ts-meter' }, h('span', { class: 'ts-meter__label', text: label }), h('span', { class: 'ts-progress' }, bar),
      h('span', { class: 'ts-meter__value', text: `${Math.round(value)} / ${target} ${unit}` }));
  }

  function renderHead() {
    const p = state.plan;
    $('[data-p-title]').textContent = p ? `${p.targets.kcal} kcal · ${p.targets.protein_g} g protein a day` : 'Indian meals that hit your numbers';
    $('[data-p-sub]').textContent = p
      ? `${DIET[p.profile.diet_pref] || p.profile.diet_pref} · ${p.summary.mealsPerDay} meals a day · ${p.summary.daysWithinTolerance} of 7 days within ±5% calories and ±10% macros.`
      : '7-day plans from 180+ home-style dishes, with nutrition computed from USDA ingredient data.';
    const chips = $('[data-p-chips]');
    chips.replaceChildren();
    if (p) {
      chips.append(tag(`${p.targets.carbs_g} g carbs`), tag(`${p.targets.fat_g} g fat`), tag(`≥ ${p.targets.fiber_g} g fibre`),
        tag(p.engine === 'optimizer' ? 'Optimised' : 'Quick plan', p.engine === 'optimizer' ? 'ts-tag--gold' : 'ts-tag--warm'));
      if (p.targets.general) chips.append(tag('General targets', 'ts-tag--warm'));
      if (state.mode !== 'trainee') chips.append(tag('Preview', 'ts-tag--warm'));
    }
    const actions = $('[data-p-actions]');
    actions.replaceChildren();
    if (p && state.mode === 'trainee') {
      actions.append(h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'New week of meals', onclick: () => generate() }),
        h('button', { type: 'button', class: 'ts-btn ts-btn--dark ts-btn--sm', text: 'Print', onclick: () => window.print() }));
    } else if (p) {
      actions.append(h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Change answers', onclick: () => renderBuilder() }));
    }
  }

  function renderPlan() {
    renderHead();
    const p = state.plan;
    const day = p.days.find(d => d.day === state.day) || p.days[0];
    const main = h('div', { class: 'p-main' });
    if (state.mode !== 'trainee') {
      main.append(h('div', { class: 'p-cta' }, h('p', {}, h('strong', { text: 'Like it? ' }), 'Create a free account to save your plan and swap meals.'),
        h('a', { class: 'ts-btn ts-btn--gold ts-btn--sm', href: '/registration.html', text: 'Save my plan' })));
    }
    if (p.targets.general) main.append(h('div', { class: 'o-note', role: 'note' }, icon('info'), h('span', { text: 'These are general targets. Share body measurements in your profile for targets built on your own metabolism.' })));

    const days = h('div', { class: 'p-days', role: 'tablist', 'aria-label': 'Days' });
    for (const d of p.days) {
      days.append(h('button', { type: 'button', role: 'tab', class: 'p-day', 'aria-selected': String(d.day === day.day), onclick: () => { state.day = d.day; renderPlan(); } },
        h('strong', { text: DAY_NAMES[d.day] }), h('span', { text: `${d.totals.kcal} kcal` })));
    }
    main.append(h('section', { class: 'p-card ts-glass', 'aria-label': 'Days' }, days));

    const mealsCard = h('section', { class: 'p-card ts-glass', 'aria-labelledby': 'd-day-title' },
      h('div', { class: 'p-session__head' }, h('div', {}, h('p', { class: 'ts-eyebrow', text: 'Meals' }), h('h2', { id: 'd-day-title', text: `${DAY_NAMES[day.day]}’s menu` }))));
    day.meals.forEach((m, i) => mealsCard.append(mealRow(day, m, i)));
    main.append(mealsCard);

    const side = h('aside', { class: 'p-side', 'aria-label': 'Day summary' });
    side.append(h('section', { class: 'p-card ts-glass d-summary' },
      h('h2', { class: 'p-card__title' }, icon('flame'), 'Today vs target'),
      ring(day.totals, p.targets.kcal),
      h('div', { class: 'd-legend' }, h('span', { class: 'd-dot d-dot--p', text: 'Protein' }), h('span', { class: 'd-dot d-dot--c', text: 'Carbs' }), h('span', { class: 'd-dot d-dot--f', text: 'Fat' })),
      h('div', { class: 'ts-stack' },
        meter('Calories', day.totals.kcal, p.targets.kcal, 'kcal'), meter('Protein', day.totals.protein_g, p.targets.protein_g, 'g'),
        meter('Carbs', day.totals.carbs_g, p.targets.carbs_g, 'g'), meter('Fat', day.totals.fat_g, p.targets.fat_g, 'g'),
        meter('Fibre', day.totals.fiber_g, p.targets.fiber_g, 'g'))));
    side.append(h('section', { class: 'p-card ts-glass' }, h('h2', { class: 'p-card__title' }, icon('spark'), 'Why this plan'),
      h('ul', { class: 'p-reason' }, p.reasoning.map(r => h('li', { text: r })))));
    side.append(h('section', { class: 'p-card ts-glass' }, h('h2', { class: 'p-card__title' }, icon('bookmark'), 'Grocery list (7 days)'),
      h('ul', { class: 'd-groceries' }, p.groceries.map(g => h('li', {}, h('span', { text: g.name }), h('span', { text: g.grams >= 1000 ? `${(g.grams / 1000).toFixed(1)} kg` : `${g.grams} g` }))))));
    root.replaceChildren(h('div', { class: 'p-layout' }, main, side));
  }

  function mealRow(day, m, i) {
    const wrap = h('article', { class: 'p-ex' });
    const bodyId = `d-meal-${day.day}-${i}`;
    const row = h('div', { class: 'p-ex__row d-meal__row', role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'p-ex__num', text: (SLOT[m.slot] || m.slot)[0] }),
      h('div', {}, h('div', { class: 'ts-eyebrow', text: SLOT[m.slot] || m.slot }), h('div', { class: 'p-ex__name', text: m.name }),
        h('div', { class: 'p-ex__rx', text: `${m.kcal} kcal · ${m.protein_g} g protein · ${m.carbs_g} g carbs · ${m.fat_g} g fat` }),
        h('div', { class: 'p-ex__sub', text: `${m.portion === 1 ? '1 serving' : `${m.portion} servings`} (${m.grams} g)${m.prepMinutes ? ` · ${m.prepMinutes} min` : ''}` })),
      h('span', { class: 'p-ex__chev', html: TS.icon('arrow-right') }));
    const toggle = () => { const open = wrap.toggleAttribute('data-open'); row.setAttribute('aria-expanded', String(open)); };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    const body = h('div', { class: 'p-ex__body d-meal__body', id: bodyId },
      h('div', {}, h('p', { class: 'ts-label', text: 'Ingredients for this portion' }),
        h('ul', { class: 'p-list' }, m.ingredients.map(x => h('li', {}, h('span', { text: x.name }), h('span', { text: `${x.grams} g` }))))),
      h('div', { class: 'ts-stack' }, h('p', { class: 'ts-label', text: state.mode === 'trainee' ? 'Swap for' : 'Similar options (log in to swap)' }),
        h('div', { class: 'p-alts' }, m.alternatives.map(a => h('button', {
          type: 'button', class: 'ts-chip ts-chip--static', disabled: state.mode !== 'trainee',
          text: `${a.name} · ${a.kcal} kcal`, onclick: () => swap(day.day, i, a.dishId, a.name),
        }))), h('p', { class: 'ts-hint', text: `${m.fiber_g} g fibre.` })));
    wrap.append(row, body);
    return wrap;
  }

  async function swap(day, meal, dishId, name) {
    const res = await TS.api(`/api/plans/diet/${state.planId}/swap`, { method: 'POST', body: { day, meal, dishId } });
    if (!res.ok) return TS.toast(res.data.error || 'Swap failed.', { type: 'error' });
    const i = state.plan.days.findIndex(d => d.day === day);
    state.plan.days[i] = res.data.day;
    state.plan.groceries = res.data.groceries;
    TS.toast(`Swapped in ${name}.`, { type: 'success' });
    renderPlan();
    return undefined;
  }

  async function generate() {
    root.replaceChildren(h('div', { class: 'ts-skeleton p-skel' }), h('p', { class: 'ts-hint', text: 'Balancing your week… this takes a few seconds.' }));
    const res = await TS.api('/api/plans/diet', { method: 'POST', body: {} });
    if (!res.ok) {
      root.replaceChildren(h('div', { class: 'p-card ts-glass' }, h('p', { class: 'ts-form-error', text: res.data.error || 'Could not build your plan.' }),
        res.data.code === 'profile_incomplete' ? h('a', { class: 'ts-btn ts-btn--gold', href: '/onboarding.html#goals', text: 'Finish my profile' }) : null));
      return;
    }
    Object.assign(state, { planId: res.data.planId, plan: res.data.plan });
    renderPlan();
    TS.toast('Your meal plan is ready.', { type: 'gold' });
  }

  // ------------------------------------------------------------ builder
  function chips(label, options, selected) {
    const set = new Set(selected);
    const row = h('div', { class: 'o-chips', role: 'group', 'aria-label': label });
    for (const [v, t] of options) {
      const b = h('button', { type: 'button', class: 'o-chip', 'aria-pressed': String(set.has(v)), text: t });
      b.addEventListener('click', () => { if (set.has(v)) set.delete(v); else set.add(v); b.setAttribute('aria-pressed', String(set.has(v))); });
      row.append(b);
    }
    return { el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), row), get: () => [...set] };
  }
  function select(id, label, options, value) {
    const sel = h('select', { class: 'ts-select', id }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = value;
    return { el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: id, text: label }), sel), get: () => sel.value };
  }
  function num(id, label, value, min, max, unit) {
    const input = h('input', { class: 'ts-input', type: 'number', id, min, max, value, inputmode: 'decimal' });
    return { el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: id, text: label }), h('div', { class: 'o-unit' }, input, h('span', { text: unit }))), get: () => Number(input.value) };
  }

  function renderBuilder() {
    state.plan = null;
    renderHead();
    const f = state.form || {};
    const sex = select('d-sex', 'Sex (for energy formulas)', [['female', 'Female'], ['male', 'Male']], f.sex || 'female');
    const age = num('d-age', 'Age', f.age || 28, 18, 100, 'yrs');
    const height = num('d-height', 'Height', f.height_cm || 162, 120, 230, 'cm');
    const weight = num('d-weight', 'Weight', f.weight_kg || 65, 30, 250, 'kg');
    const activity = select('d-activity', 'Activity', [['sedentary', 'Sedentary'], ['light', 'Lightly active'], ['moderate', 'Moderately active'], ['active', 'Very active'], ['very_active', 'Athlete']], f.activity_level || 'light');
    const goal = select('d-goal', 'Goal', [['cut', 'Lose fat'], ['maintenance', 'Maintain'], ['lean-bulk', 'Lean bulk'], ['bulk', 'Bulk']], f.goal || 'cut');
    const diet = select('d-diet', 'Diet', Object.entries(DIET), f.diet_pref || 'veg');
    const allergens = chips('Avoid (allergies)', [['dairy', 'Dairy'], ['gluten', 'Gluten'], ['peanuts', 'Peanuts'], ['tree_nuts', 'Tree nuts'], ['soy', 'Soy'], ['egg', 'Egg'], ['fish', 'Fish'], ['sesame', 'Sesame']], f.allergens || []);
    const cuisines = chips('Cuisines you like', [['south-indian', 'South Indian'], ['north-indian', 'North Indian'], ['gujarati', 'Gujarati'], ['maharashtrian', 'Maharashtrian'], ['bengali', 'Bengali'], ['continental', 'Continental']], f.cuisines || []);
    const err = h('p', { class: 'ts-form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'ts-btn ts-btn--gold ts-btn--lg', text: 'Build my meal plan' });
    const form = h('form', { class: 'p-card ts-glass p-builder', 'aria-label': 'Build a meal plan' },
      h('div', { class: 'o-grid-2' }, sex.el, age.el, height.el, weight.el, activity.el, goal.el, diet.el), allergens.el, cuisines.el,
      h('p', { class: 'ts-hint', text: 'Calories from the Mifflin–St Jeor equation and your activity level; protein set for your goal. Estimates, not medical advice.' }), err, submit);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      state.form = { sex: sex.get(), age: age.get(), height_cm: height.get(), weight_kg: weight.get(), activity_level: activity.get(), goal: goal.get(), diet_pref: diet.get(), allergens: allergens.get(), cuisines: cuisines.get() };
      submit.disabled = true;
      submit.textContent = 'Balancing your week…';
      const res = await TS.api('/api/plans/diet/preview', { method: 'POST', body: state.form });
      submit.disabled = false;
      submit.textContent = 'Build my meal plan';
      if (!res.ok) { err.textContent = res.data.error || 'Could not build a plan.'; return; }
      state.plan = res.data.plan;
      renderPlan();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    root.replaceChildren(form);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const session = await TS.getSession();
    if (!session.loggedIn || session.role !== 'trainee') { state.mode = session.loggedIn ? 'trainer' : 'visitor'; renderBuilder(); return; }
    if (session.onboardingComplete === false) { location.replace('/onboarding.html'); return; }
    state.mode = 'trainee';
    const res = await TS.api('/api/plans/diet/active');
    if (res.ok && res.data.plan) { Object.assign(state, { planId: res.data.planId, plan: res.data.plan }); renderPlan(); return; }
    renderHead();
    root.replaceChildren(h('section', { class: 'p-card ts-glass p-rest' }, h('span', { class: 'ts-badge', html: TS.icon('bowl') }),
      h('h2', { class: 'ts-h3', text: 'Build your meal plan' }),
      h('p', { class: 'ts-muted', text: 'We’ll use your diet, allergies, cuisines and energy needs from your profile.' }),
      h('button', { type: 'button', class: 'ts-btn ts-btn--gold ts-btn--lg', text: 'Build my meal plan', onclick: generate })));
  });
})();
