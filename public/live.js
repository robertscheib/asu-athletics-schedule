const POLL_INTERVAL = 60_000;
window.__liveData = {};   // keyed by dbEventId → game object
let _pollTimer = null;

async function pollLive() {
  let games;
  try {
    const res = await fetch('/api/live');
    games = await res.json();
    if (!Array.isArray(games)) throw new Error('bad response');
  } catch (err) {
    console.error('[live] poll failed:', err);
    return;  // keep showing stale data rather than clearing it
  }

  window.__liveData = {};
  for (const g of games) {
    if (g.dbEventId) window.__liveData[g.dbEventId] = g;
  }

  updateLiveBanner(games);
  updateCalendarLiveBadges();
  updateListLiveBadges();
  window.applyLiveToMap && window.applyLiveToMap();
}

// ── Live Now banner ────────────────────────────────────────────────────────

function updateLiveBanner(games) {
  const banner = document.getElementById('live-banner');
  if (!banner) return;
  if (!games.length) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  const items = games.map(g =>
    `<span class="live-banner-game">
       <span class="live-dot"></span>
       <strong>${esc(g.title)}</strong>
       <span class="live-score">${esc(g.asuScore)}–${esc(g.oppScore)}</span>
       <span class="live-situation">${esc(g.situation)}</span>
     </span>`
  ).join('');
  banner.innerHTML = `<div class="live-banner-inner"><span class="live-banner-label">LIVE NOW</span>${items}</div>`;
  banner.hidden = false;
}

// ── Calendar: pulsing LIVE badge on in-progress events ────────────────────

function updateCalendarLiveBadges() {
  const els = window.__calendarEventEls || {};
  document.querySelectorAll('.fc-live-line').forEach(el => el.remove());
  for (const [id, game] of Object.entries(window.__liveData)) {
    const el = els[id];
    if (!el || !document.contains(el)) continue;
    el.querySelector('.fc-score-line')?.remove();
    const line = document.createElement('div');
    line.className = 'fc-live-line';
    line.innerHTML = `<span class="live-badge-sm">LIVE</span> ${esc(game.asuScore)}–${esc(game.oppScore)} <span class="fc-live-situation">${esc(game.situation)}</span>`;
    el.querySelector('.fc-event-title-container')?.appendChild(line);
  }
}

// ── List view: LIVE badge injected into rendered list items ───────────────

function updateListLiveBadges() {
  document.querySelectorAll('.list-event[data-event-id]').forEach(el => {
    const id = el.dataset.eventId;
    const game = window.__liveData[id];
    el.querySelector('.live-badge-list')?.remove();
    el.classList.toggle('list-event-live', !!game);
    if (!game) return;
    const right = el.querySelector('.list-event-right');
    if (!right) return;
    const badge = document.createElement('div');
    badge.className = 'live-badge-list';
    badge.innerHTML =
      `<span class="live-badge-pill">🔴 LIVE</span>` +
      `<span class="live-score-text">${esc(game.asuScore)}–${esc(game.oppScore)} · ${esc(game.situation)}</span>`;
    right.prepend(badge);
  });
}

// ── Polling control ───────────────────────────────────────────────────────

function startLivePolling() {
  if (_pollTimer) return;
  pollLive();
  _pollTimer = setInterval(pollLive, POLL_INTERVAL);
}

function stopLivePolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLivePolling();
  } else {
    startLivePolling();   // polls immediately on resume
  }
});

startLivePolling();

// ── Escape helper (mirrors filters.js) ───────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
