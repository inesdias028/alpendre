// Alpendre host dashboard
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SOURCES = { airbnb: 'Airbnb', booking: 'Booking.com', direct: 'Website', manual: 'Manual' };
const S = { state: null, view: 'overview', month: null, filter: { q: '', source: 'all', status: 'active', when: 'upcoming' } };

// ---------- dates ----------
const D = s => new Date(s + 'T00:00:00Z');
const F = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return F(d); };
const nightsOf = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fullMonth = d => d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const short = s => { const d = D(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const range = r => `${short(r.checkIn)} → ${short(r.checkOut)}`;
const money = n => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: S.state?.settings.currency || 'EUR', maximumFractionDigits: 0 }).format(n);
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.errors || []).join(' ') || 'Request failed');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }

async function refresh() { S.state = await api('/api/state'); render(); }

// ---------- auth ----------
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
    $('#login').hidden = true; $('#app').hidden = false; await refresh();
  } catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

// ---------- derived data ----------
const live = () => S.state.reservations.filter(r => r.status !== 'cancelled');
const stays = () => live().filter(r => r.status !== 'blocked');
function nightsIn(r, from, to) { // nights of r inside [from, to)
  const a = r.checkIn > from ? r.checkIn : from, b = r.checkOut < to ? r.checkOut : to;
  return Math.max(0, nightsOf(a, b));
}

// ---------- router ----------
const TITLES = {
  overview: ['Overview', ''],
  calendar: ['Calendar', 'Every channel on one calendar. Click a stay to open it, or a day to add one.'],
  reservations: ['Reservations', 'All stays from Airbnb, Booking.com, your website and manual entries.'],
  channels: ['Channels', 'Connect Airbnb and Booking.com through their calendar (iCal) links.'],
  settings: ['Property & site', 'What guests see on your website and the rules for direct bookings.'],
};
window.addEventListener('hashchange', () => { S.view = location.hash.slice(1) || 'overview'; render(); });

function render() {
  if (!S.state) return;
  if (!TITLES[S.view]) S.view = 'overview';
  document.querySelectorAll('.side nav a').forEach(a => a.classList.toggle('active', a.dataset.view === S.view));
  const [t, sub] = TITLES[S.view];
  $('#viewTitle').textContent = t;
  $('#viewSub').textContent = S.view === 'overview' ? greeting() : sub;
  const pending = live().filter(r => r.status === 'pending').length;
  $('#pendingBadge').hidden = !pending; $('#pendingBadge').textContent = pending;
  $('#view').innerHTML = VIEWS[S.view]();
  if (AFTER[S.view]) AFTER[S.view]();
}
function greeting() {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening'} — here is ${esc(S.state.settings.propertyName)} at a glance.`;
}

