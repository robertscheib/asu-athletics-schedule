# asu-athletics-schedule — Handoff Archive

_Dated history moved out of CLAUDE.md on 2026-06-20 for token efficiency. Current state + open items now live in CLAUDE.md._

## Active Handoff

- [2026-06-06 (Claude Code)]: Added agent collaboration rules and initialized handoff log.
- [2026-06-11 (Claude Code)]: Full-sweep behavior-preserving refactor, 8 commits (0da1fc1..HEAD).
  Backend: new `lib/` modules (env, constants, opponent, sports-config, cache, ical, ncaa,
  tournaments); server.js 787→~490 lines, scores.js 880→~550, fetchLiveGames decomposed with
  side-effect order preserved; scheduler now fails fast if push module is broken; dead
  getNextGame() removed. Frontend: new public/shared.js (dedup of esc/shortTitle/sportColor/
  ESPN_LOGO_MAP + `store` localStorage wrapper) and public/game-modal.js (box score modal out
  of filters.js, 905→~500 lines); live.js renders decomposed (output verified byte-identical
  via vm harness); duplicate spin keyframes removed. Bumps: shared v1, filters v17, game-modal
  v1, live v25, map v3, pwa v5, style v5, SW cache asu-cal-v6. Verified per phase on
  PORT=3100 DISABLE_SCHEDULER=1 against /tmp/asu-refactor-baseline (events/ics byte-identical).
  Browser smoke test on a real device (esp. iOS PWA) still recommended: all tabs, both
  modals, bell menu persistence, SW update to asu-cal-v6.
- [2026-06-11 (Claude Code)]: VAPID keys copied into ~/projects/secrets.env (systemd now
  provides them directly; verified served public key matches). lib/env.js fallback to
  ~/projects/unifi-scripts/secrets.env is now a pure safety net. Backup at
  ~/projects/secrets.env.bak-2026-06-11.
- [2026-06-12 (Claude Code)]: Feature roadmap phase 1 shipped: conference standings +
  poll rank badges. New lib/standings.js (ESPN standings/rankings fetch, 1h/6h TtlCaches
  with 5-min negative cache, non-blocking getRankIndexSync so cold caches never stall
  /api/live or /api/events) and public/standings.js (collapsible Live-tab widget, sport
  pills persisted in store). STANDINGS_CONFIG/RANKINGS_SLUGS in lib/sports-config.js —
  group IDs are per-league; baseball/volleyball conference tables live on a child group
  (group=26 child 44, group=90 child 51); softball/soccer have no ESPN standings; women's
  soccer rankings use soccer/usa.ncaa.w.1 (NOT the summary slug). Rank badges merged
  server-side: game.oppRank/asuRank in /api/live, event.opp_rank in /api/events (future
  events only, 24h lookback). Fixed latent SW bug: /api/game was cache-first-forever, now
  NETWORK_ONLY. Bumps: shared v2, standings v1 (new), filters v18, game-modal v2,
  calendar v13, live v26, style v6, SW asu-cal-v7. Verified via curl + headless-chromium
  smoke test on :3100 and on prod after restart. Approved roadmap for later phases:
  phase 2 = play-by-play tab in game modal (ESPN summary already ships plays/scoringPlays,
  currently ignored) + head-to-head from local DB; phase 3 = My Sports favorites, dark
  mode, TV/ticket links on list cards; phase 4 = ESPN team news strip + rosters. Full plan:
  ~/.claude/plans/review-the-dashboard-and-typed-otter.md. Pre-existing harmless 404 noticed:
  fullcalendar index.global.min.css doesn't exist on jsdelivr (v6 injects styles via JS).
