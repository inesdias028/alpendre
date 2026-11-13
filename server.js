// Alpendre — one porch for every booking.
// Zero-dependency Node server: storage, iCal sync (Airbnb / Booking.com),
// iCal export, public booking API and the admin API.
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

// ---------- dates ----------
const toDate = s => new Date(s + 'T00:00:00Z');
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const nights = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const today = () => fmt(new Date());
const overlaps = (a, b) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ---------- storage ----------
const DEFAULT_SETTINGS = {
  propertyName: 'Casa da Colina',
  tagline: 'A whitewashed house on the hill, with a porch made for long evenings.',
  location: 'Algarve, Portugal',
  description: 'Four bedrooms, a pool facing the hills, a big kitchen and a shaded porch. Ten minutes from the beach, a world away from the crowds.',
  bedrooms: 4, bathrooms: 3, maxGuests: 8,
  nightlyPrice: 180, cleaningFee: 60, minNights: 3,
  checkInTime: '16:00', checkOutTime: '11:00',
  currency: 'EUR',
  autoConfirm: false,
  contactEmail: 'hello@example.com',
  amenities: ['Private pool', 'Wi-Fi', 'Air conditioning', 'Full kitchen', 'Free parking', 'Washing machine', 'Barbecue', 'Garden'],
  channels: {
    airbnb: { url: '', lastSync: null, lastStatus: null },
    booking: { url: '', lastSync: null, lastStatus: null },
  },
  syncMinutes: 30,
  exportToken: crypto.randomBytes(12).toString('hex'),
};

let db;
function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...DEFAULT_SETTINGS, ...db.settings, channels: { ...DEFAULT_SETTINGS.channels, ...(db.settings || {}).channels } };
  } else {
    db = { settings: DEFAULT_SETTINGS, reservations: seed(), log: [] };
    save();
  }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const id = () => crypto.randomBytes(6).toString('hex');
function log(msg, level = 'info') {
  db.log.unshift({ at: new Date().toISOString(), level, msg });
  db.log = db.log.slice(0, 100);
}

// Demo data so the dashboard is not empty on first run. Removable from Settings.
function seed() {
  const t = today();
  const r = (source, inOff, len, guest, extra = {}) => ({
    id: id(), source, status: 'confirmed', demo: true,
    checkIn: addDays(t, inOff), checkOut: addDays(t, inOff + len),
    guestName: guest, email: '', phone: '', guests: 2 + (len % 4), price: len * 180 + 60,
    notes: '', createdAt: new Date().toISOString(), ...extra,
  });
  return [
    r('airbnb', -3, 5, 'Sophie Laurent', { code: 'HMA4K2Z9QX' }),
    r('booking', 4, 4, 'Jonas Becker', { code: '4382910566' }),
    r('direct', 9, 7, 'Marta & Rui Silva', { email: 'marta@example.com' }),
    r('airbnb', 18, 3, 'Emily Carter', { code: 'HMB7Y3PQ1L' }),
    r('booking', 23, 6, 'Luca Romano', { code: '4391120874' }),
    r('direct', 31, 4, 'Anna Kowalski', { status: 'pending', email: 'anna@example.com' }),
    r('manual', 36, 2, 'Owner stay', { price: 0, notes: 'Family weekend' }),
    r('airbnb', 40, 5, 'Daniel Okafor', { code: 'HMC2T8WE5R' }),
    r('booking', -20, 6, 'Claire Dubois', { code: '4370019823' }),
    r('direct', -12, 5, 'Pedro Almeida'),
  ];
}