// ---------- views ----------
const VIEWS = {
  overview() {
    const t = S.state.today;
    const mStart = t.slice(0, 8) + '01';
    const next = new Date(D(mStart)); next.setUTCMonth(next.getUTCMonth() + 1); const mEnd = F(next);
    const daysInMonth = nightsOf(mStart, mEnd);
    const booked = stays().reduce((n, r) => n + nightsIn(r, mStart, mEnd), 0);
    const occ = Math.round(booked / daysInMonth * 100);
    const revenue = stays().reduce((n, r) => { const tot = nightsOf(r.checkIn, r.checkOut); return n + (r.price ? r.price * nightsIn(r, mStart, mEnd) / tot : 0); }, 0);
    const week = add(t, 7);
    const arrivals = stays().filter(r => r.checkIn >= t && r.checkIn < week);
    const pending = live().filter(r => r.status === 'pending');
    const inHouse = stays().find(r => r.checkIn <= t && r.checkOut > t);

    // arrivals & departures, next 14 days
    const horizon = add(t, 14);
    const moves = [];
    for (const r of stays()) {
      if (r.checkIn >= t && r.checkIn < horizon) moves.push({ d: r.checkIn, type: 'in', r });
      if (r.checkOut >= t && r.checkOut < horizon) moves.push({ d: r.checkOut, type: 'out', r });
    }
    moves.sort((a, b) => a.d.localeCompare(b.d) || (a.type === 'out' ? -1 : 1));

    // channel mix, next 90 days + last 30
    const from = add(t, -30), to = add(t, 90);
    const mix = {}; let mixTotal = 0;
    for (const r of stays()) { const n = nightsIn(r, from, to); if (n) { mix[r.source] = (mix[r.source] || 0) + n; mixTotal += n; } }

    // alerts
    const alerts = [];
    const conflicts = live().filter(r => r.conflicts.length);
    if (conflicts.length) alerts.push(`<div class="alert bad" data-go="reservations"><b>Double booking!</b> ${conflicts.length} stays overlap. Open them and cancel one on its channel.</div>`);
    for (const r of pending) alerts.push(`<div class="alert warn" data-open="${r.id}"><span><b>${esc(r.guestName)}</b> asked to book ${range(r)} through your website. Confirm or decline.</span></div>`);
    const noName = stays().filter(r => r.checkOut >= t && !r.guestName).length;
    if (noName) alerts.push(`<div class="alert info" data-go="reservations"><span><b>${noName} synced stays</b> have no guest name yet. Airbnb and Booking.com calendars only share dates, so add the guest details yourself.</span></div>`);
    const noFeeds = !S.state.settings.channels.airbnb.url && !S.state.settings.channels.booking.url;
    if (noFeeds) alerts.push(`<div class="alert info" data-go="channels"><span><b>Connect your channels.</b> Paste your Airbnb and Booking.com calendar links to import reservations automatically.</span></div>`);
    if (S.state.reservations.some(r => r.demo)) alerts.push(`<div class="alert info" data-go="settings"><span>You are looking at <b>demo reservations</b>. Remove them from Property &amp; site when you're ready.</span></div>`);

    return `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Occupancy · ${MONTHS[D(t).getUTCMonth()]}</div><div class="value">${occ}%</div>
        <div class="hint">${booked} of ${daysInMonth} nights booked</div><div class="meter"><span style="width:${occ}%"></span></div></div>
      <div class="card kpi"><div class="label">Revenue · ${MONTHS[D(t).getUTCMonth()]}</div><div class="value">${money(Math.round(revenue))}</div>
        <div class="hint">From stays with a price set</div></div>
      <div class="card kpi"><div class="label">Arrivals · next 7 days</div><div class="value">${arrivals.length}</div>
        <div class="hint">${inHouse ? `In the house now: ${esc(inHouse.guestName || SOURCES[inHouse.source] + ' guest')}` : 'The house is empty tonight'}</div></div>
      <div class="card kpi"><div class="label">Website requests</div><div class="value">${pending.length}</div>
        <div class="hint">${pending.length ? 'Waiting for your answer' : 'All answered'}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Coming and going <small>next 14 days</small></h2>
        ${moves.length ? `<ul class="moves">${moves.map(m => { const d = D(m.d); return `
          <li data-open="${m.r.id}"><div class="datebox"><div class="d">${d.getUTCDate()}</div><div class="m">${MONTHS[d.getUTCMonth()]}</div></div>
          <div><div class="who">${esc(m.r.guestName) || `<span class="missing">${SOURCES[m.r.source]} guest</span>`}</div>
          <div class="what">${m.type === 'in' ? `Check-in ${esc(S.state.settings.checkInTime)} · ${nightsOf(m.r.checkIn, m.r.checkOut)} nights` : `Check-out ${esc(S.state.settings.checkOutTime)} · clean the house`}${m.r.guests ? ` · ${m.r.guests} guests` : ''}</div></div>
          <div style="display:flex;gap:.4rem;align-items:center"><span class="chip ${m.r.source}">${SOURCES[m.r.source]}</span><span class="tag ${m.type}">${m.type === 'in' ? 'Arrives' : 'Leaves'}</span></div></li>`; }).join('')}</ul>`
          : '<p class="empty">No arrivals or departures in the next two weeks.</p>'}
      </div>
      <div style="display:flex;flex-direction:column;gap:1rem">
        <div class="card"><h2>Needs attention</h2>${alerts.join('') || '<p class="empty">Nothing to do. Enjoy the porch.</p>'}</div>
        <div class="card"><h2>Where bookings come from <small>nights, −30 to +90 days</small></h2>
          <div class="mix-bar">${Object.keys(SOURCES).filter(s => mix[s]).map(s => `<span style="flex:${mix[s]};background:var(--${s})"></span>`).join('') || '<span style="flex:1;background:var(--line)"></span>'}</div>
          ${Object.keys(SOURCES).map(s => `<div class="mix-row"><span class="chip ${s}">${SOURCES[s]}</span><span class="n">${mix[s] || 0} nights · ${mixTotal ? Math.round((mix[s] || 0) / mixTotal * 100) : 0}%</span></div>`).join('')}
        </div>
      </div>
    </div>`;
  },

  calendar() {
    if (!S.month) S.month = S.state.today.slice(0, 8) + '01';
    const first = D(S.month);
    const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
    const gridStart = add(S.month, -startOffset);
    const nextMonth = new Date(first); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const weeks = Math.ceil((startOffset + nightsOf(S.month, F(nextMonth))) / 7);
    const items = live();
    let html = '';
    for (let w = 0; w < weeks; w++) {
      const ws = add(gridStart, w * 7), we = add(ws, 7);
      let days = '', nums = '';
      for (let i = 0; i < 7; i++) {
        const d = add(ws, i), cls = [d.slice(0, 7) !== S.month.slice(0, 7) && 'other', d === S.state.today && 'today', d < S.state.today && 'past'].filter(Boolean).join(' ');
        days += `<div class="day ${cls}" data-day="${d}"></div>`;
        nums += `<div class="num-cell ${cls}" style="grid-column:${i + 1}"><span class="num">${D(d).getUTCDate()}</span></div>`;
      }
      // bars: occupied nights checkIn..checkOut-1, lanes assigned greedily
      const segs = items.filter(r => r.checkIn < we && r.checkOut > ws).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
      const lanes = [];
      let bars = '';
      for (const r of segs) {
        const s = r.checkIn < ws ? 0 : nightsOf(ws, r.checkIn);
        const e = r.checkOut > we ? 7 : nightsOf(ws, r.checkOut);
        let lane = lanes.findIndex(end => end <= s); if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = e;
        const cls = [r.source, r.status === 'pending' && 'pending', r.status === 'blocked' && 'blocked', r.conflicts.length && 'conflict', r.checkIn < ws && 'cont-l', r.checkOut > we && 'cont-r'].filter(Boolean).join(' ');
        const name = r.guestName || SOURCES[r.source] + ' guest';
        bars += `<div class="bar ${cls}" data-open="${r.id}" title="${esc(name)} · ${range(r)}" style="grid-column:${s + 1}/${Math.max(e, s + 1) + 1};grid-row:${lane + 2}">${esc(name)}${r.status === 'pending' ? ' · pending' : ''}</div>`;
      }
      html += `<div class="week"><div class="wk-bg">${days}</div>${nums}${bars}</div>`;
    }
    return `
      <div class="cal-head">
        <button class="btn small" data-month="-1" aria-label="Previous month">←</button>
        <button class="btn small" data-month="0">Today</button>
        <button class="btn small" data-month="1" aria-label="Next month">→</button>
        <h2>${fullMonth(first)}</h2>
        <div class="legend">${Object.keys(SOURCES).map(s => `<span class="chip ${s}">${SOURCES[s]}</span>`).join('')}</div>
      </div>
      <div class="cal"><div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div>${html}</div>`;
  },

  reservations() {
    const f = S.filter, t = S.state.today;
    let list = S.state.reservations.slice();
    if (f.source !== 'all') list = list.filter(r => r.source === f.source);
    if (f.status === 'active') list = list.filter(r => r.status !== 'cancelled');
    else if (f.status !== 'all') list = list.filter(r => r.status === f.status);
    if (f.when === 'upcoming') list = list.filter(r => r.checkOut >= t);
    if (f.when === 'past') list = list.filter(r => r.checkOut < t);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter(r => [r.guestName, r.email, r.code, r.notes].join(' ').toLowerCase().includes(q)); }
    list.sort((a, b) => f.when === 'past' ? b.checkIn.localeCompare(a.checkIn) : a.checkIn.localeCompare(b.checkIn));
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-f="${key}" data-v="${v}" class="${f[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `
      <div class="filters">
        <input type="search" id="q" placeholder="Search guest, email, code…" value="${esc(f.q)}">
        ${seg('when', [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']])}
        <select id="fSource"><option value="all">All channels</option>${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${f.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="fStatus">${[['active', 'Not cancelled'], ['confirmed', 'Confirmed'], ['pending', 'Pending'], ['blocked', 'Blocked'], ['cancelled', 'Cancelled'], ['all', 'Any status']].map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Guest</th><th>Channel</th><th>Dates</th><th class="num">Nights</th><th class="num">Guests</th><th class="num">Total</th><th>Status</th><th>Ref.</th></tr></thead>
        <tbody>${list.map(r => `
          <tr data-open="${r.id}">
            <td>${esc(r.guestName) || '<span class="missing">Add guest name</span>'}${r.conflicts?.length ? '<span class="warn-dot" title="Overlaps another stay">⚠</span>' : ''}</td>
            <td><span class="chip ${r.source}">${SOURCES[r.source]}</span></td>
            <td>${range(r)} ${D(r.checkIn).getUTCFullYear()}</td>
            <td class="num">${nightsOf(r.checkIn, r.checkOut)}</td>
            <td class="num">${r.guests ?? '—'}</td>
            <td class="num">${money(r.price)}</td>
            <td><span class="status ${r.status}">${r.status}</span></td>
            <td style="color:var(--muted);font-size:.8rem">${esc(r.code || '')}</td>
          </tr>`).join('') || `<tr><td colspan="8" class="empty">No reservations match.</td></tr>`}
        </tbody></table></div>`;
  },

  channels() {
    const s = S.state.settings;
    const base = location.origin + '/ical/' + s.exportToken;
    const card = (key, letter, color, hint, steps, exportSteps) => {
      const ch = s.channels[key];
      const st = ch.lastStatus || '';
      return `<div class="card ch-card">
        <div class="ch-top"><div class="ch-logo" style="background:${color}">${letter}</div><div><h3>${SOURCES[key]}</h3><p>${hint}</p></div></div>
        <label class="field">1 · Import: ${SOURCES[key]} calendar link
          <input data-ch="${key}" type="url" placeholder="https://…ics" value="${esc(ch.url)}"></label>
        <details><summary>Where do I find this link?</summary><ol>${steps}</ol></details>
        <div class="ch-status ${st.startsWith('ok') ? 'ok' : st.startsWith('error') ? 'err' : ''}">${ch.url ? `Last sync ${ago(ch.lastSync)}${st ? ' · ' + esc(st) : ''}` : 'Not connected yet'}</div>
        <div class="field">2 · Export: paste this link into ${SOURCES[key]}
          <div class="copy"><input readonly value="${base}/${key}.ics"><button class="btn small" data-copy="${base}/${key}.ics">Copy</button></div>
          <p class="help">It blocks the dates booked everywhere else, so ${SOURCES[key]} never sells a night you have already sold.</p></div>
        <details><summary>How do I add it to ${SOURCES[key]}?</summary><ol>${exportSteps}</ol></details>
      </div>`;
    };
    return `
      <div class="grid channels">
        ${card('airbnb', 'A', 'var(--airbnb)', 'Syncs through Airbnb’s calendar link',
          '<li>Open Airbnb and go to <b>Calendar</b>, then choose your listing.</li><li>Open <b>Availability</b> → <b>Connect calendars</b> (or <b>Sync calendars</b>).</li><li>Click <b>Export calendar</b> and copy the link.</li><li>Paste it above and click <b>Save channels</b>.</li>',
          '<li>In the same <b>Connect calendars</b> screen click <b>Import calendar</b>.</li><li>Paste the export link, name it “Alpendre” and save.</li>')}
        ${card('booking', 'B', 'var(--booking)', 'Syncs through the Booking.com extranet',
          '<li>Sign in to the <b>Booking.com extranet</b>.</li><li>Go to <b>Rates &amp; Availability</b> → <b>Sync calendars</b>.</li><li>Choose <b>Export calendar</b> and copy the link.</li><li>Paste it above and click <b>Save channels</b>.</li>',
          '<li>In <b>Sync calendars</b> choose <b>Import calendar</b>.</li><li>Paste the export link, name it “Alpendre” and save.</li>')}
        <div class="card ch-card">
          <div class="ch-top"><div class="ch-logo" style="background:var(--direct)">W</div><div><h3>Your website</h3><p>Direct bookings, no commission</p></div></div>
          <div class="ch-status ok">Built in · always connected</div>
          <p style="margin:0;font-size:.9rem;color:var(--ink-2)">Guests book on your own site and the request lands here straight away. ${s.autoConfirm ? 'Requests are <b>confirmed automatically</b>.' : 'You <b>confirm each request</b> yourself.'}</p>
          <a class="btn" href="/" target="_blank" style="align-self:flex-start;text-decoration:none">Open guest website ↗</a>
          <div class="field">Calendar for Google / Apple Calendar
            <div class="copy"><input readonly value="${base}/all.ics"><button class="btn small" data-copy="${base}/all.ics">Copy</button></div>
            <p class="help">Subscribe to it on your phone to see every stay. Keep it private: anyone with the link can see your dates.</p></div>
        </div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Sync settings</h2>
          <div class="form-grid">
            <label class="field">Check channels every<select id="syncMinutes">${[15, 30, 60, 180].map(m => `<option value="${m}" ${s.syncMinutes == m ? 'selected' : ''}>${m < 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')}</option>`).join('')}</select></label>
          </div>
          <p class="help" style="margin-top:.8rem">Airbnb and Booking.com refresh imported calendars on their side every few hours, so avoid back-to-back bookings arriving in that window by keeping your calendars connected both ways.</p>
          <div style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn primary" id="saveChannels">Save channels</button><button class="btn" id="syncBtn2">Sync now</button></div>
        </div>
        <div class="card"><h2>Activity</h2>
          <ul class="log">${S.state.log.map(l => `<li><time>${new Date(l.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span class="${l.level}">${esc(l.msg)}</span></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul>
        </div>
      </div>`;
  },

  settings() {
    const s = S.state.settings;
    const f = (k, l, type = 'text', extra = '') => `<label class="field">${l}<input name="${k}" type="${type}" value="${esc(s[k])}" ${extra}></label>`;
    return `
      <form id="settingsForm" class="grid two" style="margin-top:0">
        <div class="card"><h2>Your house</h2><div class="form-grid">
          <div class="full">${f('propertyName', 'House name')}</div>
          <div class="full">${f('tagline', 'Tagline')}</div>
          <div class="full">${f('location', 'Location')}</div>
          <label class="field full">Description<textarea name="description" rows="4">${esc(s.description)}</textarea></label>
          ${f('bedrooms', 'Bedrooms', 'number', 'min="0"')}${f('bathrooms', 'Bathrooms', 'number', 'min="0"')}
          ${f('maxGuests', 'Max guests', 'number', 'min="1"')}${f('contactEmail', 'Contact email', 'email')}
          <label class="field full">Amenities<input name="amenities" value="${esc(s.amenities.join(', '))}"><span class="help">Separate with commas.</span></label>
        </div></div>
        <div style="display:flex;flex-direction:column;gap:1rem">
          <div class="card"><h2>Direct booking rules</h2><div class="form-grid">
            ${f('nightlyPrice', 'Price per night', 'number', 'min="0"')}${f('cleaningFee', 'Cleaning fee', 'number', 'min="0"')}
            ${f('minNights', 'Minimum nights', 'number', 'min="1"')}
            <label class="field">Currency<select name="currency">${['EUR', 'GBP', 'USD', 'BRL', 'CHF'].map(c => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            ${f('checkInTime', 'Check-in from', 'time')}${f('checkOutTime', 'Check-out by', 'time')}
            <label class="switch full"><input type="checkbox" name="autoConfirm" ${s.autoConfirm ? 'checked' : ''}> Confirm website bookings automatically</label>
          </div></div>
          <div class="card"><h2>Housekeeping</h2>
            ${S.state.reservations.some(r => r.demo) ? `<p class="help" style="margin:0 0 .8rem">Demo reservations are loaded so you can explore. Remove them before you go live.</p><button type="button" class="btn danger" id="clearDemo">Remove demo reservations</button>` : '<p class="help" style="margin:0">No demo data left.</p>'}
            ${S.state.defaultPassword ? '<div class="note bad" style="margin-top:1rem">You are using the default password. Start the server with <code>ALPENDRE_PASSWORD=your-password</code> to change it.</div>' : ''}
          </div>
          <div><button class="btn primary" type="submit">Save changes</button></div>
        </div>
      </form>`;
  },
};

// ---------- view wiring ----------
const AFTER = {
  calendar() {
    document.querySelectorAll('[data-month]').forEach(b => b.onclick = () => {
      const n = +b.dataset.month;
      if (!n) S.month = S.state.today.slice(0, 8) + '01';
      else { const d = D(S.month); d.setUTCMonth(d.getUTCMonth() + n); S.month = F(d); }
      render();
    });
    document.querySelectorAll('.day').forEach(d => d.onclick = () => openDrawer(null, d.dataset.day));
  },
  reservations() {
    const q = $('#q'); q.oninput = () => { S.filter.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#fSource').onchange = e => { S.filter.source = e.target.value; render(); };
    $('#fStatus').onchange = e => { S.filter.status = e.target.value; render(); };
    document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter[b.dataset.f] = b.dataset.v; render(); });
  },
  channels() {
    document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { b.previousElementSibling.select(); toast('Press Ctrl+C to copy'); }
    });
    $('#saveChannels').onclick = async () => {
      const channels = {}; document.querySelectorAll('[data-ch]').forEach(i => channels[i.dataset.ch] = { url: i.value });
      try { await api('/api/settings', { method: 'PUT', body: { channels, syncMinutes: +$('#syncMinutes').value } }); toast('Channels saved — syncing…'); await doSync(); }
      catch (e) { toast(e.message); }
    };
    $('#syncBtn2').onclick = doSync;
  },
  settings() {
    $('#settingsForm').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target), body = Object.fromEntries(fd);
      body.autoConfirm = fd.has('autoConfirm');
      body.amenities = String(body.amenities).split(',').map(s => s.trim()).filter(Boolean);
      try { await api('/api/settings', { method: 'PUT', body }); toast('Saved'); await refresh(); } catch (err) { toast(err.message); }
    };
    const c = $('#clearDemo'); if (c) c.onclick = async () => {
      if (!confirm('Remove all demo reservations? Your real reservations stay.')) return;
      await api('/api/demo', { method: 'DELETE' }); toast('Demo reservations removed'); await refresh();
    };
  },
};

// global delegated clicks (open reservation / go to view)
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.stopPropagation(); return openDrawer(o.dataset.open); }
  const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go;
}, true);

