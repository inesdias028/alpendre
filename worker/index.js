// Alpendre API — Cloudflare Worker + one Durable Object that holds all data.
// The Worker routes every request to the Durable Object, which keeps the data in
// memory, persists changes to its storage and runs the calendar syncs.
import { DurableObject } from 'cloudflare:workers';
import { mailReady, confirmationEmail, sendMail } from './mail.js';

const CHANNELS = ['airbnb', 'booking', 'website'];
const SOURCES = ['airbnb', 'booking', 'website', 'manual'];
const LABEL = { airbnb: 'Airbnb', booking: 'Booking.com', website: 'Website', manual: 'Manual' };
const COLORS = ['#c4622d', '#6b7f4e', '#2f6f8f', '#8a5a9e', '#c9902a', '#a2423d', '#3f7a6b', '#5b6170'];
const SESSION_DAYS = 30;

// ---------- dates & ids ----------
const toDate = s => new Date(s + 'T00:00:00Z');
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const nights = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const today = () => fmt(new Date());
const overlaps = (a, b) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const id = () => hex(6);
const token = () => hex(12);

function newHouse(fields = {}, index = 0) {
  return {
    id: id(), name: 'New house', location: '', color: COLORS[index % COLORS.length],
    checkInTime: '16:00', checkOutTime: '11:00', currency: 'EUR',
    nightlyPrice: 150, cleaningFee: 50, minNights: 2, maxGuests: 6,
    websiteBookings: true, autoConfirm: false,
    channels: Object.fromEntries(CHANNELS.map(c => [c, { url: '', lastSync: null, lastStatus: null }])),
    exportToken: token(), publicKey: 'pk_' + token(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
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
      ev[key] = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
    }
  }
  const d = v => v && `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return events.map(e => ({ uid: e.UID, checkIn: d(e.DTSTART), checkOut: d(e.DTEND), summary: e.SUMMARY || '', description: e.DESCRIPTION || '' }))
    .filter(e => e.uid && isDate(e.checkIn) && isDate(e.checkOut) && e.checkOut > e.checkIn);
}
function interpret(ev) {
  const text = `${ev.summary}\n${ev.description}`;
  const blocked = /not available|closed|blocked|unavailable/i.test(ev.summary) && !/reserved|booked/i.test(ev.summary);
  const m = text.match(/details\/([A-Z0-9]{8,12})/) || text.match(/\b(HM[A-Z0-9]{8})\b/) || text.match(/\b(\d{10})\b/);
  const guest = !blocked && /^(?:booked|reserved|reservation)?\s*[:\-–]\s*(.{2,80})$/i.exec(ev.summary.trim());
  return { blocked, code: m ? m[1] : '', guestName: guest ? guest[1].trim() : '' };
}
async function fetchText(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Alpendre-Calendar-Sync/2.0' }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > 5e6) throw new Error('Feed too large');
    return body;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'Timed out' : e.message); }
  finally { clearTimeout(t); }
}

// ---------- passwords (PBKDF2, the strongest setting Workers allow) ----------
const enc = new TextEncoder();
const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function hashPassword(pw, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { salt: toHex(salt), hash: toHex(new Uint8Array(bits)) };
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  return crypto.subtle.timingSafeEqual(x, y);
}
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '').slice(0, 40);
const INVITE_DAYS = 7;
const OWNER = { id: 'owner', name: 'Owner' };
const publicUser = u => ({ id: u.id, name: u.name, login: u.login, email: u.email || '', role: u.role, createdAt: u.createdAt, createdBy: u.createdBy,
  status: u.passHash ? 'active' : (u.inviteExp > Date.now() ? 'invited' : 'invite expired'), inviteExp: u.passHash ? null : u.inviteExp });

// ---------- HTTP helpers ----------
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const PUBLIC_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function ownerCors(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const self = new URL(req.url).origin;
  if (origin === self || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin' };
  }
  return {};
}
async function readBody(req) {
  const t = await req.text();
  if (t.length > 1e6) throw new Error('Body too large');
  try { return t ? JSON.parse(t) : {}; } catch { throw new Error('Invalid JSON'); }
}
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
const EDITABLE = ['guestName', 'email', 'phone', 'guests', 'price', 'notes', 'status', 'checkIn', 'checkOut', 'source', 'code'];
const HOUSE_TEXT = ['name', 'location', 'checkInTime', 'checkOutTime', 'currency'];
const HOUSE_NUM = ['nightlyPrice', 'cleaningFee', 'minNights', 'maxGuests'];

// =====================================================================
export class Alpendre extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.dirty = new Set();   // storage keys to write
    this.gone = new Set();    // storage keys to delete
    this.lock = { syncing: null };
    ctx.blockConcurrencyWhile(() => this.load());
  }

  // ---------- storage ----------
  async load() {
    const all = await this.ctx.storage.list();
    this.db = { settings: { syncMinutes: 5, lastAutoSync: null }, workspaces: [], reservations: [], log: [], users: [] };
    for (const [k, v] of all) {
      if (k === 'settings') this.db.settings = { ...this.db.settings, ...v };
      else if (k === 'log') this.db.log = v;
      else if (k.startsWith('w:')) this.db.workspaces.push(v);
      else if (k.startsWith('r:')) this.db.reservations.push(v);
      else if (k.startsWith('u:')) this.db.users.push(v);
    }
    this.db.users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // One-off: move existing setups to the 5-minute check (they can still pick a slower one).
    if (!this.db.settings.fiveMinuteDefault) { this.db.settings.syncMinutes = 5; this.db.settings.fiveMinuteDefault = true; this.touch('settings'); }
    // Houses from before ownership existed: give each to whoever the log says created it.
    for (const w of this.db.workspaces) {
      if (w.ownerId) continue;
      const made = this.db.log.find(l => l.workspaceId === w.id && /^House “/.test(l.msg) && l.by);
      const u = made && this.db.users.find(x => x.name === made.by);
      w.ownerId = u ? u.id : 'owner'; this.touch('w:' + w.id);
    }
    this.db.workspaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!all.has('settings')) { this.seed(); this.touch('settings'); }
    if (this.dirty.size) await this.save();
  }
  touch(key) { this.dirty.add(key); this.gone.delete(key); }
  touchW(w) { this.touch('w:' + w.id); }
  touchR(r) { this.touch('r:' + r.id); }
  touchU(u) { this.touch('u:' + u.id); }
  drop(key) { this.gone.add(key); this.dirty.delete(key); }
  async save() {
    const map = {
      settings: () => this.db.settings, log: () => this.db.log,
      w: k => this.db.workspaces.find(w => 'w:' + w.id === k), r: k => this.db.reservations.find(r => 'r:' + r.id === k),
      u: k => this.db.users.find(u => 'u:' + u.id === k),
    };
    const entries = {};
    for (const k of this.dirty) {
      const v = k === 'settings' || k === 'log' ? map[k]() : map[k[0]](k);
      if (v !== undefined) entries[k] = v;
    }
    this.dirty.clear();
    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.put(Object.fromEntries(keys.slice(i, i + 128).map(k => [k, entries[k]])));
    const del = [...this.gone]; this.gone.clear();
    for (let i = 0; i < del.length; i += 128) await this.ctx.storage.delete(del.slice(i, i + 128));
  }
  log(workspaceId, msg, level = 'info') {
    this.db.log.unshift({ at: new Date().toISOString(), workspaceId, level, msg, by: this.actor ? this.actor.name : null });
    this.db.log = this.db.log.slice(0, 300); this.touch('log');
  }
  // Houses belong to whoever created them; the owner account sees and manages all of them.
  isOwner() { return !!this.actor && this.actor.id === 'owner'; }
  ownerOf(w) { return w.ownerId || 'owner'; }
  canSee(w) { return !!w && !!this.actor && (this.isOwner() || this.ownerOf(w) === this.actor.id); }
  house(wid) { return this.db.workspaces.find(w => w.id === wid); }
  visibleHouse(wid) { const w = this.house(wid); return this.canSee(w) ? w : null; }
  personName(uid) { return uid === 'owner' ? 'Owner' : (this.db.users.find(u => u.id === uid) || {}).name || 'Removed person'; }
  activeIn(wid) { return this.db.reservations.filter(r => r.workspaceId === wid && r.status !== 'cancelled'); }
  conflictsFor(r, wid) { return this.activeIn(wid).filter(o => o.id !== r.id && overlaps(o, r)); }
  addReservation(r) { this.db.reservations.push(r); this.touchR(r); }

  seed() {
    const t = today();
    const houses = [
      newHouse({ ownerId: 'owner', name: 'Casa da Colina', location: 'Algarve', demo: true, nightlyPrice: 180, cleaningFee: 60, minNights: 3, maxGuests: 8 }, 0),
      newHouse({ name: 'Apartamento Ribeira', location: 'Porto', demo: true, nightlyPrice: 110, cleaningFee: 40, minNights: 2, maxGuests: 4 }, 2),
      newHouse({ name: 'Monte das Oliveiras', location: 'Alentejo', demo: true, nightlyPrice: 220, cleaningFee: 80, minNights: 3, maxGuests: 10 }, 1),
    ];
    houses.forEach((w, i) => { w.createdAt = new Date(Date.now() + i).toISOString(); this.db.workspaces.push(w); this.touchW(w); });
    const r = (h, source, inOff, len, guest, extra = {}) => this.addReservation({
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
    r(2, 'airbnb', 13, 3, 'Hannah Schmidt', { code: 'HMF3W8QZ6C' });
    r(2, 'website', 27, 5, 'Grace Miller', { status: 'pending', email: 'grace@example.com' });
  }

  // ---------- sync ----------
  async syncChannel(w, source) {
    const ch = w.channels[source];
    if (!ch || !ch.url) return { house: w.id, source, skipped: true };
    this.touchW(w);
    if (ch.url.includes(`/ical/${w.exportToken}/`)) {
      ch.lastSync = new Date().toISOString(); ch.lastStatus = 'error · this is Alpendre’s own link';
      return { house: w.id, source, error: ch.lastStatus };
    }
    try {
      const events = parseICS(await fetchText(ch.url));
      const seen = new Set(); let added = 0, updated = 0, removed = 0;
      for (const ev of events) {
        if (ev.uid.endsWith('@alpendre')) continue;
        if (ev.checkOut < addDays(today(), -60)) continue;
        seen.add(ev.uid);
        const { blocked, code, guestName } = interpret(ev);
        const ex = this.db.reservations.find(r => r.workspaceId === w.id && r.source === source && r.uid === ev.uid);
        if (ex) {
          if (ex.checkIn !== ev.checkIn || ex.checkOut !== ev.checkOut || ex.status === 'cancelled') {
            ex.checkIn = ev.checkIn; ex.checkOut = ev.checkOut;
            if (ex.status === 'cancelled') ex.status = blocked ? 'blocked' : 'confirmed';
            updated++; this.touchR(ex);
          }
          if (code && !ex.code) { ex.code = code; this.touchR(ex); }
        } else {
          this.addReservation({
            id: id(), workspaceId: w.id, source, uid: ev.uid, status: blocked ? 'blocked' : 'confirmed',
            checkIn: ev.checkIn, checkOut: ev.checkOut, code,
            guestName: blocked ? 'Blocked on ' + LABEL[source] : guestName, email: '', phone: '', guests: null, price: null,
            notes: '', createdAt: new Date().toISOString(),
          });
          added++;
        }
      }
      for (const r of this.db.reservations) {
        if (r.workspaceId === w.id && r.source === source && r.uid && !seen.has(r.uid) && r.status !== 'cancelled' && r.checkOut >= today()) {
          r.status = 'cancelled'; removed++; this.touchR(r);
        }
      }
      ch.lastSync = new Date().toISOString(); ch.lastStatus = `ok · ${events.length} events`;
      if (added || updated || removed) this.log(w.id, `${LABEL[source]}: ${added} new, ${updated} changed, ${removed} cancelled`);
      return { house: w.id, source, added, updated, removed };
    } catch (e) {
      ch.lastSync = new Date().toISOString(); ch.lastStatus = 'error · ' + e.message;
      this.log(w.id, `${LABEL[source]} sync failed: ${e.message}`, 'error');
      return { house: w.id, source, error: e.message };
    }
  }
  async syncHouses(list) {
    // Durable Object input gates already serialise requests; the flag guards against overlap across awaits.
    while (this.lock.syncing) await this.lock.syncing;
    let done; this.lock.syncing = new Promise(r => (done = r));
    try {
      const results = [];
      for (const w of list) for (const c of CHANNELS) results.push(await this.syncChannel(w, c));
      await this.save();
      return results;
    } finally { this.lock.syncing = null; done(); }
  }

  exportFor(w, target) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const clean = s => s.replace(/[,;\\\r\n]/g, ' ');
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alpendre//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${clean(w.name)}`];
    for (const r of this.db.reservations) {
      if (r.workspaceId !== w.id || r.status === 'cancelled' || r.checkOut < today() || r.source === target || r.demo) continue;
      out.push('BEGIN:VEVENT', `UID:${r.id}@alpendre`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${r.checkIn.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${r.checkOut.replace(/-/g, '')}`,
        `SUMMARY:${target === 'all' && r.guestName ? clean(r.guestName) + ' · ' + LABEL[r.source] : 'Not available'}`, 'END:VEVENT');
    }
    out.push('END:VCALENDAR');
    return out.join('\r\n');
  }

  updateHouse(w, b) {
    for (const k of HOUSE_TEXT) if (typeof b[k] === 'string') w[k] = b[k].trim().slice(0, 200);
    if (typeof b.confirmMessage === 'string') w.confirmMessage = b.confirmMessage.trim().slice(0, 3000);
    if (!w.name) w.name = 'Untitled house';
    if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) w.color = b.color;
    for (const k of HOUSE_NUM) if (b[k] !== undefined && b[k] !== '' && !isNaN(+b[k])) w[k] = Math.max(k === 'minNights' || k === 'maxGuests' ? 1 : 0, +b[k]);
    for (const k of ['websiteBookings', 'autoConfirm']) if (typeof b[k] === 'boolean') w[k] = b[k];
    if (b.channels) for (const c of CHANNELS) if (b.channels[c] && typeof b.channels[c].url === 'string') {
      const u = b.channels[c].url.trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error(`${LABEL[c]} link must start with https://`);
      if (u !== w.channels[c].url) w.channels[c] = { url: u, lastSync: null, lastStatus: null };
    }
    delete w.demo; this.touchW(w);
  }

  // ---------- guest email ----------
  async emailGuest(r) {
    const w = this.house(r.workspaceId);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email || '')) return { emailSent: false, emailError: 'This reservation has no guest email.' };
    if (!mailReady(this.env)) return { emailSent: false, emailError: 'Email is not set up yet.' };
    try {
      const m = confirmationEmail(w, r);
      await sendMail(this.env, { fromName: w.name, to: r.email, toName: r.guestName, ...m });
      r.confirmationSentAt = new Date().toISOString(); this.touchR(r);
      this.log(w.id, `Confirmation email sent to ${r.guestName || r.email}`);
      return { emailSent: true };
    } catch (e) {
      const msg = /535|BadCredentials|not accepted/i.test(e.message) ? 'Gmail refused the login: check the Gmail app password.'
        : /timed? ?out|timeout/i.test(e.message) ? 'Gmail did not answer in time. Try again.' : e.message.split(/\r?\n/)[0].slice(0, 200);
      this.log(w.id, `Confirmation email to ${r.email} failed: ${msg}`, 'error');
      return { emailSent: false, emailError: msg };
    }
  }

  // ---------- auth ----------
  // Returns the signed-in person ({ id, name }) or null.
  async sessionUser(req) {
    const m = (req.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
    if (!m) return null;
    const s = await this.ctx.storage.get('s:' + m[1]);
    if (!s || s.exp < Date.now()) return null;
    if (!s.userId || s.userId === 'owner') return OWNER;
    const u = this.db.users.find(x => x.id === s.userId);
    return u && u.passHash ? { id: u.id, name: u.name } : null;
  }
  async newSession(userId) {
    const t = hex(24);
    await this.ctx.storage.put('s:' + t, { exp: Date.now() + SESSION_DAYS * 864e5, userId });
    return t;
  }
  async endSessionsOf(userId) {
    const all = await this.ctx.storage.list({ prefix: 's:' });
    const keys = [...all].filter(([, v]) => v.userId === userId).map(([k]) => k);
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }
  findUser(login) {
    const l = String(login || '').trim().toLowerCase();
    return l ? this.db.users.find(u => u.login === l || (u.email && u.email.toLowerCase() === l)) : null;
  }
  async checkLogin(login, password) {
    const l = String(login || '').trim().toLowerCase();
    if (!l || l === 'owner') return this.env.ALPENDRE_PASSWORD && (await sameSecret(password, this.env.ALPENDRE_PASSWORD)) ? OWNER : null;
    const u = this.findUser(l);
    if (!u || !u.passHash) { await hashPassword(String(password), '00'.repeat(16)); return null; } // same work either way
    const h = await hashPassword(String(password), u.salt);
    return (await sameSecret(h.hash, u.passHash)) ? { id: u.id, name: u.name } : null;
  }
  async setPassword(u, pw) {
    const h = await hashPassword(pw); u.passHash = h.hash; u.salt = h.salt;
    delete u.inviteToken; delete u.inviteExp; this.touchU(u);
  }
  newInvite(u) { u.inviteToken = hex(24); u.inviteExp = Date.now() + INVITE_DAYS * 864e5; this.touchU(u); return u.inviteToken; }

  // ---------- requests ----------
  async fetch(req) {
    const url = new URL(req.url), p = url.pathname, m = req.method;
    if (p === '/__cron') {
      const mins = Math.max(5, this.db.settings.syncMinutes || 5);
      const last = this.db.settings.lastAutoSync ? Date.parse(this.db.settings.lastAutoSync) : 0;
      if (Date.now() - last < (mins - 1) * 60e3) return json({ skipped: true });
      this.db.settings.lastAutoSync = new Date().toISOString(); this.touch('settings');
      const run = Object.create(this); run.actor = null; // automatic run: nobody to credit in the log
      return json({ results: await run.syncHouses(this.db.workspaces) });
    }
    // Requests can interleave while one awaits the network, so each gets its own view that
    // carries who is signed in. Data (db, dirty sets, sync lock) stays shared via the prototype.
    const view = Object.create(this); view.actor = null;
    try { return await view.route(req, url, p, m); }
    catch (e) { return json({ error: e.message }, 500, ownerCors(req, this.env)); }
  }

  async route(req, url, p, m) {
    const env = this.env;
    // calendar exports
    const ex = p.match(/^\/ical\/([a-f0-9]+)\/(airbnb|booking|website|all)\.ics$/);
    if (ex) {
      const w = this.db.workspaces.find(x => x.exportToken === ex[1]);
      if (!w) return new Response('Not found', { status: 404 });
      return new Response(this.exportFor(w, ex[2]), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // public website API
    if (p.startsWith('/api/public/')) {
      if (m === 'OPTIONS') return new Response(null, { status: 204, headers: PUBLIC_CORS });
      const pub = p.match(/^\/api\/public\/(pk_[a-f0-9]+)\/(availability|book)$/);
      const w = pub && this.db.workspaces.find(x => x.publicKey === pub[1]);
      if (!w) return json({ error: 'Unknown house' }, 404, PUBLIC_CORS);
      if (pub[2] === 'availability' && m === 'GET') {
        return json({
          house: w.name, currency: w.currency, nightlyPrice: w.nightlyPrice, cleaningFee: w.cleaningFee,
          minNights: w.minNights, maxGuests: w.maxGuests, checkInTime: w.checkInTime, checkOutTime: w.checkOutTime,
          bookingsEnabled: w.websiteBookings, autoConfirm: w.autoConfirm,
          booked: this.activeIn(w.id).filter(r => r.checkOut >= today()).map(r => ({ checkIn: r.checkIn, checkOut: r.checkOut })),
        }, 200, PUBLIC_CORS);
      }
      if (pub[2] === 'book' && m === 'POST') {
        if (!w.websiteBookings) return json({ errors: ['Online booking is turned off for this house.'] }, 403, PUBLIC_CORS);
        const b = await readBody(req), errors = [];
        if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) errors.push('Choose valid dates.');
        else {
          if (b.checkIn < today()) errors.push('Check-in cannot be in the past.');
          if (nights(b.checkIn, b.checkOut) < w.minNights) errors.push(`Minimum stay is ${w.minNights} nights.`);
          if (nights(b.checkIn, b.checkOut) > 90) errors.push('Stays are limited to 90 nights.');
          if (this.conflictsFor({ checkIn: b.checkIn, checkOut: b.checkOut }, w.id).length) errors.push('Those dates are no longer available.');
        }
        if (!b.guestName || String(b.guestName).trim().length < 2) errors.push('Please enter your name.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) errors.push('Please enter a valid email.');
        const guests = Number(b.guests);
        if (!(guests >= 1 && guests <= w.maxGuests)) errors.push(`Guests must be between 1 and ${w.maxGuests}.`);
        if (errors.length) return json({ errors }, 400, PUBLIC_CORS);
        const n = nights(b.checkIn, b.checkOut);
        // A website with its own pricing (e.g. by season) sends the total the guest saw; it is a
        // request the host confirms, so it is stored as quoted and marked as such in the notes.
        const quoted = Number(b.total), useQuote = Number.isFinite(quoted) && quoted > 0 && quoted < 1e6;
        const total = useQuote ? Math.round(quoted * 100) / 100 : n * w.nightlyPrice + w.cleaningFee;
        const extra = b.details && typeof b.details === 'object' ? Object.entries(b.details).slice(0, 12)
          .map(([k, v]) => `${String(k).slice(0, 40)}: ${String(v).slice(0, 200)}`).join('\n') : '';
        const notes = [String(b.message || '').slice(0, 2000), extra, useQuote ? 'Price as quoted on the website.' : ''].filter(Boolean).join('\n\n');
        const r = {
          id: id(), workspaceId: w.id, source: 'website', status: w.autoConfirm ? 'confirmed' : 'pending',
          checkIn: b.checkIn, checkOut: b.checkOut,
          guestName: String(b.guestName).trim().slice(0, 120), email: String(b.email).trim().slice(0, 200),
          phone: String(b.phone || '').slice(0, 40), guests, price: total,
          notes, code: 'WEB-' + id().slice(0, 6).toUpperCase(), lang: b.lang === 'pt' ? 'pt' : b.lang === 'en' ? 'en' : undefined,
          createdAt: new Date().toISOString(),
        };
        this.addReservation(r);
        this.log(w.id, `Website request from ${r.guestName} (${r.checkIn} → ${r.checkOut})`);
        await this.save();
        return json({ ok: true, code: r.code, status: r.status, total, nights: n, currency: w.currency }, 201, PUBLIC_CORS);
      }
      return json({ error: 'Method not allowed' }, 405, PUBLIC_CORS);
    }

    // owner API
    const cors = ownerCors(req, env);
    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (p === '/api/login' && m === 'POST') {
      const b = await readBody(req);
      if (!String(b.login || '').trim() && !env.ALPENDRE_PASSWORD) return json({ error: 'No password set on the server yet. Run: npx wrangler secret put ALPENDRE_PASSWORD' }, 503, cors);
      const who = await this.checkLogin(b.login, b.password || '');
      if (!who) { await new Promise(r => setTimeout(r, 600)); return json({ error: 'Wrong username or password' }, 401, cors); }
      return json({ ok: true, token: await this.newSession(who.id), user: who }, 200, cors);
    }
    if (p === '/api/logout' && m === 'POST') {
      const mm = (req.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
      if (mm) await this.ctx.storage.delete('s:' + mm[1]);
      return json({ ok: true }, 200, cors);
    }
    // invite links: open without signing in, the token is the proof
    const inv = p.match(/^\/api\/invite\/([a-f0-9]{48})$/);
    if (inv) {
      const u = this.db.users.find(x => x.inviteToken === inv[1] && x.inviteExp > Date.now());
      if (!u) return json({ error: 'This invite link has expired or was already used. Ask for a new one.' }, 404, cors);
      if (m === 'GET') return json({ name: u.name, login: u.login }, 200, cors);
      if (m === 'POST') {
        const b = await readBody(req);
        if (String(b.password || '').length < 8) return json({ error: 'Use at least 8 characters.' }, 400, cors);
        await this.setPassword(u, String(b.password));
        this.actor = { id: u.id, name: u.name }; this.log(null, `${u.name} accepted the invite`);
        await this.save();
        return json({ ok: true, token: await this.newSession(u.id), user: this.actor }, 200, cors);
      }
    }
    if (!p.startsWith('/api/')) return new Response('Not found', { status: 404 });
    this.actor = await this.sessionUser(req);
    if (!this.actor) return json({ error: 'Not signed in' }, 401, cors);

    // people (everyone has full access, including managing people)
    const ownerOnly = () => json({ error: 'Only the owner account can do this.' }, 403, cors);
    if (p === '/api/users' && m === 'GET') return json({ me: this.actor, users: this.isOwner() ? this.db.users.map(publicUser) : [] }, 200, cors);
    if (p === '/api/users' && m === 'POST') {
      if (!this.isOwner()) return ownerOnly();
      const b = await readBody(req);
      const name = String(b.name || '').trim().slice(0, 80);
      if (name.length < 2) return json({ error: 'Enter a name.' }, 400, cors);
      const login = slug(String(b.login || '').trim() || name.split(/\s+/)[0]);
      if (!login || login === 'owner') return json({ error: 'Choose another username.' }, 400, cors);
      if (this.findUser(login)) return json({ error: `The username “${login}” is taken.` }, 400, cors);
      const email = String(b.email || '').trim().slice(0, 200);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email does not look right.' }, 400, cors);
      if (email && this.findUser(email)) return json({ error: 'Someone already uses that email.' }, 400, cors);
      const u = { id: id(), name, login, email, role: 'admin', createdAt: new Date().toISOString(), createdBy: this.actor.name };
      this.db.users.push(u); const t = this.newInvite(u);
      this.log(null, `Invited ${name} (${login})`); await this.save();
      return json({ user: publicUser(u), inviteToken: t }, 201, cors);
    }
    const um = p.match(/^\/api\/users\/([a-f0-9]+)(\/invite)?$/);
    if (um) {
      if (!this.isOwner()) return ownerOnly();
      const u = this.db.users.find(x => x.id === um[1]);
      if (!u) return json({ error: 'Person not found' }, 404, cors);
      if (um[2] && m === 'POST') { // a fresh invite link is also how a forgotten password is reset
        if (u.id === this.actor.id) return json({ error: 'Use “Change my password” instead.' }, 400, cors);
        delete u.passHash; delete u.salt; const t = this.newInvite(u);
        await this.endSessionsOf(u.id); this.log(null, `New invite link for ${u.name}`); await this.save();
        return json({ user: publicUser(u), inviteToken: t }, 200, cors);
      }
      if (!um[2] && m === 'DELETE') {
        if (u.id === this.actor.id) return json({ error: 'You cannot remove yourself.' }, 400, cors);
        this.db.users = this.db.users.filter(x => x.id !== u.id); this.drop('u:' + u.id);
        for (const w of this.db.workspaces.filter(w => w.ownerId === u.id)) { w.ownerId = 'owner'; this.touchW(w); }
        await this.endSessionsOf(u.id); this.log(null, `Removed ${u.name}`); await this.save();
        return json({ ok: true }, 200, cors);
      }
    }
    if (p === '/api/me/password' && m === 'POST') {
      if (this.actor.id === 'owner') return json({ error: 'The owner password is changed with: npx wrangler secret put ALPENDRE_PASSWORD' }, 400, cors);
      const b = await readBody(req), u = this.db.users.find(x => x.id === this.actor.id);
      if (!(await this.checkLogin(u.login, b.current || ''))) return json({ error: 'Your current password is wrong.' }, 400, cors);
      if (String(b.next || '').length < 8) return json({ error: 'Use at least 8 characters.' }, 400, cors);
      await this.setPassword(u, String(b.next)); await this.save();
      return json({ ok: true }, 200, cors);
    }

    const db = this.db;
    if (p === '/api/state' && m === 'GET') {
      const houses = db.workspaces.filter(w => this.canSee(w));
      const ids = new Set(houses.map(w => w.id));
      const reservations = db.reservations.filter(r => ids.has(r.workspaceId))
        .map(r => ({ ...r, conflicts: r.status === 'cancelled' ? [] : this.conflictsFor(r, r.workspaceId).map(o => o.id) }));
      const log = db.log.filter(l => l.workspaceId ? ids.has(l.workspaceId) : this.isOwner());
      const workspaces = houses.map(w => ({ ...w, ownerId: this.ownerOf(w), ownerName: this.personName(this.ownerOf(w)) }));
      return json({ settings: db.settings, workspaces, reservations, log, today: today(), defaultPassword: false, apiOrigin: url.origin, mailReady: mailReady(env), mailFrom: env.GMAIL_USER || '',
        me: { ...this.actor, isOwner: this.isOwner() }, users: this.isOwner() ? db.users.map(publicUser) : [] }, 200, cors);
    }
    if (p === '/api/workspaces' && m === 'POST') {
      const b = await readBody(req), w = newHouse({ ownerId: this.actor.id }, db.workspaces.length);
      try { this.updateHouse(w, b); } catch (e) { return json({ error: e.message }, 400, cors); }
      db.workspaces.push(w); this.touchW(w); this.log(w.id, `House “${w.name}” created`); await this.save();
      return json(w, 201, cors);
    }
    const wm = p.match(/^\/api\/workspaces\/([a-f0-9]+)(\/sync|\/rotate)?$/);
    if (wm) {
      const w = this.visibleHouse(wm[1]);
      if (!w) return json({ error: 'House not found' }, 404, cors);
      if (wm[2] === '/sync' && m === 'POST') return json({ results: await this.syncHouses([w]) }, 200, cors);
      if (wm[2] === '/rotate' && m === 'POST') { w.exportToken = token(); this.touchW(w); this.log(w.id, 'Calendar export links replaced'); await this.save(); return json(w, 200, cors); }
      if (!wm[2] && m === 'PUT') {
        const b = await readBody(req);
        if (b.ownerId !== undefined && b.ownerId !== this.ownerOf(w)) {
          if (!this.isOwner()) return ownerOnly();
          if (b.ownerId !== 'owner' && !db.users.some(u => u.id === b.ownerId)) return json({ error: 'Unknown person' }, 400, cors);
          w.ownerId = b.ownerId; this.log(w.id, `House moved to ${this.personName(b.ownerId)}`);
        }
        try { this.updateHouse(w, b); } catch (e) { return json({ error: e.message }, 400, cors); }
        await this.save(); return json(w, 200, cors);
      }
      if (!wm[2] && m === 'DELETE') {
        db.workspaces = db.workspaces.filter(x => x.id !== w.id); this.drop('w:' + w.id);
        for (const r of db.reservations.filter(r => r.workspaceId === w.id)) this.drop('r:' + r.id);
        db.reservations = db.reservations.filter(r => r.workspaceId !== w.id);
        db.log = db.log.filter(l => l.workspaceId !== w.id); this.touch('log');
        await this.save(); return json({ ok: true }, 200, cors);
      }
    }
    if (p === '/api/reservations' && m === 'POST') {
      const b = await readBody(req);
      if (!this.visibleHouse(b.workspaceId)) return json({ error: 'Choose a house' }, 400, cors);
      if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) return json({ error: 'Invalid dates' }, 400, cors);
      const r = { id: id(), workspaceId: b.workspaceId, source: 'manual', status: 'confirmed', guestName: '', email: '', phone: '', guests: null, price: null, notes: '', code: '', createdAt: new Date().toISOString(), ...pick(b, EDITABLE) };
      if (!SOURCES.includes(r.source)) r.source = 'manual';
      this.addReservation(r); this.log(r.workspaceId, `Added ${LABEL[r.source]} stay for ${r.guestName || 'guest'}`); await this.save();
      return json(r, 201, cors);
    }
    const rm = p.match(/^\/api\/reservations\/([a-f0-9]+)(\/email)?$/);
    if (rm) {
      const r = db.reservations.find(x => x.id === rm[1]);
      if (!r || !this.visibleHouse(r.workspaceId)) return json({ error: 'Not found' }, 404, cors);
      if (rm[2] && m === 'POST') {
        const out = await this.emailGuest(r);
        await this.save();
        return json(out.emailSent ? out : { ...out, error: out.emailError }, out.emailSent ? 200 : 400, cors);
      }
      if (m === 'PUT') {
        const raw = await readBody(req), b = pick(raw, EDITABLE);
        const wasConfirmed = r.status === 'confirmed';
        if (r.uid) { delete b.checkIn; delete b.checkOut; delete b.source; }
        if (b.source && !SOURCES.includes(b.source)) delete b.source;
        if ((b.checkIn || b.checkOut) && !((b.checkIn || r.checkIn) < (b.checkOut || r.checkOut))) return json({ error: 'Invalid dates' }, 400, cors);
        Object.assign(r, b); delete r.demo; this.touchR(r);
        let mail = {};
        if (raw.notifyGuest === true && r.status === 'confirmed' && !wasConfirmed) mail = await this.emailGuest(r);
        await this.save();
        return json({ ...r, ...mail }, 200, cors);
      }
      if (m === 'DELETE') {
        db.reservations = db.reservations.filter(x => x.id !== r.id); this.drop('r:' + r.id);
        this.log(r.workspaceId, `Deleted stay ${r.guestName || r.id}`); await this.save();
        return json({ ok: true }, 200, cors);
      }
    }
    if (p === '/api/sync' && m === 'POST') return json({ results: await this.syncHouses(db.workspaces.filter(w => this.canSee(w))) }, 200, cors);
    if (p === '/api/settings' && m === 'PUT') {
      if (!this.isOwner()) return ownerOnly();
      const b = await readBody(req);
      if ([5, 15, 30, 60, 180].includes(+b.syncMinutes)) { db.settings.syncMinutes = +b.syncMinutes; this.touch('settings'); }
      await this.save(); return json(db.settings, 200, cors);
    }
    if (p === '/api/demo' && m === 'DELETE') {
      if (!this.isOwner()) return ownerOnly();
      const demo = new Set(db.workspaces.filter(w => w.demo).map(w => w.id));
      for (const w of db.workspaces.filter(w => w.demo)) this.drop('w:' + w.id);
      for (const r of db.reservations.filter(r => r.demo || demo.has(r.workspaceId))) this.drop('r:' + r.id);
      db.workspaces = db.workspaces.filter(w => !w.demo);
      db.reservations = db.reservations.filter(r => !r.demo && !demo.has(r.workspaceId));
      await this.save(); return json({ ok: true }, 200, cors);
    }
    return json({ error: 'Unknown endpoint' }, 404, cors);
  }
}

// =====================================================================
const stub = env => env.STORE.get(env.STORE.idFromName('main'));
export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    if (p.startsWith('/api/') || p.startsWith('/ical/')) return stub(env).fetch(req);
    if (p === '/__cron') return new Response('Not found', { status: 404 }); // only the scheduler may trigger syncs
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://alpendre.internal/__cron'));
  },
};
