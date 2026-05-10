const cron = require('node-cron');
const { fetchAndStore } = require('./fetcher');
const { fetchAndStoreScores } = require('./scores');
const { getEventCount } = require('./db');
const { geocodeAllMissing } = require('./geocoder');

function startScheduler() {
  // Nightly at 2am server local time
  cron.schedule('0 2 * * *', async () => {
    console.log('[scheduler] Running nightly fetch');
    try {
      await fetchAndStore();
    } catch (err) {
      console.error('[scheduler] Fetch failed:', err.message);
    }
    try {
      await fetchAndStoreScores();
    } catch (err) {
      console.error('[scheduler] Score fetch failed:', err.message);
    }
    // Geocode new events as a separate pass after the main fetch completes
    geocodeAllMissing().catch(err => console.error('[scheduler] Geocode pass failed:', err.message));
  });

  // Seed on startup if DB is empty
  if (getEventCount() === 0) {
    console.log('[scheduler] DB empty — running initial fetch');
    fetchAndStore()
      .then(() => geocodeAllMissing())
      .catch(err => console.error('[scheduler] Initial fetch/geocode failed:', err.message));
  } else {
    console.log(`[scheduler] DB has ${getEventCount()} events — skipping initial fetch`);
    // Backfill coordinates for any events added before geocoding was introduced
    geocodeAllMissing().catch(err => console.error('[scheduler] Startup geocode pass failed:', err.message));
  }
}

module.exports = { startScheduler };
