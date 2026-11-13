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

## Run it

Requires Node.js 18 or newer. There are no dependencies.

```bash
npm start
```

Open http://localhost:4300/ (default password `alpendre`). Set your own:

```bash
ALPENDRE_PASSWORD="choose-a-strong-one" PORT=8080 npm start
```

The first run loads three demo houses. Remove them under **Settings → Remove demo houses**. Data is stored in `data/db.json`, so back it up.

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
<script src="https://your-alpendre-domain/embed.js" async></script>
```

Website requests arrive as **pending** (or confirmed straight away if you turn on auto-confirm in the house settings), with the price worked out from the house's nightly price, cleaning fee and minimum stay.

## Going live

Airbnb, Booking.com and your website need to reach Alpendre over the internet. Deploy to any Node host (Render, Railway, Fly.io, a small VPS) with:

- a persistent disk for `data/`
- `ALPENDRE_PASSWORD` set
- HTTPS (the platforms require it for calendar links)

## Project layout

```
server.js        API, storage, iCal import/export, public website API, auto-sync
public/
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
