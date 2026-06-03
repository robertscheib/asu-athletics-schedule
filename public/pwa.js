// pwa.js — Install banner, offline banner, push subscription, bell state

// ── Push subscription state ───────────────────────────────────────────────────

const PUSH_ENDPOINT_KEY = 'asu-push-endpoint';
let _swRegistration = null;

window.getPushEndpoint = () => localStorage.getItem(PUSH_ENDPOINT_KEY) || null;

async function _initPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    _swRegistration = await navigator.serviceWorker.ready;
    let sub = await _swRegistration.pushManager.getSubscription();
    if (!sub) {
      const keyRes = await fetch('/api/vapid-public-key');
      const { publicKey } = await keyRes.json();
      sub = await _swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(publicKey),
      });
    }
    const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh'))));
    const auth   = btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))));
    localStorage.setItem(PUSH_ENDPOINT_KEY, sub.endpoint);

    // Upsert subscription server-side with current sport prefs
    const sportPrefs = _getSportPrefs();
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh, auth, sportPrefs }),
    });

    console.log('[pwa] Push subscription active');
    window.dispatchEvent(new CustomEvent('pwa-push-ready'));
  } catch (err) {
    console.warn('[pwa] Push subscription failed:', err.message);
  }
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// ── Sport preferences ─────────────────────────────────────────────────────────

function _getSportPrefs() {
  try {
    const stored = localStorage.getItem('asu-sport-prefs');
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function _saveSportPrefs(prefs) {
  try { localStorage.setItem('asu-sport-prefs', JSON.stringify(prefs)); } catch {}
}

// ── Bell icon state ───────────────────────────────────────────────────────────

const _gameSubscriptions = new Set(
  JSON.parse(localStorage.getItem('asu-game-subs') || '[]'),
);

function _persistGameSubs() {
  try { localStorage.setItem('asu-game-subs', JSON.stringify([..._gameSubscriptions])); } catch {}
}

function isGameSubscribed(eventId) {
  return _gameSubscriptions.has(eventId);
}

async function toggleGameSubscription(eventId, subscribeNow) {
  const endpoint = window.getPushEndpoint();
  if (!endpoint) return;

  const method = subscribeNow ? 'POST' : 'DELETE';
  const path = '/api/subscribe/game';

  try {
    await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, eventId }),
    });
    if (subscribeNow) {
      _gameSubscriptions.add(eventId);
    } else {
      _gameSubscriptions.delete(eventId);
    }
    _persistGameSubs();
  } catch (err) {
    console.error('[pwa] toggleGameSubscription failed:', err.message);
  }
}

// Bell HTML — call from list/live renderers
// tooltip: optional override for the subscribe action label
function bellIconHTML(eventId, isFutureOrLive, tooltip) {
  if (!isFutureOrLive) return '';
  const subLabel = tooltip || 'Subscribe to this game';
  const endpoint = window.getPushEndpoint();
  if (!endpoint) {
    return `<button class="bell-btn bell-disabled" title="Enable notifications to subscribe to this game" aria-label="Notifications disabled">🔕</button>`;
  }
  const subscribed = isGameSubscribed(eventId);
  return `<button class="bell-btn ${subscribed ? 'bell-on' : 'bell-off'}" data-event-id="${eventId}" onclick="window.handleBellClick(event, this)" title="${subscribed ? 'Unsubscribe from this game' : subLabel}" aria-label="${subscribed ? 'Subscribed' : 'Subscribe'}">🔔</button>`;
}

window.bellIconHTML = bellIconHTML;

window.handleBellClick = async function(e, btn) {
  e.stopPropagation();
  const eventId = btn.dataset.eventId;
  if (!eventId) return;
  const nowSubscribed = btn.classList.contains('bell-on');
  const willSubscribe = !nowSubscribed;
  btn.disabled = true;
  await toggleGameSubscription(eventId, willSubscribe);
  btn.disabled = false;
  btn.classList.toggle('bell-on', willSubscribe);
  btn.classList.toggle('bell-off', !willSubscribe);
  btn.title = willSubscribe ? 'Unsubscribe from this game' : 'Subscribe to this game';
};

window.isGameSubscribed = isGameSubscribed;

// ── Enable notifications button ───────────────────────────────────────────────

window.requestPushPermission = async function() {
  if (!('Notification' in window)) return;
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    await _initPushSubscription();
    _renderNotifSection();
  }
};

// ── iOS install banner ────────────────────────────────────────────────────────

function _isIosSafari() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !/Chrome|CriOS|FxiOS|OPT\//i.test(ua);
}

