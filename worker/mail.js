// Guest emails, sent through Gmail's SMTP server with an app password.
// GMAIL_USER (wrangler.toml) is the sending address; GMAIL_APP_PASSWORD is a Worker secret.
import { WorkerMailer } from 'worker-mailer';

export const mailReady = env => !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const D = s => new Date(s + 'T00:00:00Z');
const nightsOf = (a, b) => Math.round((D(b) - D(a)) / 864e5);

// The guest's language: stored on new website requests, read from the notes on older ones.
export function guestLang(r) {
  if (r.lang === 'pt' || r.lang === 'en') return r.lang;
  return /Language:\s*Portuguese/i.test(r.notes || '') ? 'pt' : 'en';
}

const TEXT = {
  pt: {
    subject: (h, a, b) => `Reserva confirmada · ${h} · ${a} a ${b}`,
    hello: n => `Olá ${n},`,
    intro: h => `A sua reserva na ${h} está confirmada. Obrigado pela preferência!`,
    arrive: 'Chegada', leave: 'Saída', from: 'a partir das', by: 'até às',
    stay: 'Estadia', nights: n => `${n} ${n === 1 ? 'noite' : 'noites'}`,
    guests: 'Hóspedes', total: 'Total', ref: 'Referência',
    outro: 'Se precisar de alguma coisa, basta responder a este email.',
    bye: 'Até breve,',
    locale: 'pt-PT',
  },
  en: {
    subject: (h, a, b) => `Booking confirmed · ${h} · ${a} to ${b}`,
    hello: n => `Hello ${n},`,
    intro: h => `Your booking at ${h} is confirmed. Thank you for choosing us!`,
    arrive: 'Arrival', leave: 'Departure', from: 'from', by: 'by',
    stay: 'Stay', nights: n => `${n} ${n === 1 ? 'night' : 'nights'}`,
    guests: 'Guests', total: 'Total', ref: 'Reference',
    outro: 'If you need anything, just reply to this email.',
    bye: 'See you soon,',
    locale: 'en-GB',
  },
};

export function confirmationEmail(house, r) {
  const L = TEXT[guestLang(r)];
  const day = s => D(s).toLocaleDateString(L.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const short = s => D(s).toLocaleDateString(L.locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const money = n => new Intl.NumberFormat(L.locale, { style: 'currency', currency: house.currency || 'EUR', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  const first = String(r.guestName || '').trim().split(/\s+/)[0] || '';
  const rows = [
    [L.arrive, `${day(r.checkIn)}, ${L.from} ${house.checkInTime}`],
    [L.leave, `${day(r.checkOut)}, ${L.by} ${house.checkOutTime}`],
    [L.stay, L.nights(nightsOf(r.checkIn, r.checkOut))],
    ...(r.guests ? [[L.guests, String(r.guests)]] : []),
    ...(r.price ? [[L.total, money(r.price)]] : []),
    ...(r.code ? [[L.ref, r.code]] : []),
  ];
  const message = String(house.confirmMessage || '').trim();
  const text = [L.hello(first), '', L.intro(house.name), '', ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(message ? [message, ''] : []), L.outro, '', L.bye, house.name].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f7f2e9;font-family:Georgia,'Times New Roman',serif;color:#1f2a24">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
  <div style="background:#fffdf9;border:1px solid #e6dfd2;border-radius:16px;padding:28px 26px">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#c4622d;font-family:Arial,sans-serif">${esc(house.name)}</p>
    <h1 style="margin:0 0 18px;font-size:24px;font-weight:600">${esc(L.hello(first))}</h1>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.55">${esc(L.intro(house.name))}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      ${rows.map(([k, v]) => `<tr><td style="padding:9px 0;border-top:1px solid #e6dfd2;color:#7d867f;width:38%">${esc(k)}</td><td style="padding:9px 0;border-top:1px solid #e6dfd2;font-weight:600">${esc(v)}</td></tr>`).join('')}
    </table>
    ${message ? `<p style="margin:22px 0 0;font-size:15px;line-height:1.6;white-space:pre-line">${esc(message)}</p>` : ''}
    <p style="margin:22px 0 0;font-size:15px;line-height:1.6">${esc(L.outro)}</p>
    <p style="margin:18px 0 0;font-size:15px">${esc(L.bye)}<br><strong>${esc(house.name)}</strong></p>
  </div>
</div></body></html>`;
  return { subject: L.subject(house.name, short(r.checkIn), short(r.checkOut)), text, html };
}

export async function sendMail(env, { fromName, to, toName, subject, text, html }) {
  if (!mailReady(env)) throw new Error('Email is not set up yet (missing Gmail app password).');
  const mailer = await WorkerMailer.connect({
    host: 'smtp.gmail.com', port: 465, secure: true,
    credentials: { username: env.GMAIL_USER, password: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') },
    authType: 'plain', socketTimeoutMs: 15000, responseTimeoutMs: 15000,
  });
  try {
    await mailer.send({ from: { name: fromName, email: env.GMAIL_USER }, to: { name: toName || to, email: to }, subject, text, html });
  } finally { try { await mailer.close(); } catch { /* already closed */ } }
}