async function doSync() {
  const b = $('#syncBtn'); b.classList.add('spin'); b.disabled = true;
  try {
    const { results } = await api('/api/sync', { method: 'POST' });
    const done = results.filter(r => !r.skipped);
    if (!done.length) toast('No channel links yet — add them in Channels');
    else if (done.some(r => r.error)) toast('Sync finished with errors — see Channels');
    else toast(`Synced: ${done.reduce((n, r) => n + r.added, 0)} new, ${done.reduce((n, r) => n + r.updated + r.removed, 0)} changed`);
    await refresh();
  } catch (e) { toast(e.message); }
  finally { b.classList.remove('spin'); b.disabled = false; }
}
$('#syncBtn').onclick = doSync;
$('#newBtn').onclick = () => openDrawer(null, S.state.today);

// ---------- drawer ----------
function openDrawer(id, day) {
  const r = id ? S.state.reservations.find(x => x.id === id) : { source: 'manual', status: 'confirmed', checkIn: day, checkOut: add(day, S.state.settings.minNights || 1), guestName: '', email: '', phone: '', guests: 2, price: '', notes: '', conflicts: [] };
  if (!r) return;
  const synced = !!r.uid;
  const conflicts = (r.conflicts || []).map(cid => S.state.reservations.find(x => x.id === cid)).filter(Boolean);
  const dr = $('#drawer');
  dr.innerHTML = `
    <header><div><span class="chip ${r.source}">${SOURCES[r.source]}</span><h2 style="margin-top:.5rem">${id ? esc(r.guestName || SOURCES[r.source] + ' guest') : 'New reservation'}</h2>
      ${id ? `<p class="sub">${range(r)} · ${nightsOf(r.checkIn, r.checkOut)} nights${r.code ? ' · ' + esc(r.code) : ''}</p>` : ''}</div>
      <button class="x" id="closeDr" aria-label="Close">×</button></header>
    <form class="body" id="resForm">
      ${conflicts.length ? `<div class="note bad"><b>Overlaps with</b> ${conflicts.map(c => `${esc(c.guestName || SOURCES[c.source])} (${SOURCES[c.source]}, ${range(c)})`).join(', ')}. Cancel one of them on its channel.</div>` : ''}
      ${r.status === 'pending' ? `<div class="note">This guest asked to book through your website. Reply to them by email and confirm or decline here.</div>` : ''}
      ${synced ? `<div class="note">Imported from ${SOURCES[r.source]}. Dates come from the channel and update on every sync; guest details are yours to fill in.</div>` : ''}
      <div class="form-grid">
        <label class="field">Check-in<input type="date" name="checkIn" value="${r.checkIn}" ${synced ? 'disabled' : 'required'}></label>
        <label class="field">Check-out<input type="date" name="checkOut" value="${r.checkOut}" ${synced ? 'disabled' : 'required'}></label>
        ${synced ? '' : `<label class="field">Channel<select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${r.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`}
        <label class="field">Status<select name="status">${['confirmed', 'pending', 'blocked', 'cancelled'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field full">Guest name<input name="guestName" value="${esc(r.guestName)}"></label>
        <label class="field">Email<input type="email" name="email" value="${esc(r.email)}"></label>
        <label class="field">Phone<input name="phone" value="${esc(r.phone)}"></label>
        <label class="field">Guests<input type="number" min="0" name="guests" value="${r.guests ?? ''}"></label>
        <label class="field">Total paid<input type="number" min="0" step="0.01" name="price" value="${r.price ?? ''}"></label>
        <label class="field">Reference<input name="code" value="${esc(r.code || '')}"></label>
        <label class="field full">Notes<textarea name="notes" rows="4">${esc(r.notes)}</textarea></label>
      </div>
    </form>
    <footer>
      ${id && !synced ? '<button class="btn danger left" id="delRes">Delete</button>' : ''}
      ${r.status === 'pending' ? '<button class="btn" id="declineRes">Decline</button><button class="btn primary" id="confirmRes">Confirm booking</button>' : `<button class="btn" id="cancelDr">Close</button><button class="btn primary" id="saveRes">${id ? 'Save' : 'Add reservation'}</button>`}
    </footer>`;
  dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;

  const collect = () => {
    const fd = Object.fromEntries(new FormData($('#resForm')));
    fd.guests = fd.guests === '' ? null : +fd.guests; fd.price = fd.price === '' ? null : +fd.price;
    return fd;
  };
  const save = async override => {
    try {
      const body = { ...collect(), ...override };
      if (id) await api('/api/reservations/' + id, { method: 'PUT', body });
      else await api('/api/reservations', { method: 'POST', body });
      closeDrawer(); toast(id ? 'Saved' : 'Reservation added'); await refresh();
    } catch (e) { toast(e.message); }
  };
  $('#closeDr').onclick = closeDrawer;
  const c = $('#cancelDr'); if (c) c.onclick = closeDrawer;
  const s = $('#saveRes'); if (s) s.onclick = () => save();
  const cf = $('#confirmRes'); if (cf) cf.onclick = () => save({ status: 'confirmed' });
  const dc = $('#declineRes'); if (dc) dc.onclick = () => save({ status: 'cancelled' });
  const d = $('#delRes'); if (d) d.onclick = async () => {
    if (!confirm('Delete this reservation for good?')) return;
    await api('/api/reservations/' + id, { method: 'DELETE' }); closeDrawer(); toast('Deleted'); await refresh();
  };
}
function closeDrawer() { const dr = $('#drawer'); dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ---------- boot ----------
S.view = location.hash.slice(1) || 'overview';
api('/api/state').then(st => { S.state = st; $('#app').hidden = false; render(); }).catch(() => {});