function _isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function _showIosBanner() {
  if (_isStandalone()) return;
  if (!_isIosSafari()) return;
  if (localStorage.getItem('installBannerDismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.innerHTML = `
    <img src="/sparky.png" alt="Sun Devils" style="width:36px;height:36px;border-radius:8px;flex-shrink:0">
    <span class="ios-banner-text">Add to Home Screen for the full experience &mdash; tap <strong>⬆ Share</strong> → <strong>Add to Home Screen</strong></span>
    <button class="ios-banner-dismiss" onclick="window._dismissIosBanner()" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('ios-banner-visible'));
}

window._dismissIosBanner = function() {
  localStorage.setItem('installBannerDismissed', '1');
  const banner = document.getElementById('ios-install-banner');
  if (banner) {
    banner.classList.remove('ios-banner-visible');
    setTimeout(() => banner.remove(), 350);
  }
};

// ── Offline banner ────────────────────────────────────────────────────────────

function _initOfflineBanner() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'offline') _showOfflineBanner();
  });

  window.addEventListener('online', _hideOfflineBanner);
}

function _showOfflineBanner() {
  if (document.getElementById('offline-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'offline-banner';
  bar.textContent = "You're offline — showing cached schedule. Live scores unavailable.";
  document.body.prepend(bar);
}

function _hideOfflineBanner() {
  document.getElementById('offline-banner')?.remove();
}

// ── Install App sidebar section ───────────────────────────────────────────────

function _renderInstallSection() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (_isStandalone()) return;

  const section = document.createElement('div');
  section.className = 'filter-group install-app-section';
  section.id = 'install-app-section';
  section.innerHTML = `
    <label class="group-label">Install App</label>
    <p class="install-benefit">Get game-start notifications and offline schedule access.</p>
    <ol class="install-steps">
      <li>Tap <span class="install-icon">⬆</span> <strong>Share</strong></li>
      <li>Scroll to find <span class="install-icon">➕</span></li>
      <li>Tap <strong>"Add to Home Screen"</strong></li>
    </ol>
  `;
  sidebar.appendChild(section);
}

// ── Notifications sidebar section ─────────────────────────────────────────────

function _renderNotifSection() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const existing = document.getElementById('notif-section');
  if (existing) existing.remove();

  const perm = Notification?.permission ?? 'default';

  const section = document.createElement('div');
  section.className = 'filter-group';
  section.id = 'notif-section';

  if (perm === 'denied') {
    section.innerHTML = `<label class="group-label">Notifications</label><p class="install-benefit" style="color:#c0392b">Blocked in browser settings.</p>`;
    sidebar.appendChild(section);
    return;
  }

  if (perm !== 'granted') {
    section.innerHTML = `
      <label class="group-label">Notifications</label>
      <p class="install-benefit">Get notified 15 min before game start.</p>
      <button class="btn-enable-notif" onclick="window.requestPushPermission()">Enable Notifications</button>
    `;
    sidebar.appendChild(section);
    return;
  }

  // Granted — show sport preference checkboxes
  const sportPrefs = _getSportPrefs();
  const allChecked = !sportPrefs;

  let sportsHtml = '';
  const knownSports = [
    "Football", "Men's Basketball", "Women's Basketball",
    "Baseball", "Softball", "Soccer",
    "Swimming & Diving", "Track and Field", "Golf (Men's)", "Golf (Women's)",
    "Tennis (Men's)", "Tennis (Women's)", "Wrestling", "Gymnastics",
  ];
  sportsHtml = knownSports.map(s => {
    const checked = allChecked || sportPrefs?.includes(s);
    return `<label class="notif-sport-row"><input type="checkbox" value="${s}" ${checked ? 'checked' : ''} onchange="window._onSportPrefChange()"> ${s}</label>`;
  }).join('');

  section.innerHTML = `
    <label class="group-label">Notifications <span style="font-size:0.7rem;font-weight:400;opacity:0.7">(granted)</span></label>
    <label class="notif-sport-row notif-all-row">
      <input type="checkbox" id="notif-all" ${allChecked ? 'checked' : ''} onchange="window._onNotifAllChange(this)"> All sports
    </label>
    <div id="notif-sport-list" style="${allChecked ? 'display:none' : ''}">${sportsHtml}</div>
  `;
  sidebar.appendChild(section);
}

window._onNotifAllChange = function(checkbox) {
  const listEl = document.getElementById('notif-sport-list');
  if (checkbox.checked) {
    if (listEl) listEl.style.display = 'none';
    _saveSportPrefs(null);
    _postSportPrefs(null);
  } else {
    if (listEl) listEl.style.display = '';
  }
};

window._onSportPrefChange = function() {
  const allBox = document.getElementById('notif-all');
  if (allBox) allBox.checked = false;
  const checked = [...document.querySelectorAll('#notif-sport-list input[type=checkbox]:checked')].map(i => i.value);
  _saveSportPrefs(checked);
  _postSportPrefs(checked);
};

async function _postSportPrefs(prefs) {
  const endpoint = window.getPushEndpoint();
  if (!endpoint) return;
  try {
    const p256dh = ''; const auth = '';
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, p256dh, auth, sportPrefs: prefs }),
    });
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  _initOfflineBanner();
  _showIosBanner();
  _renderInstallSection();
  _renderNotifSection();

  // If already granted, attempt to restore/create subscription silently
  if (Notification?.permission === 'granted') {
    _swRegistration = _swRegistration || (await navigator.serviceWorker.ready.catch(() => null));
    await _initPushSubscription();
  }
});
