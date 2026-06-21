# asu-athletics-schedule — Claude Code Context

## Project Summary

Self-hosted ASU Sun Devil Athletics schedule web app. **Production runs on the Oracle Cloud VPS** (`asu.dikaiaserver.com`); the **Ubuntu VM is now a dev sandbox** (`asu-dev.dikaiaserver.com`). Pulls event data nightly from the official ASU feed and auto-inserts postseason/NCAA tournament games from ESPN. Serves a filterable calendar, list view, geocoded map, and live score feed. Node.js + Express backend with SQLite event cache and vanilla JS frontend.

## Environment

Two-box topology (migrated 2026-06-16): **prod = Oracle VPS** (resilient, off-home),
**dev = Ubuntu VM** (fast iteration, may break). Promote mature work to prod by cutting a
git tag (see `## Deploy / Promotion` below). Both run the same code; the scheduler
(nightly fetch + push notifications) runs **only on prod** to avoid duplicate fetches/pushes.

### Prod — Oracle Cloud VPS (`asu.dikaiaserver.com`)
- **Host**: Oracle `speedtest-wan`, `ubuntu@170.9.227.11` (Ubuntu 24.04, arm64, 4 OCPU/24 GB), TZ America/Chicago
- **Project root**: `/home/ubuntu/projects/asu-athletics-schedule/`
- **Secrets** (single file, consolidated — Oracle has no unifi-scripts fallback):
  `/home/ubuntu/projects/secrets.env` (chmod 600) holds CF_API_TOKEN, CF_ACCOUNT_ID,
  VAPID_* and others; loaded by systemd `EnvironmentFile=`. The `lib/env.js` fallback to
  `unifi-scripts/secrets.env` is a no-op here (VAPID already in env).
- **Service**: `asu-cal.service` (User=ubuntu, ExecStart=`/usr/bin/node server.js`) — runs the scheduler
- **Public path**: dedicated `cloudflared` tunnel **on the box** (`asu-oracle`, id `56683813-ed64-4029-a2d1-fe03a96b8ebc`) → `localhost:3000`. systemd `cloudflared.service`. asu CNAME → `<that-id>.cfargotunnel.com`. **No home dependency.** Rollback: repoint asu CNAME to the HA tunnel `ea5427e8-…cfargotunnel.com` (its asu→NPM ingress is kept as a fallback).

### Dev — Ubuntu VM (`asu-dev.dikaiaserver.com`, CF Access-gated)
- **Host**: Ubuntu VM at 10.10.1.19, port 3000 (Claude Code runs here)
- **Project root**: `~/projects/asu-athletics-schedule/`
- **Secrets** (two files, both load-bearing here — do not consolidate without an ops change):
  - `~/projects/secrets.env` — CF_API_TOKEN / CF_ACCOUNT_ID; loaded by systemd (`EnvironmentFile=` in asu-cal.service)
  - `~/projects/unifi-scripts/secrets.env` — VAPID_* push keys; loaded as a fallback by `lib/env.js`
- **Service**: `asu-cal.service` — with drop-in `/etc/systemd/system/asu-cal.service.d/dev-no-scheduler.conf` setting `DISABLE_SCHEDULER=1` (NO cron, NO pushes). Refresh test data manually.
- **Public path**: HA-add-on tunnel (`jarvis_tunnel_cf`) → NPM (10.10.1.40:80) → 10.10.1.19:3000, NPM proxy host id 25, behind CF Access (Allow Robert / Google OAuth).

### Shared
- **DB**: `events.db` (SQLite, gitignored). Prod seeded by copying dev's DB (push subscribers preserved). `GeoLite2-City.mmdb` (64 MB, gitignored) copied to prod too.
- **Verification knobs**: `PORT=3100 DISABLE_SCHEDULER=1 node server.js` runs a second instance against the live DB without cron jobs / double-pushes (never hit `/api/refresh` or `/api/geocode` on it)
- **Rule**: never run the scheduler / `/api/refresh` / `/api/geocode` on both boxes at once — only prod owns the scheduler; dev is `DISABLE_SCHEDULER=1`.

