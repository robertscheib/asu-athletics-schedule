// Single source of truth for sport mappings. ESPN_SPORT_SLUGS and
// SPORT_CONFIG stay separate tables on purpose: SLUGS keys the summary
// endpoint by display sport name (and includes nulls for sports ESPN has
// no box score for), while SPORT_CONFIG drives team-schedule sync and
// needs ASU teamIds. Their key spaces and ESPN paths differ.

// Sport slug mapping for ESPN summary endpoint
const ESPN_SPORT_SLUGS = {
  'Baseball':             'baseball/college-baseball',
  'Softball':             'softball/college-softball',
  "Men's Basketball":     'basketball/mens-college-basketball',
  "Women's Basketball":   'basketball/womens-college-basketball',
  'Basketball':           'basketball/mens-college-basketball',
  'Football':             'football/college-football',
  "Women's Soccer":       'soccer/college-soccer-women',
  "Men's Soccer":         'soccer/college-soccer-men',
  'Soccer':               'soccer/college-soccer-men',
  "Women's Volleyball":   'volleyball/womens-college-volleyball',
  'Volleyball':           'volleyball/womens-college-volleyball',
  "Golf (Men's)":         'golf/college-golf-men',
  "Golf (Women's)":       'golf/college-golf-women',
  "Tennis (Men's)":       'tennis/college-tennis-men',
  "Tennis (Women's)":     'tennis/college-tennis-women',
  'Swimming':             'swimming-and-diving/college-swimming-diving',
  'Swimming & Diving':    'swimming-and-diving/college-swimming-diving',
  'Track and Field':      null,
  'Cross Country':        null,
};

// Sports for schedule sync (teamId required for team-schedule endpoint)
const SPORT_CONFIG = [
  { dbSport: 'Baseball',   espnPath: 'baseball/college-baseball',            teamId: '59',  fallSport: false },
  { dbSport: 'Softball',   espnPath: 'baseball/college-softball',            teamId: '471', fallSport: false },
  { dbSport: 'Football',   espnPath: 'football/college-football',            teamId: '9',   fallSport: true  },
  { dbSport: 'Ice Hockey', espnPath: 'hockey/mens-college-hockey',           teamId: '9',   fallSport: false },
  { dbSport: 'Volleyball', espnPath: 'volleyball/womens-college-volleyball', teamId: '9',   fallSport: true  },
];

// Additional sports polled for live data only (scoreboard doesn't need teamId)
const LIVE_EXTRA_SPORTS = [
  { dbSport: "Men's Basketball",   espnPath: 'basketball/mens-college-basketball',  fallSport: false },
  { dbSport: "Women's Basketball", espnPath: 'basketball/womens-college-basketball', fallSport: false },
  { dbSport: "Women's Soccer",     espnPath: 'soccer/womens-college-soccer',         fallSport: true  },
  { dbSport: "Men's Soccer",       espnPath: 'soccer/mens-college-soccer',           fallSport: true  },
];

const ALL_LIVE_CONFIGS = [...SPORT_CONFIG, ...LIVE_EXTRA_SPORTS];

const TOURNAMENT_RE = /regional|super\s*regional|tournament|playoff|championship|ncaa|bracket|semifinal|final\s*four|postseason/i;

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

module.exports = {
  ESPN_SPORT_SLUGS,
  SPORT_CONFIG,
  LIVE_EXTRA_SPORTS,
  ALL_LIVE_CONFIGS,
  TOURNAMENT_RE,
  SPORT_EMOJI,
};
