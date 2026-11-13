// Alpendre — multi-house dashboard
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SOURCES = { airbnb: 'Airbnb', booking: 'Booking.com', website: 'Website', manual: 'Manual' };
const CHANNELS = ['airbnb', 'booking', 'website'];
const COLORS = ['#c4622d', '#6b7f4e', '#2f6f8f', '#8a5a9e', '#c9902a', '#a2423d', '#3f7a6b', '#5b6170'];
const S = { state: null, route: { name: 'home' }, month: null, tlStart: null, chTab: 'widget',
  filter: { q: '', source: 'all', status: 'active', when: 'upcoming' } };

// ---------- dates & format ----------
const D = s => new Date(s + 'T00:00:00Z');
const F = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return F(d); };
const nightsOf = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = s => { const d = D(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const range = r => `${short(r.checkIn)} → ${short(r.checkOut)}`;
const money = (n, cur = 'EUR') => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const monthStart = s => s.slice(0, 8) + '01';
const nextMonth = s => { const d = D(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); return F(d); };

// ---------- api ----------
// config.js sets window.ALPENDRE_API when the dashboard is hosted apart from the API (GitHub Pages).
const API = String(window.ALPENDRE_API || '').replace(/\/$/, '');
const API_ORIGIN = API || location.origin;
let TOKEN = ''; try { TOKEN = localStorage.getItem('alp_token') || ''; } catch { /* storage blocked */ }
function setToken(t) { TOKEN = t; try { t ? localStorage.setItem('alp_token', t) : localStorage.removeItem('alp_token'); } catch { /* ignore */ } }
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw new Error('Cannot reach the Alpendre server'); }
  if (res.status === 401 && path !== '/api/login') { setToken(''); showLogin(); throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.errors || []).join(' ') || 'Request failed');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }
async function refresh() { S.state = await api('/api/state'); render(); }

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { const d = await api('/api/login', { method: 'POST', body: { password: e.target.password.value } }); setToken(d.token); $('#login').hidden = true; $('#app').hidden = false; await refresh(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* already signed out */ } setToken(''); showLogin(); });

// ---------- data helpers ----------
const houses = () => S.state.workspaces;
const houseById = id => houses().find(w => w.id === id);
const resOf = hid => S.state.reservations.filter(r => !hid || r.workspaceId === hid);
const live = hid => resOf(hid).filter(r => r.status !== 'cancelled');
const stays = hid => live(hid).filter(r => r.status !== 'blocked');
const nightsIn = (r, from, to) => Math.max(0, nightsOf(r.checkIn > from ? r.checkIn : from, r.checkOut < to ? r.checkOut : to));
const bookedNights = (hid, from, to) => live(hid).reduce((n, r) => n + nightsIn(r, from, to), 0);
const guestLabel = r => r.guestName || `${SOURCES[r.source]} guest`;
function channelState(w, c) {
  const ch = w.channels[c];
  if (c === 'website' && !ch.url) return w.websiteBookings ? 'on' : 'off'; // widget/API counts as connected
  if (!ch.url) return 'off';
  return (ch.lastStatus || '').startsWith('error') ? 'err' : 'on';
}

// ---------- router ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/');
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'h' && parts[1]) return { name: 'house', hid: parts[1], view: parts[2] || 'overview' };
  return { name: 'home' };
}
window.addEventListener('hashchange', () => { const prev = S.route.hid; S.route = parseRoute(); if (S.route.hid !== prev) S.month = null; render(); window.scrollTo(0, 0); });
const HOUSE_VIEWS = { overview: 'Overview', calendar: 'Calendar', reservations: 'Reservations', channels: 'Connections', settings: 'House settings' };

function render() {
  if (!S.state) return;
  const r = S.route;
  if (r.name === 'house' && (!houseById(r.hid) || !HOUSE_VIEWS[r.view])) { location.hash = '#/'; return; }
  renderSide();
  const pending = live().filter(x => x.status === 'pending').length;
  $('#pendingBadge').hidden = !pending; $('#pendingBadge').textContent = pending;
  let title, sub = '', crumb = '', html;
  if (r.name === 'home') {
    title = 'All houses'; sub = greeting(); html = viewHome();
  } else if (r.name === 'settings') {
    title = 'Settings'; sub = 'Applies to every house.'; html = viewSettings();
  } else {
    const w = houseById(r.hid);
    crumb = `<a href="#/">All houses</a> / <span class="dot" style="background:${w.color}"></span>${esc(w.name)}`;
    title = r.view === 'overview' ? esc(w.name) : HOUSE_VIEWS[r.view];
    sub = { overview: esc(w.location || ''), calendar: 'Every channel on one calendar. Click a stay to open it, or a day to add one.',
      reservations: 'Stays from Airbnb, Booking.com, your website and manual entries.',
      channels: 'Connect Airbnb, Booking.com and your website so the calendars stay in sync.',
      settings: 'Details and the rules your website uses to take bookings.' }[r.view];
    html = HOUSE[r.view](w);
  }
  $('#crumb').innerHTML = crumb; $('#crumb').hidden = !crumb;
  $('#viewTitle').innerHTML = title; $('#viewSub').innerHTML = sub;
  $('#newBtn').hidden = r.name === 'settings' || !houses().length;
  $('#view').innerHTML = html;
  (AFTER[r.name === 'house' ? r.view : r.name] || (() => {}))();
}
function greeting() {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening'}. ${houses().length} ${houses().length === 1 ? 'house' : 'houses'} on the porch.`;
}
function renderSide() {
  const r = S.route;
  $$('.side nav a[data-nav]').forEach(a => a.classList.toggle('active', r.name === 'home'));
  $('#houseNav').innerHTML = houses().map(w => {
    const on = r.hid === w.id;
    const issues = live(w.id).some(x => x.conflicts.length) || CHANNELS.some(c => channelState(w, c) === 'err');
    return `<a class="house ${on ? 'active' : ''}" href="#/h/${w.id}/overview"><span class="dot" style="background:${w.color}"></span>${esc(w.name)}${issues ? '<span class="warn-dot" title="Needs attention">⚠</span>' : ''}</a>
      ${on ? `<div class="subnav">${Object.entries(HOUSE_VIEWS).map(([k, v]) => `<a href="#/h/${w.id}/${k}" class="${r.view === k ? 'active' : ''}">${v}</a>`).join('')}</div>` : ''}`;
  }).join('');
  // compact nav for phones
  $('#mnav').innerHTML = `<a href="#/" class="${r.name === 'home' ? 'active' : ''}">Houses</a>` +
    (r.name === 'house' ? Object.entries(HOUSE_VIEWS).map(([k, v]) => `<a href="#/h/${r.hid}/${k}" class="${r.view === k ? 'active' : ''}">${v}</a>`).join('') : '') +
    `<a href="#/settings" class="${r.name === 'settings' ? 'active' : ''}">Settings</a>`;
}

