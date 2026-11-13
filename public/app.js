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
  if (S.route.name === 'invite') return; // the invite page handles its own submit
  try { const d = await api('/api/login', { method: 'POST', body: { login: e.target.login.value, password: e.target.password.value } }); setToken(d.token); $('#login').hidden = true; $('#app').hidden = false; await refresh(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* already signed out */ } setToken(''); showLogin(); });

// ---------- invite page ----------
async function showInvite(tokenId) {
  $('#app').hidden = true; $('#login').hidden = false;
  const card = $('.login-card');
  let info;
  try { info = await api('/api/invite/' + tokenId); }
  catch (e) {
    card.innerHTML = `<img src="logo.svg" alt="" width="56" height="56"><h1>Alpendre</h1><p>${esc(e.message)}</p><a class="btn primary" href="${location.pathname}">Go to sign in</a>`;
    return;
  }
  card.innerHTML = `<img src="logo.svg" alt="" width="56" height="56"><h1>Welcome, ${esc(info.name.split(' ')[0])}</h1>
    <p>Choose a password for Alpendre. You'll sign in with the username <b>${esc(info.login)}</b>.</p>
    <label class="field">Username<input name="login" value="${esc(info.login)}" autocomplete="username" readonly></label>
    <label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="8" required autofocus><span class="help">At least 8 characters.</span></label>
    <label class="field">Repeat password<input type="password" name="again" autocomplete="new-password" required></label>
    <p class="err" id="inviteErr"></p><button class="btn primary" type="submit">Set password and sign in</button>`;
  card.onsubmit = async e => {
    e.preventDefault(); e.stopImmediatePropagation();
    const f = e.target;
    if (f.password.value.length < 8) return void ($('#inviteErr').textContent = 'Use at least 8 characters.');
    if (f.password.value !== f.again.value) return void ($('#inviteErr').textContent = 'The two passwords are different.');
    try {
      const d = await api('/api/invite/' + tokenId, { method: 'POST', body: { password: f.password.value } });
      setToken(d.token); location.replace(location.pathname + '#/'); location.reload();
    } catch (err) { $('#inviteErr').textContent = err.message; }
  };
}

// ---------- data helpers ----------
const houses = () => S.state.workspaces;
const isOwner = () => !!(S.state && S.state.me && S.state.me.isOwner);
const othersExist = () => isOwner() && (S.state.users || []).length > 0;
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
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', token: parts[1] };
  if (parts[0] === 'h' && parts[1]) return { name: 'house', hid: parts[1], view: parts[2] || 'overview' };
  return { name: 'home' };
}
window.addEventListener('hashchange', () => { if (parseRoute().name === 'invite') return void showInvite(parseRoute().token); const prev = S.route.hid; S.route = parseRoute(); if (S.route.hid !== prev) S.month = null; render(); window.scrollTo(0, 0); });
const HOUSE_VIEWS = { overview: 'Overview', calendar: 'Calendar', reservations: 'Reservations', channels: 'Connections', settings: 'House settings' };

