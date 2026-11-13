// Guest website: availability calendar + direct booking request
'use strict';
const $ = s => document.querySelector(s);
const D = s => new Date(s + 'T00:00:00Z');
const F = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return F(d); };
const nightsOf = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const nice = s => D(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const today = F(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
let info, taken = new Set(), start = null, end = null, offset = 0;
const money = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: info.currency, maximumFractionDigits: 0 }).format(n);

async function load() {
  [info] = await Promise.all([fetch('/api/public/info').then(r => r.json()), loadAvailability()]);
  document.title = `${info.propertyName} · Book direct`;
  for (const id of ['navName', 'name', 'footName']) $('#' + id).textContent = info.propertyName;
  $('#loc').textContent = $('#footLoc').textContent = info.location;
  $('#tagline').textContent = info.tagline;
  $('#desc').textContent = info.description;
  $('#facts').innerHTML = [`${info.maxGuests} guests`, `${info.bedrooms} bedrooms`, `${info.bathrooms} bathrooms`].map(f => `<span>${f}</span>`).join('');
  $('#priceFrom').innerHTML = `from <b>${money(info.nightlyPrice)}</b> / night`;
  $('#cin').textContent = 'from ' + info.checkInTime; $('#cout').textContent = 'by ' + info.checkOutTime;
  $('#minN').textContent = info.minNights + ' nights';
  $('#amenities').innerHTML = info.amenities.map(a => `<li>${a.replace(/</g, '&lt;')}</li>`).join('');
  $('#guests').innerHTML = Array.from({ length: info.maxGuests }, (_, i) => `<option ${i === 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  $('#mail').textContent = info.contactEmail; $('#mail').href = 'mailto:' + info.contactEmail;
  $('#fine').textContent = info.autoConfirm ? 'Your booking is confirmed straight away. Payment details follow by email.' : 'No payment now. We confirm within 24 hours by email.';
  $('#submitBtn').textContent = info.autoConfirm ? 'Book now' : 'Request to book';
  renderMonths(); renderQuote();
}
async function loadAvailability() {
  const ranges = await fetch('/api/public/availability').then(r => r.json());
  taken = new Set();
  for (const r of ranges) for (let d = r.checkIn; d < r.checkOut; d = add(d, 1)) taken.add(d); // occupied nights
}

function renderMonths() {
  const base = new Date(D(today.slice(0, 8) + '01')); base.setUTCMonth(base.getUTCMonth() + offset);
  let html = '';
  for (let m = 0; m < 2; m++) {
    const first = new Date(base); first.setUTCMonth(base.getUTCMonth() + m);
    const fs = F(first), lead = (first.getUTCDay() + 6) % 7;
    const nextM = new Date(first); nextM.setUTCMonth(nextM.getUTCMonth() + 1);
    const days = nightsOf(fs, F(nextM));
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('') + '<span></span>'.repeat(lead);
    for (let i = 0; i < days; i++) {
      const d = add(fs, i), cls = [];
      let disabled = d < today;
      if (taken.has(d)) {
        cls.push('taken');
        // While picking a departure, the first taken night can still be the check-out day.
        if (start && !end && d > start && !rangeBlocked(start, d)) cls.push('co-only'); else disabled = true;
      }
      if (start && d === start) cls.push('start');
      if (end && d === end) cls.push('end');
      if (start && end && d > start && d < end) cls.push('in-range');
      if (d === today) cls.push('today');
      cells += `<button type="button" data-d="${d}" class="${cls.join(' ')}" ${disabled ? 'disabled' : ''} aria-label="${nice(d)}${taken.has(d) ? ', unavailable' : ''}">${i + 1}</button>`;
    }
    html += `<div class="month"><h3>${first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><div class="mgrid">${cells}</div></div>`;
  }
  $('#months').innerHTML = html;
  $('#prev').disabled = offset <= 0;
}
// true if any night in [a, b) is taken
function rangeBlocked(a, b) { for (let d = a; d < b; d = add(d, 1)) if (taken.has(d)) return true; return false; }

$('#months').addEventListener('click', e => {
  const b = e.target.closest('button[data-d]'); if (!b || b.disabled) return;
  const d = b.dataset.d;
  if (!start || end || d <= start) { if (taken.has(d)) return; start = d; end = null; }
  else if (!rangeBlocked(start, d)) end = d;
  else { start = taken.has(d) ? null : d; end = null; }
  $('#formErr').textContent = '';
  renderMonths(); renderQuote();
});
$('#prev').onclick = () => { offset = Math.max(0, offset - 1); renderMonths(); };
$('#next').onclick = () => { offset = Math.min(22, offset + 1); renderMonths(); };

function renderQuote() {
  $('#selIn').textContent = start ? nice(start) : 'Add date';
  $('#selOut').textContent = end ? nice(end) : 'Add date';
  const q = $('#quote');
  if (!start || !end) { q.innerHTML = `<p class="muted">${start ? 'Now choose your departure day.' : 'Choose your dates to see the price.'}</p>`; return; }
  const n = nightsOf(start, end);
  if (n < info.minNights) { q.innerHTML = `<p class="muted">The minimum stay is ${info.minNights} nights. Pick a later departure.</p>`; return; }
  q.innerHTML = `
    <div class="line"><span>${money(info.nightlyPrice)} × ${n} nights</span><span>${money(info.nightlyPrice * n)}</span></div>
    <div class="line"><span>Cleaning</span><span>${money(info.cleaningFee)}</span></div>
    <div class="line"><span>Service fee</span><span>${money(0)}</span></div>
    <div class="line total"><span>Total</span><span>${money(info.nightlyPrice * n + info.cleaningFee)}</span></div>`;
}

$('#bookForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#formErr'), fd = Object.fromEntries(new FormData(e.target));
  if (!start || !end) { err.textContent = 'Please choose your arrival and departure days on the calendar.'; return; }
  if (nightsOf(start, end) < info.minNights) { err.textContent = `The minimum stay is ${info.minNights} nights.`; return; }
  if (!fd.guestName.trim() || !/^\S+@\S+\.\S+$/.test(fd.email)) { err.textContent = 'Please add your name and a valid email.'; return; }
  const btn = $('#submitBtn'); btn.disabled = true; err.textContent = '';
  try {
    const res = await fetch('/api/public/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fd, checkIn: start, checkOut: end }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = (data.errors || ['Something went wrong.']).join(' '); await loadAvailability(); renderMonths(); return; }
    $('#doneTitle').textContent = data.status === 'confirmed' ? 'You’re booked!' : 'Request sent!';
    $('#doneText').innerHTML = `${nice(start)} → ${nice(end)} · ${money(data.quote.total)}<br>Reference <b>${data.code}</b>. ${data.status === 'confirmed' ? 'A confirmation is on its way to' : 'We’ll reply within 24 hours to'} ${fd.email.replace(/</g, '&lt;')}.`;
    $('#done').hidden = false;
    e.target.reset(); start = end = null; await loadAvailability(); renderMonths(); renderQuote();
  } catch { err.textContent = 'Could not reach the server. Please try again.'; }
  finally { btn.disabled = false; }
});
$('#doneBtn').onclick = () => { $('#done').hidden = true; };

load();
