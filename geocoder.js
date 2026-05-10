const fetch = require('node-fetch');
const { getEventsNeedingGeocode, updateCoordinates } = require('./db');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'ASU-Athletics-Calendar/1.0 (contact: asu-athletics-schedule)';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(address) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// Sentinel stored in DB for addresses that can never be geocoded.
// Non-null so getEventsNeedingGeocode won't retry them; filtered out by the map.
const GEO_SKIP = { lat: 0, lng: 0 };

// Venues Nominatim can't resolve — add new entries here as needed.
const KNOWN_VENUES = {
  '1 N National Championship Dr, Tucson, AZ 85719': { lat: 32.2226, lng: -110.9747 }, // Kino Sports Complex
};

function cleanSuiteUnit(address) {
  return address
    .replace(/(?:#\S+|\b(?:Suite|Ste\.?|Unit)\s+\w+)\s*/gi, '')
    .trim()
    .replace(/,\s*,/g, ',');
}

function extractCityState(address) {
  const m = address.match(/,\s*([^,]+,\s*[A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  return m ? m[1].trim() : null;
}

function dehyphenate(address) {
  return address.replace(/^(\d+)-\d+/, '$1');
}

async function geocodeAllMissing() {
  const events = getEventsNeedingGeocode();
  if (events.length === 0) {
    console.log('[geocoder] No events need geocoding');
    return { success: 0, failed: 0 };
  }

  console.log(`[geocoder] Geocoding ${events.length} events`);

  // Deduplicate by address — only call Nominatim once per unique address
  const addressMap = {};
  for (const e of events) {
    if (!e.venue_address) continue;
    if (!addressMap[e.venue_address]) addressMap[e.venue_address] = [];
    addressMap[e.venue_address].push(e.id);
  }

  let success = 0;
  let failed = 0;
  let first = true;

  for (const [address, ids] of Object.entries(addressMap)) {
    // Respect Nominatim's 1 req/sec policy
    if (!first) await sleep(1100);
    first = false;

    try {
      // (1) Known venues hardcoded above — no Nominatim call needed
      if (KNOWN_VENUES[address]) {
        const { lat, lng } = KNOWN_VENUES[address];
        for (const id of ids) updateCoordinates(id, lat, lng);
        success += ids.length;
        console.log(`[geocoder] OK (hardcoded): "${address}" → ${lat}, ${lng}`);
        continue;
      }

      // (2) Google Maps URLs can never be parsed by Nominatim — skip permanently
      if (address.startsWith('http')) {
        for (const id of ids) updateCoordinates(id, GEO_SKIP.lat, GEO_SKIP.lng);
        console.warn(`[geocoder] Skipping URL (marked permanent skip): "${address}"`);
        failed += ids.length;
        continue;
      }

      let coords = await geocodeAddress(address);
      let resolvedAddress = address;

      // (3) Strip suite/unit suffixes (#3410, Ste 200, Unit B)
      if (!coords && /(?:#\S+|\b(?:Suite|Ste\.?|Unit)\s+\w+)/i.test(address)) {
        await sleep(1100);
        resolvedAddress = cleanSuiteUnit(address);
        coords = await geocodeAddress(resolvedAddress);
      }

      // (4) Venue names (no leading digit) — fall back to city, state
      if (!coords && !/^\d/.test(address)) {
        const cityState = extractCityState(address);
        if (cityState) {
          await sleep(1100);
          resolvedAddress = cityState;
          coords = await geocodeAddress(resolvedAddress);
        }
      }

      // (5) Hyphenated range like "1628-1696 Foo St" — try just the first number
      if (!coords && /^\d+-\d+/.test(address)) {
        await sleep(1100);
        resolvedAddress = dehyphenate(address);
        coords = await geocodeAddress(resolvedAddress);
      }

      if (coords) {
        for (const id of ids) updateCoordinates(id, coords.lat, coords.lng);
        success += ids.length;
        const suffix = resolvedAddress !== address ? ` (via "${resolvedAddress}")` : '';
        console.log(`[geocoder] OK: "${address}" → ${coords.lat}, ${coords.lng}${suffix}`);
      } else {
        console.warn(`[geocoder] No result for address: "${address}"`);
        failed += ids.length;
      }
    } catch (err) {
      console.error(`[geocoder] Failed to geocode "${address}": ${err.message}`);
      failed += ids.length;
    }
  }

  console.log(`[geocoder] Done — ${success} geocoded, ${failed} failed`);
  return { success, failed };
}

module.exports = { geocodeAllMissing };
