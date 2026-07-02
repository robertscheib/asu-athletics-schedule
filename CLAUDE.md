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
  `/home/ubuntu/projects/secrets.env` (chmod 600) holds CF_ANALYTICS_TOKEN, CF_ACCOUNT_ID,
  VAPID_* and others; loaded by systemd `EnvironmentFile=`. The `lib/env.js` fallback to
  `unifi-scripts/secrets.env` is a no-op here (VAPID already in env).
  ⚠ Next deploy: generate a prod-specific `ADMIN_TOKEN` into this file (admin feedback
  API is 503 until set). Proxy hops: prod uses the code default `trust proxy = 1`
  (on-box cloudflared) — do NOT set TRUST_PROXY_HOPS there.
- **Service**: `asu-cal.service` (User=ubuntu, ExecStart=`/usr/bin/node server.js`) — runs the scheduler
- **Public path**: dedicated `cloudflared` tunnel **on the box** (`asu-oracle`, id `56683813-ed64-4029-a2d1-fe03a96b8ebc`) → `localhost:3000`. systemd `cloudflared.service`. asu CNAME → `<that-id>.cfargotunnel.com`. **No home dependency.** Rollback: repoint asu CNAME to the HA tunnel `ea5427e8-…cfargotunnel.com` (its asu→NPM ingress is kept as a fallback).
  ⚠ **Split-DNS gotcha (fixed 2026-07-02)**: the Pi-holes' shared `host-record`/`local=`
  dnsmasq lines (pihole.toml, both .30/.32) used to include `asu.dikaiaserver.com → 10.10.1.40`
  (NPM) — a pre-migration leftover that silently routed every home-LAN client to the DEV box
  while cellular/outside users got Oracle (split-brain: LAN push subscriptions landed in dev's
  DB where the scheduler is off). Removed from both Pi-holes (backups:
  `pihole.toml.bak-20260702-asu`). Do NOT re-add while prod lives on Oracle; the NPM asu proxy
  host + HA-tunnel ingress remain as the dormant rollback path only. When testing "prod" from
  home WiFi, `curl /api/version` first to confirm which box you're on.

### Dev — Ubuntu VM (`asu-dev.dikaiaserver.com`, CF Access-gated)
- **Host**: Ubuntu VM at 10.10.1.19, port 3000 (Claude Code runs here)
- **Project root**: `~/projects/asu-athletics-schedule/`
- **Secrets** (single consolidated file, same as prod — verified 2026-07-01):
  `~/projects/secrets.env` holds CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID / ADMIN_TOKEN /
  VAPID_*; loaded by systemd (`EnvironmentFile=` in asu-cal.service). The `lib/env.js`
  fallback to `unifi-scripts/secrets.env` is a no-op now — that file no longer exists
  (candidate for removal in audit Group 6). Shell-run scripts (e.g. test-push.js) must
  source `~/projects/secrets.env` themselves for VAPID.
