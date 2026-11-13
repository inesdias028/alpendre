/* Alpendre booking widget — drop into any website:
 *   <div data-alpendre="pk_..."></div>
 *   <script src="https://YOUR-ALPENDRE/embed.js" async></script>
 * Options on the div: data-mode="calendar" (availability only), data-accent="#c4622d".
 * Renders inside a shadow root so it never clashes with the site's own CSS.
 */
(function () {
  'use strict';
  var script = document.currentScript || [].slice.call(document.scripts).filter(function (s) { return /embed\.js/.test(s.src); }).pop();
  var BASE = new URL(script.src).origin;

  var CSS = ':host{all:initial;display:block;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2a24;--a:#c4622d}' +
    '*{box-sizing:border-box}.w{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;align-items:start}' +
    '@media(max-width:720px){.w{grid-template-columns:1fr}}.w.cal-only{grid-template-columns:1fr}' +
    '.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.nav b{font-size:15px}' +
    '.nav button,.btn{border:1px solid #e6dfd2;background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px}' +
    '.months{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:520px){.months{grid-template-columns:1fr}}' +
    '.m h4{margin:0 0 6px;text-align:center;font-size:14px;font-weight:600}.g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}' +
    '.dow{font-size:11px;color:#7d867f;text-align:center;padding:2px 0 4px}' +
    '.g button{aspect-ratio:1;border:0;background:transparent;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;color:inherit}' +
    '.g button:hover:not(:disabled){background:color-mix(in srgb,var(--a) 15%,#fff)}.g button:disabled{color:#c9c2b5;cursor:not-allowed}' +
    '.g button.t{text-decoration:line-through}.g button.co{color:#4a564f;cursor:pointer}' +
    '.g button.r{background:color-mix(in srgb,var(--a) 15%,#fff);border-radius:0}.g button.s,.g button.e{background:var(--a);color:#fff}' +
    '.g button.s{border-radius:8px 0 0 8px}.g button.e{border-radius:0 8px 8px 0}.g button.s.e{border-radius:8px}' +
    'form{background:#fff;border:1px solid #e6dfd2;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}' +
    '.sel{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e6dfd2;border-radius:10px}.sel div{padding:8px 10px;display:flex;flex-direction:column}' +
    '.sel div+div{border-left:1px solid #e6dfd2}.sel span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#7d867f;font-weight:600}' +
    '.q{background:#f7f2e9;border-radius:10px;padding:10px 12px;font-size:13px}.q .l{display:flex;justify-content:space-between;padding:2px 0}' +
    '.q .tot{border-top:1px solid #e6dfd2;margin-top:4px;padding-top:6px;font-weight:700}.mut{color:#7d867f;margin:0}' +
    'label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500;color:#4a564f}' +
    'input,select,textarea{font:inherit;font-size:14px;border:1px solid #e6dfd2;border-radius:8px;padding:8px 10px;color:#1f2a24;background:#fff}' +
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.go{background:var(--a);color:#fff;border:0;border-radius:999px;padding:11px;font:inherit;font-weight:600;cursor:pointer}' +
    '.go:disabled{opacity:.6}.err{color:#b3261e;font-size:13px;margin:0}.ok{text-align:center;padding:10px 0}.ok b{display:block;font-size:18px;margin-bottom:6px}' +
    '.pw{font-size:11px;color:#a9a497;text-align:right;margin-top:6px}.pw a{color:inherit}';

  function D(s) { return new Date(s + 'T00:00:00Z'); }
  function F(d) { return d.toISOString().slice(0, 10); }
  function add(s, n) { var d = D(s); d.setUTCDate(d.getUTCDate() + n); return F(d); }
  function nightsOf(a, b) { return Math.round((D(b) - D(a)) / 864e5); }
  function nice(s) { return D(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount(el) {
    var key = el.getAttribute('data-alpendre');
    var calOnly = el.getAttribute('data-mode') === 'calendar';
    var root = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;
    var accent = el.getAttribute('data-accent');
    root.innerHTML = '<style>' + CSS + (accent ? ':host{--a:' + esc(accent) + '}' : '') + '</style><div class="w"><p class="mut">Loading availability…</p></div>';
    var wrap = root.querySelector('.w');
    var info, taken = {}, start = null, end = null, offset = 0;
    var today = F(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
    function money(n) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: info.currency, maximumFractionDigits: 0 }).format(n); }

    function load() {
      return fetch(BASE + '/api/public/' + key + '/availability').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
        info = d; taken = {};
        d.booked.forEach(function (b) { for (var x = b.checkIn; x < b.checkOut; x = add(x, 1)) taken[x] = 1; });
      });
    }
    function blocked(a, b) { for (var x = a; x < b; x = add(x, 1)) if (taken[x]) return true; return false; }

    function render() {
      var showForm = !calOnly && info.bookingsEnabled;
      wrap.className = 'w' + (showForm ? '' : ' cal-only');
      var base = D(today.slice(0, 8) + '01'); base.setUTCMonth(base.getUTCMonth() + offset);
      var months = '';
      for (var k = 0; k < 2; k++) {
        var first = new Date(base); first.setUTCMonth(base.getUTCMonth() + k);
        var fs = F(first), lead = (first.getUTCDay() + 6) % 7, nx = new Date(first); nx.setUTCMonth(nx.getUTCMonth() + 1);
        var cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('') + new Array(lead + 1).join('<span></span>');
        for (var i = 0; i < nightsOf(fs, F(nx)); i++) {
          var d = add(fs, i), c = [], dis = d < today;
          if (taken[d]) { c.push('t'); if (showForm && start && !end && d > start && !blocked(start, d)) c.push('co'); else dis = true; }
          if (d === start) c.push('s'); if (d === end) c.push('e'); if (start && end && d > start && d < end) c.push('r');
          if (!showForm) dis = d < today || !!taken[d]; // display only: free days stay readable, clicks are ignored
          cells += '<button type="button" data-d="' + d + '" class="' + c.join(' ') + '"' + (dis ? ' disabled' : '') + '>' + (i + 1) + '</button>';
        }
        months += '<div class="m"><h4>' + first.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) + '</h4><div class="g">' + cells + '</div></div>';
      }
      var cal = '<div><div class="nav"><button type="button" data-n="-1"' + (offset <= 0 ? ' disabled' : '') + '>←</button><b>' + esc(info.house) + '</b><button type="button" data-n="1">→</button></div><div class="months">' + months + '</div><div class="pw">Crossed-out days are taken · <a href="https://github.com/inesdias028/alpendre" target="_blank" rel="noopener">Alpendre</a></div></div>';
      var form = '';
      if (showForm) {
        var q;
        if (!start || !end) q = '<p class="mut">' + (start ? 'Now pick your departure day.' : 'Pick your arrival day on the calendar.') + '</p>';
        else if (nightsOf(start, end) < info.minNights) q = '<p class="mut">Minimum stay is ' + info.minNights + ' nights.</p>';
        else { var n = nightsOf(start, end); q = '<div class="l"><span>' + money(info.nightlyPrice) + ' × ' + n + ' nights</span><span>' + money(n * info.nightlyPrice) + '</span></div><div class="l"><span>Cleaning</span><span>' + money(info.cleaningFee) + '</span></div><div class="l tot"><span>Total</span><span>' + money(n * info.nightlyPrice + info.cleaningFee) + '</span></div>'; }
        var opts = ''; for (var g = 1; g <= info.maxGuests; g++) opts += '<option' + (g === 2 ? ' selected' : '') + '>' + g + '</option>';
        form = '<form novalidate><div class="sel"><div><span>Arrive</span><b>' + (start ? nice(start) : '—') + '</b></div><div><span>Leave</span><b>' + (end ? nice(end) : '—') + '</b></div></div>' +
          '<div class="q">' + q + '</div><label>Full name<input name="guestName" autocomplete="name"></label><label>Email<input name="email" type="email" autocomplete="email"></label>' +
          '<div class="two"><label>Phone<input name="phone" type="tel"></label><label>Guests<select name="guests">' + opts + '</select></label></div>' +
          '<label>Message<textarea name="message" rows="2"></textarea></label><p class="err"></p><button class="go">' + (info.autoConfirm ? 'Book now' : 'Request to book') + '</button></form>';
      }
      var keep = {}; var old = wrap.querySelector('form'); if (old) ['guestName', 'email', 'phone', 'guests', 'message'].forEach(function (n) { keep[n] = old[n].value; });
      wrap.innerHTML = cal + form;
      var nf = wrap.querySelector('form'); if (nf) Object.keys(keep).forEach(function (n) { nf[n].value = keep[n]; });
    }

    wrap.addEventListener('click', function (e) {
      var n = e.target.closest('[data-n]'); if (n) { offset = Math.max(0, Math.min(22, offset + +n.getAttribute('data-n'))); return render(); }
      var b = e.target.closest('button[data-d]'); if (!b || b.disabled || calOnly || !info.bookingsEnabled) return;
      var d = b.getAttribute('data-d');
      if (!start || end || d <= start) { if (taken[d]) return; start = d; end = null; }
      else if (!blocked(start, d)) end = d; else { start = taken[d] ? null : d; end = null; }
      render();
    });
    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, err = f.querySelector('.err');
      if (!start || !end) { err.textContent = 'Choose your dates on the calendar.'; return; }
      var body = { checkIn: start, checkOut: end, guestName: f.guestName.value, email: f.email.value, phone: f.phone.value, guests: +f.guests.value, message: f.message.value };
      f.querySelector('.go').disabled = true;
      fetch(BASE + '/api/public/' + key + '/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (!x.ok) { err.textContent = (x.d.errors || ['Something went wrong.']).join(' '); f.querySelector('.go').disabled = false; return load().then(render); }
          f.outerHTML = '<form><div class="ok"><b>' + (x.d.status === 'confirmed' ? 'You’re booked!' : 'Request sent!') + '</b>' + nice(start) + ' → ' + nice(end) + ' · ' + money(x.d.total) +
            '<br>Reference ' + esc(x.d.code) + '<br><span class="mut">' + (x.d.status === 'confirmed' ? 'A confirmation follows by email.' : 'We’ll confirm by email soon.') + '</span></div></form>';
          start = end = null; load();
        })
        .catch(function () { err.textContent = 'Could not reach the booking server.'; f.querySelector('.go').disabled = false; });
    });

    load().then(render).catch(function () { wrap.innerHTML = '<p class="mut">Availability could not be loaded.</p>'; });
  }

  function init() { [].forEach.call(document.querySelectorAll('[data-alpendre]'), function (el) { if (!el.__alp) { el.__alp = 1; mount(el); } }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