// ---------- home ----------
function viewHome() {
  const t = S.state.today, t30 = add(t, 30), t7 = add(t, 7);
  const list = houses();
  if (!list.length) return `<div class="card" style="text-align:center;padding:3rem 1rem"><img src="logo.svg" width="56" height="56" alt=""><h2 style="margin:1rem 0 .5rem">Add your first house</h2>
    <p class="sub" style="margin-bottom:1.2rem">Each house is a workspace with its own Airbnb, Booking.com and website connections.</p><button class="btn primary" data-act="add-house">+ Add a house</button></div>`;
  const occ = Math.round(list.reduce((n, w) => n + bookedNights(w.id, t, t30), 0) / (list.length * 30) * 100);
  const arrivals = stays().filter(r => r.checkIn >= t && r.checkIn < t7).length;
  const pending = live().filter(r => r.status === 'pending');
  const conflicts = new Set(live().filter(r => r.conflicts.length).map(r => r.workspaceId));

  const cards = list.map(w => {
    const mS = monthStart(t), mE = nextMonth(t), days = nightsOf(mS, mE);
    const o = Math.round(bookedNights(w.id, mS, mE) / days * 100);
    const inHouse = stays(w.id).find(r => r.checkIn <= t && r.checkOut > t);
    const next = stays(w.id).filter(r => r.checkIn > t).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    const pend = live(w.id).filter(r => r.status === 'pending').length;
    return `<div class="hcard" data-go="#/h/${w.id}/overview"><div class="strip" style="background:${w.color}"></div><div class="in">
      <div><h3>${esc(w.name)}</h3><div class="loc">${esc(w.location || 'No location set')}</div></div>
      <div class="conn">${CHANNELS.map(c => `<span class="${channelState(w, c)}" title="${SOURCES[c]}: ${channelState(w, c) === 'on' ? 'connected' : channelState(w, c) === 'err' ? 'sync error' : 'not connected'}">${SOURCES[c]}</span>`).join('')}</div>
      <div class="stats"><div><b>${o}%</b><span>booked in ${MONTHS[D(t).getUTCMonth()]}</span></div><div><b>${inHouse ? 'Occupied' : 'Free'}</b><span>tonight</span></div></div>
      <div class="next">${next ? `Next: <b>${esc(guestLabel(next))}</b> · ${short(next.checkIn)}` : 'No upcoming arrivals'}</div>
      ${conflicts.has(w.id) ? '<div class="flag">⚠ Double booking</div>' : pend ? `<div class="flag" style="color:#b0700c">${pend} website request${pend > 1 ? 's' : ''} waiting</div>` : ''}
    </div></div>`;
  }).join('') + `<div class="hcard new" data-act="add-house">+ Add a house</div>`;

  // moves next 7 days across houses
  const moves = [];
  for (const r of stays()) {
    if (r.checkIn >= t && r.checkIn < t7) moves.push({ d: r.checkIn, type: 'in', r });
    if (r.checkOut >= t && r.checkOut < t7) moves.push({ d: r.checkOut, type: 'out', r });
  }
  moves.sort((a, b) => a.d.localeCompare(b.d) || (a.type === 'out' ? -1 : 1));

  return `
    <div class="grid kpis five">
      <div class="card kpi"><div class="label">Houses</div><div class="value">${list.length}</div><div class="hint">${list.filter(w => CHANNELS.every(c => channelState(w, c) === 'on')).length} fully connected</div></div>
      <div class="card kpi"><div class="label">Booked · next 30 days</div><div class="value">${occ}%</div><div class="meter"><span style="width:${occ}%"></span></div></div>
      <div class="card kpi"><div class="label">Arrivals · 7 days</div><div class="value">${arrivals}</div><div class="hint">across all houses</div></div>
      <div class="card kpi"><div class="label">Website requests</div><div class="value">${pending.length}</div><div class="hint">${pending.length ? 'waiting for you' : 'all answered'}</div></div>
      <div class="card kpi"><div class="label">Double bookings</div><div class="value" style="${conflicts.size ? 'color:var(--danger)' : ''}">${conflicts.size}</div><div class="hint">${conflicts.size ? 'houses affected' : 'none, all clear'}</div></div>
    </div>
    <div class="grid house-cards">${cards}</div>
    <div class="card" style="margin-top:1rem">${timeline()}</div>
    <div class="grid two">
      <div class="card"><h2>Coming and going <small>next 7 days</small></h2>${movesList(moves, true)}</div>
      <div class="card"><h2>Needs attention</h2>${alerts(null) || '<p class="empty">Nothing to do. Enjoy the porch.</p>'}</div>
    </div>`;
}

