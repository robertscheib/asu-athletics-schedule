const fetch = require('node-fetch');
const { updateScore, upsertESPNEvent, queryEvents } = require('./db');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// Sports with reliable ESPN public API coverage.
// fallSport: true → season runs Aug–Dec, so prior year when month < 7.
const SPORT_CONFIG = [
  { dbSport: 'Baseball',   espnPath: 'baseball/college-baseball',            teamId: '59',  fallSport: false },
  { dbSport: 'Softball',   espnPath: 'baseball/college-softball',            teamId: '471', fallSport: false },
  { dbSport: 'Football',   espnPath: 'football/college-football',            teamId: '9',   fallSport: true  },
  { dbSport: 'Ice Hockey', espnPath: 'hockey/mens-college-hockey',           teamId: '9',   fallSport: false },
  { dbSport: 'Volleyball', espnPath: 'volleyball/womens-college-volleyball', teamId: '9',   fallSport: true  },
];

function getSeason(fallSport) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return (fallSport && month < 7) ? year - 1 : year;
}

async function fetchESPNSchedule(espnPath, teamId, season) {
  const url = `${ESPN_BASE}/${espnPath}/teams/${teamId}/schedule?season=${season}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ASU-Athletics-Calendar/1.0' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

function extractScore(espnEvent) {
  const comp = espnEvent.competitions?.[0];
  if (!comp?.status?.type?.completed) return null;

  const asuComp = comp.competitors?.find(c =>
    c.team?.displayName?.toLowerCase().includes('arizona state')
  );
  const oppComp = comp.competitors?.find(c =>
    !c.team?.displayName?.toLowerCase().includes('arizona state')
  );
  if (!asuComp || !oppComp) return null;

  const asuScore = asuComp.score?.displayValue ?? String(asuComp.score ?? '');
  const oppScore = oppComp.score?.displayValue ?? String(oppComp.score ?? '');
  if (!asuScore || !oppScore) return null;

  const result = asuComp.winner === true ? 'W' : oppComp.winner === true ? 'L' : 'T';
  return {
    asu_score: asuScore,
    opp_score: oppScore,
    result,
    espnOppName: oppComp.team?.displayName || '',
    espnOppDisplay: (oppComp.team?.displayName || '').toLowerCase(),
    espnOppAbbr: (oppComp.team?.abbreviation || '').toLowerCase(),
    espnOppLogo: oppComp.team?.logo || null,
    homeAway: asuComp.homeAway || 'home',
    neutralSite: comp.neutralSite === true,
  };
}

// Extract opponent portion from our event title.
// "Sun Devil Baseball: Arizona State vs. UCF"  → "ucf"
// "Arizona State at Michigan"                  → "michigan"
// "Texas at Arizona State"                     → "texas"
function opponentFromTitle(title) {
  const clean = title.replace(/^[^:]+:\s*/i, '');
  const vsM = clean.match(/arizona\s+state\s+vs\.?\s+(.+)/i);
  if (vsM) return vsM[1].trim().toLowerCase();
  const asuAtM = clean.match(/arizona\s+state\s+at\s+(.+)/i);
  if (asuAtM) return asuAtM[1].trim().toLowerCase();
  const oppAtM = clean.match(/^(.+?)\s+at\s+arizona\s+state/i);
  if (oppAtM) return oppAtM[1].trim().toLowerCase();
  return null;
}

function opponentMatches(dbOpp, espnDisplay, espnAbbr) {
  if (!dbOpp) return false;
  if (espnAbbr && dbOpp.includes(espnAbbr)) return true;
  const words = espnDisplay.split(/\s+/).filter(w => w.length > 3);
  return words.some(w => dbOpp.includes(w));
}

// Returns a matching DB event, or null if no confident match.
function findDBMatch(scoreData, dbEvents, espnDate) {
  const espnDay = espnDate.toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

  const sameDay = dbEvents.filter(db => {
    const dbDay = new Date(db.start_date * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
    return dbDay === espnDay;
  });

  if (sameDay.length === 0) return null;
  if (sameDay.length === 1) return sameDay[0];

  // Multiple same-day games (tournament): disambiguate by opponent.
  const withOpp = sameDay.filter(db => {
    const dbOpp = opponentFromTitle(db.title || '');
    return opponentMatches(dbOpp, scoreData.espnOppDisplay, scoreData.espnOppAbbr);
  });
  return withOpp.length === 1 ? withOpp[0] : null;
}

// Build a minimal event record from ESPN data for backfill insertion.
function buildESPNEvent(espnEvent, sport, scoreData) {
  const oppName = scoreData.espnOppName;

  const gameType = scoreData.neutralSite ? 'neutral'
    : scoreData.homeAway === 'home' ? 'home' : 'away';

  const title = scoreData.homeAway === 'away'
    ? `Arizona State at ${oppName}`
    : `Arizona State vs. ${oppName}`;

  const startDate = Math.floor(new Date(espnEvent.date).getTime() / 1000);

  return {
    id: `espn_${espnEvent.id}`,
    title,
    sport,
    season: String(new Date(espnEvent.date).getFullYear()),
    start_date: startDate,
    end_date: null,
    location_name: null,
    venue_address: null,
    city: null,
    state: null,
    country: null,
    game_type: gameType,
    event_type: 'Game',
    tv_network: null,
    ticket_url: null,
    ticket_label: null,
    opponent_logo: scoreData.espnOppLogo,
    badges: null,
    image_url: null,
    node_url: null,
    updated_at: Date.now(),
    asu_score: scoreData.asu_score,
    opp_score: scoreData.opp_score,
    result: scoreData.result,
  };
}

async function fetchLiveScoreboard(espnPath) {
  const url = `${ESPN_BASE}/${espnPath}/scoreboard`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ASU-Athletics-Calendar/1.0' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

function extractLiveGame(espnEvent) {
  const comp = espnEvent.competitions?.[0];
  if (!comp) return null;
  const status = comp.status;
  if (status?.type?.state !== 'in') return null;

  const asuComp = comp.competitors?.find(c =>
    c.team?.displayName?.toLowerCase().includes('arizona state')
  );
  const oppComp = comp.competitors?.find(c =>
    !c.team?.displayName?.toLowerCase().includes('arizona state')
  );
  if (!asuComp || !oppComp) return null;

  return {
    espnDate: espnEvent.date,
    oppName: oppComp.team?.displayName || '',
    asuScore: asuComp.score?.displayValue ?? String(asuComp.score ?? '0'),
    oppScore: oppComp.score?.displayValue ?? String(oppComp.score ?? '0'),
    period: status.period || 0,
    clock: status.displayClock || '',
    situation: status.type?.shortDetail || status.type?.description || 'In Progress',
    espnOppDisplay: (oppComp.team?.displayName || '').toLowerCase(),
    espnOppAbbr: (oppComp.team?.abbreviation || '').toLowerCase(),
  };
}

async function fetchLiveGames() {
  const results = [];

  for (const cfg of SPORT_CONFIG) {
    let scoreboard;
    try {
      scoreboard = await fetchLiveScoreboard(cfg.espnPath);
    } catch (err) {
      console.error(`[live] ${cfg.dbSport}: scoreboard fetch failed:`, err.message);
      continue;
    }

    const dbEvents = queryEvents({ sport: cfg.dbSport });

    for (const espnEvent of scoreboard) {
      const comp = espnEvent.competitions?.[0];
      if (!comp) continue;

      // Auto-update any just-completed games found on today's scoreboard
      if (comp.status?.type?.completed) {
        const scoreData = extractScore(espnEvent);
        if (scoreData) {
          const dbMatch = findDBMatch(scoreData, dbEvents, new Date(espnEvent.date));
          if (dbMatch && (dbMatch.result !== scoreData.result ||
              dbMatch.asu_score !== scoreData.asu_score ||
              dbMatch.opp_score !== scoreData.opp_score)) {
            updateScore(dbMatch.id, scoreData.asu_score, scoreData.opp_score, scoreData.result);
            console.log(`[live] Auto-updated completed game: ${dbMatch.title}`);
          }
        }
        continue;
      }

      const live = extractLiveGame(espnEvent);
      if (!live) continue;

      const matchKey = { espnOppDisplay: live.espnOppDisplay, espnOppAbbr: live.espnOppAbbr };
      const dbMatch = findDBMatch(matchKey, dbEvents, new Date(live.espnDate));

      results.push({
        dbEventId: dbMatch?.id ?? null,
        sport: cfg.dbSport,
        title: dbMatch?.title ?? `Arizona State vs. ${live.oppName}`,
        asuScore: live.asuScore,
        oppScore: live.oppScore,
        period: live.period,
        clock: live.clock,
        situation: live.situation,
      });
    }
  }

  return results;
}

async function fetchAndStoreScores() {
  let updated = 0;
  let inserted = 0;

  for (const cfg of SPORT_CONFIG) {
    const season = getSeason(cfg.fallSport);
    console.log(`[scores] ${cfg.dbSport}: fetching ESPN season ${season}`);

    let espnEvents;
    try {
      espnEvents = await fetchESPNSchedule(cfg.espnPath, cfg.teamId, season);
    } catch (err) {
      console.error(`[scores] ${cfg.dbSport}: ESPN fetch failed:`, err.message);
      continue;
    }

    const completed = espnEvents.filter(e =>
      e.competitions?.[0]?.status?.type?.completed
    );
    console.log(`[scores] ${cfg.dbSport}: ${completed.length} completed from ESPN`);

    const dbEvents = queryEvents({ sport: cfg.dbSport });

    for (const espnEvent of completed) {
      const scoreData = extractScore(espnEvent);
      if (!scoreData) continue;

      const espnDate = new Date(espnEvent.date);
      const dbMatch = findDBMatch(scoreData, dbEvents, espnDate);

      if (dbMatch) {
        if (dbMatch.result === scoreData.result &&
            dbMatch.asu_score === scoreData.asu_score &&
            dbMatch.opp_score === scoreData.opp_score) continue;
        updateScore(dbMatch.id, scoreData.asu_score, scoreData.opp_score, scoreData.result);
        updated++;
      } else {
        // No existing DB event — backfill from ESPN so scores are visible.
        upsertESPNEvent(buildESPNEvent(espnEvent, cfg.dbSport, scoreData));
        inserted++;
      }
    }
  }

  console.log(`[scores] Updated ${updated}, inserted ${inserted} ESPN events`);
  return { updated, inserted };
}

module.exports = { fetchAndStoreScores, fetchLiveGames };