## Deploy / Promotion (dev → prod)

Production is gated by **git tags**. Develop and commit freely on `main` from the Ubuntu
dev box; when a feature is mature, cut a release tag, then deploy that tag on Oracle:

```bash
# on dev (Ubuntu), after bumping package.json + releases.json for the release:
git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z

# on prod (Oracle), ssh ubuntu@170.9.227.11:
cd ~/projects/asu-athletics-schedule
git fetch --tags && git checkout vX.Y.Z && npm ci && sudo systemctl restart asu-cal
```

> SSH note: the Oracle box silently drops port 22 after a burst of rapid SSH connections
> (sshd MaxStartups throttle — no fail2ban installed). Batch remote work into few sessions;
> if locked out, wait ~2–10 min. The public site is unaffected (tunnel is outbound).

## Project Structure

```
asu-athletics-schedule/
├── server.js          ← Express server, thin API routes
├── fetcher.js         ← Nightly data fetch from sundevils.com feed
├── geocoder.js        ← Venue geocoding (GeoLite2 mmdb, gitignored)
├── scheduler.js       ← Cron jobs (eager-requires push: broken push = boot failure)
├── scores.js          ← ESPN scoreboard polling + schedule/score sync
├── db.js              ← SQLite helpers
├── push.js            ← Web push notifications
├── lib/
│   ├── env.js           ← secrets fallback loader (documents the two-file system)
│   ├── constants.js     ← USER_AGENT, NCAA_USER_AGENT, SITE_HOST/ORIGIN
│   ├── sports-config.js ← single source for sport slugs/configs/emoji/TOURNAMENT_RE
│   ├── opponent.js      ← opponentFromTitle(title, {lowercase, fallback})
│   ├── cache.js         ← TtlCache (evict-on-read TTL cache)
│   ├── ical.js          ← buildIcsCalendar for /api/events.ics
│   ├── ncaa.js          ← NCAA bracket scraping/GraphQL + ESPN matching + caches
│   └── tournaments.js   ← bracket/series/pool tournament builders
├── scripts/           ← Utility scripts
└── public/            ← Frontend (FullCalendar, Leaflet, vanilla JS — no build step)
    ├── shared.js        ← loaded FIRST: esc/shortTitle/sportColor/logo maps + `store` localStorage wrapper
    ├── filters.js       ← filter sidebar state, view switching, event modal
    ├── game-modal.js    ← ESPN box-score modal (lazy-invoked via window.openGameDetailModal)
    ├── calendar.js / live.js / map.js / pwa.js / whats-new.js / feedback.js
    └── sw.js            ← service worker; bump CACHE_NAME whenever index.html changes
```

**Frontend cache busting**: scripts load via `?v=N` query params in index.html. When you
change a frontend file, bump its `?v=` AND bump `CACHE_NAME` in sw.js if index.html changed
(`/` is precached cache-first; the controllerchange handler auto-reloads clients).

## Rules

- Always use the secrets.env files for credentials — never hardcode (see Environment for which file holds what)
- `GeoLite2-City.mmdb` is gitignored (64MB binary) — lives only on the server
- `events.db` is gitignored — do not commit
- Restart service after code changes: `sudo systemctl restart asu-cal`
- Check logs: `journalctl -u asu-cal -n 50`

## Active Handoff

> Full dated history (roadmap phases 1–4, the big refactor, the Oracle migration) archived in `CHANGELOG-handoff.md`.

**Current state (2026-06-16):** Prod migrated to Oracle VPS; dev sandbox on the Ubuntu VM (see
`## Environment`). Promotion via git tags (`v1.2.0` deployed). All 4 feature-roadmap phases
shipped: standings + poll ranks, dark mode + favorites + ticket links, scoring tab + head-to-head,
team news + rosters.

**Open / not yet verified (needs a real device):** authenticated `asu-dev` page render; PWA
install + push on prod from a phone; full reboot-recovery test of the Oracle box.

