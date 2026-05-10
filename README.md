# ASU Sun Devil Athletics Schedule

A self-hosted web app that pulls ASU athletics event data nightly and serves a filterable calendar, list view, and map. Live scores are fetched from ESPN during active games.

**Live site:** https://asu.dikaiaserver.com

---

## Features

- **Month calendar** (FullCalendar) and **list view** with per-sport color coding
- **Map view** showing away game locations
- Filter by sport, game type (home / away / neutral), and region
- Live score overlay during active games (ESPN API)
- Nightly data refresh via built-in scheduler (2 AM by default)
- Rate-limited REST API

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (v18+) |
| Web framework | Express 4 |
| Database | SQLite via better-sqlite3 |
| Scheduling | node-cron |
| HTTP client | node-fetch |
| Security | helmet, express-rate-limit |
| Frontend | Vanilla JS + FullCalendar 6 + Leaflet |
| Data source | sundevils.com event feed + ESPN API |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | All events. Query params: `sport`, `game_type`, `city`, `state`, `region`, `from` (unix ts), `to` (unix ts) |
| GET | `/api/sports` | Distinct sport list |
| GET | `/api/locations` | Distinct city/state pairs |
| POST | `/api/refresh` | Manually trigger a data fetch (rate-limited: 5/hr) |
| GET | `/api/live` | Live scores for in-progress games |
| POST | `/api/geocode` | Geocode any events missing lat/lng |

## Self-Hosting

### Prerequisites

- Node.js 18 or later
- npm

### Install

```bash
git clone https://github.com/robertscheib/asu-athletics-schedule.git
cd asu-athletics-schedule
npm install
```

### Run

```bash
node server.js
# Listening on http://0.0.0.0:3000
```

The database (`events.db`) is created automatically on first run. Events are fetched from the sundevils.com feed on startup if the database is empty, and nightly at 2 AM thereafter.

### Run as a systemd service

Copy the included unit file and enable it:

```bash
sudo cp asu-cal.service /etc/systemd/system/asu-cal.service
# Edit WorkingDirectory, User, and ExecStart paths to match your setup
sudo systemctl daemon-reload
sudo systemctl enable --now asu-cal
```

The `ExecStart` path must point to your Node.js binary. Find it with `which node`.

### Reverse proxy (Nginx Proxy Manager / nginx)

The app listens on port 3000 over plain HTTP. Put it behind a reverse proxy that handles TLS.

Example NPM settings:
- **Forward host:** `127.0.0.1` (or the host's LAN IP)
- **Forward port:** `3000`
- **Websockets support:** on
- **Force SSL / HTTP/2 / HSTS:** on

### Environment

No environment variables are required. An optional `secrets.env` file (excluded from this repo) is used in the reference deployment to pass credentials to other services on the same host.

## Project Structure

```
server.js          Express app + API routes
db.js              SQLite schema, queries, and migrations
fetcher.js         sundevils.com feed parser and DB writer
scores.js          ESPN live scores API client
geocoder.js        Nominatim geocoder for away venues
scheduler.js       node-cron nightly refresh job
public/
  index.html       Single-page shell
  calendar.js      FullCalendar integration + modal
  filters.js       Filter sidebar state
  live.js          Live score polling
  map.js           Leaflet map view
  style.css        Styles
asu-cal.service    systemd unit file
```

## License

MIT
