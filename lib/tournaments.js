// Tournament detection and bracket/series/pool building, independent of
// the live scoreboard polling in scores.js. Two sources:
//   buildTournaments(games)    — groups ESPN live games flagged isTournament
//   detectActiveTournaments()  — DB-title fallback when ESPN has nothing
const fetch = require('node-fetch');
const { queryEvents } = require('../db');
const { opponentFromTitle } = require('./opponent');
const { USER_AGENT } = require('./constants');
const { ALL_LIVE_CONFIGS, TOURNAMENT_RE } = require('./sports-config');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function extractRoundName(summaryData, game) {
  const notes = summaryData?.header?.competitions?.[0]?.notes || [];
  for (const note of notes) {
    const text = note.headline || note.text || '';
    if (text) return text;
  }
  return game.espnNotes || 'Tournament';
}

function buildBracketTeam(compData, fallbackGame, isASU) {
  if (compData) {
    return {
      name: compData.team?.displayName || (isASU ? 'Arizona State' : 'TBD'),
      abbr: compData.team?.abbreviation || (isASU ? 'ASU' : 'TBD'),
      logo: compData.team?.logos?.[0]?.href || compData.team?.logo || null,
      seed: compData.curatedRank?.current ?? null,
      score: compData.score?.displayValue ?? (compData.score != null ? String(compData.score) : null),
      winner: compData.winner === true ? true : compData.winner === false ? false : null,
      isASU,
    };
  }
  if (isASU) {
    return {
      name: 'Arizona State', abbr: 'ASU', logo: null, seed: null,
      score: fallbackGame?.asuScore ?? null,
      winner: fallbackGame?.state === 'final' ? (fallbackGame?.asuWinner === true) : null,
      isASU: true,
    };
  }
  return {
    name: fallbackGame?.oppName || 'TBD',
    abbr: fallbackGame?.oppAbbr || 'TBD',
    logo: fallbackGame?.oppLogo || null,
    seed: null,
    score: fallbackGame?.oppScore ?? null,
    winner: fallbackGame?.state === 'final' ? (fallbackGame?.asuWinner === false) : null,
    isASU: false,
  };
}

function inferRounds(games) {
  const matchups = games.map(g => ({
    id: g.espnEventId || `m-${Date.now()}-${Math.random()}`,
    teamA: buildBracketTeam(null, g, true),
    teamB: buildBracketTeam(null, g, false),
    state: g.state === 'live' ? 'in' : g.state === 'upcoming' ? 'pre' : 'post',
    startTime: g.startTime,
    situation: g.situation || '',
  }));
  return [{ name: 'Tournament', matchups }];
}

