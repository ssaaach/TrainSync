// Shared page chrome for every v3 page: role-aware nav, footer with data
// attributions, the fixed smoke-video background, scroll reveal and toasts.
// Requires common.js (window.TS). Pages opt in with:
//   <body data-page="landing">  <header data-ts-nav></header> … <footer data-ts-footer></footer>
(function () {
  const TS = window.TS;
  const esc = TS.escapeHTML;
  const icon = (name, cls = 'ts-icon') => `<svg class="${cls}" aria-hidden="true"><use href="/icons.svg#i-${name}"></use></svg>`;
  TS.icon = icon;

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ toasts
  function toast(message, { type = 'info', timeout = 4200 } = {}) {
    let host = document.querySelector('.ts-toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'ts-toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `ts-toast ts-toast--${type}`;
    const ic = { success: 'check', error: 'info', gold: 'spark', info: 'info' }[type] || 'info';
    el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), timeout);
    return el;
  }
  TS.toast = toast;

  // ------------------------------------------------------------ background video
  // Poster first (it is frame 0); the video only loads for visitors without
  // reduced-motion or data-saver preferences and on reasonably fast networks.
  function wantsVideo() {
    if (reducedMotion()) return false;
    const c = navigator.connection;
    if (c && (c.saveData || ['slow-2g', '2g', '3g'].includes(c.effectiveType))) return false;
    return true;
  }

  function mountBackground() {
    if (document.body.dataset.bg === 'none') return;
    let bg = document.querySelector('.ts-bg');
    if (!bg) {
      bg = document.createElement('div');
      bg.className = 'ts-bg';
      bg.setAttribute('aria-hidden', 'true');
      document.body.prepend(bg);
    }
    const variant = () => (window.innerWidth / window.innerHeight > 0.8 ? 'smoke-wide' : 'smoke-tall');
    let current = null;

    function render() {
      const v = variant();
      if (v === current) return;
      current = v;
      const poster = `/media/${v}.webp`;
      if (!wantsVideo()) {
        bg.innerHTML = `<img src="${poster}" alt="" decoding="async">`;
        bg.dataset.mode = 'poster';
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('preload', 'auto');
      video.poster = poster;
      video.innerHTML = `<source src="/media/${v}.webm" type="video/webm"><source src="/media/${v}.mp4" type="video/mp4">`;
      bg.replaceChildren(video);
      bg.dataset.mode = 'video';
      video.play().catch(() => { /* autoplay blocked: the poster stays */ });
    }

    render();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 250); });
  }

  // ------------------------------------------------------------ nav
  const PUBLIC_LINKS = [
    { href: '/homepage.html#features', label: 'Features', id: 'features' },
    { href: '/homepage.html#how', label: 'How it works', id: 'how' },
    { href: '/gyms.html', label: 'Gyms', id: 'gyms' },
  ];
  const TRAINEE_LINKS = [
    { href: '/homepage1.html', label: 'Dashboard', id: 'dashboard' },
    { href: '/trainermatch.html', label: 'Trainers', id: 'trainermatch' },
    { href: '/workoutplans.html', label: 'Workouts', id: 'workoutplans' },
    { href: '/dietplans.html', label: 'Diet', id: 'dietplans' },
    { href: '/gyms.html', label: 'Gyms', id: 'gyms' },
  ];
  const TRAINER_LINKS = [
    { href: '/homepage1.html', label: 'Dashboard', id: 'dashboard' },
    { href: '/trainermatch.html', label: 'Requests', id: 'trainermatch' },
    { href: '/gyms.html', label: 'Gyms', id: 'gyms' },
  ];

  function linksFor(session) {
    if (!session.loggedIn) return PUBLIC_LINKS;
    return session.role === 'trainer' ? TRAINER_LINKS : TRAINEE_LINKS;
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  }

  function navHTML(session, page) {
    const links = linksFor(session);
    const current = id => (id === page ? ' aria-current="page"' : '');
    const list = links.map(l => `<li><a href="${l.href}"${current(l.id)}>${esc(l.label)}</a></li>`).join('');
    const actions = session.loggedIn
      ? `<a class="ts-icon-btn ts-nav__bell" href="/homepage1.html#notifications" aria-label="Notifications" data-ts-bell>${icon('bell')}</a>
         <div class="ts-usermenu">
           <button class="ts-btn ts-btn--dark ts-btn--sm" type="button" aria-expanded="false" aria-haspopup="true" data-ts-usermenu>
             <span class="ts-avatar ts-avatar--xs" aria-hidden="true">${esc(initials(session.name))}</span>
             <span>${esc(String(session.name || '').split(' ')[0])}</span>
           </button>
           <div class="ts-usermenu__panel" hidden>
             <div class="ts-usermenu__who"><div>${esc(session.name)}</div><div class="ts-dim">${esc(session.email)}</div></div>
             <a href="/homepage1.html">${icon('chart')}Dashboard</a>
             <a href="/onboarding.html">${icon('user')}Profile</a>
             <a href="/homepage1.html#privacy">${icon('shield')}Privacy &amp; data</a>
             <button type="button" data-ts-logout>${icon('logout')}Log out</button>
           </div>
         </div>`
      : `<a class="ts-btn ts-btn--ghost ts-btn--sm" href="/login.html" data-ts-login>Log in</a>
         <a class="ts-btn ts-btn--gold ts-btn--sm" href="/registration.html">Get started</a>`;
    const mobileActions = session.loggedIn
      ? `<a href="/onboarding.html">Profile</a><a href="/homepage1.html#privacy">Privacy &amp; data</a>
         <button class="ts-btn ts-btn--ghost ts-btn--block" type="button" data-ts-logout>Log out</button>`
      : `<a class="ts-btn ts-btn--ghost ts-btn--block" href="/login.html">Log in</a>
         <a class="ts-btn ts-btn--gold ts-btn--block" href="/registration.html">Get started</a>`;
    return `
      <nav class="ts-nav" aria-label="Main">
        <div class="ts-container ts-container--wide ts-nav__inner">
          <a class="ts-logo" href="${session.loggedIn ? '/homepage1.html' : '/homepage.html'}" aria-label="TrainSync home">
            <img src="/webicon1.png" alt="" width="40" height="40"><span>Train<b>Sync</b></span>
          </a>
          <ul class="ts-nav__links">${list}</ul>
          <div class="ts-nav__actions">${actions}</div>
          <button class="ts-icon-btn ts-nav__toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="ts-menu" data-ts-menu-toggle>${icon('menu')}</button>
        </div>
      </nav>
      <div class="ts-menu" id="ts-menu" hidden>
        ${links.map(l => `<a href="${l.href}"${current(l.id)}>${esc(l.label)}</a>`).join('')}
        ${mobileActions}
      </div>`;
  }

  function wireNav(root) {
    const nav = root.querySelector('.ts-nav');
    const menu = root.querySelector('.ts-menu');
    const toggle = root.querySelector('[data-ts-menu-toggle]');

    toggle.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      toggle.innerHTML = icon(open ? 'close' : 'menu');
    });
    menu.addEventListener('click', e => { if (e.target.closest('a')) toggle.click(); });

    const um = root.querySelector('[data-ts-usermenu]');
    if (um) {
      const panel = um.nextElementSibling;
      um.addEventListener('click', e => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        um.setAttribute('aria-expanded', String(!panel.hidden));
      });
      document.addEventListener('click', e => { if (!panel.contains(e.target)) { panel.hidden = true; um.setAttribute('aria-expanded', 'false'); } });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { panel.hidden = true; um.setAttribute('aria-expanded', 'false'); } });
    }
    root.querySelectorAll('[data-ts-logout]').forEach(b => b.addEventListener('click', () => TS.logout('/homepage.html')));

    // Glass after a little scroll; hide on scroll down, show on scroll up.
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 24);
      nav.classList.toggle('is-hidden', y > last && y > 240 && menu.hidden);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ------------------------------------------------------------ footer
  const FOOTER = `
    <div class="ts-container ts-container--wide">
      <div class="ts-footer__grid">
        <div>
          <a class="ts-logo" href="/homepage.html"><img src="/webicon1.png" alt="" width="40" height="40"><span>Train<b>Sync</b></span></a>
          <p class="ts-footer__about">Fitness that fits: the right trainer, a plan built for your body, and gyms near you, all in one place.</p>
          <div class="ts-footer__social">
            <a class="ts-icon-btn ts-icon-btn--sm" href="https://www.instagram.com/sachin._1275/?hl=en" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>
            <a class="ts-icon-btn ts-icon-btn--sm" href="mailto:sachin.mitblr2023@learner.manipal.edu" aria-label="Email">${icon('mail')}</a>
            <a class="ts-icon-btn ts-icon-btn--sm" href="https://www.linkedin.com/in/sachin-bhat-98397b2a0/" target="_blank" rel="noopener" aria-label="LinkedIn">${icon('linkedin')}</a>
          </div>
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <ul>
            <li><a href="/trainermatch.html">Trainer match</a></li>
            <li><a href="/workoutplans.html">Workout plans</a></li>
            <li><a href="/dietplans.html">Diet plans</a></li>
            <li><a href="/gyms.html">Gym finder</a></li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <h2>Trust</h2>
          <ul>
            <li><a href="/privacy.html">Privacy &amp; consent</a></li>
            <li><a href="/privacy.html#your-rights">Your data rights</a></li>
            <li><a href="/privacy.html#safety">Safety &amp; reporting</a></li>
            <li><a href="/homepage.html#how">How matching works</a></li>
          </ul>
        </nav>
        <div>
          <h2>Data sources</h2>
          <p class="ts-footer__attrib">
            Map data &amp; gym listings © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL).
            Exercises &amp; images: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain).
            Nutrients: <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener">USDA FoodData Central</a> (CC0).
            Personality items: <a href="https://ipip.ori.org/" target="_blank" rel="noopener">IPIP</a> / Mini-IPIP (public domain).
            Poppins font (SIL OFL).
          </p>
        </div>
      </div>
      <div class="ts-footer__base">
        <span>© <span data-ts-year></span> TrainSync. Body-composition figures are estimates, not medical advice.</span>
        <a href="/privacy.html">Privacy policy</a>
      </div>
    </div>`;

  // ------------------------------------------------------------ scroll reveal
  function reveal() {
    const els = document.querySelectorAll('.ts-reveal');
    if (reducedMotion() || !('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(el => io.observe(el));
  }

  // ------------------------------------------------------------ boot
  async function init() {
    document.documentElement.classList.remove('ts-no-js');
    mountBackground();
    const page = document.body.dataset.page || '';
    const footer = document.querySelector('[data-ts-footer]');
    if (footer) {
      footer.classList.add('ts-footer');
      footer.innerHTML = FOOTER;
      footer.querySelector('[data-ts-year]').textContent = new Date().getFullYear();
    }
    reveal();
    const header = document.querySelector('[data-ts-nav]');
    const session = await TS.getSession();
    if (header) {
      header.innerHTML = navHTML(session, page);
      wireNav(header);
    }
    document.dispatchEvent(new CustomEvent('ts:ready', { detail: { session } }));
  }

  TS.layoutReady = new Promise(resolve => document.addEventListener('ts:ready', e => resolve(e.detail), { once: true }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