function render() {
  if (!S.state) return;
  const r = S.route;
  if (r.name === 'house' && (!houseById(r.hid) || !HOUSE_VIEWS[r.view])) { location.hash = '#/'; return; }
  if (r.hid) { S.lastHouse = r.hid; try { localStorage.setItem('alp_house', r.hid); } catch { /* ignore */ } }
  renderSide();
  renderPhoneBars();
  $('#me').textContent = S.state.me ? 'Signed in as ' + S.state.me.name : '';
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
    sub = { overview: esc(w.location || ''), calendar: `Every channel on one calendar. ${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} a stay to open it, or a day to add one.`,
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

// ---------- phone: top bar, bottom tabs, + button ----------
const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bookings: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  links: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  houses: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};
const svg = (k, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}">${ICON[k]}</svg>`;
const shortName = n => { const w = String(n).split(/\s+/); return (w[0].length > 3 || w.length === 1 ? w[0] : w.slice(0, 2).join(' ')).slice(0, 11); };
function houseIssues(w) { return !!w && (live(w.id).some(x => x.conflicts.length) || CHANNELS.some(c => channelState(w, c) === 'err')); }
function currentHouse() {
  let id = S.route.hid || S.lastHouse;
  if (!id) try { id = localStorage.getItem('alp_house'); } catch { /* ignore */ }
  return houseById(id) || houses()[0] || null;
}
function renderPhoneBars() {
  const r = S.route, w = r.name === 'house' ? houseById(r.hid) : null, cur = currentHouse();
  const pending = live(cur ? cur.id : undefined).filter(x => x.status === 'pending').length;
  $('#appbar').innerHTML = `<a href="#/" class="ab-logo" aria-label="All houses"><img src="logo.svg" alt="" width="30" height="30"></a>
    <button class="ab-ctx" id="ctxBtn">${w ? `<span class="dot" style="background:${w.color}"></span>${esc(w.name)}` : r.name === 'settings' ? 'Settings' : 'All houses'}${svg('down', 16)}</button>
    <button class="ab-sync" id="abSync" aria-label="Sync now">${svg('sync', 20)}</button>`;
  const tab = (href, icon, label, on, badge = 0, off = false) => off ? `<span class="off">${svg(icon)}<span>${label}</span></span>`
    : `<a href="${href}" class="${on ? 'active' : ''}">${svg(icon)}<span>${label}</span>${badge ? `<b class="tb-badge">${badge}</b>` : ''}</a>`;
  const h = cur ? `#/h/${cur.id}` : '#/', none = !cur, v = r.name === 'house' ? r.view : '';
  const allPending = live().filter(x => x.status === 'pending').length;
  $('#tabbar').innerHTML = tab('#/', 'houses', 'All houses', r.name === 'home', allPending)
    + tab(h + '/overview', 'home', cur ? shortName(cur.name) : 'House', v === 'overview', houseIssues(cur) ? '!' : 0, none)
    + tab(h + '/calendar', 'calendar', 'Calendar', v === 'calendar', 0, none)
    + tab(h + '/reservations', 'bookings', 'Bookings', v === 'reservations', pending, none)
    + `<button type="button" id="moreBtn" class="${r.name === 'settings' || v === 'settings' || v === 'channels' ? 'active' : ''}">${svg('more')}<span>More</span></button>`;
  $('#fab').hidden = r.name === 'settings' || v === 'settings' || v === 'channels' || !houses().length;
  $('#ctxBtn').onclick = openHouseSwitcher;
  $('#abSync').onclick = () => doSync(r.name === 'house' ? r.hid : null);
  $('#moreBtn').onclick = openMoreSheet;
}
$('#fab').onclick = () => { const c = currentHouse(); openDrawer(null, { hid: S.route.hid || (c && c.id), day: S.state.today }); };
function sheet(title, items) {
  showDrawer(`<header><div><h2>${title}</h2></div><button class="x" id="closeDr" aria-label="Close">×</button></header>
    <div class="body sheet-list">${items.join('')}</div>`);
  $('#drawer').classList.add('is-sheet');
  $$('#drawer [data-sheet-go]').forEach(a => a.onclick = () => { closeDrawer(); location.hash = a.dataset.sheetGo; });
}
function openHouseSwitcher() {
  const cur = S.route.name === 'house' ? S.route.hid : null;
  sheet('Choose a house', [
    `<button class="sheet-item ${!cur ? 'on' : ''}" data-sheet-go="#/"><span class="dot" style="background:var(--ink)"></span>All houses</button>`,
    ...houses().map(w => { const p = live(w.id).filter(x => x.status === 'pending').length;
      return `<button class="sheet-item ${cur === w.id ? 'on' : ''}" data-sheet-go="#/h/${w.id}/${S.route.view && S.route.name === 'house' ? S.route.view : 'overview'}"><span class="dot" style="background:${w.color}"></span>
        <span style="flex:1">${esc(w.name)}<small>${esc(w.location || '')}${othersExist() ? ' · ' + esc(w.ownerName) : ''}</small></span>
        ${houseIssues(w) ? '<span class="warn-dot" title="Needs attention">⚠</span>' : ''}${p ? `<b class="tb-badge static">${p}</b>` : ''}</button>`; }),
    `<button class="sheet-item add" id="sheetAdd">+ Add a house</button>`,
  ]);
  $('#sheetAdd').onclick = () => { closeDrawer(); openHouseDrawer(); };
}
function openMoreSheet() {
  const c = currentHouse();
  const errs = c ? CHANNELS.filter(ch => channelState(c, ch) === 'err').length : 0;
  sheet('More', [
    c ? `<p class="sheet-label"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</p>` : '',
    c ? `<button class="sheet-item" data-sheet-go="#/h/${c.id}/channels">${svg('links', 20)}<span style="flex:1">Connections<small>Airbnb, Booking.com and website</small></span>${errs ? '<span class="warn-dot">⚠</span>' : ''}</button>` : '',
    c ? `<button class="sheet-item" data-sheet-go="#/h/${c.id}/settings">${svg('gear', 20)}<span>House settings<small>Details, booking rules, confirmation email</small></span></button>` : '',
    c && houses().length > 1 ? `<button class="sheet-item" id="sheetSwitch">${svg('houses', 20)}<span>Switch house</span></button>` : '',
    `<p class="sheet-label">Alpendre</p>`,
    `<button class="sheet-item" data-sheet-go="#/settings">${svg('user', 20)}<span>${isOwner() ? 'Settings<small>People, guest emails, calendar sync</small>' : 'My account<small>Change my password</small>'}</span></button>`,
    `<button class="sheet-item" id="sheetAdd">${svg('plus', 20)}<span>Add a house</span></button>`,
    `<button class="sheet-item danger" id="sheetOut">${svg('out', 20)}<span>Sign out<small>${S.state.me ? 'Signed in as ' + esc(S.state.me.name) : ''}</small></span></button>`,
  ]);
  const sw = $('#sheetSwitch'); if (sw) sw.onclick = openHouseSwitcher;
  $('#sheetAdd').onclick = () => { closeDrawer(); openHouseDrawer(); };
  $('#sheetOut').onclick = () => { closeDrawer(); $('#logout').click(); };
}

// ---------- home ----------
function viewHome() {
  const t = S.state.today, t30 = add(t, 30), t7 = add(t, 7);
  const list = houses();
  if (!list.length) return `<div class="card" style="text-align:center;padding:3rem 1rem"><img src="logo.svg" width="56" height="56" alt=""><h2 style="margin:1rem 0 .5rem">Add your first house</h2>
    <p class="sub" style="margin-bottom:1.2rem">Each house is a workspace with its own Airbnb, Booking.com and website connections.${isOwner() ? '' : ' Only you (and the owner) will see your houses.'}</p><button class="btn primary" data-act="add-house">+ Add a house</button></div>`;
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
      <div><h3>${esc(w.name)}</h3><div class="loc">${esc(w.location || 'No location set')}${othersExist() ? ` · <span class="owner-tag">${esc(w.ownerName)}</span>` : ''}</div></div>
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
    return `<div class="hcell" data-go="#/h/${w.id}/calendar" title="${othersExist() ? 'Belongs to ' + esc(w.ownerName) : ''}"><span class="dot" style="background:${w.color}"></span>${esc(w.name)}</div><div class="row">${line}${bars}</div>`;
  }).join('');
  return `<div class="tl-head"><h2>Timeline <small style="font-family:var(--sans);font-size:.8rem;color:var(--muted);font-weight:500">all houses</small></h2>
      <div class="legend" style="margin:0 .5rem 0 0">${Object.keys(SOURCES).map(s => `<span class="chip ${s}">${SOURCES[s]}</span>`).join('')}</div>
      <button class="btn small" data-tl="-14">←</button><button class="btn small" data-tl="0">Today</button><button class="btn small" data-tl="14">→</button></div>
    <div class="tl-scroll"><div class="tl" style="--days:${N}">${head}${rows}</div></div>`;
}
const barClass = (r, contL, contR) => [r.source, r.status === 'pending' && 'pending', r.status === 'blocked' && 'blocked', r.conflicts.length && 'conflict', contL && 'cont-l', contR && 'cont-r'].filter(Boolean).join(' ');

