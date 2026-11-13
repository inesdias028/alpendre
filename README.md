# Alpendre

**Every booking, one porch.**

*Alpendre* is Portuguese for porch, the place where every guest arrives, whatever road they took to get there. Alpendre is a platform for managing several holiday houses. Each house is its own **workspace**, connected to **Airbnb**, **Booking.com** and **your own website**, with calendars kept in sync and every reservation in one place.

## What's inside

| | |
|---|---|
| **Houses home** | Every house as a card (occupancy, tonight's status, next arrival, connection health), a timeline of all houses side by side, arrivals and departures across houses, and a "needs attention" list. |
| **A workspace per house** | Overview, month calendar, reservations, connections and settings, kept separate for each house. |
| **Airbnb & Booking.com** | Two-way calendar sync (iCal): imports their bookings and gives each one a link that blocks nights sold elsewhere. |
| **Your existing website** | Three ways to connect it (below), so nights sold on your site block Airbnb and Booking.com, and the other way round. |
| **Double-booking alerts** | Overlapping stays in a house are flagged in red everywhere. |

## Live

- **Dashboard:** https://inesdias028.github.io/alpendre/ (GitHub Pages)
- **API, calendar links and widget:** https://alpendre.houseguests.workers.dev (Cloudflare Worker)

GitHub Pages only hosts static files, so the server part runs on Cloudflare Workers (free plan). A Durable Object stores all houses and reservations, and a scheduled trigger syncs the calendars every 15 minutes (the sync interval in Settings decides how often a sync actually happens).

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:8787/ (local password `alpendre`, set in `.dev.vars`). The first run loads three demo houses. Remove them under **Settings → Remove demo houses**.

## Deploy

```bash
npx wrangler login                          # once
npx wrangler secret put ALPENDRE_PASSWORD   # once, or to change the password
npm run deploy                              # the Worker (API + scheduled sync)
npm run deploy:pages                        # the dashboard, published to the gh-pages branch
```

`public/config.js` tells the dashboard where the Worker lives. `ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to use the owner API from a browser.

## Connecting a house

Open a house, then **Connections**.

### Airbnb and Booking.com
Neither platform offers an open API to small hosts. Both support **calendar sync (iCal)**:

1. **Import:** copy the export link from Airbnb (*Calendar → Availability → Connect calendars → Export*) or the Booking.com extranet (*Rates & Availability → Sync calendars → Export*) and paste it into Alpendre.
2. **Export:** copy Alpendre's link for that channel and paste it into the platform's *Import calendar*.

Their calendars only carry dates and a reference, not guest names or prices. Alpendre imports the dates. You add guest details, and Alpendre keeps them on every later sync. A stay that disappears from a channel is marked cancelled.

### Your website
Pick whichever fits how the site is built:

| Option | When to use it | How |
|---|---|---|
| **Booking widget** | The site has no booking system (WordPress, Wix, Squarespace, plain HTML) | Paste the two-line snippet. It shows live availability and sends booking requests into Alpendre. Add `data-mode="calendar"` for availability only, or `data-accent="#hex"` to match your colours. |
| **Calendar sync** | The site already has a booking plugin that offers an iCal link | Import the site's link into Alpendre, and give the site Alpendre's website export link. |
| **API** | A custom-built site | `GET /api/public/<key>/availability` and `POST /api/public/<key>/book` (JSON, CORS enabled, no login). |

```html
<div data-alpendre="pk_your_house_key"></div>
<script src="https://alpendre.houseguests.workers.dev/embed.js" async></script>
```

Website requests arrive as **pending** (or confirmed straight away if you turn on auto-confirm in the house settings), with the price worked out from the house's nightly price, cleaning fee and minimum stay.

## Project layout

```
worker/index.js  Cloudflare Worker + Durable Object: API, storage, iCal import/export, public website API, scheduled sync
wrangler.toml    Worker configuration
scripts/         deploy-pages.js publishes public/ to GitHub Pages
public/          dashboard (GitHub Pages)
  config.js      where the API lives
  index.html     dashboard shell
  app.js/.css    dashboard (houses home + per-house workspaces)
  embed.js       booking widget for your website
  brand.css      colours, type, shared components
  logo.svg       the mark: three porch arches under a tiled roof
```

## Brand

| Token | Colour | Used for |
|---|---|---|
| Ink | `#1f2a24` | text, sidebar |
| Cream | `#f7f2e9` | backgrounds (limewashed walls) |
| Terracotta | `#c4622d` | primary actions, website bookings (roof tiles) |
| Olive | `#6b7f4e` | manual stays, success |
| Sun | `#e8a93b` | highlights |

Type: **Fraunces** for headings, **Inter** for text.