function timeline() {
  const t = S.state.today;
  if (!S.tlStart) S.tlStart = add(t, -2);
  const N = 28, start = S.tlStart, end = add(start, N);
  let head = '<div class="hcell" style="border-top:0;cursor:default;font-weight:500;color:var(--muted);font-size:.75rem">' + D(start).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + '</div>';
  for (let i = 0; i < N; i++) {
    const d = add(start, i), dow = D(d).getUTCDay();
    head += `<div class="dh ${d === t ? 'today' : ''} ${dow === 0 || dow === 6 ? 'wknd' : ''}">${'SMTWTFS'[dow]}<b>${D(d).getUTCDate()}</b></div>`;
  }
  const todayIdx = nightsOf(start, t);
  const rows = houses().map(w => {
    const segs = live(w.id).filter(r => r.checkIn < end && r.checkOut > start).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const lanes = []; let bars = '';
    for (const r of segs) {
      const s = Math.max(0, nightsOf(start, r.checkIn)), e = Math.min(N, nightsOf(start, r.checkOut));
      let lane = lanes.findIndex(x => x <= s); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = e;
      bars += `<div class="bar ${barClass(r, r.checkIn < start, r.checkOut > end)}" data-open="${r.id}" title="${esc(guestLabel(r))} · ${SOURCES[r.source]} · ${range(r)}" style="grid-column:${s + 1}/${e + 1};grid-row:${lane + 1}">${esc(guestLabel(r))}</div>`;
    }
    const line = todayIdx >= 0 && todayIdx < N ? `<div class="today-line" style="left:calc(${todayIdx} * 100% / ${N})"></div>` : '';
    return `<div class="hcell" data-go="#/h/${w.id}/calendar"><span class="dot" style="background:${w.color}"></span>${esc(w.name)}</div><div class="row">${line}${bars}</div>`;
  }).join('');
  return `<div class="tl-head"><h2>Timeline <small style="font-family:var(--sans);font-size:.8rem;color:var(--muted);font-weight:500">all houses</small></h2>
      <div class="legend" style="margin:0 .5rem 0 0">${Object.keys(SOURCES).map(s => `<span class="chip ${s}">${SOURCES[s]}</span>`).join('')}</div>
      <button class="btn small" data-tl="-14">←</button><button class="btn small" data-tl="0">Today</button><button class="btn small" data-tl="14">→</button></div>
    <div class="tl-scroll"><div class="tl" style="--days:${N}">${head}${rows}</div></div>`;
}
const barClass = (r, contL, contR) => [r.source, r.status === 'pending' && 'pending', r.status === 'blocked' && 'blocked', r.conflicts.length && 'conflict', contL && 'cont-l', contR && 'cont-r'].filter(Boolean).join(' ');

function movesList(moves, showHouse) {
  if (!moves.length) return '<p class="empty">No arrivals or departures.</p>';
  return `<ul class="moves">${moves.map(m => {
    const d = D(m.d), w = houseById(m.r.workspaceId);
    return `<li data-open="${m.r.id}"><div class="datebox"><div class="d">${d.getUTCDate()}</div><div class="m">${MONTHS[d.getUTCMonth()]}</div></div>
      <div><div class="who">${m.r.guestName ? esc(m.r.guestName) : `<span class="missing">${SOURCES[m.r.source]} guest</span>`}</div>
      <div class="what">${showHouse ? `<span class="dot" style="background:${w.color};display:inline-block;vertical-align:middle;margin-right:.3rem"></span>${esc(w.name)} · ` : ''}${m.type === 'in' ? `Check-in ${esc(w.checkInTime)} · ${nightsOf(m.r.checkIn, m.r.checkOut)} nights` : `Check-out ${esc(w.checkOutTime)} · clean up`}</div></div>
      <div style="display:flex;gap:.4rem;align-items:center"><span class="chip ${m.r.source}">${SOURCES[m.r.source]}</span><span class="tag ${m.type}">${m.type === 'in' ? 'Arrives' : 'Leaves'}</span></div></li>`;
  }).join('')}</ul>`;
}

function alerts(hid) {
  const t = S.state.today, out = [];
  const scope = hid ? [houseById(hid)] : houses();
  const name = w => hid ? '' : `<b>${esc(w.name)}:</b> `;
  for (const w of scope) {
    const c = live(w.id).filter(r => r.conflicts.length);
    if (c.length) out.push(`<div class="alert bad" data-go="#/h/${w.id}/calendar"><span>${name(w)}<b>Double booking.</b> ${c.length} stays overlap. Cancel one on its channel.</span></div>`);
    for (const r of live(w.id).filter(r => r.status === 'pending')) out.push(`<div class="alert warn" data-open="${r.id}"><span>${name(w)}<b>${esc(r.guestName)}</b> asked to book ${range(r)} on your website. Confirm or decline.</span></div>`);
    for (const ch of CHANNELS) if (channelState(w, ch) === 'err') out.push(`<div class="alert bad" data-go="#/h/${w.id}/channels"><span>${name(w)}${SOURCES[ch]} sync is failing: ${esc(w.channels[ch].lastStatus.replace('error · ', ''))}</span></div>`);
    const off = ['airbnb', 'booking'].filter(c => channelState(w, c) === 'off');
    if (off.length) out.push(`<div class="alert info" data-go="#/h/${w.id}/channels"><span>${name(w)}${off.map(c => SOURCES[c]).join(' and ')} not connected yet.</span></div>`);
    const noName = stays(w.id).filter(r => r.checkOut >= t && !r.guestName).length;
    if (noName && hid) out.push(`<div class="alert info" data-go="#/h/${w.id}/reservations"><span><b>${noName} synced stays</b> have no guest name. Airbnb and Booking.com calendars only share dates, so add guest details yourself.</span></div>`);
  }
  if (!hid && S.state.workspaces.some(w => w.demo)) out.push(`<div class="alert info" data-go="#/settings"><span>These are <b>demo houses</b>. Remove them in Settings when you're ready.</span></div>`);
  return out.join('');
}