- **Service**: `asu-cal.service` — with drop-in `/etc/systemd/system/asu-cal.service.d/dev-no-scheduler.conf` setting `DISABLE_SCHEDULER=1` (NO cron, NO pushes) and `TRUST_PROXY_HOPS=2` (dev sits behind HA tunnel → NPM; prod's on-box cloudflared uses the code default of 1). Refresh test data manually.
- **Public path**: HA-add-on tunnel (`jarvis_tunnel_cf`) → NPM (10.10.1.40:80) → 10.10.1.19:3000, NPM proxy host id 25, behind CF Access (Allow Robert / Google OAuth).

### Shared
- **DB**: `events.db` (SQLite, gitignored). Prod seeded by copying dev's DB (push subscribers preserved). `GeoLite2-City.mmdb` (64 MB, gitignored) copied to prod too.
- **Verification knobs**: `PORT=3200 DISABLE_SCHEDULER=1 node server.js` runs a second instance against the live DB without cron jobs / double-pushes (never hit `/api/refresh` or `/api/geocode` on it). NOT :3100 — that's hotel-search on the dev VM. DB is WAL + busy_timeout=5s as of 2026-07-02, so concurrent instances are safe.
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
├── server.js          ← Express server, thin API routes (trust proxy, rate limits, admin auth)
├── fetcher.js         ← Nightly data fetch from sundevils.com feed + stale-event prune
├── geocoder.js        ← Venue geocoding via Nominatim (serialized; KNOWN_VENUES overrides)
├── scheduler.js       ← Cron jobs (eager-requires push: broken push = boot failure)
├── scores.js          ← ESPN scoreboard polling + schedule/score sync (live cache lives here)
├── db.js              ← SQLite helpers (WAL, FKs on) + REGIONS table
├── push.js            ← Web push notifications (payloads carry raw epochs; sw.js formats)
├── test-push.js       ← Manual push test CLI (source secrets.env first)
├── docs/              ← audit reports / fix-plan checklists
├── lib/
│   ├── constants.js     ← USER_AGENT, NCAA_USER_AGENT, SITE_HOST/ORIGIN
│   ├── sports-config.js ← single source for sport slugs/configs/emoji/TOURNAMENT_RE
│   ├── opponent.js      ← opponentFromTitle(title, {lowercase, fallback})
│   ├── cache.js         ← TtlCache (evict-on-read, FIFO-capped)
│   ├── ical.js          ← buildIcsCalendar for /api/events.ics
│   ├── ncaa.js          ← NCAA bracket scraping/GraphQL + ESPN matching + caches
│   ├── tournaments.js   ← bracket/series/pool tournament builders
│   ├── standings.js     ← conference standings + poll rankings + rank annotation
│   ├── h2h.js           ← head-to-head records from the local DB
│   └── team.js          ← ESPN team news + rosters
├── scripts/           ← Utility scripts (enrich-venues.js)
└── public/            ← Frontend (FullCalendar, Leaflet, vanilla JS — no build step)
    ├── shared.js        ← loaded FIRST: esc/shortTitle/sportColor/logo maps + `store` localStorage wrapper
    ├── filters.js       ← filter sidebar state, view switching, event modal
    ├── game-modal.js    ← ESPN box-score modal (lazy-invoked via window.openGameDetailModal)
    ├── standings.js     ← standings/news widgets + roster modal (Live tab)
    ├── calendar.js / live.js / map.js / pwa.js / whats-new.js / feedback.js
    ├── stats.html / admin/feedback.html  ← online-only tools (SW network-only)
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

**Current state (2026-07-01, Claude Code):** Full codebase audit complete — findings and the
6-group fix plan live in `docs/audit-2026-07-01.md` (tick items there as they land).
**Groups 1–2 applied on dev and verified, not yet committed.**
Group 1 (security/config): trust proxy via TRUST_PROXY_HOPS (per-IP rate limiting now works),
ADMIN_TOKEN auth on `/api/admin/*` (fail-closed, admin page prompts for token), feedback `page`
whitelist + escaping (stored-XSS fix), push endpoint validation, generic error bodies, from/to
NaN clamp, sw.js v14 (`/api/admin` network-only).
Group 2 (live path): soccer fully fixed (dead ESPN slugs → `usa.ncaa.w.1`, and dbSport key now
matches the feed's bare `'Soccer'` tag; men's entry removed — no ASU program); `fetchLiveGames`
15s cache + single-flight + parallel sweep (cold 1.2s→0.28s, cached 5ms); tournament summary/pool
fetches cached 60s + parallel; `findDBMatch` hardened (espn_id first, opponent-verified lone
match, doubleheader nearest-time) with a passing 7-case synthetic test.
Group 3 (SW + frontend caching): all `/api/` GETs network-first by default (frozen-API bug
fixed; behavioral stub-test of routing passed), `/admin/`+`/stats` network-only, offline
fallback shapes fixed, feedback.js/css versioned, `typeof Notification` guards (iOS Safari
tab crash), live.js→v30 pwa.js→v6, CACHE_NAME v14. Headless smoke render OK; still needs a
real-device pass (iPhone Safari tab + installed-PWA v13→v14 update flow).
Group 4 (push lifecycle): 30-day subscription purge removed (410-at-send is the only cleanup),
client re-registers on every load + recovers from 409s, dead sport-prefs sidebar UI removed
(never wired server-side), M3 shipped as re-scoped — payload carries raw `startTime` epoch and
sw.js renders it in the *device's local timezone* ("Starts in N min (H:MM)"), per-game
notification tags, push crons now run 0-1,8-23 CT for late Phoenix games. pwa.js→v7,
CACHE_NAME→v15. Open: real-device push test.
Group 5 (data integrity): SQLite now WAL + foreign_keys + busy_timeout (FK cascade real,
two-instance access safe — use :3200 for the second instance, :3100 is hotel-search);
nightly fetch prunes canceled games (horizon + hiccup guards); geocoder serialized with
city/state fallback (backlog cleared to 0 — also fixed getEventsNeedingGeocode not selecting
city/state); DC naming fixed; REGIONS deduped via new `/api/regions`; NCAA bracket year
derived instead of hardcoded 2026. filters.js→v22.
Group 6 (polish): esc() sweep through filters.js/calendar.js (+ http(s)-only link guards),
countdown timer guards, loadFilterOptions error handling + `/api/seasons/default` (no more
full-events fetch at load), lib/env.js deleted, TtlCache capped, computed seasonLabel,
hashed sportColor, modal focus/ARIA, KNOWN_VENUES pins → geocode backlog 0, dead status-bar
removed, service-file template synced. CACHE_NAME→v16.
Mobile addendum (Robert-reported): filter sidebar → fixed bottom sheet (was rendering below
a 100vh main = unreachable); header now fits 320–430px off-Live (wordmark + 📅 hidden ≤767px,
📅 lives in the sheet, clamp() sizing, overflow-x clip guard). Playwright-verified across
widths + desktop regression. style.css→v12, filters.js→v24, CACHE_NAME→v17.
**ALL SIX AUDIT GROUPS + mobile addendum COMPLETE — committed as v1.3.0 bump (2026-07-02,
tag NOT cut yet).** Before cutting the v1.3.0 tag + prod deploy: real-device pass on
Robert's phone (Safari tab, installed-PWA v13→v17 SW update, filter sheet feel, push test);
prod ADMIN_TOKEN into Oracle secrets.env (no TRUST_PROXY_HOPS there; verify VAPID present);
watch a live-game day on dev.

**Infra incident (2026-07-02, resolved):** Robert saw the new UI on the *prod* URL but not
asu-dev — root cause was the split-DNS leftover documented in `## Environment` above (LAN →
dev box on the prod hostname). Pi-hole records removed + verified (LAN now gets Oracle 1.2.1).
asu-dev's stale look was the phone PWA's old SW cache; it self-updates on a fresh load.
Home-WiFi push subscriptions created during the split-brain sit in dev's DB (scheduler off →
no pushes); once v1.3.0 deploys to prod, the Group-4 self-healing re-register recreates them
in Oracle's DB on each user's next visit.

**Open / not yet verified (needs a real device):** authenticated `asu-dev` page render; PWA
install + push on prod from a phone; full reboot-recovery test of the Oracle box.

