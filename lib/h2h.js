// Head-to-head record vs an opponent, computed from the local events DB.
// The same school shows up under different names across feed eras — "Arizona
// Wildcats" in older rows, "Arizona" in newer ones, "Texas Tech Red Raiders"
// from ESPN displayNames — so opponent groups are merged under a canonical
// key (the shortest mascot-stripped form) and every name variant indexes as
// an alias. Shortening obeys the rank-matching stop words ("Kansas State"
// must never fall through to "Kansas"); ambiguous aliases (one prefix, two
// schools) are discarded rather than guessed.
const { queryEvents } = require('../db');
const { opponentFromTitle } = require('./opponent');
const { normName, SHORTEN_STOP_WORDS } = require('./standings');

// Yields key, then key minus trailing words, respecting stop words / min length.
function* _shorterForms(key) {
  for (;;) {
    yield key;
    const i = key.lastIndexOf(' ');
    if (i === -1) return;
    if (SHORTEN_STOP_WORDS.has(key.slice(i + 1))) return;
    key = key.slice(0, i);
    if (key.length <= 3) return;
  }
}

function _buildOpponentIndex(events) {
  const raw = new Map(); // full normalized opponent -> events[]
  for (const e of events) {
    const opp = opponentFromTitle(e.title);
    if (!opp) continue;
    const key = normName(opp);
    if (!key) continue;
    if (!raw.has(key)) raw.set(key, []);
    raw.get(key).push(e);
  }

  // Canonical key = the shortest shorter-form that is itself a known opponent
  // (merges "arizona wildcats" rows into "arizona" when both exist).
  const groups = new Map(); // canonical key -> merged events[]
  const keys = new Map();   // any name/prefix -> canonical key | null (ambiguous)
  for (const [full, evs] of raw) {
    let canon = full;
    for (const form of _shorterForms(full)) {
      if (raw.has(form)) canon = form;
    }
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon).push(...evs);
    for (const form of _shorterForms(full)) {
      const existing = keys.get(form);
      keys.set(form, existing === undefined || existing === canon ? canon : null);
    }
  }
  return { groups, keys };
}

function _resolve(target, { keys }) {
  for (const form of _shorterForms(target)) {
    const canon = keys.get(form);
    if (canon) return canon;
  }
  return null;
}

function getHeadToHead(sport, opponentRaw) {
  const opponent = opponentFromTitle(opponentRaw) || opponentRaw;
  const target = normName(opponent);
  if (!target) return null;

  const index = _buildOpponentIndex(queryEvents({ sport }));
  const matchKey = _resolve(target, index);
  const played = (matchKey ? index.groups.get(matchKey) : [])
    .filter(e => e.result)
    .sort((a, b) => b.start_date - a.start_date);

  return {
    opponent,
    sport,
    games: played.length,
    w: played.filter(e => e.result === 'W').length,
    l: played.filter(e => e.result === 'L').length,
    t: played.filter(e => e.result === 'T').length,
    meetings: played.slice(0, 5).map(e => ({
      id: e.id,
      startDate: e.start_date,
      season: e.season,
      result: e.result,
      asuScore: e.asu_score,
      oppScore: e.opp_score,
      gameType: e.game_type,
      location: e.location_name || [e.city, e.state].filter(Boolean).join(', ') || null,
    })),
  };
}

module.exports = { getHeadToHead };