// ---------- house views ----------
const HOUSE = {
  overview(w) {
    const t = S.state.today, mS = monthStart(t), mE = nextMonth(t), days = nightsOf(mS, mE);
    const booked = bookedNights(w.id, mS, mE), occ = Math.round(booked / days * 100);
    const revenue = stays(w.id).reduce((n, r) => n + (r.price ? r.price * nightsIn(r, mS, mE) / nightsOf(r.checkIn, r.checkOut) : 0), 0);
    const t7 = add(t, 7), t14 = add(t, 14);
    const arrivals = stays(w.id).filter(r => r.checkIn >= t && r.checkIn < t7);
    const pending = live(w.id).filter(r => r.status === 'pending');
    const inHouse = stays(w.id).find(r => r.checkIn <= t && r.checkOut > t);
    const moves = [];
    for (const r of stays(w.id)) {
      if (r.checkIn >= t && r.checkIn < t14) moves.push({ d: r.checkIn, type: 'in', r });
      if (r.checkOut >= t && r.checkOut < t14) moves.push({ d: r.checkOut, type: 'out', r });
    }
    moves.sort((a, b) => a.d.localeCompare(b.d) || (a.type === 'out' ? -1 : 1));
    const from = add(t, -30), to = add(t, 90), mix = {}; let total = 0;
    for (const r of stays(w.id)) { const n = nightsIn(r, from, to); if (n) { mix[r.source] = (mix[r.source] || 0) + n; total += n; } }
    const M = MONTHS[D(t).getUTCMonth()];
    return `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Occupancy · ${M}</div><div class="value">${occ}%</div><div class="hint">${booked} of ${days} nights</div><div class="meter"><span style="width:${occ}%;background:${w.color}"></span></div></div>
      <div class="card kpi"><div class="label">Revenue · ${M}</div><div class="value">${money(Math.round(revenue), w.currency)}</div><div class="hint">From stays with a price set</div></div>
      <div class="card kpi"><div class="label">Arrivals · 7 days</div><div class="value">${arrivals.length}</div><div class="hint">${inHouse ? 'In the house: ' + esc(guestLabel(inHouse)) : 'Empty tonight'}</div></div>
      <div class="card kpi"><div class="label">Website requests</div><div class="value">${pending.length}</div><div class="hint">${pending.length ? 'Waiting for your answer' : 'All answered'}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Coming and going <small>next 14 days</small></h2>${movesList(moves, false)}</div>
      <div style="display:flex;flex-direction:column;gap:1rem">
        <div class="card"><h2>Needs attention</h2>${alerts(w.id) || '<p class="empty">Nothing to do. Enjoy the porch.</p>'}</div>
        <div class="card"><h2>Where bookings come from <small>nights, −30 to +90 days</small></h2>
          <div class="mix-bar">${Object.keys(SOURCES).filter(s => mix[s]).map(s => `<span style="flex:${mix[s]};background:var(--${s})"></span>`).join('') || '<span style="flex:1;background:var(--line)"></span>'}</div>
          ${Object.keys(SOURCES).map(s => `<div class="mix-row"><span class="chip ${s}">${SOURCES[s]}</span><span class="n">${mix[s] || 0} nights · ${total ? Math.round((mix[s] || 0) / total * 100) : 0}%</span></div>`).join('')}
        </div>
      </div>
    </div>`;
  },

  calendar(w) {
    if (!S.month) S.month = monthStart(S.state.today);
    const first = D(S.month), lead = (first.getUTCDay() + 6) % 7, gridStart = add(S.month, -lead);
    const weeks = Math.ceil((lead + nightsOf(S.month, nextMonth(S.month))) / 7);
    const items = live(w.id);
    let html = '';
    for (let k = 0; k < weeks; k++) {
      const ws = add(gridStart, k * 7), we = add(ws, 7);
      let days = '', nums = '';
      for (let i = 0; i < 7; i++) {
        const d = add(ws, i), cls = [d.slice(0, 7) !== S.month.slice(0, 7) && 'other', d === S.state.today && 'today', d < S.state.today && 'past'].filter(Boolean).join(' ');
        days += `<div class="day ${cls}" data-day="${d}"></div>`;
        nums += `<div class="num-cell ${cls}" style="grid-column:${i + 1}"><span class="num">${D(d).getUTCDate()}</span></div>`;
      }
      const segs = items.filter(r => r.checkIn < we && r.checkOut > ws).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
      const lanes = []; let bars = '';
      for (const r of segs) {
        const s = r.checkIn < ws ? 0 : nightsOf(ws, r.checkIn), e = r.checkOut > we ? 7 : nightsOf(ws, r.checkOut);
        let lane = lanes.findIndex(x => x <= s); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = e;
        bars += `<div class="bar ${barClass(r, r.checkIn < ws, r.checkOut > we)}" data-open="${r.id}" title="${esc(guestLabel(r))} · ${range(r)}" style="grid-column:${s + 1}/${Math.max(e, s + 1) + 1};grid-row:${lane + 2}">${esc(guestLabel(r))}${r.status === 'pending' ? ' · pending' : ''}</div>`;
      }
      html += `<div class="week"><div class="wk-bg">${days}</div>${nums}${bars}</div>`;
    }
    return `<div class="cal-head">
        <button class="btn small" data-month="-1" aria-label="Previous month">←</button><button class="btn small" data-month="0">Today</button><button class="btn small" data-month="1" aria-label="Next month">→</button>
        <h2>${first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
        <div class="legend">${Object.keys(SOURCES).map(s => `<span class="chip ${s}">${SOURCES[s]}</span>`).join('')}</div></div>
      <div class="cal"><div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div>${html}</div>`;
  },

  reservations(w) {
    const f = S.filter, t = S.state.today;
    let list = resOf(w.id);
    if (f.source !== 'all') list = list.filter(r => r.source === f.source);
    if (f.status === 'active') list = list.filter(r => r.status !== 'cancelled'); else if (f.status !== 'all') list = list.filter(r => r.status === f.status);
    if (f.when === 'upcoming') list = list.filter(r => r.checkOut >= t);
    if (f.when === 'past') list = list.filter(r => r.checkOut < t);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter(r => [r.guestName, r.email, r.code, r.notes].join(' ').toLowerCase().includes(q)); }
    list.sort((a, b) => f.when === 'past' ? b.checkIn.localeCompare(a.checkIn) : a.checkIn.localeCompare(b.checkIn));
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-f="${key}" data-v="${v}" class="${f[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="filters">
        <input type="search" id="q" placeholder="Search guest, email, reference…" value="${esc(f.q)}">
        ${seg('when', [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']])}
        <select id="fSource"><option value="all">All channels</option>${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${f.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="fStatus">${[['active', 'Not cancelled'], ['confirmed', 'Confirmed'], ['pending', 'Pending'], ['blocked', 'Blocked'], ['cancelled', 'Cancelled'], ['all', 'Any status']].map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Guest</th><th>Channel</th><th>Dates</th><th class="num">Nights</th><th class="num">Guests</th><th class="num">Total</th><th>Status</th><th>Ref.</th></tr></thead>
        <tbody>${list.map(r => `<tr data-open="${r.id}">
          <td>${r.guestName ? esc(r.guestName) : '<span class="missing">Add guest name</span>'}${r.conflicts.length ? '<span class="warn-dot" title="Overlaps another stay">⚠</span>' : ''}</td>
          <td><span class="chip ${r.source}">${SOURCES[r.source]}</span></td><td>${range(r)} ${D(r.checkIn).getUTCFullYear()}</td>
          <td class="num">${nightsOf(r.checkIn, r.checkOut)}</td><td class="num">${r.guests ?? '—'}</td><td class="num">${money(r.price, w.currency)}</td>
          <td><span class="status ${r.status}">${r.status}</span></td><td style="color:var(--muted);font-size:.8rem">${esc(r.code || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No reservations match.</td></tr>'}
        </tbody></table></div>`;
  },

  channels(w) {
    const base = `${API_ORIGIN}/ical/${w.exportToken}`;
    const status = c => { const ch = w.channels[c], st = ch.lastStatus || '';
      return `<div class="ch-status ${st.startsWith('ok') ? 'ok' : st.startsWith('error') ? 'err' : ''}">${ch.url ? `Last sync ${ago(ch.lastSync)}${st ? ' · ' + esc(st) : ''}` : 'Not connected yet'}</div>`; };
    const copy = v => `<div class="copy"><input readonly value="${esc(v)}"><button class="btn small" data-copy="${esc(v)}">Copy</button></div>`;
    const ota = (key, letter, color, hint, imp, exp) => `<div class="card ch-card">
      <div class="ch-top"><div class="ch-logo" style="background:${color}">${letter}</div><div><h3>${SOURCES[key]}</h3><p>${hint}</p></div></div>
      <label class="field">1 · Import: ${SOURCES[key]} calendar link<input data-ch="${key}" type="url" placeholder="https://…ics" value="${esc(w.channels[key].url)}"></label>
      <details><summary>Where do I find this link?</summary><ol>${imp}</ol></details>
      ${status(key)}
      <div class="field">2 · Export: paste this link into ${SOURCES[key]}${copy(`${base}/${key}.ics`)}
        <p class="help">Blocks the nights booked everywhere else, so ${SOURCES[key]} never sells them twice.</p></div>
      <details><summary>How do I add it to ${SOURCES[key]}?</summary><ol>${exp}</ol></details></div>`;

    const snippet = `<div data-alpendre="${w.publicKey}"></div>\n<script src="${API_ORIGIN}/embed.js" async></script>`;
    const tabs = { widget: 'Booking widget', ical: 'Calendar sync', api: 'API' };
    const webBody = {
      widget: `<p class="help" style="margin:0">Paste this where the booking section should appear on your site (WordPress: a <b>Custom HTML</b> block; Wix/Squarespace: an <b>Embed code</b> block). It shows live availability and takes booking requests straight into Alpendre.</p>
        <div class="snippet"><pre>${esc(snippet)}</pre><button class="btn small" data-copy="${esc(snippet)}">Copy</button></div>
        <p class="help" style="margin:0">Only availability? Add <code>data-mode="calendar"</code> to the div. Match your colours with <code>data-accent="#hex"</code>.</p>
        <label class="switch"><input type="checkbox" id="webBookings" ${w.websiteBookings ? 'checked' : ''}> Accept booking requests from my website</label>`,
      ical: `<p class="help" style="margin:0">Already have a booking system on your site? Connect it through calendar links instead.</p>
        <label class="field">1 · Import: your website's calendar link<input data-ch="website" type="url" placeholder="https://yoursite.com/…ics" value="${esc(w.channels.website.url)}"></label>
        ${w.channels.website.url ? status('website') : ''}
        <div class="field">2 · Export: give this link to your website's booking system${copy(`${base}/website.ics`)}<p class="help">Blocks the nights sold on Airbnb and Booking.com.</p></div>`,
      api: `<p class="help" style="margin:0">For a custom-built site. Your developer can call these directly. They're open to the browser (CORS) and need no login.</p>
        <div class="field">Availability (GET)${copy(`${API_ORIGIN}/api/public/${w.publicKey}/availability`)}</div>
        <div class="field">Create booking (POST JSON)${copy(`${API_ORIGIN}/api/public/${w.publicKey}/book`)}
          <p class="help">Body: <code>{ checkIn, checkOut, guestName, email, phone, guests, message }</code>, with dates as YYYY-MM-DD.</p></div>`,
    };
    return `<div class="grid channels">
      ${ota('airbnb', 'A', 'var(--airbnb)', 'Through Airbnb’s calendar link',
        '<li>Open Airbnb → <b>Calendar</b> and choose this listing.</li><li>Open <b>Availability</b> → <b>Connect calendars</b>.</li><li>Click <b>Export calendar</b> and copy the link.</li><li>Paste it above and press <b>Save connections</b>.</li>',
        '<li>In <b>Connect calendars</b> choose <b>Import calendar</b>.</li><li>Paste the export link, name it “Alpendre” and save.</li>')}
      ${ota('booking', 'B', 'var(--booking)', 'Through the Booking.com extranet',
        '<li>Sign in to the <b>Booking.com extranet</b>.</li><li>Go to <b>Rates &amp; Availability</b> → <b>Sync calendars</b>.</li><li>Choose <b>Export calendar</b> and copy the link.</li><li>Paste it above and press <b>Save connections</b>.</li>',
        '<li>In <b>Sync calendars</b> choose <b>Import calendar</b>.</li><li>Paste the export link, name it “Alpendre” and save.</li>')}
      <div class="card ch-card">
        <div class="ch-top"><div class="ch-logo" style="background:var(--website)">W</div><div><h3>Your website</h3><p>Direct bookings, no commission</p></div></div>
        <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${S.chTab === k ? 'on' : ''}">${v}</button>`).join('')}</div>
        ${webBody[S.chTab]}
      </div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Save &amp; sync</h2>
        <p class="help" style="margin:0 0 1rem">Alpendre checks every connected calendar every ${S.state.settings.syncMinutes} minutes. Airbnb and Booking.com read your export links on their own schedule (usually every 1–3 hours).</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn primary" id="saveChannels">Save connections</button><button class="btn" id="syncHouse">Sync this house now</button></div>
        <details style="margin-top:1rem"><summary>Export links leaked?</summary><p>Replacing them makes the old links stop working. You'll need to paste the new ones into Airbnb, Booking.com and your website again.</p><button class="btn small danger" id="rotate">Replace export links</button></details>
      </div>
      <div class="card"><h2>Activity</h2><ul class="log">${S.state.log.filter(l => l.workspaceId === w.id).slice(0, 40).map(l => `<li><time>${new Date(l.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span class="${l.level}">${esc(l.msg)}</span></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul></div>
    </div>`;
  },

  settings(w) { return houseForm(w) + `
    <div class="card danger-zone" style="margin-top:1rem"><h2>Delete this house</h2><p class="help" style="margin:0 0 .8rem">Removes the house, all its reservations and its calendar links. Airbnb and Booking.com are not changed.</p>
      <button class="btn danger" id="delHouse">Delete ${esc(w.name)}</button></div>`; },
};

function houseForm(w, isNew) {
  const f = (k, l, type = 'text', extra = '') => `<label class="field">${l}<input name="${k}" type="${type}" value="${esc(w[k] ?? '')}" ${extra}></label>`;
  return `<form id="houseForm" class="${isNew ? '' : 'grid two'}" style="${isNew ? 'display:flex;flex-direction:column;gap:1rem' : 'margin-top:0'}">
    <div class="${isNew ? '' : 'card'}">${isNew ? '' : '<h2>The house</h2>'}<div class="form-grid">
      <div class="full">${f('name', 'Name', 'text', 'required maxlength="80" placeholder="e.g. Casa da Praia"')}</div>
      <div class="full">${f('location', 'Location', 'text', 'placeholder="e.g. Lagos, Algarve"')}</div>
      <div class="field full">Colour<div class="swatches">${COLORS.map(c => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${w.color === c ? 'checked' : ''}></label>`).join('')}</div></div>
      ${f('checkInTime', 'Check-in from', 'time')}${f('checkOutTime', 'Check-out by', 'time')}
    </div></div>
    <div class="${isNew ? '' : 'card'}">${isNew ? '<h3 style="font-size:1rem;margin-bottom:.6rem">Website booking rules</h3>' : '<h2>Website booking rules</h2>'}<div class="form-grid">
      ${f('nightlyPrice', 'Price per night', 'number', 'min="0"')}${f('cleaningFee', 'Cleaning fee', 'number', 'min="0"')}
      ${f('minNights', 'Minimum nights', 'number', 'min="1"')}${f('maxGuests', 'Max guests', 'number', 'min="1"')}
      <label class="field">Currency<select name="currency">${['EUR', 'GBP', 'USD', 'BRL', 'CHF'].map(c => `<option ${w.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="switch full"><input type="checkbox" name="autoConfirm" ${w.autoConfirm ? 'checked' : ''}> Confirm website bookings automatically</label>
    </div>${isNew ? '' : '<div style="margin-top:1rem"><button class="btn primary" type="submit">Save changes</button></div>'}</div>
  </form>`;
}
function readHouseForm() {
  const form = $('#houseForm'), fd = new FormData(form), b = Object.fromEntries(fd);
  b.autoConfirm = fd.has('autoConfirm');
  return b;
}

function viewSettings() {
  const s = S.state.settings;
  return `<div class="grid two" style="margin-top:0">
    <div class="card"><h2>Calendar sync</h2>
      <label class="field">Check every connected calendar every<select id="syncMinutes">${[15, 30, 60, 180].map(m => `<option value="${m}" ${s.syncMinutes == m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')}</option>`).join('')}</select></label>
      <div style="margin-top:1rem"><button class="btn primary" id="saveSettings">Save</button></div></div>
    <div class="card"><h2>Housekeeping</h2>
      ${houses().some(w => w.demo) ? '<p class="help" style="margin:0 0 .8rem">Demo houses are loaded so you can look around. Remove them before adding your own.</p><button class="btn danger" id="clearDemo">Remove demo houses</button>' : '<p class="help" style="margin:0">No demo data left.</p>'}
      ${S.state.defaultPassword ? '<div class="note bad" style="margin-top:1rem">You are using the default password. Start the server with <code>ALPENDRE_PASSWORD=your-password</code> to change it.</div>' : ''}
    </div></div>`;
}

// ---------- wiring ----------
const AFTER = {
  home() {
    $$('[data-tl]').forEach(b => b.onclick = () => { const n = +b.dataset.tl; S.tlStart = n ? add(S.tlStart, n) : add(S.state.today, -2); render(); });
  },
  calendar() {
    $$('[data-month]').forEach(b => b.onclick = () => {
      const n = +b.dataset.month;
      if (!n) S.month = monthStart(S.state.today); else { const d = D(S.month); d.setUTCMonth(d.getUTCMonth() + n); S.month = F(d); }
      render();
    });
    $$('.wk-bg .day').forEach(d => d.onclick = () => openDrawer(null, { hid: S.route.hid, day: d.dataset.day }));
  },
  reservations() {
    const q = $('#q'); q.oninput = () => { S.filter.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#fSource').onchange = e => { S.filter.source = e.target.value; render(); };
    $('#fStatus').onchange = e => { S.filter.status = e.target.value; render(); };
    $$('[data-f]').forEach(b => b.onclick = () => { S.filter[b.dataset.f] = b.dataset.v; render(); });
  },
  channels() {
    const hid = S.route.hid;
    $$('[data-copy]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Select the text and press Ctrl+C'); }
    });
    $$('[data-tab]').forEach(b => b.onclick = () => { S.chTab = b.dataset.tab; render(); });
    const save = async () => {
      const w = houseById(hid), channels = {};
      for (const c of CHANNELS) channels[c] = { url: w.channels[c].url };
      $$('[data-ch]').forEach(i => channels[i.dataset.ch] = { url: i.value });
      const body = { channels }; const wb = $('#webBookings'); if (wb) body.websiteBookings = wb.checked;
      await api(`/api/workspaces/${hid}`, { method: 'PUT', body });
    };
    const wb = $('#webBookings'); if (wb) wb.onchange = async () => { try { await save(); toast(wb.checked ? 'Website bookings on' : 'Website bookings off'); await refresh(); } catch (e) { toast(e.message); } };
    $('#saveChannels').onclick = async () => { try { await save(); toast('Saved. Syncing…'); await doSync(hid); } catch (e) { toast(e.message); } };
    $('#syncHouse').onclick = () => doSync(hid);
    $('#rotate').onclick = async () => {
      if (!confirm('Replace the export links? The old ones stop working right away.')) return;
      await api(`/api/workspaces/${hid}/rotate`, { method: 'POST' }); toast('New links created. Update them on each channel.'); await refresh();
    };
  },
  settings() {
    if (S.route.name === 'house') {
      const hid = S.route.hid;
      $('#houseForm').onsubmit = async e => { e.preventDefault(); try { await api(`/api/workspaces/${hid}`, { method: 'PUT', body: readHouseForm() }); toast('Saved'); await refresh(); } catch (err) { toast(err.message); } };
      $('#delHouse').onclick = async () => {
        const w = houseById(hid);
        if (prompt(`This deletes ${w.name} and all its reservations. Type the house name to confirm.`) !== w.name) return;
        await api(`/api/workspaces/${hid}`, { method: 'DELETE' }); toast('House deleted'); location.hash = '#/'; await refresh();
      };
      return;
    }
    $('#saveSettings').onclick = async () => { await api('/api/settings', { method: 'PUT', body: { syncMinutes: +$('#syncMinutes').value } }); toast('Saved'); await refresh(); };
    const c = $('#clearDemo'); if (c) c.onclick = async () => {
      if (!confirm('Remove the demo houses and their reservations? Houses you created stay.')) return;
      await api('/api/demo', { method: 'DELETE' }); toast('Demo houses removed'); await refresh();
    };
  },
};

document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.stopPropagation(); return openDrawer(o.dataset.open); }
  const a = e.target.closest('[data-act="add-house"]'); if (a) return openHouseDrawer();
  const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go;
}, true);
$('#addHouse').onclick = () => openHouseDrawer();

async function doSync(hid) {
  const b = $('#syncBtn'); b.classList.add('spin'); b.disabled = true;
  try {
    const { results } = await api(hid ? `/api/workspaces/${hid}/sync` : '/api/sync', { method: 'POST' });
    const done = results.filter(r => !r.skipped);
    if (!done.length) toast('No calendar links connected yet');
    else if (done.some(r => r.error)) toast('Sync finished with errors. See Connections.');
    else toast(`Synced: ${done.reduce((n, r) => n + r.added, 0)} new, ${done.reduce((n, r) => n + r.updated + r.removed, 0)} changed`);
    await refresh();
  } catch (e) { toast(e.message); }
  finally { b.classList.remove('spin'); b.disabled = false; }
}
$('#syncBtn').onclick = () => doSync(S.route.name === 'house' ? S.route.hid : null);
$('#newBtn').onclick = () => openDrawer(null, { hid: S.route.hid, day: S.state.today });

// ---------- drawers ----------
function showDrawer(html) { const dr = $('#drawer'); dr.innerHTML = html; dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; $('#closeDr').onclick = closeDrawer; }
function closeDrawer() { const dr = $('#drawer'); dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

function openHouseDrawer() {
  const w = { name: '', location: '', color: COLORS[houses().length % COLORS.length], checkInTime: '16:00', checkOutTime: '11:00', nightlyPrice: 150, cleaningFee: 50, minNights: 2, maxGuests: 6, currency: 'EUR', autoConfirm: false };
  showDrawer(`<header><div><h2>Add a house</h2><p class="sub">You'll connect Airbnb, Booking.com and your website next.</p></div><button class="x" id="closeDr" aria-label="Close">×</button></header>
    <div class="body">${houseForm(w, true)}</div>
    <footer><button class="btn" id="cancelDr">Cancel</button><button class="btn primary" id="createHouse">Create house</button></footer>`);
  $('#cancelDr').onclick = closeDrawer;
  setTimeout(() => $('#houseForm [name=name]').focus(), 50);
  $('#createHouse').onclick = async () => {
    const b = readHouseForm();
    if (!b.name.trim()) { toast('Give the house a name'); return; }
    try { const nw = await api('/api/workspaces', { method: 'POST', body: b }); closeDrawer(); await refresh(); location.hash = `#/h/${nw.id}/channels`; toast('House created. Now connect its calendars.'); }
    catch (e) { toast(e.message); }
  };
}

function openDrawer(id, opts = {}) {
  const r = id ? S.state.reservations.find(x => x.id === id)
    : { workspaceId: opts.hid || '', source: 'manual', status: 'confirmed', checkIn: opts.day, checkOut: add(opts.day, 2), guestName: '', email: '', phone: '', guests: 2, price: '', notes: '', code: '', conflicts: [] };
  if (!r) return;
  const w = houseById(r.workspaceId);
  const synced = !!r.uid, cur = w ? w.currency : 'EUR';
  const conflicts = r.conflicts.map(cid => S.state.reservations.find(x => x.id === cid)).filter(Boolean);
  showDrawer(`
    <header><div><div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"><span class="chip ${r.source}">${SOURCES[r.source]}</span>${w ? `<span class="chip" style="background:#efe9df;color:${w.color}">${esc(w.name)}</span>` : ''}</div>
      <h2 style="margin-top:.5rem">${id ? esc(guestLabel(r)) : 'New reservation'}</h2>
      ${id ? `<p class="sub">${range(r)} · ${nightsOf(r.checkIn, r.checkOut)} nights${r.code ? ' · ' + esc(r.code) : ''}</p>` : ''}</div>
      <button class="x" id="closeDr" aria-label="Close">×</button></header>
    <form class="body" id="resForm">
      ${conflicts.length ? `<div class="note bad"><b>Overlaps with</b> ${conflicts.map(c => `${esc(guestLabel(c))} (${SOURCES[c.source]}, ${range(c)})`).join(', ')}. Cancel one of them on its channel.</div>` : ''}
      ${r.status === 'pending' ? `<div class="note">This guest asked to book through your website. Reply by email, then confirm or decline here.</div>` : ''}
      ${synced ? `<div class="note">Imported from ${SOURCES[r.source]}. The dates come from there and update on every sync. Guest details are yours to fill in.</div>` : ''}
      <div class="form-grid">
        ${id ? '' : `<label class="field full">House<select name="workspaceId" required>${houses().map(h => `<option value="${h.id}" ${h.id === r.workspaceId ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>`}
        <label class="field">Check-in<input type="date" name="checkIn" value="${r.checkIn}" ${synced ? 'disabled' : 'required'}></label>
        <label class="field">Check-out<input type="date" name="checkOut" value="${r.checkOut}" ${synced ? 'disabled' : 'required'}></label>
        ${synced ? '' : `<label class="field">Channel<select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${r.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`}
        <label class="field">Status<select name="status">${['confirmed', 'pending', 'blocked', 'cancelled'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field full">Guest name<input name="guestName" value="${esc(r.guestName)}"></label>
        <label class="field">Email<input type="email" name="email" value="${esc(r.email)}"></label>
        <label class="field">Phone<input name="phone" value="${esc(r.phone)}"></label>
        <label class="field">Guests<input type="number" min="0" name="guests" value="${r.guests ?? ''}"></label>
        <label class="field">Total paid (${cur})<input type="number" min="0" step="0.01" name="price" value="${r.price ?? ''}"></label>
        <label class="field">Reference<input name="code" value="${esc(r.code || '')}"></label>
        <label class="field full">Notes<textarea name="notes" rows="4">${esc(r.notes)}</textarea></label>
      </div>
    </form>
    <footer>
      ${id && !synced ? '<button class="btn danger left" id="delRes">Delete</button>' : ''}
      ${r.status === 'pending' ? '<button class="btn" id="declineRes">Decline</button><button class="btn primary" id="confirmRes">Confirm booking</button>'
        : `<button class="btn" id="cancelDr">Close</button><button class="btn primary" id="saveRes">${id ? 'Save' : 'Add reservation'}</button>`}
    </footer>`);
  const collect = () => { const fd = Object.fromEntries(new FormData($('#resForm'))); fd.guests = fd.guests === '' ? null : +fd.guests; fd.price = fd.price === '' ? null : +fd.price; return fd; };
  const save = async override => {
    try {
      const body = { ...collect(), ...override };
      if (id) await api('/api/reservations/' + id, { method: 'PUT', body }); else await api('/api/reservations', { method: 'POST', body });
      closeDrawer(); toast(id ? 'Saved' : 'Reservation added'); await refresh();
    } catch (e) { toast(e.message); }
  };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#cancelDr', closeDrawer); on('#saveRes', () => save());
  on('#confirmRes', () => save({ status: 'confirmed' })); on('#declineRes', () => save({ status: 'cancelled' }));
  on('#delRes', async () => { if (!confirm('Delete this reservation for good?')) return; await api('/api/reservations/' + id, { method: 'DELETE' }); closeDrawer(); toast('Deleted'); await refresh(); });
}

// ---------- boot ----------
S.route = parseRoute();
if (!TOKEN) showLogin();
else api('/api/state').then(st => { S.state = st; $('#app').hidden = false; render(); }).catch(e => { if (e.message !== 'Signed out') { showLogin(); $('#loginErr').textContent = e.message; } });
