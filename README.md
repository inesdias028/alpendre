# Alpendre

**Every booking, one porch.**

*Alpendre* is Portuguese for porch, the place where every guest arrives, whatever road they took to get there. Alpendre puts the reservations for your holiday house from **Airbnb**, **Booking.com** and **your own website** on one calendar.

![logo](public/logo.svg)

## What's inside

| | |
|---|---|
| **Guest website** (`/`) | A booking page for the house: description, amenities, a live availability calendar, a price quote and a booking form. Direct bookings, no commission. |
| **Host dashboard** (`/admin/`) | Overview (occupancy, revenue, arrivals and departures, alerts), a calendar of every channel, a searchable list of reservations, channel connections and property settings. |
| **Two-way calendar sync** | Imports Airbnb and Booking.com calendars over iCal and publishes a calendar link back to each one, so a night sold anywhere is blocked everywhere. |
| **Double-booking alerts** | Overlapping stays are flagged in red on the dashboard and the calendar. |

## Run it

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
npm start
```

- Guest website: http://localhost:4300/
- Host dashboard: http://localhost:4300/admin/ (default password `alpendre`)

Set your own password and port:

```bash
ALPENDRE_PASSWORD="choose-a-strong-one" PORT=8080 npm start
```

On first run it loads demo reservations so you can look around. Remove them under **Property & site → Remove demo reservations**.

Data is stored in `data/db.json`. Back this file up.

## Connecting Airbnb and Booking.com

Neither platform offers an open API to small hosts. The tool both of them do support is **calendar sync (iCal)**, and Alpendre uses it in both directions:

1. **Import:** in Airbnb (*Calendar → Availability → Connect calendars → Export*) and in the Booking.com extranet (*Rates & Availability → Sync calendars → Export*), copy the calendar link and paste it under **Channels** in Alpendre.
2. **Export:** copy the Alpendre link shown on each channel card and paste it into that platform's *Import calendar* option.

Alpendre checks both platforms every 30 minutes by default. You can change that, or press **Sync now**.

**What iCal does not include:** the calendars only carry dates and a reservation reference, not guest names or prices. Alpendre imports the dates and lets you add guest details to each stay. Those details are kept on every later sync. If a stay disappears from a channel's calendar, Alpendre marks it as cancelled.

To get full guest and price data automatically you would need a certified channel-manager connection (Airbnb's and Booking.com's partner APIs), which requires a partnership with each platform.

## Going live

The guest website must be reachable on the internet so guests can book, and so Airbnb and Booking.com can read your export links. Deploy it to any Node host (Render, Railway, Fly.io, a small VPS) with:

- a persistent disk for `data/`
- `ALPENDRE_PASSWORD` set
- HTTPS (the platforms require it for calendar links)

## Project layout

```
server.js            API, storage, iCal import/export, auto-sync
public/
  brand.css          colours, type and shared components
  logo.svg           the mark: three porch arches under a tiled roof
  index.html  site.* guest website
  admin/             host dashboard
```

## Brand

| Token | Colour | Used for |
|---|---|---|
| Ink | `#1f2a24` | text, sidebar |
| Cream | `#f7f2e9` | backgrounds (limewashed walls) |
| Terracotta | `#c4622d` | primary actions, direct bookings (roof tiles) |
| Olive | `#6b7f4e` | manual stays, success |
| Sun | `#e8a93b` | highlights |

Type: **Fraunces** for headings, **Inter** for text.
