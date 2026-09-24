// homepage.html — live stats, how-it-works carousel, lazy feature video and
// the Gym Finder mini map (Leaflet is loaded only when the card is near view).
(function () {
  const TS = window.TS;

  // ------------------------------------------------------------ live stats
  const roundDown = (n, step) => (n >= step ? `${Math.floor(n / step) * step}+` : String(n));
  async function loadStats() {
    const { ok, data } = await TS.api('/api/stats');
    if (!ok) return;
    const values = {
      gyms: roundDown(data.gyms, 50),
      cities: String(data.cities),
      exercises: roundDown(data.exercises, 10),
      dishes: roundDown(data.dishes, 10),
    };
    document.querySelectorAll('[data-stat]').forEach(el => {
      const v = values[el.dataset.stat];
      if (v) el.textContent = v;
    });
  }

  // ------------------------------------------------------------ carousel
  function carousel() {
    const track = document.getElementById('how-track');
    if (!track) return;
    const step = () => {
      const first = track.querySelector('.l-step');
      return first ? first.getBoundingClientRect().width + 16 : 300;
    };
    const prev = document.querySelector('[data-carousel-prev]');
    const next = document.querySelector('[data-carousel-next]');
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: smooth }));
    next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: smooth }));
    const update = () => {
      prev.disabled = track.scrollLeft < 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    track.addEventListener('scroll', update, { passive: true });
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); }
    });
    window.addEventListener('resize', update);
    update();
  }

  // ------------------------------------------------------------ lazy things
  function whenNear(el, fn, margin = '300px') {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: margin });
    io.observe(el);
  }

  function lazyVideos() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const c = navigator.connection;
    if (reduce || (c && (c.saveData || ['slow-2g', '2g', '3g'].includes(c.effectiveType)))) return; // poster only
    document.querySelectorAll('video[data-lazy-video]').forEach(video => whenNear(video, () => {
      video.querySelectorAll('source[data-src]').forEach(s => { s.src = s.dataset.src; });
      video.load();
      video.play().catch(() => {});
    }));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function miniMap() {
    const el = document.querySelector('[data-minimap]');
    whenNear(el, async () => {
      try {
        loadCss('/vendor/leaflet/leaflet.css');
        await loadScript('/vendor/leaflet/leaflet.js');
        const lat = Number(el.dataset.lat);
        const lng = Number(el.dataset.lng);
        el.replaceChildren();
        const map = window.L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !window.matchMedia('(pointer: coarse)').matches, attributionControl: true })
          .setView([lat, lng], 13);
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        const icon = window.L.divIcon({ className: '', html: '<span class="l-pin"></span>', iconSize: [14, 14] });
        const { ok, data } = await TS.api(`/api/gyms/near?lat=${lat}&lng=${lng}&radius_km=4&limit=40`);
        if (ok) {
          for (const g of data.gyms) {
            window.L.marker([g.lat, g.lng], { icon, title: g.name, keyboard: false }).addTo(map);
          }
        }
      } catch {
        /* the placeholder image stays; the card still links to /gyms.html */
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    carousel();
    lazyVideos();
    miniMap();
  });
})();