function buildBracketRoundsFromSummaries(group, summaries) {
  const summaryMap = {};
  for (const s of summaries) summaryMap[s.gameId] = s.data;

  const ROUND_ORDER = ['regional', 'super regional', 'college world series', 'semifinal', 'final', 'championship'];
  const roundMap = {};

  for (const g of group.games) {
    const summary = summaryMap[g.espnEventId];
    const roundName = extractRoundName(summary, g);
    if (!roundMap[roundName]) roundMap[roundName] = { name: roundName, matchups: [] };

    const comp = summary?.header?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const asuComp = competitors.find(c => c.team?.displayName?.toLowerCase().includes('arizona state'));
    const oppComp = competitors.find(c => !c.team?.displayName?.toLowerCase().includes('arizona state'));

    const rawState = comp?.status?.type?.state;
    const state = rawState === 'in' ? 'in' : rawState === 'pre' ? 'pre' : rawState === 'post' ? 'post'
      : (g.state === 'live' ? 'in' : g.state === 'upcoming' ? 'pre' : 'post');

    roundMap[roundName].matchups.push({
      id: g.espnEventId || `m-${Date.now()}`,
      teamA: buildBracketTeam(asuComp, g, true),
      teamB: buildBracketTeam(oppComp, g, false),
      state,
      startTime: g.startTime,
      situation: g.situation || '',
    });
  }

  return Object.values(roundMap).sort((a, b) => {
    const ai = ROUND_ORDER.findIndex(r => a.name.toLowerCase().includes(r));
    const bi = ROUND_ORDER.findIndex(r => b.name.toLowerCase().includes(r));
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function buildSeriesTournament(group, summaries) {
  const summaryMap = {};
  for (const s of summaries) summaryMap[s.gameId] = s.data;

  const seriesGames = group.games.map(g => {
    const series = summaryMap[g.espnEventId]?.header?.competitions?.[0]?.series;
    return { ...g, gameNumber: series?.gameNumber ?? null, maxGames: series?.maxGames ?? null };
  }).sort((a, b) => (a.gameNumber ?? 999) - (b.gameNumber ?? 999) || a.startTime - b.startTime);

  return { ...group, format: 'series', rounds: [], standings: [], seriesGames, bracketReady: true };
}

async function fetchPoolStandings(espnPath) {
  const url = `${ESPN_BASE}/${espnPath}/scoreboard?groups=50`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const entries = data.standings?.entries || data.standings?.groups?.[0]?.entries || [];
  if (!entries.length) return null;

  return entries.map((entry, i) => {
    const stats = entry.stats || [];
    const getStat = name => stats.find(s => s.name === name)?.displayValue ?? '-';
    return {
      rank: entry.team?.rank ?? i + 1,
      name: entry.team?.displayName || 'Unknown',
      abbr: entry.team?.abbreviation || '',
      logo: entry.team?.logos?.[0]?.href || null,
      w: getStat('wins'),
      l: getStat('losses'),
      pct: getStat('winPercent'),
      gb: getStat('gamesBehind'),
      isASU: (entry.team?.displayName || '').toLowerCase().includes('arizona state'),
    };
  });
}

async function buildTournaments(games) {
  const tournamentGames = games.filter(g => g.isTournament);
  if (!tournamentGames.length) return [];

  const groups = {};
  for (const g of tournamentGames) {
    const key = g.espnNotes ? `${g.sport}:${g.espnNotes}` : `${g.sport}:tournament`;
    if (!groups[key]) {
      groups[key] = { id: key, sport: g.sport, name: g.espnNotes || `${g.sport} Tournament`, games: [] };
    }
    groups[key].games.push(g);
  }

  const results = [];

  for (const group of Object.values(groups)) {
    group.games.sort((a, b) => a.startTime - b.startTime);

    const cfg = ALL_LIVE_CONFIGS.find(c => c.dbSport === group.sport);
    if (!cfg) {
      console.warn(`[live] No ESPN config for sport ${group.sport}, using inferred bracket`);
      results.push({ ...group, format: 'bracket', rounds: inferRounds(group.games), standings: [], seriesGames: [], bracketReady: true });
      continue;
    }

    // Fetch ESPN summaries for each tournament game to get round/series context
    const summaries = [];
    for (const g of group.games) {
      if (!g.espnEventId) continue;
      try {
        const url = `${ESPN_BASE}/${cfg.espnPath}/summary?event=${g.espnEventId}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 10000,
        });
        if (res.ok) summaries.push({ gameId: g.espnEventId, data: await res.json() });
      } catch (err) {
        console.error(`[live] Summary fetch failed for event ${g.espnEventId}:`, err.message);
      }
    }

    // Series format: ESPN reports maxGames > 1 on the competition
    const hasSeries = summaries.some(s => {
      const series = s.data?.header?.competitions?.[0]?.series;
      return series?.maxGames > 1;
    });
    if (hasSeries) {
      results.push(buildSeriesTournament(group, summaries));
      continue;
    }

    // Pool format: try groups endpoint for standings
    let standings = null;
    try {
      standings = await fetchPoolStandings(cfg.espnPath);
    } catch (err) {
      console.error(`[live] Pool standings fetch failed for ${group.sport}:`, err.message);
    }
    if (standings && standings.length > 0) {
      results.push({ ...group, format: 'pool', rounds: [], standings, seriesGames: [], bracketReady: true });
      continue;
    }

    // Bracket format: build rounds from summaries (or infer from game list if all fetches failed)
    const rounds = summaries.length
      ? buildBracketRoundsFromSummaries(group, summaries)
      : inferRounds(group.games);

    results.push({ ...group, format: 'bracket', rounds, standings: [], seriesGames: [], bracketReady: true });
  }

  return results;
}

async function detectActiveTournaments() {
  const nowTs = Math.floor(Date.now() / 1000);
  const candidates = queryEvents({ from: nowTs - 86400, to: nowTs + 14 * 86400 })
    .filter(e =>
      TOURNAMENT_RE.test(e.title || '') ||
      TOURNAMENT_RE.test(e.badges || '') ||
      TOURNAMENT_RE.test(e.location_name || '')
    );

  if (!candidates.length) return [];

  function deriveTournamentName(sport, event) {
    const text = `${event.title || ''} ${event.badges || ''} ${event.location_name || ''}`;
    const m = text.match(/ncaa\s+(?:super\s+regional|regional|tournament|championship)|super\s+regional|college\s+world\s+series|regional|championship|tournament/i);
    return m ? m[0].replace(/\s+/g, ' ').trim() : `${sport} Tournament`;
  }

  const groups = {};
  for (const event of candidates) {
    const name = deriveTournamentName(event.sport, event);
    const key = `${event.sport}:${name}`;
    if (!groups[key]) {
      groups[key] = { id: `db:${key}`, sport: event.sport, name, events: [] };
    }
    groups[key].events.push(event);
  }

  const results = [];

  for (const group of Object.values(groups)) {
    group.events.sort((a, b) => a.start_date - b.start_date);

    const games = group.events.map(event => ({
      espnEventId: null,
      dbEventId: event.id,
      sport: event.sport,
      title: event.title,
      state: event.start_date < nowTs ? 'final' : 'upcoming',
      asuScore: event.asu_score || null,
      oppScore: event.opp_score || null,
      asuWinner: event.result === 'W',
      oppName: opponentFromTitle(event.title, { fallback: 'Opponent' }),
      oppLogo: event.opponent_logo || null,
      oppAbbr: '',
      situation: event.result ? `Final: ${event.asu_score}–${event.opp_score}` : '',
      sportDetails: {},
      location: event.location_name || null,
      city: event.city || null,
      stateAbbr: event.state || null,
      tvNetwork: event.tv_network || null,
      startTime: event.start_date,
      isTournament: true,
      espnNotes: '',
      source: 'DB',
    }));

    const cfg = ALL_LIVE_CONFIGS.find(c => c.dbSport === group.sport);
    if (!cfg) {
      results.push({ id: group.id, sport: group.sport, name: group.name, format: 'bracket', rounds: inferRounds(games), standings: [], seriesGames: [], games, bracketReady: false });
      continue;
    }

    let standings = null;
    try {
      standings = await fetchPoolStandings(cfg.espnPath);
    } catch (err) {
      console.error(`[live] DB-detected pool fetch failed for ${group.sport}:`, err.message);
    }
    if (standings && standings.length > 0) {
      results.push({ id: group.id, sport: group.sport, name: group.name, format: 'pool', rounds: [], standings, seriesGames: [], games, bracketReady: false });
      continue;
    }

    results.push({ id: group.id, sport: group.sport, name: group.name, format: 'bracket', rounds: inferRounds(games), standings: [], seriesGames: [], games, bracketReady: false });
  }

  return results;
}

module.exports = { buildTournaments, detectActiveTournaments };
