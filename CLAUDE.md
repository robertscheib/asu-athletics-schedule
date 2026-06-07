# asu-athletics-schedule — Claude Code Context

## Project Summary

Self-hosted ASU Sun Devil Athletics schedule web app running at **asu.dikaiaserver.com** on the Ubuntu VM (10.10.1.19, port 3000). Pulls event data nightly from the official ASU feed and auto-inserts postseason/NCAA tournament games from ESPN. Serves a filterable calendar, list view, geocoded map, and live score feed. Node.js + Express backend with SQLite event cache and vanilla JS frontend.

## Environment

- **Host**: Ubuntu VM at 10.10.1.19, port 3000
- **Project root**: `~/projects/asu-athletics-schedule/`
- **Secrets**: `~/projects/secrets.env` — source at session start
- **DB**: `events.db` (SQLite, gitignored)
- **Service**: `asu-cal.service` systemd unit
- **Live URL**: https://asu.dikaiaserver.com

## Project Structure

```
asu-athletics-schedule/
├── server.js          ← Express server, API routes
├── fetcher.js         ← Nightly data fetch from ASU + ESPN
├── geocoder.js        ← Venue geocoding (GeoLite2 mmdb, gitignored)
├── scheduler.js       ← Cron jobs
├── scores.js          ← Live score polling
├── db.js              ← SQLite helpers
├── push.js            ← Web push notifications
├── scripts/           ← Utility scripts
└── public/            ← Frontend (FullCalendar, Leaflet, vanilla JS)
```

## Rules

- Always use `~/projects/secrets.env` for credentials — never hardcode
- `GeoLite2-City.mmdb` is gitignored (64MB binary) — lives only on the server
- `events.db` is gitignored — do not commit
- Restart service after code changes: `sudo systemctl restart asu-cal`
- Check logs: `journalctl -u asu-cal -n 50`

## Agent Collaboration Rules

- **Read History First**: At the start of every session, the agent MUST run `git status` and `git log -n 5` to understand recent changes, and read the `## Active Handoff` section in this file.
- **Commit with Context**: Every commit message must explain the *why* behind a change, not just the *what*.
- **The Handoff Journal**: Before concluding a session or completing a major task, the active agent MUST update the `## Active Handoff` section at the bottom of this file.
- **Interactive Dry Runs**: The agent must always perform a dry run and list planned changes for user approval before modifying code, databases, or configuration files.
- **Explicit Task Tracking**: Maintain a shared checklist of tasks in `task.md` or `CLAUDE.md`. Mark tasks as `[x]` for complete, `[/]` for in-progress, and `[ ]` for pending.

## Active Handoff

- [2026-06-06 (Claude Code)]: Added agent collaboration rules and initialized handoff log.
