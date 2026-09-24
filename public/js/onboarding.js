// onboarding.html — consent-first, resumable profile wizard.
// Steps come from GET /api/onboarding; each step is saved with
// PATCH /api/onboarding/steps/:id. Steps whose consent purpose was declined
// are skipped automatically.
(function () {
  const TS = window.TS;

  // ------------------------------------------------------------ labels
  const L = {
    purposes: {
      body_metrics: ['Body metrics', 'Height, weight and a few tape measurements, for body-fat and calorie estimates.', 'Plans use general targets for your goal.'],
      health: ['Health & injuries', 'A 7-question health check and any injuries, so plans leave out movements that aren’t safe for you.', 'Plans stay conservative and we suggest checking with a doctor first.'],
      personality: ['Personality', '20 short statements (Mini-IPIP), used for personality fit with trainers.', 'Matching ignores personality.'],
      interests: ['Hobbies & interests', 'What you enjoy outside training, to find trainers you’ll click with.', 'Matching ignores interests.'],
      location: ['Location', 'Your neighbourhood or device location, for distance to trainers and gyms.', 'Gym search by city still works; matches aren’t filtered by distance.'],
      matching: ['Use my profile for matching', 'Show your profile to potential matches and rank them for you.', 'You won’t appear in matches; plans and gyms still work.'],
    },
    activityLevels: { sedentary: ['Sedentary', 'Desk job, little walking'], light: ['Lightly active', 'On your feet a bit, or 1–2 workouts a week'], moderate: ['Moderately active', '3–4 workouts or an active job'], active: ['Very active', '5–6 hard sessions a week'], very_active: ['Athlete', 'Twice-a-day training or heavy labour'] },
    bodyGoals: { cut: ['Lose fat', 'Calorie deficit, keep muscle'], 'lean-bulk': ['Lean bulk', 'Slow, clean muscle gain'], bulk: ['Bulk', 'Faster gain, more food'], maintenance: ['Maintain', 'Hold weight, get fitter'] },
    goals: { 'fat-loss': 'Fat loss', 'muscle-gain': 'Muscle gain', strength: 'Strength', endurance: 'Endurance', 'mobility-yoga': 'Mobility & yoga', 'sport-specific': 'Sport-specific', 'general-fitness': 'General fitness', 'beginner-onboarding': 'Starting out' },
    experienceLevels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
    dietPrefs: { veg: 'Vegetarian', 'non-veg': 'Non-vegetarian', eggetarian: 'Eggetarian', vegan: 'Vegan', jain: 'Jain' },
    modalities: { in_person_gym: 'At a gym', home: 'At home', online: 'Online', outdoor: 'Outdoors' },
    days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
    dayparts: { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
    styleAxes: {
      structure: ['How structured?', 'Flexible plan', 'Strict plan'],
      tone: ['What tone works for you?', 'Supportive', 'Tough love'],
      checkin: ['How often should your coach check in?', 'Now and then', 'Every day'],
      data: ['How should progress be judged?', 'By feel', 'By the numbers'],
    },
  };
  const pretty = s => String(s).replace(/[_-]/g, ' ').replace(/^\w/, c => c.toUpperCase());
  const labelOf = (group, v) => {
    const x = (L[group] || {})[v];
    return Array.isArray(x) ? x[0] : x || (state.options.limitationLabels || {})[v] || pretty(v);
  };

  // ------------------------------------------------------------ tiny DOM helpers
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  let uid = 0;
  const id = name => `o-${name}-${++uid}`;

  function head(title, text) {
    return h('div', { class: 'o-head' }, h('h1', { text: title }), text ? h('p', { text }) : null);
  }
  function note(text, gold = false) {
    const n = h('div', { class: `o-note${gold ? ' o-note--gold' : ''}` });
    n.innerHTML = TS.icon('info');
    n.append(h('span', { text }));
    return n;
  }

  // Each field returns { el, get(), name }.
  const F = {
    number(name, label, { value, min, max, step = 1, unit, hint, required = true } = {}) {
      const fid = id(name);
      const input = h('input', { class: 'ts-input', type: 'number', id: fid, name, inputmode: 'decimal', min, max, step, required });
      if (value !== undefined && value !== null) input.value = value;
      const wrap = unit ? h('div', { class: 'o-unit' }, input, h('span', { text: unit })) : input;
      return { name, el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: fid, text: label }), wrap, hint ? h('p', { class: 'ts-hint', text: hint }) : null),
        get: () => (input.value === '' ? undefined : Number(input.value)) };
    },
    text(name, label, { value, max = 150, hint, list, placeholder } = {}) {
      const fid = id(name);
      const input = h('input', { class: 'ts-input', type: 'text', id: fid, name, maxlength: max, list, placeholder, autocomplete: 'off' });
      if (value) input.value = value;
      return { name, input, el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: fid, text: label }), input, hint ? h('p', { class: 'ts-hint', text: hint }) : null),
        get: () => input.value.trim() || undefined };
    },
    textarea(name, label, { value, max = 500, placeholder } = {}) {
      const fid = id(name);
      const t = h('textarea', { class: 'ts-textarea', id: fid, name, maxlength: max, placeholder });
      if (value) t.value = value;
      return { name, el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: fid, text: label }), t), get: () => t.value.trim() || undefined };
    },
    select(name, label, choices, { value, placeholder, hint } = {}) {
      const fid = id(name);
      const sel = h('select', { class: 'ts-select', id: fid, name },
        placeholder !== undefined ? h('option', { value: '', text: placeholder }) : null,
        choices.map(([v, t]) => h('option', { value: v, text: t })));
      if (value !== undefined && value !== null) sel.value = value;
      return { name, input: sel, el: h('div', { class: 'ts-field' }, h('label', { class: 'ts-label', for: fid, text: label }), sel, hint ? h('p', { class: 'ts-hint', text: hint }) : null),
        get: () => sel.value || undefined };
    },
    segmented(name, label, choices, { value, hint } = {}) {
      const group = h('div', { class: 'ts-segmented', role: 'radiogroup' });
      choices.forEach(([v, t]) => {
        const rid = id(`${name}-${v}`);
        group.append(h('input', { type: 'radio', id: rid, name, value: v, checked: v === value }), h('label', { for: rid, text: t }));
      });
      return { name, el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), group, hint ? h('p', { class: 'ts-hint', text: hint }) : null),
        get: () => (group.querySelector('input:checked') || {}).value };
    },
    chips(name, label, choices, { value = [], hint } = {}) {
      const selected = new Set(value || []);
      const row = h('div', { class: 'o-chips', role: 'group', 'aria-label': label, 'data-field': name });
      choices.forEach(([v, t]) => {
        const b = h('button', { type: 'button', class: 'o-chip', 'aria-pressed': String(selected.has(v)), 'data-value': v, text: t });
        b.addEventListener('click', () => {
          if (selected.has(v)) selected.delete(v); else selected.add(v);
          b.setAttribute('aria-pressed', String(selected.has(v)));
        });
        row.append(b);
      });
      return { name, el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), row, hint ? h('p', { class: 'ts-hint', text: hint }) : null),
        get: () => choices.map(([v]) => v).filter(v => selected.has(v)) };
    },
    cards(name, label, choices, { value } = {}) {
      let current = value;
      const grid = h('div', { class: 'o-cards', role: 'radiogroup', 'aria-label': label, 'data-field': name });
      const buttons = choices.map(([v, title, desc]) => {
        const b = h('button', { type: 'button', class: 'o-option', role: 'radio', 'aria-checked': String(v === current), 'data-value': v },
          h('strong', { text: title }), desc ? h('small', { text: desc }) : null);
        b.addEventListener('click', () => { current = v; buttons.forEach(x => x.setAttribute('aria-checked', String(x.dataset.value === v))); });
        return b;
      });
      grid.append(...buttons);
      return { name, el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), grid), get: () => current };
    },
    range(name, label, { value, min, max, step = 1, left, right, format = v => v } = {}) {
      const fid = id(name);
      const input = h('input', { type: 'range', id: fid, name, min, max, step });
      input.value = value ?? Math.round((min + max) / 2);
      const out = h('span', { class: 'o-range__value', text: format(input.value) });
      input.addEventListener('input', () => { out.textContent = format(input.value); });
      return { name, el: h('div', { class: 'o-range' },
        h('label', { class: 'ts-label', for: fid }, `${label} `, out), input,
        left || right ? h('div', { class: 'o-range__ends' }, h('span', { text: left || '' }), h('span', { text: right || '' })) : null),
      get: () => Number(input.value) };
    },
    schedule(name, label, { value = {} } = {}) {
      const { days, dayparts } = state.options;
      const sel = new Set(Object.entries(value || {}).flatMap(([d, parts]) => parts.map(p => `${d}:${p}`)));
      const grid = h('div', { class: 'o-sched', role: 'group', 'aria-label': label, 'data-field': name }, h('span'));
      days.forEach(d => grid.append(h('span', { class: 'o-sched__h', text: L.days[d] })));
      dayparts.forEach(p => {
        grid.append(h('span', { class: 'o-sched__row', text: L.dayparts[p] }));
        days.forEach(d => {
          const key = `${d}:${p}`;
          const b = h('button', { type: 'button', class: 'o-slot', 'aria-pressed': String(sel.has(key)), 'aria-label': `${L.days[d]} ${L.dayparts[p]}` });
          b.addEventListener('click', () => { if (sel.has(key)) sel.delete(key); else sel.add(key); b.setAttribute('aria-pressed', String(sel.has(key))); });
          grid.append(b);
        });
      });
      return { name, el: h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: label }), grid, h('p', { class: 'ts-hint', text: 'Tap every slot that usually works for you.' })),
        get: () => {
          const out = {};
          for (const key of sel) { const [d, p] = key.split(':'); (out[d] = out[d] || []).push(p); }
          return out;
        } };
    },
  };

  const choicesOf = (vocab, group) => vocab.map(v => [v, labelOf(group, v)]);
  const cardChoices = (vocab, group) => vocab.map(v => { const x = L[group][v] || [pretty(v)]; return [v, x[0], x[1]]; });

  // ------------------------------------------------------------ state
  const state = { steps: [], index: 0, consents: {}, profile: {}, options: {}, role: 'trainee', fields: [], custom: null };
  const $ = sel => document.querySelector(sel);
  const body = $('[data-o-body]');
  const form = $('[data-o-form]');

  // Values of the given fields (undefined ones left out).
  function collectFields(fields) {
    const out = {};
    for (const f of fields) {
      const v = f.get();
      if (v !== undefined) out[f.name] = v;
    }
    return out;
  }
  const collect = () => (state.custom ? state.custom() : collectFields(state.fields));

  // ------------------------------------------------------------ steps
  const P = () => state.profile;
  const STEPS = {
    consent() {
      const toggles = {};
      const list = h('div', { class: 'o-consent' });
      state.options.consentPurposes.forEach(p => {
        const [title, what, ifNo] = L.purposes[p];
        const input = h('input', { type: 'checkbox', role: 'switch', id: `consent-${p}`, name: p, checked: state.consentDecided ? state.consents[p] : false });
        toggles[p] = input;
        list.append(h('div', { class: 'o-purpose' },
          h('h2', {}, h('label', { for: `consent-${p}`, text: title })),
          h('label', { class: 'ts-switch' }, input, h('span')),
          h('p', { text: what }),
          h('p', { class: 'o-purpose__no', text: `If you say no: ${ifNo}` })));
      });
      const allBtn = h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Allow all' });
      allBtn.addEventListener('click', () => Object.values(toggles).forEach(t => { t.checked = true; }));
      const link = h('p', { class: 'ts-hint' }, 'Every switch can be changed later in Privacy & data. Read the full ', h('a', { href: '/privacy.html', class: 'ts-gold', target: '_blank', text: 'privacy policy' }), ` (version ${state.policyVersion}).`);
      body.replaceChildren(head('Your data, your choice', 'Everything below is optional, and TrainSync works with any combination. Turn on only what you’re comfortable sharing.'), allBtn, list, link);
      state.custom = () => ({ purposes: Object.fromEntries(Object.entries(toggles).map(([k, t]) => [k, t.checked])) });
    },

    basics() {
      const p = P();
      const cities = state.options.cities.map(c => [c.key, c.name]);
      const cityKey = (state.options.cities.find(c => c.name === p.city) || {}).key;
      const city = F.select('city', 'City', cities, { value: cityKey, placeholder: 'Choose your city' });
      const fields = [];
      if (state.role === 'trainee') {
        fields.push(
          F.segmented('sex', 'Sex (for body-composition formulas)', [['female', 'Female'], ['male', 'Male']], { value: p.sex, hint: 'The formulas we use differ by sex. This is not shown to anyone.' }),
          F.select('gender', 'Gender (optional)', [['female', 'Woman'], ['male', 'Man'], ['other', 'Another gender / prefer to self-describe']], { value: p.gender, placeholder: 'Prefer not to say' }),
          F.number('age', 'Age', { value: p.age, min: 18, max: 100, hint: 'TrainSync is for adults (18+).' }),
        );
      } else {
        fields.push(F.select('gender', 'Gender', [['female', 'Woman'], ['male', 'Man'], ['other', 'Another gender']], { value: p.gender, placeholder: 'Choose' }));
      }
      fields.push(city);
      const parts = [head('About you', 'The basics we need to personalise everything else.')];
      const grid = h('div', { class: 'o-grid-2' });
      fields.forEach(f => grid.append(f.el));
      parts.push(grid);

      let coords = null;
      if (state.consents.location) {
        const loc = F.text('locality', 'Neighbourhood', { value: p.locality, list: 'o-localities', placeholder: 'e.g. Indiranagar', hint: 'Pick from the list for the best distance estimates.' });
        const dl = h('datalist', { id: 'o-localities' });
        const loadLocalities = async () => {
          dl.replaceChildren();
          if (!city.get()) return;
          const res = await TS.api(`/api/localities?city=${encodeURIComponent(city.get())}`);
          if (res.ok) res.data.forEach(l => dl.append(h('option', { value: l.name })));
        };
        city.input.addEventListener('change', loadLocalities);
        loadLocalities();
        const geo = h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Use my current location' });
        const geoMsg = h('p', { class: 'ts-hint', 'aria-live': 'polite' });
        geo.addEventListener('click', () => {
          if (!navigator.geolocation) { geoMsg.textContent = 'Your browser can’t share location. Pick a neighbourhood instead.'; return; }
          geoMsg.textContent = 'Asking your browser…';
          navigator.geolocation.getCurrentPosition(pos => {
            coords = { lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4 };
            geoMsg.textContent = 'Location saved (rounded to about 10 m). Only approximate distances are ever shown to others.';
          }, () => { geoMsg.textContent = 'Location wasn’t shared. That’s fine: pick a neighbourhood instead.'; }, { timeout: 10000, maximumAge: 600000 });
        });
        fields.push(loc);
        parts.push(h('div', { class: 'o-grid-2' }, loc.el, h('div', { class: 'ts-field' }, h('span', { class: 'ts-label', text: 'Or' }), geo, geoMsg)), dl);
      } else {
        parts.push(note('Location is off, so we only store your city. Turn it on in Privacy & data to see distances.'));
      }
      if (state.role === 'trainee') {
        const act = F.cards('activity_level', 'How active are you day to day?', cardChoices(state.options.activityLevels, 'activityLevels'), { value: p.activity_level });
        fields.push(act);
        parts.push(act.el);
      }
      body.replaceChildren(...parts);
      state.fields = fields;
      state.custom = () => ({ ...collectFields(fields), ...(coords ? { coords } : {}) });
    },

    body() {
      const p = P();
      const female = p.sex === 'female';
      const fields = [
        F.number('height_cm', 'Height', { value: p.height_cm, min: 120, max: 230, step: 0.5, unit: 'cm' }),
        F.number('weight_kg', 'Weight', { value: p.weight_kg, min: 30, max: 250, step: 0.1, unit: 'kg' }),
        F.number('waist_cm', 'Waist', { value: p.waist_cm, min: 40, max: 200, step: 0.5, unit: 'cm', hint: female ? 'At the narrowest point' : 'At the navel' }),
        F.number('neck_cm', 'Neck', { value: p.neck_cm, min: 20, max: 70, step: 0.5, unit: 'cm', hint: 'Just below the larynx' }),
      ];
      if (female) fields.push(F.number('hip_cm', 'Hip', { value: p.hip_cm, min: 50, max: 200, step: 0.5, unit: 'cm', hint: 'At the widest point' }));
      fields.push(F.number('wrist_cm', 'Wrist (optional)', { value: p.wrist_cm, min: 10, max: 25, step: 0.1, unit: 'cm', required: false }));
      const grid = h('div', { class: 'o-grid-2' }, ...fields.map(f => f.el));
      const tip = h('details', { class: 'o-tip' }, h('summary', { text: 'How to measure (1 minute)' }), h('ul', {},
        h('li', { text: 'Use a soft tape, snug but not squeezing, and measure on bare skin.' }),
        h('li', { text: 'Measure in the morning before eating, standing relaxed. Don’t suck in.' }),
        h('li', { text: 'Take each measurement twice and use the average.' })));
      const preview = h('div', { class: 'o-preview', 'aria-live': 'polite' }, h('p', { class: 'ts-hint', text: 'Your estimate appears here as you type.' }));
      let t;
      const update = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const v = Object.fromEntries(fields.map(f => [f.name, f.get()]).filter(([, x]) => x !== undefined));
          if (!v.height_cm || !v.weight_kg || !v.waist_cm || !v.neck_cm || (female && !v.hip_cm)) return;
          const res = await TS.api('/api/onboarding/body-preview', { method: 'POST', body: { ...v, sex: p.sex, age: p.age, activity_level: p.activity_level } });
          if (!res.ok) { preview.replaceChildren(h('p', { class: 'ts-hint', text: res.data.error || 'Check the numbers.' })); return; }
          const a = res.data.assessment;
          preview.replaceChildren(
            h('div', { class: 'o-preview__stats' },
              ...[[`${a.bodyFatPct}%`, 'Body fat (est.)'], [a.bmi, 'BMI'], [a.ffmiNormalized, 'FFMI'], [a.label.replace(/-/g, '‑'), 'Body type'], [`${a.tdee} kcal`, 'Daily energy']]
                .map(([v2, l2]) => h('div', { class: 'o-stat' }, h('strong', { text: String(v2) }), h('span', { text: l2 })))),
            h('p', { class: 'ts-hint', text: `Estimate (U.S. Navy circumference method + height-weight ratio), confidence ${Math.round(a.confidence * 100)}%. Not a medical measurement.` }));
        }, 350);
      };
      grid.addEventListener('input', update);
      update();
      body.replaceChildren(head('Body measurements', 'We estimate body fat, lean mass and daily energy needs from a few tape measurements.'), tip, grid, preview);
      state.fields = fields;
    },

    goals() {
      const p = P();
      const o = state.options;
      const fields = [
        F.cards('goal', 'Main goal right now', cardChoices(o.bodyGoals, 'bodyGoals'), { value: p.goal }),
        F.chips('goals', 'What matters to you? (pick any)', choicesOf(o.goals, 'goals'), { value: p.goals }),
        F.segmented('experience_level', 'Training experience', choicesOf(o.experienceLevels, 'experienceLevels'), { value: p.experience_level }),
        F.range('days_per_week', 'Days per week', { value: p.days_per_week || 4, min: 1, max: 7, format: v => `${v} day${v === '1' ? '' : 's'}` }),
        F.range('session_minutes', 'Time per session', { value: p.session_minutes || 45, min: 15, max: 120, step: 5, format: v => `${v} min` }),
        F.chips('equipment', 'Equipment you can use', choicesOf(o.equipment, 'equipment').map(([v, t]) => [v, v === 'body only' ? 'Bodyweight only' : pretty(t)]), { value: p.equipment || ['body only'] }),
        F.select('diet_pref', 'Diet', choicesOf(o.dietPrefs, 'dietPrefs'), { value: p.diet_pref, placeholder: 'Choose' }),
        F.chips('allergens', 'Allergies & intolerances', choicesOf(o.allergens, 'allergens'), { value: p.allergens }),
        F.chips('cuisines', 'Cuisines you enjoy', choicesOf(o.cuisines, 'cuisines'), { value: p.cuisines }),
        F.number('food_budget_inr_per_day', 'Daily food budget (optional)', { value: p.food_budget_inr_per_day, min: 50, max: 5000, step: 10, unit: '₹', required: false }),
      ];
      body.replaceChildren(head('Goals & training', 'This shapes your workout split, calorie target and meal plan.'), ...fields.map(f => f.el));
      state.fields = fields;
    },

    health() {
      const p = P();
      const answers = {};
      const rows = state.options.parq.map(q => {
        const seg = F.segmented(`parq-${q.id}`, q.text, [['no', 'No'], ['yes', 'Yes']], { value: 'no' });
        answers[q.id] = seg;
        const group = seg.el.querySelector('.ts-segmented');
        group.setAttribute('aria-label', q.text);
        return h('div', { class: 'o-yn' }, h('span', { text: q.text, 'aria-hidden': 'true' }), group);
      });
      const warn = note('One or more “yes” answers: we’ll keep your plans conservative. Please check with a doctor or physiotherapist before starting a new programme.', true);
      warn.hidden = true;
      const limits = F.chips('limitations', 'Injuries or conditions to work around', choicesOf(state.options.limitations, 'limitations'), { value: p.limitations });
      const group = h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: 'Health check (PAR-Q+)' }), ...rows);
      group.addEventListener('change', () => { warn.hidden = !Object.values(answers).some(s => s.get() === 'yes'); });
      body.replaceChildren(head('Health check', 'Seven yes/no questions from the PAR-Q+ screen. Your answers only change how cautious your plan is.'), group, warn, limits.el);
      state.custom = () => ({ parq: Object.fromEntries(Object.entries(answers).map(([k, s]) => [k, s.get() === 'yes'])), limitations: limits.get() });
    },

    personality() {
      const items = state.options.miniIpip.items;
      const labels = state.options.miniIpip.scale.labels;
      const answers = Array(items.length).fill(null);
      let i = 0;
      const q = h('p', { class: 'o-likert__q', id: 'o-likert-q' });
      const count = h('p', { class: 'ts-hint' });
      const scale = h('div', { class: 'o-likert__scale', role: 'radiogroup', 'aria-labelledby': 'o-likert-q' });
      const buttons = labels.map((lab, k) => {
        const b = h('button', { type: 'button', class: 'o-option', role: 'radio', 'aria-checked': 'false' }, h('strong', { text: String(k + 1) }), h('small', { text: lab }));
        b.addEventListener('click', () => {
          answers[i] = k + 1;
          if (i < items.length - 1) { i++; show(); } else { show(); form.requestSubmit(); }
        });
        return b;
      });
      scale.append(...buttons);
      const prev = h('button', { type: 'button', class: 'ts-btn ts-btn--ghost ts-btn--sm', text: 'Previous statement' });
      prev.addEventListener('click', () => { if (i > 0) { i--; show(); } });
      function show() {
        q.textContent = `“I ${items[i].text.charAt(0).toLowerCase()}${items[i].text.slice(1)}”`;
        count.textContent = `Statement ${i + 1} of ${items.length} · How accurately does this describe you?`;
        buttons.forEach((b, k) => b.setAttribute('aria-checked', String(answers[i] === k + 1)));
        prev.disabled = i === 0;
      }
      show();
      body.replaceChildren(head('Personality', 'Describe yourself as you generally are now, not as you wish to be. There are no right answers.'),
        h('div', { class: 'o-likert' }, count, q, scale, prev),
        h('p', { class: 'ts-hint', text: `Mini-IPIP (${state.options.miniIpip.citation.split('(')[0].trim()} et al., 2006), public-domain items.` }));
      state.custom = () => {
        const missing = answers.findIndex(a => a === null);
        if (missing !== -1) { i = missing; show(); throw new Error(`Please answer statement ${missing + 1}.`); }
        return { answers };
      };
    },

    interests() {
      const p = P();
      const fields = [
        F.chips('interests', 'Things you enjoy', choicesOf(state.options.interests, 'interests'), { value: p.interests }),
        F.textarea('hobbies', 'Anything else? (optional)', { value: p.hobbies, placeholder: 'e.g. weekend treks, cooking South Indian food, F1' }),
      ];
      body.replaceChildren(head('Interests', 'Shared interests make for better coaching conversations.'), ...fields.map(f => f.el));
      state.fields = fields;
    },

    coaching() {
      const p = P();
      const current = (state.role === 'trainer' ? p.coaching_style : p.style_pref) || {};
      const axes = Object.keys(L.styleAxes).map(k => {
        const [label, left, right] = L.styleAxes[k];
        return F.range(k, state.role === 'trainer' ? label.replace('for you', 'for your clients') : label, { value: current[k] || 3, min: 1, max: 5, left, right, format: v => `${v}/5` });
      });
      body.replaceChildren(head(state.role === 'trainer' ? 'Your coaching style' : 'How do you like to be coached?',
        state.role === 'trainer' ? 'Trainees answer the same four questions, so matches can compare like with like.' : 'Trainers answer the same four questions about how they coach.'), ...axes.map(a => a.el));
      state.custom = () => ({ style: Object.fromEntries(axes.map(a => [a.name, a.get()])) });
    },

    logistics() {
      const p = P();
      const o = state.options;
      const fields = [
        F.chips('modality', state.role === 'trainer' ? 'Where do you coach?' : 'Where do you want to train?', choicesOf(o.modalities, 'modalities'), { value: p.modality }),
        F.schedule('schedule', 'When are you usually free?', { value: p.schedule }),
        F.chips('languages', 'Languages', o.languages.map(l => [l, l]), { value: p.languages || ['English'] }),
      ];
      if (state.role === 'trainee') {
        fields.push(
          F.number('budget_per_session_inr', 'Budget per session', { value: p.budget_per_session_inr ?? 1000, min: 0, max: 20000, step: 50, unit: '₹' }),
          F.range('search_radius_km', 'How far will you travel?', { value: p.search_radius_km || 8, min: 1, max: 25, format: v => `${v} km` }),
          F.select('trainer_gender_pref', 'Trainer gender preference', [['female', 'Women only'], ['male', 'Men only']], { value: p.trainer_gender_pref, placeholder: 'No preference' }),
        );
      } else {
        fields.push(F.range('travel_radius_km', 'How far will you travel to clients?', { value: p.travel_radius_km || 5, min: 0, max: 50, format: v => (v === '0' ? 'Home gym only' : `${v} km`) }));
      }
      body.replaceChildren(head(state.role === 'trainer' ? 'Schedule & area' : 'Schedule & budget', 'Used to rank matches by schedule overlap, distance and price.'), ...fields.map(f => f.el));
      state.fields = fields;
      state.custom = () => {
        const out = collectFields(fields);
        if (state.role === 'trainee' && !out.trainer_gender_pref) out.trainer_gender_pref = null;
        return out;
      };
    },

    professional() {
      const p = P();
      const o = state.options;
      const fields = [
        F.number('years_experience', 'Years coaching', { value: p.years_experience, min: 0, max: 60 }),
        F.chips('specializations', 'Specialisations', choicesOf(o.goals, 'goals'), { value: p.specializations }),
        F.chips('certifications', 'Certifications', o.certifications.map(c => [c, c]), { value: p.certifications }),
        F.segmented('best_level', 'Clients you coach best', choicesOf(o.experienceLevels, 'experienceLevels'), { value: p.best_level }),
        F.number('price_per_session_inr', 'Price per session', { value: p.price_per_session_inr, min: 100, max: 20000, step: 50, unit: '₹' }),
        F.number('max_clients', 'Maximum active clients', { value: p.max_clients || 15, min: 1, max: 60 }),
        F.textarea('bio', 'Short bio', { value: p.bio, max: 1000, placeholder: 'Who you coach, how you coach, and what clients can expect.' }),
      ];
      // Home gym picker: search the gyms in the trainer's city.
      let gymId = p.home_gym_id || null;
      const search = h('input', { class: 'ts-input', type: 'search', placeholder: 'Search gyms by name', 'aria-label': 'Search gyms' });
      const list = h('div', { class: 'o-gyms', role: 'radiogroup', 'aria-label': 'Home gym' });
      let gyms = [];
      const cityKey = (o.cities.find(c => c.name === p.city) || {}).key;
      const render = () => {
        const q = search.value.trim().toLowerCase();
        const shown = gyms.filter(g => !q || g.name.toLowerCase().includes(q)).slice(0, 30);
        list.replaceChildren(...shown.map(g => {
          const b = h('button', { type: 'button', class: 'o-gym', role: 'radio', 'aria-checked': String(g.gym_id === gymId) },
            h('span', { text: g.name }), h('small', { text: g.locality || g.address || '' }));
          b.addEventListener('click', () => { gymId = g.gym_id === gymId ? null : g.gym_id; render(); });
          return b;
        }));
        if (!shown.length) list.append(h('p', { class: 'ts-hint', text: gyms.length ? 'No gyms match that search.' : 'Loading gyms…' }));
      };
      search.addEventListener('input', render);
      if (cityKey) TS.api(`/api/gyms/${encodeURIComponent(cityKey)}`).then(r => { gyms = r.ok ? r.data : []; render(); });
      render();
      const gymField = h('fieldset', { class: 'o-fieldset' }, h('legend', { class: 'ts-label', text: 'Home gym (optional)' }), search, list,
        h('p', { class: 'ts-hint', text: 'Gym listings © OpenStreetMap contributors.' }));
      body.replaceChildren(head('Your coaching', 'Trainees see this on your card. Be specific: it helps the right clients find you.'),
        h('div', { class: 'o-grid-2' }, fields[0].el, fields[3].el), fields[1].el, fields[2].el,
        h('div', { class: 'o-grid-2' }, fields[4].el, fields[5].el), fields[6].el, gymField);
      state.fields = fields;
      state.custom = () => ({ ...collectFields(fields), home_gym_id: gymId });
    },
  };

  function finish() {
    const done = h('div', { class: 'o-done' });
    const badge = h('span', { class: 'ts-badge' });
    badge.innerHTML = TS.icon('check');
    done.append(badge, h('h1', { class: 'ts-h3', text: 'You’re all set' }),
      h('p', { class: 'ts-muted', text: state.role === 'trainer' ? 'Your profile is ready. Trainees who fit how you coach will start seeing you.' : 'Your plans and matches are ready on your dashboard.' }));
    body.replaceChildren(done);
    $('[data-o-next]').textContent = 'Go to my dashboard';
    $('[data-o-skip]').hidden = true;
    $('[data-o-back]').hidden = true;
    state.custom = null;
    state.finishing = true;
    setProgress(state.steps.length, state.steps.length, 'Done');
  }

  // ------------------------------------------------------------ navigation
  const available = s => !s.requires || state.consents[s.requires];

  function setProgress(n, total, title) {
    $('[data-o-count]').textContent = `Step ${Math.min(n + 1, total)} of ${total}`;
    $('[data-o-title]').textContent = title;
    $('[data-o-bar]').style.width = `${Math.round((n / total) * 100)}%`;
  }

  function show(index) {
    // Skip steps whose consent purpose was declined.
    while (index < state.steps.length && !available(state.steps[index])) index++;
    if (index >= state.steps.length) return finish();
    state.index = index;
    state.fields = [];
    state.custom = null;
    const step = state.steps[index];
    TS.formOk(form, '');
    STEPS[step.id]();
    setProgress(index, state.steps.length, step.title);
    $('[data-o-back]').hidden = index === 0;
    $('[data-o-skip]').hidden = step.required || step.id === 'consent';
    $('[data-o-next]').textContent = step.id === 'consent' ? 'Continue with my choices' : 'Continue';
    history.replaceState(null, '', `#${step.id}`);
    const h1 = body.querySelector('h1');
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0 });
  }

  function back() {
    let i = state.index - 1;
    while (i > 0 && !available(state.steps[i])) i--;
    show(Math.max(0, i));
  }

  async function refresh() {
    const { ok, data } = await TS.api('/api/onboarding');
    if (!ok) throw new Error(data.error || 'Could not load your profile.');
    Object.assign(state, {
      steps: data.steps, role: data.role, consents: data.consents, consentDecided: data.consentDecided,
      profile: data.profile, options: data.options, policyVersion: data.policyVersion, complete: data.complete,
      currentStep: data.currentStep,
    });
    return data;
  }

  async function submit(e) {
    e.preventDefault();
    if (state.finishing) {
      TS.busy(form, true);
      const res = await TS.api('/api/onboarding/complete', { method: 'POST' });
      TS.busy(form, false);
      if (res.ok) return location.assign(res.data.next);
      const missing = (res.data.missing || [])[0];
      TS.formError(form, res.data, 'Please finish the required steps.');
      state.finishing = false;
      $('[data-o-back]').hidden = false;
      if (missing) show(state.steps.findIndex(s => s.id === missing));
      return undefined;
    }
    const step = state.steps[state.index];
    let payload;
    try {
      payload = collect();
    } catch (err) {
      return TS.formError(form, null, err.message);
    }
    TS.busy(form, true);
    const res = step.id === 'consent'
      ? await TS.api('/api/onboarding/consent', { method: 'PUT', body: payload })
      : await TS.api(`/api/onboarding/steps/${step.id}`, { method: 'PATCH', body: payload });
    TS.busy(form, false);
    if (!res.ok) {
      TS.formError(form, res.data, 'Please check this step.');
      const field = res.data.details && res.data.details[0] && res.data.details[0].field.split('.')[0];
      const el = field && body.querySelector(`[name="${CSS.escape(field)}"], [data-field="${CSS.escape(field)}"]`);
      if (el) { el.setAttribute('aria-invalid', 'true'); (el.focus ? el : el.querySelector('button')).focus(); }
      return undefined;
    }
    await refresh();
    if (res.data.flagged) TS.toast('Thanks. Your plans will stay conservative. Please check with a doctor before starting.', { type: 'gold', timeout: 7000 });
    show(state.index + 1);
    return undefined;
  }

  // ------------------------------------------------------------ boot
  (async () => {
    await TS.requireLogin();
    try {
      await refresh();
    } catch (err) {
      body.replaceChildren(h('p', { class: 'ts-form-error', text: err.message }));
      return;
    }
    if (state.complete && !location.hash) {
      // Already done: this page doubles as "edit my profile".
      $('[data-o-count]').textContent = 'Edit profile';
    }
    form.addEventListener('submit', submit);
    $('[data-o-back]').addEventListener('click', back);
    $('[data-o-skip]').addEventListener('click', () => show(state.index + 1));
    // Resume: consent first; then a #step link, or where the user left off
    // (currentStep = steps saved so far). A finished profile opens at step 1
    // (this page doubles as "edit my profile").
    const fromHash = state.steps.findIndex(s => s.id === location.hash.slice(1));
    let start = 0;
    if (state.consentDecided) {
      if (fromHash > 0) start = fromHash;
      else if (state.complete) start = 1;
      else start = Math.max(1, Math.min(state.currentStep, state.steps.length - 1));
    }
    show(start);
  })();
})();