// Stays as tappable cards: the phone version of the calendar and the bookings table.
function agenda(list, w, empty = 'No stays this month.') {
  if (!list.length) return `<div class="agenda"><p class="empty">${empty}</p></div>`;
  return `<div class="agenda">${list.map(r => `<button class="ag-item ${r.source}" data-open="${r.id}">
      <div class="ag-dates"><b>${D(r.checkIn).getUTCDate()}</b><span>${MONTHS[D(r.checkIn).getUTCMonth()]}</span></div>
      <div class="ag-main"><div class="ag-name">${r.guestName ? esc(r.guestName) : `<span class="missing">${SOURCES[r.source]} guest</span>`}${r.conflicts.length ? ' <span class="warn-dot">⚠</span>' : ''}</div>
        <div class="ag-sub">${range(r)} · ${nightsOf(r.checkIn, r.checkOut)} nights${r.guests ? ` · ${r.guests} guests` : ''}${r.code ? ` · ${esc(r.code)}` : ''}</div>
        <div class="ag-tags"><span class="chip ${r.source}">${SOURCES[r.source]}</span><span class="status ${r.status}">${r.status}</span></div></div>
      <div class="ag-price">${r.price ? money(r.price, w.currency) : ''}</div>
    </button>`).join('')}</div>`;
}

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
  if (!hid && isOwner() && S.state.workspaces.some(w => w.demo)) out.push(`<div class="alert info" data-go="#/settings"><span>These are <b>demo houses</b>. Remove them in Settings when you're ready.</span></div>`);
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
      <div class="cal"><div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div>${html}</div>
      ${agenda(items.filter(r => r.checkIn < nextMonth(S.month) && r.checkOut > S.month).sort((a, b) => a.checkIn.localeCompare(b.checkIn)), w)}`;
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
        </tbody></table></div>
      ${agenda(list, w, 'No reservations match.')}`;
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
      <div class="card"><h2>Activity</h2><ul class="log">${S.state.log.filter(l => l.workspaceId === w.id).slice(0, 40).map(l => `<li><time>${new Date(l.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span class="${l.level}">${esc(l.msg)}${l.by ? ` <span style="color:var(--muted)">· ${esc(l.by)}</span>` : ''}</span></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul></div>
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
      ${!isNew && othersExist() ? `<label class="field full">Belongs to<select name="ownerId">
        <option value="owner" ${w.ownerId === 'owner' ? 'selected' : ''}>Owner (you)</option>
        ${S.state.users.map(u => `<option value="${u.id}" ${w.ownerId === u.id ? 'selected' : ''}>${esc(u.name)}${u.status === 'active' ? '' : ' (invite not accepted yet)'}</option>`).join('')}
      </select><span class="help">Only this person (and the owner) can see the house and its reservations.</span></label>` : ''}
      <div class="field full">Colour<div class="swatches">${COLORS.map(c => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${w.color === c ? 'checked' : ''}></label>`).join('')}</div></div>
      ${f('checkInTime', 'Check-in from', 'time')}${f('checkOutTime', 'Check-out by', 'time')}
    </div></div>
    <div class="${isNew ? '' : 'card'}">${isNew ? '<h3 style="font-size:1rem;margin-bottom:.6rem">Website booking rules</h3>' : '<h2>Website booking rules</h2>'}<div class="form-grid">
      ${f('nightlyPrice', 'Price per night', 'number', 'min="0"')}${f('cleaningFee', 'Cleaning fee', 'number', 'min="0"')}
      ${f('minNights', 'Minimum nights', 'number', 'min="1"')}${f('maxGuests', 'Max guests', 'number', 'min="1"')}
      <label class="field">Currency<select name="currency">${['EUR', 'GBP', 'USD', 'BRL', 'CHF'].map(c => `<option ${w.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="switch full"><input type="checkbox" name="autoConfirm" ${w.autoConfirm ? 'checked' : ''}> Confirm website bookings automatically</label>
    </div>${isNew ? '' : '<div style="margin-top:1rem"><button class="btn primary" type="submit">Save changes</button></div>'}</div>
    ${isNew ? '' : `<div class="card full-span"><h2>Confirmation email</h2>
      <p class="help" style="margin:0 0 .8rem">When you confirm a booking, the guest gets an email${S.state.mailFrom ? ` from <b>${esc(S.state.mailFrom)}</b>` : ''} in their language (Portuguese or English) with the dates, check-in and check-out times, guests, total and reference.</p>
      <label class="field" style="margin-bottom:.9rem">Logo in emails (optional)<input name="emailLogo" type="url" inputmode="url" placeholder="https://…/logo.png" value="${esc(w.emailLogo || '')}">
      <span class="help">A link to an image (PNG or JPG). Shown at the top of the confirmation email.</span></label>
      <div class="logo-preview" id="logoPreview">${w.emailLogo ? `<img src="${esc(w.emailLogo)}" alt="">` : ''}</div>
      <label class="field">Extra message (optional)<textarea name="confirmMessage" rows="5" maxlength="3000" placeholder="e.g. how to pay the 30% deposit, the address and how to get there, who to call on arrival">${esc(w.confirmMessage || '')}</textarea>
      <span class="help">Added to every confirmation email for this house, exactly as written.</span></label>
      <div style="margin-top:1rem"><button class="btn primary" type="submit">Save changes</button></div></div>`}
  </form>`;
}
function readHouseForm() {
  const form = $('#houseForm'), fd = new FormData(form), b = Object.fromEntries(fd);
  b.autoConfirm = fd.has('autoConfirm');
  return b;
}

function peopleCard() {
  const me = S.state.me || {}, users = S.state.users || [];
  const row = (name, sub, status, actions) => `<li style="display:flex;align-items:center;gap:.8rem;padding:.7rem 0;border-top:1px solid var(--line)">
    <div class="avatar">${esc(name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</div>
    <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(name)}</div><div class="help" style="margin:0">${sub}</div></div>
    ${status}${actions}</li>`;
  const badge = (t, cls) => `<span class="tag ${cls}">${t}</span>`;
  return `<div class="card"><h2>People <small>each person sees only their own houses</small></h2>
    <ul style="list-style:none;margin:0;padding:0">
      ${row('Owner', 'Sees every house · signs in with the owner password (leave the username empty)', badge('owner', 'in'), '')}
      ${users.map(u => row(u.name, `username <b>${esc(u.login)}</b>${u.email ? ' · ' + esc(u.email) : ''}${u.createdBy ? ' · added by ' + esc(u.createdBy) : ''}`,
        u.status === 'active' ? badge('active', 'in') : badge(u.status === 'invited' ? 'invite sent' : 'invite expired', 'out'),
        u.id === me.id ? '<span class="help" style="margin:0">you</span>' : `<button class="btn small" data-reinvite="${u.id}" title="Make a new invite link (also resets a forgotten password)">${u.status === 'active' ? 'Reset password' : 'New link'}</button><button class="btn small danger" data-remove-user="${u.id}">Remove</button>`)).join('')}
    </ul>
    <div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap"><button class="btn primary" id="inviteBtn">+ Invite a person</button>
    </div></div>`;
}

function viewSettings() {
  const s = S.state.settings;
  if (!isOwner()) return `<div class="card" style="max-width:560px"><h2>My account</h2>
    <p class="help" style="margin:0 0 1rem">Signed in as <b>${esc(S.state.me.name)}</b>. You see the houses that belong to you. Ask the owner to add or move houses, or to invite people.</p>
    <button class="btn" id="changePw">Change my password</button></div>`;
  return peopleCard() + `<div class="grid two">
    <div class="card"><h2>Calendar sync</h2>
      <label class="field">Check every connected calendar every<select id="syncMinutes">${[5, 15, 30, 60, 180].map(m => `<option value="${m}" ${s.syncMinutes == m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')}</option>`).join('')}</select></label>
      <div style="margin-top:1rem"><button class="btn primary" id="saveSettings">Save</button></div></div>
    <div class="card"><h2>Guest emails</h2>
      ${S.state.mailReady ? `<div class="ch-status ok">Sending from ${esc(S.state.mailFrom)}</div><p class="help" style="margin:.6rem 0 0">Confirmation emails go out when you confirm a booking. Each house can add its own message in House settings.</p>`
        : `<div class="ch-status err">Not set up yet</div><p class="help" style="margin:.6rem 0 0">Create a Gmail app password for ${esc(S.state.mailFrom || 'the sending Gmail account')} and save it on the server with <code>npx wrangler secret put GMAIL_APP_PASSWORD</code>.</p>`}
    </div>
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
      const lg = $('#houseForm [name=emailLogo]'), pv = $('#logoPreview');
      if (lg) lg.oninput = () => { const u = lg.value.trim(); pv.innerHTML = /^https:\/\/\S+$/i.test(u) ? `<img src="${esc(u)}" alt="" onerror="this.parentNode.innerHTML='<span class=help>That link doesn’t show an image.</span>'">` : ''; };
      $('#houseForm').onsubmit = async e => { e.preventDefault(); try { await api(`/api/workspaces/${hid}`, { method: 'PUT', body: readHouseForm() }); toast('Saved'); await refresh(); } catch (err) { toast(err.message); } };
      $('#delHouse').onclick = async () => {
        const w = houseById(hid);
        if (prompt(`This deletes ${w.name} and all its reservations. Type the house name to confirm.`) !== w.name) return;
        await api(`/api/workspaces/${hid}`, { method: 'DELETE' }); toast('House deleted'); location.hash = '#/'; await refresh();
      };
      return;
    }
    const cp = $('#changePw'); if (cp) cp.onclick = openPasswordDrawer;
    if (!isOwner()) return;
    $('#inviteBtn').onclick = openInviteDrawer;
    $$('[data-reinvite]').forEach(b => b.onclick = async () => {
      const u = S.state.users.find(x => x.id === b.dataset.reinvite);
      if (u.status === 'active' && !confirm(`Reset ${u.name}'s password? They are signed out and need the new link to choose a password again.`)) return;
      try { const d = await api(`/api/users/${u.id}/invite`, { method: 'POST' }); await refresh(); showInviteLink(d.user, d.inviteToken); } catch (e) { toast(e.message); }
    });
    $$('[data-remove-user]').forEach(b => b.onclick = async () => {
      const u = S.state.users.find(x => x.id === b.dataset.removeUser);
      if (!confirm(`Remove ${u.name}? They lose access straight away.`)) return;
      try { await api('/api/users/' + u.id, { method: 'DELETE' }); toast(`${u.name} removed`); await refresh(); } catch (e) { toast(e.message); }
    });
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
  const b = $('#syncBtn'), ab = $('#abSync'); b.classList.add('spin'); b.disabled = true; if (ab) ab.classList.add('spin');
  try {
    const { results } = await api(hid ? `/api/workspaces/${hid}/sync` : '/api/sync', { method: 'POST' });
    const done = results.filter(r => !r.skipped);
    if (!done.length) toast('No calendar links connected yet');
    else if (done.some(r => r.error)) toast('Sync finished with errors. See Connections.');
    else toast(`Synced: ${done.reduce((n, r) => n + r.added, 0)} new, ${done.reduce((n, r) => n + r.updated + r.removed, 0)} changed`);
    await refresh();
  } catch (e) { toast(e.message); }
  finally { b.classList.remove('spin'); b.disabled = false; const a2 = $('#abSync'); if (a2) a2.classList.remove('spin'); }
}
$('#syncBtn').onclick = () => doSync(S.route.name === 'house' ? S.route.hid : null);
$('#newBtn').onclick = () => openDrawer(null, { hid: S.route.hid, day: S.state.today });

// ---------- drawers ----------
function showDrawer(html) { const dr = $('#drawer'); dr.classList.remove('is-sheet'); dr.innerHTML = html; dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; $('#closeDr').onclick = closeDrawer; }
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
  const synced = !!r.uid, cur = w ? w.currency : 'EUR', hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email || '');
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
      ${id && r.status !== 'confirmed' && r.status !== 'blocked' ? `<label class="switch" title="${hasEmail ? '' : 'Add the guest email to send one'}"><input type="checkbox" id="notifyGuest" ${hasEmail && S.state.mailReady ? 'checked' : 'disabled'}> Email ${esc(r.guestName ? r.guestName.split(' ')[0] : 'the guest')} a confirmation when I confirm</label>
        ${!S.state.mailReady ? '<p class="help" style="margin:-.5rem 0 0">Email sending isn’t set up yet.</p>' : !hasEmail ? '<p class="help" style="margin:-.5rem 0 0">No guest email on this reservation.</p>' : ''}` : ''}
      ${id && r.status === 'confirmed' && hasEmail ? `<div class="note">${r.confirmationSentAt ? `Confirmation email sent ${new Date(r.confirmationSentAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'No confirmation email sent yet.'}
        <button type="button" class="btn small" id="emailRes" style="margin-left:.4rem" ${S.state.mailReady ? '' : 'disabled title="Email sending isn’t set up yet"'}>${r.confirmationSentAt ? 'Send again' : 'Send confirmation email'}</button></div>` : ''}
    </form>
    <footer>
      ${id && !synced ? '<button class="btn danger left" id="delRes">Delete</button>' : ''}
      ${r.status === 'pending' ? '<button class="btn" id="declineRes">Decline</button><button class="btn primary" id="confirmRes">Confirm booking</button>'
        : `<button class="btn" id="cancelDr">Close</button><button class="btn primary" id="saveRes">${id ? 'Save' : 'Add reservation'}</button>`}
    </footer>`);
  const collect = () => { const fd = Object.fromEntries(new FormData($('#resForm'))); fd.guests = fd.guests === '' ? null : +fd.guests; fd.price = fd.price === '' ? null : +fd.price; return fd; };
  const save = async override => {
    try {
      const nb = $('#notifyGuest'), body = { ...collect(), ...override, notifyGuest: !!(nb && nb.checked) };
      const res = id ? await api('/api/reservations/' + id, { method: 'PUT', body }) : await api('/api/reservations', { method: 'POST', body });
      closeDrawer();
      toast(res.emailSent ? `Confirmed · email sent to ${res.email}` : res.emailError ? `Saved, but the email failed: ${res.emailError}` : id ? 'Saved' : 'Reservation added');
      await refresh();
    } catch (e) { toast(e.message); }
  };
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on('#cancelDr', closeDrawer); on('#saveRes', () => save());
  on('#emailRes', async () => {
    const b = $('#emailRes'); b.disabled = true; b.textContent = 'Sending…';
    try { await api(`/api/reservations/${id}/email`, { method: 'POST' }); toast(`Email sent to ${r.email}`); closeDrawer(); await refresh(); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Try again'; }
  });
  on('#confirmRes', () => save({ status: 'confirmed' })); on('#declineRes', () => save({ status: 'cancelled' }));
  on('#delRes', async () => { if (!confirm('Delete this reservation for good?')) return; await api('/api/reservations/' + id, { method: 'DELETE' }); closeDrawer(); toast('Deleted'); await refresh(); });
}

// ---------- people drawers ----------
const inviteUrl = t => `${location.origin}${location.pathname}#/invite/${t}`;
function openInviteDrawer() {
  showDrawer(`<header><div><h2>Invite a person</h2><p class="sub">They'll see only the houses that belong to them: the ones they add, or that you move to them.</p></div><button class="x" id="closeDr" aria-label="Close">×</button></header>
    <form class="body" id="inviteForm">
      <label class="field">Full name<input name="name" required maxlength="80" autocomplete="off"></label>
      <label class="field">Username<input name="login" maxlength="40" autocapitalize="none" spellcheck="false" placeholder="first name, if left empty"><span class="help">What they type to sign in.</span></label>
      <label class="field">Email <span style="font-weight:400;color:var(--muted)">(optional)</span><input name="email" type="email" autocomplete="off"><span class="help">They can also sign in with it.</span></label>
      <div class="note">You'll get a link to send them. They open it and choose their own password, so you never need to know it. The link works once and expires after 7 days.</div>
    </form>
    <footer><button class="btn" id="cancelDr">Cancel</button><button class="btn primary" id="createInvite">Create invite link</button></footer>`);
  $('#cancelDr').onclick = closeDrawer;
  const f = $('#inviteForm');
  f.name.oninput = () => { if (!f.login.dataset.touched) f.login.value = f.name.value.trim().split(/\s+/)[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]/g, ''); };
  f.login.oninput = () => { f.login.dataset.touched = '1'; };
  setTimeout(() => f.name.focus(), 50);
  $('#createInvite').onclick = async () => {
    try { const d = await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); await refresh(); showInviteLink(d.user, d.inviteToken); }
    catch (e) { toast(e.message); }
  };
}
function showInviteLink(user, t) {
  const link = inviteUrl(t);
  const mail = `mailto:${encodeURIComponent(user.email || '')}?subject=${encodeURIComponent('Your Alpendre access')}&body=${encodeURIComponent(`Hi ${user.name.split(' ')[0]},\n\nYou now have access to Alpendre, where we manage the houses and their reservations.\n\nOpen this link to choose your password (it works once, within 7 days):\n${link}\n\nYour username is: ${user.login}\n`)}`;
  showDrawer(`<header><div><h2>Invite ready</h2><p class="sub">${esc(user.name)} · username <b>${esc(user.login)}</b></p></div><button class="x" id="closeDr" aria-label="Close">×</button></header>
    <div class="body">
      <p style="margin:0">Send this link to ${esc(user.name.split(' ')[0])}. Opening it lets them choose a password and signs them in.</p>
      <div class="copy"><input readonly value="${esc(link)}"><button class="btn small" id="copyInvite">Copy</button></div>
      <a class="btn" href="${esc(mail)}" style="align-self:flex-start;text-decoration:none">Write an email with the link</a>
      <div class="note">Anyone with this link can claim the account, so only send it to ${esc(user.name.split(' ')[0])}. It expires in 7 days. If it gets lost, use <b>New link</b> in People.</div>
    </div>
    <footer><button class="btn primary" id="doneDr">Done</button></footer>`);
  $('#doneDr').onclick = closeDrawer;
  $('#copyInvite').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Select the link and press Ctrl+C'); } };
}
function openPasswordDrawer() {
  showDrawer(`<header><div><h2>Change my password</h2></div><button class="x" id="closeDr" aria-label="Close">×</button></header>
    <form class="body" id="pwForm">
      <label class="field">Current password<input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field">New password<input type="password" name="next" autocomplete="new-password" minlength="8" required><span class="help">At least 8 characters.</span></label>
    </form>
    <footer><button class="btn" id="cancelDr">Cancel</button><button class="btn primary" id="savePw">Change password</button></footer>`);
  $('#cancelDr').onclick = closeDrawer;
  $('#savePw').onclick = async () => {
    try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData($('#pwForm'))) }); closeDrawer(); toast('Password changed'); }
    catch (e) { toast(e.message); }
  };
}

// ---------- boot ----------
S.route = parseRoute();
if (S.route.name === 'invite') showInvite(S.route.token);
else if (!TOKEN) showLogin();
else api('/api/state').then(st => { S.state = st; $('#app').hidden = false; render(); }).catch(e => { if (e.message !== 'Signed out') { showLogin(); $('#loginErr').textContent = e.message; } });
