// gyms.html — city search or "near me", Leaflet map synced with the list,
// Google Maps directions per gym. Gym data © OpenStreetMap contributors.
(function () {
  const TS = window.TS;
  const $ = s => document.querySelector(s);
  const list = $('[data-g-list]');
  const form = $('[data-g-form]');
  const err = $('#errorMessage');
  const radius = $('[data-g-radius]');
  let map = null;
  let layer = null;
  const markers = new Map();

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

  function ensureMap() {
    if (map) return map;
    map = window.L.map($('[data-g-map]'), { scrollWheelZoom: false }).setView([20.6, 78.9], 5);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = window.L.layerGroup().addTo(map);
    return map;
  }

  const pin = cls => window.L.divIcon({ className: '', html: `<span class="g-pin ${cls || ''}"></span>`, iconSize: [14, 14] });

  function highlight(id, on) {
    const m = markers.get(id);
    if (m) m.getElement() && m.getElement().querySelector('.g-pin').classList.toggle('is-active', on);
    const c = document.querySelector(`.gym-card[data-gym="${id}"]`);
    if (c) c.classList.toggle('is-active', on);
  }

  function render(gyms, center) {
    ensureMap();
    layer.clearLayers();
    markers.clear();
    list.replaceChildren(h('p', { class: 'g-count', text: `${gyms.length} gym${gyms.length === 1 ? '' : 's'} found` }));
    if (!gyms.length) { list.append(h('div', { class: 'gym-card ts-glass' }, h('p', { text: 'No gyms found here. Try a bigger radius or another city.' }))); return; }
    const pts = [];
    if (center) {
      window.L.marker([center.lat, center.lng], { icon: pin('g-pin--me'), title: 'You', keyboard: false }).addTo(layer);
      pts.push([center.lat, center.lng]);
    }
    for (const g of gyms) {
      const card = h('article', { class: 'gym-card ts-glass', 'data-gym': g.gym_id, tabindex: '-1' },
        h('h3', {}, g.name, g.distance_km != null ? h('span', { text: `${g.distance_km} km` }) : null),
        g.address ? h('p', { text: g.address }) : g.locality ? h('p', { text: `${g.locality}, ${g.city}` }) : h('p', { text: g.city }),
        g.opening_hours ? h('p', { text: `Hours: ${g.opening_hours}` }) : null,
        g.phone ? h('p', {}, 'Phone: ', h('a', { href: `tel:${g.phone.replace(/[^\d+]/g, '')}`, text: g.phone })) : null,
        (g.amenities || []).length ? h('p', { text: g.amenities.slice(0, 5).map(a => a.replace(/_/g, ' ')).join(' · ') }) : null,
        h('div', { class: 'g-actions' },
          g.links ? h('a', { class: 'ts-btn ts-btn--gold ts-btn--sm', href: g.links.directions, target: '_blank', rel: 'noopener', text: 'Directions ↗' }) : null,
          g.links ? h('a', { class: 'ts-btn ts-btn--ghost ts-btn--sm', href: g.links.google, target: '_blank', rel: 'noopener', text: 'Google Maps ↗' }) : (g.maps_url ? h('a', { class: 'ts-btn ts-btn--ghost ts-btn--sm', href: TS.safeUrl(g.maps_url), target: '_blank', rel: 'noopener', text: 'View location ↗' }) : null),
          g.website ? h('a', { class: 'ts-btn ts-btn--ghost ts-btn--sm', href: TS.safeUrl(g.website), target: '_blank', rel: 'noopener', text: 'Website ↗' }) : null));
      list.append(card);
      if (g.lat != null && g.lng != null) {
        const m = window.L.marker([g.lat, g.lng], { icon: pin(), title: g.name, keyboard: false }).addTo(layer);
        m.on('click', () => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.focus({ preventScroll: true }); highlight(g.gym_id, true); setTimeout(() => highlight(g.gym_id, false), 1500); });
        markers.set(g.gym_id, m);
        pts.push([g.lat, g.lng]);
        card.addEventListener('mouseenter', () => highlight(g.gym_id, true));
        card.addEventListener('mouseleave', () => highlight(g.gym_id, false));
      }
    }
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }

  async function byCity(city) {
    err.textContent = '';
    const { ok, data } = await TS.api(`/api/gyms/${encodeURIComponent(city)}`);
    if (!ok) { err.textContent = data.error || 'Search failed.'; return; }
    render(data);
  }

  let last = null;
  async function near(lat, lng) {
    last = { lat, lng };
    const { ok, data } = await TS.api(`/api/gyms/near?lat=${lat}&lng=${lng}&radius_km=${radius.value}&limit=100`);
    if (!ok) { err.textContent = data.error || 'Search failed.'; return; }
    render(data.gyms, { lat, lng });
  }

  form.addEventListener('submit', e => { e.preventDefault(); const c = form.city.value.trim(); if (c) byCity(c); });
  radius.addEventListener('input', () => { $('[data-g-radius-out]').textContent = `${radius.value} km`; });
  radius.addEventListener('change', () => { if (last) near(last.lat, last.lng); });
  $('[data-g-near]').addEventListener('click', () => {
    err.textContent = '';
    if (!navigator.geolocation) { err.textContent = 'Your browser can’t share location. Search by city instead.'; return; }
    navigator.geolocation.getCurrentPosition(p => near(p.coords.latitude, p.coords.longitude),
      () => { err.textContent = 'Location wasn’t shared. Search by city instead.'; }, { timeout: 10000, maximumAge: 600000 });
  });

  document.addEventListener('DOMContentLoaded', async () => {
    ensureMap();
    const q = new URLSearchParams(location.search).get('city');
    if (q) { form.city.value = q; byCity(q); return; }
    const session = await TS.getSession();
    if (session.loggedIn) {
      const r = await TS.api('/api/dashboard');
      if (r.ok && r.data.location) near(r.data.location.lat, r.data.location.lng);
      else if (r.ok && r.data.city) { form.city.value = r.data.city; byCity(r.data.city); }
    }
  });
})();
