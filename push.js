const webpush = require('web-push');
const { getGameSubscribers, deletePushSubscription } = require('./db');

const SPORT_EMOJI = {
  'Football':             '🏈',
  "Men's Basketball":     '🏀',
  "Women's Basketball":   '🏀',
  'Basketball':           '🏀',
  'Baseball':             '⚾',
  'Softball':             '🥎',
  "Women's Soccer":       '⚽',
  "Men's Soccer":         '⚽',
  'Soccer':               '⚽',
  "Women's Volleyball":   '🏐',
  'Volleyball':           '🏐',
  "Golf (Men's)":         '⛳',
  "Golf (Women's)":       '⛳',
  "Tennis (Men's)":       '🎾',
  "Tennis (Women's)":     '🎾',
  'Swimming':             '🏊',
  'Swimming & Diving':    '🏊',
  'Track and Field':      '🏃',
  'Cross Country':        '🏃',
  'Wrestling':            '🤼',
  'Gymnastics':           '🤸',
};

function buildPayload(event) {
  const emoji = SPORT_EMOJI[event.sport] || '🏟️';
  const opponent = (event.title || '').replace(/^.*?(?:at|vs\.?)\s+/i, '').trim() || 'Opponent';
  const timeStr = event.start_date
    ? new Date(event.start_date * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  const venue = event.location_name || '';

  return {
    web_push: 8030,
    notification: {
      title: `${emoji} ASU vs ${opponent} — Starting in 15 min`,
      body: [venue, timeStr ? `Kickoff at ${timeStr}` : ''].filter(Boolean).join(' · '),
      icon: '/icons/icon-192.png',
      navigate: 'https://asu.dikaiaserver.com',
      app_badge: '1',
    },
  };
}

async function sendGameStartAlert(eventRow) {
  const subscribers = getGameSubscribers(eventRow.id);
  if (!subscribers.length) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const payload = JSON.stringify(buildPayload(eventRow));
  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410) {
        try { deletePushSubscription(sub.endpoint); } catch {}
      } else {
        console.error(`[push] send failed for endpoint ${sub.endpoint.slice(-20)}: ${err.message}`);
      }
    }
  }

  console.log(`[push] event ${eventRow.id}: sent=${sent} failed=${failed}`);
}

module.exports = { sendGameStartAlert };
