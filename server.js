// Alpendre — one porch for every booking.
// Multi-house platform: each house is a workspace connected to Airbnb, Booking.com
// and the owner's own website. Zero dependencies (Node 18+).
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4300;
const PASSWORD = process.env.ALPENDRE_PASSWORD || 'alpendre';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const CHANNELS = ['airbnb', 'booking', 'website'];
const SOURCES = ['airbnb', 'booking', 'website', 'manual'];
const LABEL = { airbnb: 'Airbnb', booking: 'Booking.com', website: 'Website', manual: 'Manual' };
const COLORS = ['#c4622d', '#6b7f4e', '#2f6f8f', '#8a5a9e', '#c9902a', '#a2423d', '#3f7a6b', '#5b6170'];

// ---------- dates ----------
const toDate = s => new Date(s + 'T00:00:00Z');
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const nights = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const today = () => fmt(new Date());
const overlaps = (a, b) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const id = () => crypto.randomBytes(6).toString('hex');
const token = () => crypto.randomBytes(12).toString('hex');

// ---------- storage ----------
function newHouse(fields = {}, index = 0) {
  return {
    id: id(), name: 'New house', location: '', color: COLORS[index % COLORS.length],
    checkInTime: '16:00', checkOutTime: '11:00', currency: 'EUR',
    // rules used when the owner's website takes bookings through Alpendre
    nightlyPrice: 150, cleaningFee: 50, minNights: 2, maxGuests: 6,
    websiteBookings: true, autoConfirm: false,
    channels: Object.fromEntries(CHANNELS.map(c => [c, { url: '', lastSync: null, lastStatus: null }])),
    exportToken: token(),   // secret: calendar links handed to Airbnb / Booking / the website
    publicKey: 'pk_' + token(), // public: identifies the house to the website widget / API
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

let db;
function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.workspaces) migrateSingleHouse();
    for (const w of db.workspaces) for (const c of CHANNELS) w.channels[c] = w.channels[c] || { url: '', lastSync: null, lastStatus: null };
    db.settings = { syncMinutes: 30, ...db.settings };
  } else {
    db = { settings: { syncMinutes: 30 }, workspaces: [], reservations: [], log: [] };
    seed();
  }
  save();
}
// v1 stored one house in db.settings — move it into a workspace.
function migrateSingleHouse() {
  const s = db.settings || {};
  const w = newHouse({ name: s.propertyName || 'My house', location: s.location || '', nightlyPrice: s.nightlyPrice ?? 150,
    cleaningFee: s.cleaningFee ?? 50, minNights: s.minNights ?? 2, maxGuests: s.maxGuests ?? 6, autoConfirm: !!s.autoConfirm,
    checkInTime: s.checkInTime || '16:00', checkOutTime: s.checkOutTime || '11:00', currency: s.currency || 'EUR',
    exportToken: s.exportToken || token() });
  for (const c of ['airbnb', 'booking']) if (s.channels && s.channels[c]) w.channels[c] = s.channels[c];
  db.workspaces = [w];
  db.reservations = (db.reservations || []).map(r => ({ ...r, workspaceId: w.id, source: r.source === 'direct' ? 'website' : r.source }));
  db.log = (db.log || []).map(l => ({ ...l, workspaceId: w.id }));
  db.settings = { syncMinutes: s.syncMinutes || 30 };
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function log(workspaceId, msg, level = 'info') {
  db.log.unshift({ at: new Date().toISOString(), workspaceId, level, msg });
  db.log = db.log.slice(0, 300);
}
const house = wid => db.workspaces.find(w => w.id === wid);

// Demo houses so the platform is not empty on first run. Removable from Settings.
function seed() {
  const t = today();
  const houses = [
    newHouse({ name: 'Casa da Colina', location: 'Algarve', demo: true, nightlyPrice: 180, cleaningFee: 60, minNights: 3, maxGuests: 8 }, 0),
    newHouse({ name: 'Apartamento Ribeira', location: 'Porto', demo: true, nightlyPrice: 110, cleaningFee: 40, minNights: 2, maxGuests: 4 }, 2),
    newHouse({ name: 'Monte das Oliveiras', location: 'Alentejo', demo: true, nightlyPrice: 220, cleaningFee: 80, minNights: 3, maxGuests: 10 }, 1),
  ];
  db.workspaces.push(...houses);
  const r = (h, source, inOff, len, guest, extra = {}) => db.reservations.push({
    id: id(), workspaceId: houses[h].id, source, status: 'confirmed', demo: true,
    checkIn: addDays(t, inOff), checkOut: addDays(t, inOff + len),
    guestName: guest, email: '', phone: '', guests: 2 + (len % 3), price: len * houses[h].nightlyPrice + houses[h].cleaningFee,
    notes: '', code: '', createdAt: new Date().toISOString(), ...extra,
  });
  r(0, 'airbnb', -3, 5, 'Sophie Laurent', { code: 'HMA4K2Z9QX' });
  r(0, 'booking', 4, 4, 'Jonas Becker', { code: '4382910566' });
  r(0, 'website', 9, 7, 'Marta & Rui Silva');
  r(0, 'airbnb', 18, 3, 'Emily Carter', { code: 'HMB7Y3PQ1L' });
  r(0, 'website', 24, 4, 'Anna Kowalski', { status: 'pending', email: 'anna@example.com' });
  r(1, 'booking', -1, 2, 'Kenji Watanabe', { code: '4391120874' });
  r(1, 'airbnb', 1, 3, 'Olivia Brown', { code: 'HMC2T8WE5R' });
  r(1, 'airbnb', 5, 2, 'Lucas Martin', { code: 'HMD9P1XK3A' });
  r(1, 'booking', 8, 5, 'Isabella Rossi', { code: '4370019823' });
  r(1, 'manual', 15, 2, 'Owner stay', { price: 0, notes: 'Maintenance weekend' });
  r(1, 'airbnb', 19, 4, 'Noah Fischer', { code: 'HME5R7TY2B' });
  r(2, 'website', 2, 6, 'Família Costa', { email: 'costa@example.com' });
  r(2, 'booking', 12, 7, 'Pierre Lefèvre', { code: '4402231987' });
  r(2, 'airbnb', 13, 3, 'Hannah Schmidt', { code: 'HMF3W8QZ6C' }); // overlaps on purpose: shows a double-booking alert
  r(2, 'website', 27, 5, 'Grace Miller', { status: 'pending', email: 'grace@example.com' });
}

// ---------- iCal import ----------
function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      ev[key] = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
    }
  }
  const d = v => v && `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return events.map(e => ({ uid: e.UID, checkIn: d(e.DTSTART), checkOut: d(e.DTEND), summary: e.SUMMARY || '', description: e.DESCRIPTION || '' }))
    .filter(e => e.uid && isDate(e.checkIn) && isDate(e.checkOut) && e.checkOut > e.checkIn);
}

function fetchText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Alpendre-Calendar-Sync/2.0' }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); return resolve(fetchText(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = ''; res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > 5e6) req.destroy(new Error('Feed too large')); });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

function interpret(ev) {
  const text = `${ev.summary}\n${ev.description}`;
  const blocked = /not available|closed|blocked|unavailable/i.test(ev.summary) && !/reserved|booked/i.test(ev.summary);
  const m = text.match(/details\/([A-Z0-9]{8,12})/) || text.match(/\b(HM[A-Z0-9]{8})\b/) || text.match(/\b(\d{10})\b/);
  // A website feed may put the guest in the summary ("Booked: Ana Silva").
  const guest = !blocked && /^(?:booked|reserved|reservation)?\s*[:\-–]\s*(.{2,80})$/i.exec(ev.summary.trim());
  return { blocked, code: m ? m[1] : '', guestName: guest ? guest[1].trim() : '' };
}

async function syncChannel(w, source) {
  const ch = w.channels[source];
  if (!ch || !ch.url) return { house: w.id, source, skipped: true };
  // Our own export links must not be imported back (would loop).
  if (ch.url.includes(`/ical/${w.exportToken}/`)) { ch.lastSync = new Date().toISOString(); ch.lastStatus = 'error · this is Alpendre’s own link'; return { house: w.id, source, error: ch.lastStatus }; }
  try {
    const events = parseICS(await fetchText(ch.url));
    const seen = new Set(); let added = 0, updated = 0, removed = 0;
    for (const ev of events) {
      if (ev.uid.endsWith('@alpendre')) continue; // dates we exported ourselves, echoed back by the channel
      if (ev.checkOut < addDays(today(), -60)) continue;
      seen.add(ev.uid);
      const { blocked, code, guestName } = interpret(ev);
      const existing = db.reservations.find(r => r.workspaceId === w.id && r.source === source && r.uid === ev.uid);
      if (existing) {
        if (existing.checkIn !== ev.checkIn || existing.checkOut !== ev.checkOut || existing.status === 'cancelled') {
          existing.checkIn = ev.checkIn; existing.checkOut = ev.checkOut;
          if (existing.status === 'cancelled') existing.status = blocked ? 'blocked' : 'confirmed';
          updated++;
        }
        if (code && !existing.code) existing.code = code;
      } else {
        db.reservations.push({
          id: id(), workspaceId: w.id, source, uid: ev.uid, status: blocked ? 'blocked' : 'confirmed',
          checkIn: ev.checkIn, checkOut: ev.checkOut, code,
          guestName: blocked ? 'Blocked on ' + LABEL[source] : guestName, email: '', phone: '', guests: null, price: null,
          notes: '', createdAt: new Date().toISOString(),
        });
        added++;
      }
    }
    for (const r of db.reservations) {
      if (r.workspaceId === w.id && r.source === source && r.uid && !seen.has(r.uid) && r.status !== 'cancelled' && r.checkOut >= today()) {
        r.status = 'cancelled'; removed++;
      }
    }
    ch.lastSync = new Date().toISOString();
    ch.lastStatus = `ok · ${events.length} events`;
    if (added || updated || removed) log(w.id, `${LABEL[source]}: ${added} new, ${updated} changed, ${removed} cancelled`);
    return { house: w.id, source, added, updated, removed };
  } catch (e) {
    ch.lastSync = new Date().toISOString();
    ch.lastStatus = 'error · ' + e.message;
    log(w.id, `${LABEL[source]} sync failed: ${e.message}`, 'error');
    return { house: w.id, source, error: e.message };
  }
}

let syncing = null;
async function syncHouses(list) {
  // Serialise syncs so the timer and a manual "Sync now" never interleave writes.
  while (syncing) await syncing;
  let done; syncing = new Promise(r => (done = r));
  try {
    const results = [];
    for (const w of list) for (const c of CHANNELS) results.push(await syncChannel(w, c));
    save();
    return results;
  } finally { syncing = null; done(); }
}

// ---------- iCal export ----------
// Each channel gets a feed of the nights booked everywhere ELSE, so it never sells them twice.
function exportFor(w, target) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alpendre//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${w.name.replace(/[,;\\]/g, ' ')}`];
  for (const r of db.reservations) {
    if (r.workspaceId !== w.id || r.status === 'cancelled' || r.checkOut < today() || r.source === target || r.demo) continue;
    out.push('BEGIN:VEVENT', `UID:${r.id}@alpendre`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${r.checkIn.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${r.checkOut.replace(/-/g, '')}`,
      `SUMMARY:${target === 'all' && r.guestName ? r.guestName.replace(/[,;\\]/g, ' ') + ' · ' + LABEL[r.source] : 'Not available'}`, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

// ---------- helpers ----------
const sessions = new Set();
function authed(req) {
  const m = (req.headers.cookie || '').match(/alp_session=([a-f0-9]+)/);
  return m && sessions.has(m[1]);
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}
const activeIn = wid => db.reservations.filter(r => r.workspaceId === wid && r.status !== 'cancelled');
const conflictsFor = (r, wid) => activeIn(wid).filter(o => o.id !== r.id && overlaps(o, r));
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
const EDITABLE = ['guestName', 'email', 'phone', 'guests', 'price', 'notes', 'status', 'checkIn', 'checkOut', 'source', 'code'];
const HOUSE_TEXT = ['name', 'location', 'checkInTime', 'checkOutTime', 'currency'];
const HOUSE_NUM = ['nightlyPrice', 'cleaningFee', 'minNights', 'maxGuests'];

function updateHouse(w, b) {
  for (const k of HOUSE_TEXT) if (typeof b[k] === 'string') w[k] = b[k].trim().slice(0, 200);
  if (!w.name) w.name = 'Untitled house';
  if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) w.color = b.color;
  for (const k of HOUSE_NUM) if (b[k] !== undefined && b[k] !== '' && !isNaN(+b[k])) w[k] = Math.max(k === 'minNights' || k === 'maxGuests' ? 1 : 0, +b[k]);
  for (const k of ['websiteBookings', 'autoConfirm']) if (typeof b[k] === 'boolean') w[k] = b[k];
  if (b.channels) for (const c of CHANNELS) if (b.channels[c] && typeof b.channels[c].url === 'string') {
    const u = b.channels[c].url.trim();
    if (u && !/^https?:\/\//i.test(u)) throw new Error(`${LABEL[c]} link must start with https://`);
    if (u !== w.channels[c].url) w.channels[c] = { url: u, lastSync: null, lastStatus: null };
  }
  delete w.demo;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serveStatic(req, res, p) {
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const extra = p === '/embed.js' ? { 'Access-Control-Allow-Origin': '*' } : {};
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...extra });
    res.end(data);
  });
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, m = req.method;

  // --- calendar exports, per house ---
  const ex = p.match(/^\/ical\/([a-f0-9]+)\/(airbnb|booking|website|all)\.ics$/);
  if (ex) {
    const w = db.workspaces.find(x => x.exportToken === ex[1]);
    if (!w) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, exportFor(w, ex[2]), 'text/calendar; charset=utf-8');
  }

  // --- public API for the owner's website (CORS open, identified by public key) ---
  const pub = p.match(/^\/api\/public\/(pk_[a-f0-9]+)\/(availability|book)$/);
  if (pub || (m === 'OPTIONS' && p.startsWith('/api/public/'))) {
    if (m === 'OPTIONS') return send(res, 204, '', 'text/plain', CORS);
    const w = db.workspaces.find(x => x.publicKey === pub[1]);
    if (!w) return send(res, 404, { error: 'Unknown house' }, 'application/json', CORS);
    if (pub[2] === 'availability' && m === 'GET') {
      return send(res, 200, {
        house: w.name, currency: w.currency, nightlyPrice: w.nightlyPrice, cleaningFee: w.cleaningFee,
        minNights: w.minNights, maxGuests: w.maxGuests, checkInTime: w.checkInTime, checkOutTime: w.checkOutTime,
        bookingsEnabled: w.websiteBookings, autoConfirm: w.autoConfirm,
        booked: activeIn(w.id).filter(r => r.checkOut >= today()).map(r => ({ checkIn: r.checkIn, checkOut: r.checkOut })),
      }, 'application/json', CORS);
    }
    if (pub[2] === 'book' && m === 'POST') {
      if (!w.websiteBookings) return send(res, 403, { errors: ['Online booking is turned off for this house.'] }, 'application/json', CORS);
      const b = await readBody(req);
      const errors = [];
      if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) errors.push('Choose valid dates.');
      else {
        if (b.checkIn < today()) errors.push('Check-in cannot be in the past.');
        if (nights(b.checkIn, b.checkOut) < w.minNights) errors.push(`Minimum stay is ${w.minNights} nights.`);
        if (conflictsFor({ checkIn: b.checkIn, checkOut: b.checkOut }, w.id).length) errors.push('Those dates are no longer available.');
      }
      if (!b.guestName || String(b.guestName).trim().length < 2) errors.push('Please enter your name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) errors.push('Please enter a valid email.');
      const guests = Number(b.guests);
      if (!(guests >= 1 && guests <= w.maxGuests)) errors.push(`Guests must be between 1 and ${w.maxGuests}.`);
      if (errors.length) return send(res, 400, { errors }, 'application/json', CORS);
      const n = nights(b.checkIn, b.checkOut), total = n * w.nightlyPrice + w.cleaningFee;
      const r = {
        id: id(), workspaceId: w.id, source: 'website', status: w.autoConfirm ? 'confirmed' : 'pending',
        checkIn: b.checkIn, checkOut: b.checkOut,
        guestName: String(b.guestName).trim().slice(0, 120), email: String(b.email).trim().slice(0, 200),
        phone: String(b.phone || '').slice(0, 40), guests, price: total,
        notes: String(b.message || '').slice(0, 2000), code: 'WEB-' + id().slice(0, 6).toUpperCase(),
        createdAt: new Date().toISOString(),
      };
      db.reservations.push(r);
      log(w.id, `Website request from ${r.guestName} (${r.checkIn} → ${r.checkOut})`);
      save();
      return send(res, 201, { ok: true, code: r.code, status: r.status, total, nights: n, currency: w.currency }, 'application/json', CORS);
    }
    return send(res, 405, { error: 'Method not allowed' }, 'application/json', CORS);
  }

  // --- auth ---
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req);
    const a = Buffer.from(String(b.password || '')), e = Buffer.from(PASSWORD);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return send(res, 401, { error: 'Wrong password' });
    const t = crypto.randomBytes(24).toString('hex'); sessions.add(t);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `alp_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
  }
  if (p === '/api/logout' && m === 'POST') {
    const mm = (req.headers.cookie || '').match(/alp_session=([a-f0-9]+)/); if (mm) sessions.delete(mm[1]);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'alp_session=; Path=/; Max-Age=0' });
  }

  // --- owner API ---
  if (p.startsWith('/api/')) {
    if (!authed(req)) return send(res, 401, { error: 'Not signed in' });

    if (p === '/api/state' && m === 'GET') {
      const reservations = db.reservations.map(r => ({ ...r, conflicts: r.status === 'cancelled' ? [] : conflictsFor(r, r.workspaceId).map(o => o.id) }));
      return send(res, 200, { settings: db.settings, workspaces: db.workspaces, reservations, log: db.log, today: today(), defaultPassword: PASSWORD === 'alpendre' });
    }

    // houses
    if (p === '/api/workspaces' && m === 'POST') {
      const b = await readBody(req);
      const w = newHouse({}, db.workspaces.length);
      try { updateHouse(w, b); } catch (e) { return send(res, 400, { error: e.message }); }
      db.workspaces.push(w); log(w.id, `House “${w.name}” created`); save();
      return send(res, 201, w);
    }
    const wm = p.match(/^\/api\/workspaces\/([a-f0-9]+)(\/sync|\/rotate)?$/);
    if (wm) {
      const w = house(wm[1]);
      if (!w) return send(res, 404, { error: 'House not found' });
      if (wm[2] === '/sync' && m === 'POST') return send(res, 200, { results: await syncHouses([w]) });
      if (wm[2] === '/rotate' && m === 'POST') { w.exportToken = token(); log(w.id, 'Calendar export links replaced'); save(); return send(res, 200, w); }
      if (!wm[2] && m === 'PUT') {
        try { updateHouse(w, await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
        save(); return send(res, 200, w);
      }
      if (!wm[2] && m === 'DELETE') {
        db.workspaces = db.workspaces.filter(x => x.id !== w.id);
        db.reservations = db.reservations.filter(r => r.workspaceId !== w.id);
        db.log = db.log.filter(l => l.workspaceId !== w.id);
        save(); return send(res, 200, { ok: true });
      }
    }

    // reservations
    if (p === '/api/reservations' && m === 'POST') {
      const b = await readBody(req);
      if (!house(b.workspaceId)) return send(res, 400, { error: 'Choose a house' });
      if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) return send(res, 400, { error: 'Invalid dates' });
      const r = { id: id(), workspaceId: b.workspaceId, source: 'manual', status: 'confirmed', guestName: '', email: '', phone: '', guests: null, price: null, notes: '', code: '', createdAt: new Date().toISOString(), ...pick(b, EDITABLE) };
      if (!SOURCES.includes(r.source)) r.source = 'manual';
      db.reservations.push(r); log(r.workspaceId, `Added ${LABEL[r.source]} stay for ${r.guestName || 'guest'}`); save();
      return send(res, 201, r);
    }
    const rm = p.match(/^\/api\/reservations\/([a-f0-9]+)$/);
    if (rm) {
      const r = db.reservations.find(x => x.id === rm[1]);
      if (!r) return send(res, 404, { error: 'Not found' });
      if (m === 'PUT') {
        const b = pick(await readBody(req), EDITABLE);
        if (r.uid) { delete b.checkIn; delete b.checkOut; delete b.source; } // synced stays: dates belong to the channel
        if (b.source && !SOURCES.includes(b.source)) delete b.source;
        if ((b.checkIn || b.checkOut) && !((b.checkIn || r.checkIn) < (b.checkOut || r.checkOut))) return send(res, 400, { error: 'Invalid dates' });
        Object.assign(r, b); delete r.demo; save();
        return send(res, 200, r);
      }
      if (m === 'DELETE') {
        db.reservations = db.reservations.filter(x => x.id !== r.id); log(r.workspaceId, `Deleted stay ${r.guestName || r.id}`); save();
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/sync' && m === 'POST') return send(res, 200, { results: await syncHouses(db.workspaces) });
    if (p === '/api/settings' && m === 'PUT') {
      const b = await readBody(req);
      if ([15, 30, 60, 180].includes(+b.syncMinutes)) db.settings.syncMinutes = +b.syncMinutes;
      save(); scheduleSync(); return send(res, 200, db.settings);
    }
    if (p === '/api/demo' && m === 'DELETE') {
      const demoHouses = new Set(db.workspaces.filter(w => w.demo).map(w => w.id));
      db.workspaces = db.workspaces.filter(w => !w.demo);
      db.reservations = db.reservations.filter(r => !r.demo && !demoHouses.has(r.workspaceId));
      save(); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Unknown endpoint' });
  }

  if (p === '/admin' || p === '/admin/') { res.writeHead(302, { Location: '/' }); return res.end(); }
  return serveStatic(req, res, p);
}

let timer;
function scheduleSync() {
  clearInterval(timer);
  timer = setInterval(() => syncHouses(db.workspaces).catch(() => {}), Math.max(15, db.settings.syncMinutes) * 60e3);
}

load();
http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message })))
  .listen(PORT, () => {
    console.log(`\n  Alpendre is running → http://localhost:${PORT}/`);
    if (PASSWORD === 'alpendre') console.log(`  ! Default password "alpendre" in use. Set ALPENDRE_PASSWORD to change it.\n`);
    scheduleSync();
    syncHouses(db.workspaces).catch(() => {});
  });