- [2026-06-12 (Claude Code)]: Roadmap phase 2 shipped: Scoring tab + head-to-head.
  Game modal gets a "Scoring" tab (football uses ESPN's ready-made scoringPlays; baseball/
  softball/basketball filter plays[] on scoringPlay===true; grouped by quarter/half/
  "Top 1st" inning; ASU plays highlighted; generic "Play Result" type suppressed).
  _gmBuildBoxScore now returns {tabs, panels} so tabs compose. New lib/h2h.js +
  GET /api/h2h?sport=&opponent= computes W-L-T + last 5 meetings from the local DB;
  opponent matching merges name variants under a canonical key ("Arizona Wildcats" 2025
  rows + "Arizona" 2026 rows are the same school — feed eras differ!) with the
  standings stop-word rules; opponent param also accepts full event titles.
  H2H strip renders in the box-score modal (real ESPN oppTeam name), its fallback,
  and the plain event modal (#modal-h2h, passes event.title). /api/h2h added to SW
  NETWORK_FIRST (same cache-first-forever trap as /api/game). Bumps: game-modal v3,
  filters v19, style v7, SW asu-cal-v8. Verified headless-chromium on :3100 (football
  + baseball scoring tabs, both h2h strips) and prod after restart. Phase 3 next:
  My Sports favorites, dark mode, TV/ticket links on list cards.
- [2026-06-12 (Claude Code)]: Roadmap phase 3 shipped: My Sports favorites, dark mode,
  ticket links. Favorites: ★ button per sidebar sport row (store key asu-fav-sports);
  starred sports are pre-checked at load so every view starts filtered; Clear All
  unchecks but keeps stars. Found+fixed pre-existing bug: setView('calendar') never
  refetched, so filters applied while another view was active (incl. the new pre-check)
  showed a stale unfiltered calendar — now refetchEvents() on switch. Dark mode:
  [data-theme=dark] CSS-var block (color-scheme:dark for UA controls), new --asu-tint/
  --gold-tint/--ink-accent vars (ink-accent = maroon in light / gold in dark — all
  `color: var(--maroon)` text usages were swapped to it; accent-color left maroon),
  FC --fc-* var overrides + Leaflet popup/tile rules, light backplate on dark team
  logos, inline head script applies stored theme (else prefers-color-scheme) pre-paint,
  🌙/☀️ header button (toggleTheme in shared.js, store key asu-theme). Ticket links:
  🎟 pill on future list cards (stopPropagation vs row click) + 📺 prefix on TV network.
  Also removed the dead fullcalendar CSS <link> (the 404 noted earlier). Bumps: shared
  v3, filters v20, calendar v14, style v8, SW asu-cal-v9. Verified headless-chromium
  dark screenshots on :3100 + prod after restart. Phase 4 (final) next: ESPN team news
  strip on Live tab + per-sport rosters/leaders.
- [2026-06-12 (Claude Code)]: Roadmap phase 4 shipped (ROADMAP COMPLETE): team news +
  rosters. New lib/team.js + TEAM_CONFIG in sports-config (ASU teamId is per-league:
  9 in most, 59 baseball, 471 softball; roster:false where ESPN data is junk — college
  baseball rosters are 100 flat null-jersey entries; volleyball empty). GET /api/news
  merges per-sport ESPN news feeds (15min TTL, deduped — league stories tag ASU in
  several sports), GET /api/roster?sport= (24h TTL) handles both ESPN shapes (football's
  grouped position buckets vs flat athletes[]). Frontend in standings.js (now the
  general Live-tab-widgets module): "📰 Sun Devils News" collapsible widget below
  standings (emoji + headline + relative time, links to ESPN), "👥 View roster" button
  inside the standings table area for Football/MBB/WBB/Ice Hockey — opens roster in the
  game-modal overlay chrome with grouped gm-stats tables. /api/news + /api/roster in SW
  NETWORK_FIRST. Bumps: standings v2, live v27, style v9, SW asu-cal-v10. Verified
  headless-chromium on :3100 (news rows, roster modal groups, no roster btn on
  baseball) and prod after restart. All 4 roadmap phases from the 2026-06-11 dashboard
  review are now live.
- [2026-06-12 (Antigravity)]: Replaced all University of Arizona logos with poop emoji across all remaining views:
  * Game Detail/Box Score Modal (teamLogoHtml in game-modal.js)
  * Live cards (oppLogoEl in live.js)
  * NCAA Tournament rows (_renderNcaaTeamRow in live.js)
  * Bracket matchups and pool standings (renderBracketTeam and renderPoolStandings in live.js)
  * Conference standings table (_tableHtml in standings.js)
  * Enhanced isUA in shared.js to check for ESPN team ID 12 logo URL (/500/12.png) to ensure robust detection.
  * Bumped script versions in index.html (shared v4, standings v3, game-modal v4, live v28) and SW cache name to asu-cal-v11.
  * Committed changes and restarted asu-cal systemd service.
- [2026-06-12 (Claude Code)]: Released v1.2.0 (package.json + releases.json entry
  "Standings, Dark Mode & More" covering all four roadmap phases) so returning
  visitors get the What's New modal — today's feature commits had shipped without a
  version bump. Verified on prod: /api/version → 1.2.0, headless visit with
  lastSeenVersion=1.1.4 pops the modal (9 bullets). package-lock.json intentionally
  left at its historical 1.0.0 (not what /api/version reads).
- [2026-06-12 (Claude Code)]: Hid the filter sidebar on the Live tab (user request —
  Live is ESPN-scoreboard-driven and ignores every filter). setView toggles
  body.live-active; CSS hides aside + the mobile .btn-filters-toggle under it, so
  Live gets full width and other views are untouched. Bumps: filters v21, style v10,
  SW asu-cal-v12. Verified headless on :3100 (desktop + 390px mobile, both
  directions of the toggle) and prod after restart.
- [2026-06-16 (Claude Code)]: **MIGRATED PROD TO ORACLE VPS; Ubuntu VM is now the dev
  sandbox.** Motivation: resilience — old prod depended on home internet + HA tunnel + NPM
  + the Ubuntu VM. New topology (full details in `## Environment` + `## Deploy / Promotion`):
  * **Prod = Oracle** `ubuntu@170.9.227.11` at `/home/ubuntu/projects/asu-athletics-schedule`,
    Node 24 + build-essential (better-sqlite3 compiled for arm64), TZ America/Chicago,
    single consolidated `secrets.env`, `events.db` + `GeoLite2-City.mmdb` scp'd from dev
    (push subscribers preserved). `asu-cal.service` runs the scheduler.
  * **Dedicated `cloudflared` on Oracle** (tunnel `asu-oracle`, id
    `56683813-ed64-4029-a2d1-fe03a96b8ebc`, remotely-managed, ingress asu→localhost:3000).
    Cutover = repointed `asu` CNAME from HA tunnel `ea5427e8-…` → the new tunnel. Verified
    served by Oracle (stop-app→502, start→200; homepage/events/ics/sw all 200). HA tunnel's
    asu→NPM ingress + NPM host 12 LEFT as rollback fallback.
  * **Dev = Ubuntu** scheduler disabled via drop-in
    `/etc/systemd/system/asu-cal.service.d/dev-no-scheduler.conf` (`DISABLE_SCHEDULER=1`) so
    only prod fetches/pushes. Exposed at `asu-dev.dikaiaserver.com`: HA tunnel ingress
    asu-dev→NPM, NPM proxy host id 25 → 10.10.1.19:3000 (clone of host 12), CF Access app
    "ASU Dev (sandbox)" id `d9cf31c3-06b8-4b92-80ee-4020ffc9be2b` + Allow Robert policy,
    DNS CNAME asu-dev→HA tunnel. Verified 302→cloudflareaccess login (gated).
  * **Promotion = git tags.** Created+pushed the first deploy tag `v1.2.0` at main HEAD
    (ba9a06b) — tagging had lapsed after v1.0.9. Deploy a tag on Oracle with
    `git fetch --tags && git checkout vX.Y.Z && npm ci && sudo systemctl restart asu-cal`.
  * Caveat: Oracle sshd silently drops port 22 after rapid SSH bursts (MaxStartups; no
    fail2ban) — batch SSH, wait it out if locked. Public site is unaffected.
  * NOT yet verified (needs Robert on a real device): authenticated `asu-dev` page render,
    PWA install/push on prod from a phone, and a full reboot-recovery test of the Oracle box.

