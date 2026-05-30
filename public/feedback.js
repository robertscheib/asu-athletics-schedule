(function () {
  'use strict';

  // ── Inject trigger button ──────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.id = 'feedback-trigger';
  trigger.setAttribute('aria-label', 'Open feedback');
  trigger.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
    <span class="fb-label">Feedback</span>
  `;
  document.body.appendChild(trigger);

  // ── Inject overlay + modal ─────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'feedback-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Feedback');

  overlay.innerHTML = `
    <div id="feedback-modal">
      <div class="fb-modal-header">
        <span class="fb-modal-title">Share Feedback</span>
        <button class="fb-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="fb-modal-body">
        <div class="fb-field">
          <label for="fb-page">Page</label>
          <select id="fb-page">
            <option value="">Other</option>
            <option value="calendar">Calendar</option>
            <option value="list">List</option>
            <option value="map">Map</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div class="fb-field">
          <label>Rating (optional)</label>
          <div class="fb-stars" id="fb-stars" role="radiogroup" aria-label="Star rating">
            <button class="fb-star" data-val="1" aria-label="1 star">&#9733;</button>
            <button class="fb-star" data-val="2" aria-label="2 stars">&#9733;</button>
            <button class="fb-star" data-val="3" aria-label="3 stars">&#9733;</button>
            <button class="fb-star" data-val="4" aria-label="4 stars">&#9733;</button>
            <button class="fb-star" data-val="5" aria-label="5 stars">&#9733;</button>
          </div>
        </div>
        <div class="fb-field">
          <label for="fb-message">Message (optional)</label>
          <textarea id="fb-message" maxlength="1000" placeholder="What's on your mind?"></textarea>
          <div class="fb-char-count" id="fb-char-count">0 / 1000</div>
        </div>
        <div class="fb-status" id="fb-status"></div>
        <button class="fb-submit" id="fb-submit">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── State ──────────────────────────────────────────────────────
  let selectedRating = null;

  // ── Pre-fill page from current view ───────────────────────────
  function detectPage() {
    const hash = location.hash.replace('#', '').toLowerCase();
    if (['calendar', 'list', 'map', 'live'].includes(hash)) return hash;
    // Check active view button if present
    const active = document.querySelector('.view-toggle button.active');
    if (active) {
      const text = active.textContent.trim().toLowerCase();
      if (['calendar', 'list', 'map', 'live'].includes(text)) return text;
    }
    return '';
  }

  // ── Elements ───────────────────────────────────────────────────
  const pageSelect = overlay.querySelector('#fb-page');
  const stars      = overlay.querySelectorAll('.fb-star');
  const textarea   = overlay.querySelector('#fb-message');
  const charCount  = overlay.querySelector('#fb-char-count');
  const status     = overlay.querySelector('#fb-status');
  const submitBtn  = overlay.querySelector('#fb-submit');
  const closeBtn   = overlay.querySelector('.fb-modal-close');
  const modal      = overlay.querySelector('#feedback-modal');

  // ── Helpers ────────────────────────────────────────────────────
  function openModal() {
    pageSelect.value = detectPage();
    selectedRating = null;
    stars.forEach(s => s.classList.remove('active'));
    textarea.value = '';
    updateCharCount();
    clearStatus();
    overlay.classList.add('open');
    setTimeout(() => closeBtn.focus(), 50);
  }

  function closeModal() {
    overlay.classList.remove('open');
    trigger.focus();
  }

  function updateCharCount() {
    const len = textarea.value.length;
    charCount.textContent = `${len} / 1000`;
    charCount.className = 'fb-char-count' + (len >= 950 ? ' red' : len >= 800 ? ' amber' : '');
  }

  function clearStatus() {
    status.className = 'fb-status';
    status.textContent = '';
  }

  function showStatus(type, msg) {
    status.className = `fb-status ${type}`;
    status.textContent = msg;
  }

  function setStars(val) {
    selectedRating = val;
    stars.forEach(s => s.classList.toggle('active', Number(s.dataset.val) <= val));
  }

  // ── Focus trap ─────────────────────────────────────────────────
  const focusable = () => Array.from(modal.querySelectorAll(
    'button, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ── Event listeners ────────────────────────────────────────────
  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  textarea.addEventListener('input', updateCharCount);

  stars.forEach(star => {
    star.addEventListener('click', () => {
      const val = Number(star.dataset.val);
      if (selectedRating === val) {
        selectedRating = null;
        stars.forEach(s => s.classList.remove('active'));
      } else {
        setStars(val);
      }
    });
  });

  submitBtn.addEventListener('click', async () => {
    clearStatus();
    const message = textarea.value.trim() || null;
    const rating  = selectedRating;
    const page    = pageSelect.value || null;

    if (!message && rating == null) {
      showStatus('error', 'Please provide a rating or message.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, rating, message }),
      });

      if (res.status === 429) {
        showStatus('error', 'Too many submissions. Try again later.');
      } else if (!res.ok) {
        showStatus('error', 'Something went wrong. Please try again.');
      } else {
        showStatus('success', 'Thanks! Your feedback was submitted.');
        setTimeout(closeModal, 2000);
      }
    } catch {
      showStatus('error', 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });
})();