// ---------- iCal ----------
function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      ev[key] = line.slice(i + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
    }
  }
  const d = v => v && `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return events.map(e => ({ uid: e.UID, checkIn: d(e.DTSTART), checkOut: d(e.DTEND), summary: e.SUMMARY || '', description: e.DESCRIPTION || '' }))
    .filter(e => e.uid && isDate(e.checkIn) && isDate(e.checkOut));
}

function fetchText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Alpendre-Calendar-Sync/1.0' }, timeout: 15000 }, res => {
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

// Turn a channel's calendar event into a reservation (or a block).
function interpret(source, ev) {
  const text = `${ev.summary}\n${ev.description}`;
  const blocked = /not available|closed|blocked/i.test(ev.summary) && !/reserved/i.test(ev.summary);
  let code = '';
  const m = text.match(/details\/([A-Z0-9]{8,12})/) || text.match(/\b(HM[A-Z0-9]{8})\b/) || text.match(/\b(\d{10})\b/);
  if (m) code = m[1];
  return { blocked, code };
}

async function syncChannel(source) {
  const ch = db.settings.channels[source];
  if (!ch || !ch.url) return { source, skipped: true };
  try {
    const events = parseICS(await fetchText(ch.url));
    const seen = new Set(); let added = 0, updated = 0, removed = 0;
    for (const ev of events) {
      if (ev.checkOut < addDays(today(), -60)) continue; // ignore old history
      seen.add(ev.uid);
      const { blocked, code } = interpret(source, ev);
      const existing = db.reservations.find(r => r.source === source && r.uid === ev.uid);
      if (existing) {
        if (existing.checkIn !== ev.checkIn || existing.checkOut !== ev.checkOut || existing.status === 'cancelled') {
          existing.checkIn = ev.checkIn; existing.checkOut = ev.checkOut;
          if (existing.status === 'cancelled') existing.status = blocked ? 'blocked' : 'confirmed';
          updated++;
        }
        if (code && !existing.code) existing.code = code;
      } else {
        db.reservations.push({
          id: id(), source, uid: ev.uid, status: blocked ? 'blocked' : 'confirmed',
          checkIn: ev.checkIn, checkOut: ev.checkOut, code,
          guestName: blocked ? 'Blocked on ' + label(source) : '', email: '', phone: '', guests: null, price: null,
          notes: '', createdAt: new Date().toISOString(),
        });
        added++;
      }
    }
    // Events that disappeared from a feed were cancelled on that channel.
    for (const r of db.reservations) {
      if (r.source === source && r.uid && !seen.has(r.uid) && r.status !== 'cancelled' && r.checkOut >= today()) {
        r.status = 'cancelled'; removed++;
      }
    }
    ch.lastSync = new Date().toISOString();
    ch.lastStatus = `ok · ${events.length} events`;
    log(`${label(source)} synced: ${added} new, ${updated} changed, ${removed} cancelled`);
    return { source, added, updated, removed };
  } catch (e) {
    ch.lastSync = new Date().toISOString();
    ch.lastStatus = 'error · ' + e.message;
    log(`${label(source)} sync failed: ${e.message}`, 'error');
    return { source, error: e.message };
  }
}
const label = s => ({ airbnb: 'Airbnb', booking: 'Booking.com', direct: 'Website', manual: 'Manual' })[s] || s;

async function syncAll() {
  const results = [];
  for (const s of ['airbnb', 'booking']) results.push(await syncChannel(s));
  save();
  return results;
}

// Per-channel export: block dates from every OTHER source.
function exportFor(target) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alpendre//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const r of db.reservations) {
    if (r.status === 'cancelled' || r.checkOut < today() || r.source === target) continue;
    if (r.demo) continue;
    out.push('BEGIN:VEVENT', `UID:${r.id}@alpendre`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${r.checkIn.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${r.checkOut.replace(/-/g, '')}`,
      `SUMMARY:Not available (${label(r.source)})`, 'END:VEVENT');
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
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}
const active = () => db.reservations.filter(r => r.status !== 'cancelled');
function conflictsFor(r, ignoreId) {
  return active().filter(o => o.id !== ignoreId && o.id !== r.id && overlaps(o, r));
}
function quote(checkIn, checkOut) {
  const s = db.settings, n = nights(checkIn, checkOut);
  return { nights: n, nightly: s.nightlyPrice, cleaning: s.cleaningFee, total: n * s.nightlyPrice + s.cleaningFee };
}
const EDITABLE = ['guestName', 'email', 'phone', 'guests', 'price', 'notes', 'status', 'checkIn', 'checkOut', 'source', 'code'];
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ics': 'text/calendar', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serveStatic(req, res, p) {
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, m = req.method;

  // --- calendar exports (give these URLs to Airbnb / Booking.com) ---
  const ex = p.match(/^\/ical\/([a-f0-9]+)\/(airbnb|booking|all)\.ics$/);
  if (ex) {
    if (ex[1] !== db.settings.exportToken) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, ex[2] === 'all' ? exportFor('none') : exportFor(ex[2]), 'text/calendar; charset=utf-8');
  }

  // --- public website API ---
  if (p === '/api/public/info' && m === 'GET') {
    const s = db.settings;
    return send(res, 200, pick(s, ['propertyName', 'tagline', 'location', 'description', 'bedrooms', 'bathrooms', 'maxGuests', 'nightlyPrice', 'cleaningFee', 'minNights', 'checkInTime', 'checkOutTime', 'currency', 'amenities', 'contactEmail', 'autoConfirm']));
  }
  if (p === '/api/public/availability' && m === 'GET') {
    return send(res, 200, active().filter(r => r.checkOut >= today()).map(r => ({ checkIn: r.checkIn, checkOut: r.checkOut })));
  }
  if (p === '/api/public/book' && m === 'POST') {
    const b = await readBody(req);
    const s = db.settings;
    const errors = [];
    if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) errors.push('Choose valid dates.');
    else {
      if (b.checkIn < today()) errors.push('Check-in cannot be in the past.');
      if (nights(b.checkIn, b.checkOut) < s.minNights) errors.push(`Minimum stay is ${s.minNights} nights.`);
      if (conflictsFor({ checkIn: b.checkIn, checkOut: b.checkOut }).length) errors.push('Those dates are no longer available.');
    }
    if (!b.guestName || String(b.guestName).trim().length < 2) errors.push('Please enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) errors.push('Please enter a valid email.');
    const guests = Number(b.guests);
    if (!(guests >= 1 && guests <= s.maxGuests)) errors.push(`Guests must be between 1 and ${s.maxGuests}.`);
    if (errors.length) return send(res, 400, { errors });
    const q = quote(b.checkIn, b.checkOut);
    const r = {
      id: id(), source: 'direct', status: s.autoConfirm ? 'confirmed' : 'pending',
      checkIn: b.checkIn, checkOut: b.checkOut,
      guestName: String(b.guestName).trim().slice(0, 120), email: String(b.email).trim().slice(0, 200),
      phone: String(b.phone || '').slice(0, 40), guests, price: q.total,
      notes: String(b.message || '').slice(0, 2000), code: 'WEB-' + id().slice(0, 6).toUpperCase(),
      createdAt: new Date().toISOString(),
    };
    db.reservations.push(r);
    log(`New website request from ${r.guestName} (${r.checkIn} → ${r.checkOut})`);
    save();
    return send(res, 201, { ok: true, code: r.code, status: r.status, quote: q });
  }

  // --- auth ---
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req);
    const a = Buffer.from(String(b.password || '')), e = Buffer.from(PASSWORD);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return send(res, 401, { error: 'Wrong password' });
    const token = crypto.randomBytes(24).toString('hex'); sessions.add(token);
    res.writeHead(200, { 'Set-Cookie': `alp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (p === '/api/logout' && m === 'POST') {
    const mm = (req.headers.cookie || '').match(/alp_session=([a-f0-9]+)/); if (mm) sessions.delete(mm[1]);
    res.writeHead(200, { 'Set-Cookie': 'alp_session=; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // --- admin API ---
  if (p.startsWith('/api/')) {
    if (!authed(req)) return send(res, 401, { error: 'Not signed in' });

    if (p === '/api/state' && m === 'GET') {
      const reservations = db.reservations.map(r => ({ ...r, conflicts: r.status === 'cancelled' ? [] : conflictsFor(r).map(o => o.id) }));
      return send(res, 200, { settings: db.settings, reservations, log: db.log, today: today(), defaultPassword: PASSWORD === 'alpendre' });
    }
    if (p === '/api/reservations' && m === 'POST') {
      const b = await readBody(req);
      if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) return send(res, 400, { error: 'Invalid dates' });
      const r = { id: id(), source: 'manual', status: 'confirmed', guestName: '', email: '', phone: '', guests: null, price: null, notes: '', createdAt: new Date().toISOString(), ...pick(b, EDITABLE) };
      db.reservations.push(r); log(`Added ${label(r.source)} reservation for ${r.guestName || 'guest'}`); save();
      return send(res, 201, r);
    }
    const rm = p.match(/^\/api\/reservations\/([a-f0-9]+)$/);
    if (rm) {
      const r = db.reservations.find(x => x.id === rm[1]);
      if (!r) return send(res, 404, { error: 'Not found' });
      if (m === 'PUT') {
        const b = pick(await readBody(req), EDITABLE);
        if (r.uid) { delete b.checkIn; delete b.checkOut; delete b.source; } // dates of synced stays come from the channel
        if ((b.checkIn || b.checkOut) && !((b.checkIn || r.checkIn) < (b.checkOut || r.checkOut))) return send(res, 400, { error: 'Invalid dates' });
        Object.assign(r, b); delete r.demo; save();
        return send(res, 200, r);
      }
      if (m === 'DELETE') {
        db.reservations = db.reservations.filter(x => x.id !== r.id); log(`Deleted reservation ${r.guestName || r.id}`); save();
        return send(res, 200, { ok: true });
      }
    }
    if (p === '/api/settings' && m === 'PUT') {
      const b = await readBody(req);
      const s = db.settings;
      for (const k of ['propertyName', 'tagline', 'location', 'description', 'checkInTime', 'checkOutTime', 'currency', 'contactEmail']) if (typeof b[k] === 'string') s[k] = b[k].slice(0, 2000);
      for (const k of ['bedrooms', 'bathrooms', 'maxGuests', 'nightlyPrice', 'cleaningFee', 'minNights', 'syncMinutes']) if (b[k] !== undefined && !isNaN(+b[k])) s[k] = Math.max(0, +b[k]);
      if (typeof b.autoConfirm === 'boolean') s.autoConfirm = b.autoConfirm;
      if (Array.isArray(b.amenities)) s.amenities = b.amenities.map(String).filter(Boolean).slice(0, 40);
      if (b.channels) for (const c of ['airbnb', 'booking']) if (b.channels[c] && typeof b.channels[c].url === 'string') {
        const u = b.channels[c].url.trim();
        if (u && !/^https?:\/\//.test(u)) return send(res, 400, { error: `${label(c)} link must start with https://` });
        s.channels[c].url = u;
      }
      save(); scheduleSync();
      return send(res, 200, s);
    }
    if (p === '/api/sync' && m === 'POST') return send(res, 200, { results: await syncAll() });
    if (p === '/api/demo' && m === 'DELETE') {
      db.reservations = db.reservations.filter(r => !r.demo); log('Demo reservations removed'); save();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Unknown endpoint' });
  }

  if (p === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
  return serveStatic(req, res, p);
}

let timer;
function scheduleSync() {
  clearInterval(timer);
  const mins = Math.max(5, db.settings.syncMinutes || 30);
  timer = setInterval(() => syncAll().catch(() => {}), mins * 60e3);
}

load();
http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message })))
  .listen(PORT, () => {
    console.log(`\n  Alpendre is running`);
    console.log(`  Guest website : http://localhost:${PORT}/`);
    console.log(`  Host dashboard: http://localhost:${PORT}/admin/`);
    if (PASSWORD === 'alpendre') console.log(`  ! Using the default password "alpendre" — set ALPENDRE_PASSWORD to change it.\n`);
    scheduleSync();
    syncAll().catch(() => {});
  });
