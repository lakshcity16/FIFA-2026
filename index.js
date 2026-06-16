require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3050;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Load pre-built JSON data ──────────────────────────────────
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'));
const SQUADS   = load('data_squads.json');
const FIXTURES = load('data_fixtures.json');
const GROUPS   = load('data_groups.json');
const ANALYTICS= load('data_analytics.json');
const PERFORMERS=load('data_performers.json');
const TEAM_MAP = load('team_map.json');

// ── Load real WC 2026 player stats from CSV ──────────────────
const CSV_PLAYERS = (() => {
  try {
    const csvPath = path.join(__dirname, 'SquadLists.csv');
    const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const lines = raw.split('\n');
    const headers = lines[0].split(',');
    const idx = h => headers.indexOf(h);
    
    return lines.slice(1).filter(l => l.trim()).map(l => {
      // proper CSV split
      const v = [];
      let current = '';
      let inQuotes = false;
      for(let i=0; i<l.length; i++){
        if(l[i] === '"' && l[i+1] === '"') { current += '"'; i++; }
        else if(l[i] === '"') { inQuotes = !inQuotes; }
        else if(l[i] === ',' && !inQuotes) { v.push(current); current = ''; }
        else { current += l[i]; }
      }
      v.push(current);
      
      const dobStr = v[idx('DOB')] || '';
      let age = 0;
      if (dobStr) {
        const year = parseInt(dobStr.split('/')[2]);
        if (year) age = 2026 - year;
      }
      
      const caps = parseInt(v[idx('Caps')]) || 0;
      const goals = parseInt(v[idx('Goals')]) || 0;
      
      let rating = 6.0 + (caps * 0.015) + (goals * 0.03);
      if (rating > 9.8) rating = 9.8;
      
      return {
        name: v[idx('Player Name')] || v[idx('Name on Shirt')],
        team: v[idx('Team')],
        position: v[idx('Position')],
        age: age,
        rating: parseFloat(rating.toFixed(2)),
        goals: goals,
        assists: Math.floor(goals * 0.6), // mock assists based on goals
        minutes: caps * 60, // mock minutes based on caps
        xg: parseFloat((goals * 0.8).toFixed(2)),
        club: v[idx('Club')],
        caps: caps
      };
    }).filter(r => r.name && r.team);
  } catch(e) {
    console.error('CSV load error:', e.message);
    return [];
  }
})();
console.log(`Loaded ${CSV_PLAYERS.length} real WC 2026 players from CSV`);

// Merge CSV players into SQUADS so they show up everywhere in the API
CSV_PLAYERS.forEach(p => {
  if (!SQUADS[p.team]) SQUADS[p.team] = [];
  
  // Try to find if player already exists in the mock data to replace it, or push new
  const existingIdx = SQUADS[p.team].findIndex(ep => ep.name.toLowerCase() === p.name.toLowerCase());
  const playerObj = {
    name: p.name,
    jersey: SQUADS[p.team].length + 1, // mock jersey
    position: p.position === 'GK' ? 'Goalkeeper' : p.position === 'DF' ? 'Defender' : p.position === 'MF' ? 'Midfielder' : 'Forward',
    age: p.age,
    club: p.club,
    goals: p.goals,
    assists: p.assists,
    minutes: p.minutes,
    rating: p.rating,
    salary_m: 0,
    clean_sheets: 0,
    yellow_cards: 0,
    red_cards: 0,
    goals_per90: 0,
    assists_per90: 0
  };

  if (existingIdx >= 0) {
    SQUADS[p.team][existingIdx] = { ...SQUADS[p.team][existingIdx], ...playerObj };
  } else {
    SQUADS[p.team].push(playerObj);
  }
});

// Index fixtures by team for fast lookup
const teamFixtures = {};
FIXTURES.forEach(f => {
  [f.home, f.away].forEach(t => {
    if (!teamFixtures[t]) teamFixtures[t] = [];
    teamFixtures[t].push(f);
  });
});

// ── Groq key rotator ──────────────────────────────────────────
const GROQ_KEYS = ['fifa1','fifa2','fifa3','fifa4','fifa5']
  .map(k => process.env[k]).filter(Boolean);
let groqIdx = 0;
const nextKey = () => { const k = GROQ_KEYS[groqIdx]; groqIdx = (groqIdx+1)%GROQ_KEYS.length; return k; };

// ── True Live Tournament Engine ────────────────────────────────
function getMatchMinute(kickoffTime, nowStr) {
  const kickoff = new Date(kickoffTime);
  const now = new Date(nowStr);
  const diffMs = now - kickoff;
  if (diffMs < 0) return null; // Upcoming
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins >= 115) return 'FT'; // match over
  return diffMins; // live minute
}

function generateDynamicMatchStats(match, minute) {
  if (minute === null) {
    return { 
      is_played: false, status: 'upcoming', minute: null, 
      home_score: 0, away_score: 0, scorers: [], stats: null 
    };
  }

  // Consistent random seed based on match ID
  const hash = match.id.split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0);
  const rng = (seed) => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  
  // Power rankings (simple)
  const getPower = t => (ANALYTICS[t] ? ANALYTICS[t].overall_rating : 7.0);
  const homeAdv = getPower(match.home) * 1.1;
  const awayAdv = getPower(match.away);
  const total = homeAdv + awayAdv;
  const hProb = homeAdv / total;

  let hScore = 0; let aScore = 0;
  const scorers = [];
  
  // Distribute max goals over 90 mins
  const maxGoals = Math.floor(rng(hash) * 5); 
  const isFT = minute === 'FT';
  const currentMin = isFT ? 90 : minute;

  for (let g = 1; g <= maxGoals; g++) {
    const goalMin = Math.floor(rng(hash + g) * 90) + 1;
    if (goalMin <= currentMin) {
      const isHomeGoal = rng(hash + g * 2) < hProb;
      if (isHomeGoal) hScore++; else aScore++;
      scorers.push({
        team: isHomeGoal ? 'home' : 'away',
        name: isHomeGoal ? getFuzzySquadPlayer(match.home, 'Forward') : getFuzzySquadPlayer(match.away, 'Forward'),
        min: goalMin
      });
    }
  }

  scorers.sort((a,b) => a.min - b.min);

  return {
    is_played: isFT,
    status: isFT ? 'finished' : 'live',
    minute: isFT ? 'FT' : `${currentMin}'`,
    home_score: hScore,
    away_score: aScore,
    scorers: scorers,
    stats: {
      possession: isFT ? [50, 50] : [Math.round(hProb*100), Math.round((1-hProb)*100)],
      shots: [hScore * 3, aScore * 3],
      shotsOnTarget: [hScore + 2, aScore + 2]
    }
  };
}

function getTournamentState() {
  // Use actual server time
  const nowStr = new Date().toISOString();
  
  const liveFixtures = FIXTURES.map(f => {
    const min = getMatchMinute(f.kickoff, nowStr);
    const dynamicData = generateDynamicMatchStats(f, min);
    return { ...f, ...dynamicData };
  });

  // Calculate live group standings
  const liveGroups = {};
  liveFixtures.forEach(f => {
    if (f.stage !== 'group-stage') return;
    if (!liveGroups[f.group]) {
      const teamsInGroup = [...new Set(FIXTURES.filter(fix => fix.group === f.group).flatMap(fix => [fix.home, fix.away]))];
      liveGroups[f.group] = teamsInGroup.map(t => ({
        team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        flag: TEAM_MAP[t] ? TEAM_MAP[t].flag : ''
      }));
    }

    if (f.status === 'finished' || f.status === 'live') {
      const home = liveGroups[f.group].find(t => t.team === f.home);
      const away = liveGroups[f.group].find(t => t.team === f.away);
      
      home.gf += f.home_score;
      home.ga += f.away_score;
      away.gf += f.away_score;
      away.ga += f.home_score;
      
      if (f.status === 'finished') {
        home.p++; away.p++;
        if (f.home_score > f.away_score) { home.w++; home.pts += 3; away.l++; }
        else if (f.home_score < f.away_score) { away.w++; away.pts += 3; home.l++; }
        else { home.d++; away.d++; home.pts += 1; away.pts += 1; }
      }
    }
  });

  Object.values(liveGroups).forEach(group => {
    group.forEach(t => { t.gd = t.gf - t.ga; });
    group.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  });

  return { fixtures: liveFixtures, groups: liveGroups, playerStats: {} };
}

function getFuzzySquadPlayer(teamName, namePart) {
  const squad = SQUADS[teamName] || [];
  const clean = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchPart = clean(namePart);
  const found = squad.find(p => clean(p.name).includes(searchPart));
  return found ? found.name : namePart;
}

function getMatchStats(matchId, home, away, homeScore, awayScore) {
  let hash = 0;
  for (let i = 0; i < matchId.length; i++) {
    hash = matchId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const seedRandom = () => {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };

  const hRating = ANALYTICS[home]?.overall_rating || 7.0;
  const aRating = ANALYTICS[away]?.overall_rating || 7.0;

  // Possession
  let hPos = Math.round(50 + (hRating - aRating) * 4 + (seedRandom() - 0.5) * 10);
  hPos = Math.min(75, Math.max(25, hPos));
  const aPos = 100 - hPos;

  // Shots
  const hShots = Math.round(homeScore * 2 + 5 + seedRandom() * 8);
  const aShots = Math.round(awayScore * 2 + 4 + seedRandom() * 7);

  // Shots on Target
  const hSOT = Math.round(homeScore + seedRandom() * (hShots - homeScore));
  const aSOT = Math.round(awayScore + seedRandom() * (aShots - awayScore));

  // Passes
  const hPasses = Math.round(hPos * 8 + seedRandom() * 100);
  const aPasses = Math.round(aPos * 8 + seedRandom() * 100);

  // Pass Accuracy
  const hAcc = Math.round(70 + (hRating - 5) * 5 + seedRandom() * 10);
  const aAcc = Math.round(70 + (aRating - 5) * 5 + seedRandom() * 10);

  // Fouls
  const hFouls = Math.round(8 + seedRandom() * 10);
  const aFouls = Math.round(8 + seedRandom() * 10);

  // Yellow Cards
  const hYC = Math.round(seedRandom() * 3);
  const aYC = Math.round(seedRandom() * 3);

  // Red Cards
  const hRC = seedRandom() < 0.05 ? 1 : 0;
  const aRC = seedRandom() < 0.05 ? 1 : 0;

  return {
    possession: { home: hPos, away: aPos },
    shots: { home: hShots, away: aShots },
    shots_on_target: { home: Math.max(homeScore, hSOT), away: Math.max(awayScore, aSOT) },
    passes: { home: hPasses, away: aPasses },
    pass_accuracy: { home: Math.min(96, hAcc), away: Math.min(96, aAcc) },
    fouls: { home: hFouls, away: aFouls },
    yellow_cards: { home: hYC, away: aYC },
    red_cards: { home: hRC, away: aRC }
  };
}

// End of dynamic live engine

// ── ROUTES ────────────────────────────────────────────────────

// 1. All 48 teams list
app.get('/api/teams', (req, res) => {
  const teams = Object.entries(ANALYTICS).map(([name, a]) => ({
    name, group: a.group, iso2: a.iso2, fifa_code: a.fifa_code,
    flag: a.flag, overall_rating: a.overall_rating
  })).sort((a,b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  res.json({ teams });
});

// 2. All 12 groups with live standings
app.get('/api/groups', (req, res) => {
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { groups } = getTournamentState(simTime);
  res.json({ groups });
});

app.get('/api/match/:id/shotmap', async (req, res) => {
  try {
    // We use a real Sofascore Event ID for the live shotmap demonstration (as requested via screenshot)
    const sofascoreEventId = '14566662'; 
    const rapidApiKey = 'aadda7b2aemsh3a23637969a12b6p138d41jsne5411241ffe6';
    
    const response = await axios.get(`https://sofascore-sport-api.p.rapidapi.com/api/event/${sofascoreEventId}/shotmap`, {
      headers: {
        'x-rapidapi-host': 'sofascore-sport-api.p.rapidapi.com',
        'x-rapidapi-key': rapidApiKey
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('RapidAPI Shotmap Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch live shotmap' });
  }
});

// 3. Single team full profile
app.get('/api/team/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures: allFix, groups, playerStats } = getTournamentState(simTime);

  const analytics = ANALYTICS[name];
  if (!analytics) return res.status(404).json({ error: 'Team not found' });

  // Get dynamic rankings from standings
  const groupLetter = analytics.group;
  const groupTeams = groups[groupLetter] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;

  // Map squad players to their dynamic stats
  const squad = (SQUADS[name] || []).map(p => {
    const dynamicPlayer = playerStats[p.name] || {};
    return {
      ...p,
      goals: dynamicPlayer.goals !== undefined ? dynamicPlayer.goals : p.goals,
      assists: dynamicPlayer.assists !== undefined ? dynamicPlayer.assists : p.assists,
      rating: dynamicPlayer.rating !== undefined ? dynamicPlayer.rating : p.rating
    };
  });

  const fixtures = allFix.filter(f => f.home === name || f.away === name).map(f => ({
    ...f,
    side: f.home === name ? 'home' : 'away',
    team_score: f.home === name ? f.home_score : f.away_score,
    opp_score: f.home === name ? f.away_score : f.home_score,
    opponent: f.home === name ? f.away : f.home,
    result: f.is_played
      ? (f.home === name
          ? (f.home_score > f.away_score ? 'W' : f.home_score === f.away_score ? 'D' : 'L')
          : (f.away_score > f.home_score ? 'W' : f.away_score === f.home_score ? 'D' : 'L'))
      : null
  })).sort((a,b) => a.date.localeCompare(b.date));

  const played = fixtures.filter(f => f.is_played);
  const upcoming = fixtures.filter(f => !f.is_played);
  const w = played.filter(f=>f.result==='W').length;
  const d = played.filter(f=>f.result==='D').length;
  const l = played.filter(f=>f.result==='L').length;

  const metrics = { offense: analytics.offense, defense: analytics.defense,
    passing: analytics.passing, possession: analytics.possession, creativity: analytics.creativity };
  const sorted = Object.entries(metrics).sort((a,b)=>b[1]-a[1]);
  const strengths = sorted.slice(0,2).map(([k,v])=>({ metric: k, value: v }));
  const weaknesses = sorted.slice(-2).reverse().map(([k,v])=>({ metric: k, value: v }));

  res.json({ name, analytics: { ...analytics, group_rank: groupRank }, squad, played, upcoming, w, d, l, strengths, weaknesses });
});

// 4. All fixtures (with optional date filter)
app.get('/api/fixtures', (req, res) => {
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures } = getTournamentState(simTime);
  let list = fixtures;
  
  if (req.query.date) list = list.filter(f => f.date === req.query.date);
  if (req.query.stage) list = list.filter(f => f.stage === req.query.stage);
  if (req.query.played !== undefined) {
    const played = req.query.played === 'true';
    list = list.filter(f => f.is_played === played);
  }
  res.json({ fixtures: list });
});

// 5. Top performers (dynamic)
app.get('/api/performers', (req, res) => {
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { performers } = getTournamentState(simTime);
  res.json(performers);
});

// 6. ML Predictions — Monte Carlo sim
app.get('/api/predict/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { groups } = getTournamentState(simTime);
  
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const power = (a.offense*0.3 + a.defense*0.25 + a.passing*0.2 + a.possession*0.15 + a.creativity*0.1) / 100;
  
  const groupTeams = groups[a.group] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2;

  const r32  = qualifies ? Math.min(97, Math.round(power * 95 + 5)) : Math.round(power * 45);
  const r16  = Math.min(r32-2, Math.round(r32 * (0.45 + power * 0.35)));
  const qf   = Math.min(r16-2, Math.round(r16 * (0.40 + power * 0.30)));
  const sf   = Math.min(qf-2,  Math.round(qf  * (0.38 + power * 0.28)));
  const fin  = Math.min(sf-2,  Math.round(sf  * (0.35 + power * 0.25)));
  const champ= Math.min(fin-2, Math.round(fin  * (0.30 + power * 0.22)));

  res.json({
    team: name, group_rank: groupRank, qualifies,
    power: Math.round(power * 100),
    group: a.group,
    stages: {
      'Round of 32': Math.max(0, r32),
      'Round of 16': Math.max(0, r16),
      'Quarter Final': Math.max(0, qf),
      'Semi Final': Math.max(0, sf),
      'Final': Math.max(0, fin),
      'Champion': Math.max(0, champ)
    }
  });
});

// 7. Journey Simulator (BFS Full Knockout Bracket Simulator)
app.get('/api/journey/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures: allFix, groups } = getTournamentState(simTime);
  
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const groupTeams = groups[a.group] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2 || (() => {
    const thirds = [];
    Object.entries(groups).forEach(([g, tList]) => {
      if (tList[2]) thirds.push({ team: tList[2].team, pts: tList[2].pts, gd: tList[2].gd, gf: tList[2].gf });
    });
    thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
    const bestThirds = thirds.slice(0, 8).map(t => t.team);
    return bestThirds.includes(name);
  })();

  // 1. Group stage matches for selected team
  const groupMatches = [];
  const gFixtures = allFix.filter(f =>
    f.stage === 'group-stage' && (f.home === name || f.away === name)
  );
  gFixtures.forEach(f => {
    const isHome = f.home === name;
    const ts = isHome ? f.home_score : f.away_score;
    const os = isHome ? f.away_score : f.home_score;
    groupMatches.push({
      id: f.id,
      date: f.date, opponent: isHome ? f.away : f.home,
      team_score: ts, opp_score: os,
      result: f.is_played ? (ts > os ? 'W' : ts === os ? 'D' : 'L') : null,
      is_played: f.is_played,
      status: f.status
    });
  });

  // 2. Identify all 32 qualified teams
  const groupWinners = {};
  const groupRunners = {};
  const allThirds = [];

  Object.entries(groups).forEach(([g, teamsList]) => {
    if (teamsList[0]) groupWinners[g] = teamsList[0].team;
    if (teamsList[1]) groupRunners[g] = teamsList[1].team;
    if (teamsList[2]) {
      allThirds.push({
        team: teamsList[2].team,
        pts: teamsList[2].pts,
        gd: teamsList[2].gd,
        gf: teamsList[2].gf,
        group: g
      });
    }
  });

  allThirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
  const bestThirds = allThirds.slice(0, 8).map(t => t.team);

  // 3. Define Round of 32 match schedules
  const r32Schedules = [
    { id: 'R32_01', date: 'June 29', stadium: 'Gillette Stadium', city: 'Foxborough', home: groupWinners['A'], away: bestThirds[0] },
    { id: 'R32_02', date: 'June 30', stadium: 'MetLife Stadium', city: 'E Rutherford', home: groupRunners['B'], away: groupRunners['F'] },
    { id: 'R32_03', date: 'June 28', stadium: 'SoFi Stadium', city: 'Inglewood', home: groupWinners['C'], away: bestThirds[1] },
    { id: 'R32_04', date: 'June 29', stadium: 'Estadio BBVA', city: 'Guadalupe', home: groupRunners['D'], away: groupRunners['H'] },
    { id: 'R32_05', date: 'July 2', stadium: 'BMO Field', city: 'Toronto', home: groupWinners['E'], away: bestThirds[2] },
    { id: 'R32_06', date: 'July 2', stadium: 'SoFi Stadium', city: 'Inglewood', home: groupRunners['J'], away: groupRunners['A'] },
    { id: 'R32_07', date: 'July 1', stadium: 'Levi\'s Stadium', city: 'Santa Clara', home: groupWinners['G'], away: bestThirds[3] },
    { id: 'R32_08', date: 'July 1', stadium: 'Lumen Field', city: 'Seattle', home: groupRunners['L'], away: groupRunners['C'] },
    { id: 'R32_09', date: 'June 29', stadium: 'NRG Stadium', city: 'Houston', home: groupWinners['I'], away: bestThirds[4] },
    { id: 'R32_10', date: 'June 30', stadium: 'AT&T Stadium', city: 'Arlington', home: groupWinners['K'], away: bestThirds[5] },
    { id: 'R32_11', date: 'June 30', stadium: 'Estadio Azteca', city: 'Mexico City', home: groupRunners['E'], away: groupRunners['I'] },
    { id: 'R32_12', date: 'July 1', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: groupWinners['B'], away: bestThirds[6] },
    { id: 'R32_13', date: 'July 3', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: groupRunners['G'], away: groupRunners['K'] },
    { id: 'R32_14', date: 'July 3', stadium: 'AT&T Stadium', city: 'Arlington', home: groupWinners['D'], away: bestThirds[7] },
    { id: 'R32_15', date: 'July 2', stadium: 'BC Place', city: 'Vancouver', home: groupWinners['H'], away: groupWinners['F'] },
    { id: 'R32_16', date: 'July 3', stadium: 'Arrowhead Stadium', city: 'Kansas City', home: groupWinners['J'], away: groupWinners['L'] }
  ];

  const isTeamInR32 = r32Schedules.some(m => m.home === name || m.away === name);
  if (qualifies && !isTeamInR32) {
    for (let i = 0; i < r32Schedules.length; i++) {
      if (r32Schedules[i].home !== name && r32Schedules[i].away !== name) {
        r32Schedules[i].home = name;
        break;
      }
    }
  }

  const simKnockout = (home, away, matchId, stage, date, stadium, city) => {
    if (!home || !away || home === 'TBD' || away === 'TBD') {
      return { id: matchId, stage, date, stadium, city, home: home || 'TBD', away: away || 'TBD', home_score: null, away_score: null, winner: null, prob: 50 };
    }
    const ha = ANALYTICS[home] || { offense:50, defense:50, passing:70, possession:50, creativity:50, overall_rating: 6.5 };
    const aa = ANALYTICS[away] || { offense:50, defense:50, passing:70, possession:50, creativity:50, overall_rating: 6.5 };
    
    const hPow = (ha.offense*0.3 + ha.defense*0.25 + ha.passing*0.2 + ha.possession*0.15 + ha.creativity*0.1);
    const aPow = (aa.offense*0.3 + aa.defense*0.25 + aa.passing*0.2 + aa.possession*0.15 + aa.creativity*0.1);
    const winProb = hPow / (hPow + aPow);

    let hash = 0;
    const key = `${matchId}_${home}_${away}_${simTime.split('T')[0]}`;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    const seedRandom = () => {
      const x = Math.sin(hash++) * 10000;
      return x - Math.floor(x);
    };

    const isHomeWin = seedRandom() < winProb;
    let homeScore = isHomeWin ? Math.floor(seedRandom()*3)+1 : Math.floor(seedRandom()*2);
    let awayScore = isHomeWin ? Math.floor(seedRandom()*2) : Math.floor(seedRandom()*3)+1;
    
    if (homeScore === awayScore) {
      if (seedRandom() < 0.5) homeScore += 1;
      else awayScore += 1;
    }
    
    const winner = homeScore > awayScore ? home : away;
    return {
      id: matchId, stage, date, stadium, city,
      home, away,
      home_score: homeScore, away_score: awayScore,
      winner, prob: Math.round(winProb * 100)
    };
  };

  const r32Results = r32Schedules.map(m => simKnockout(m.home, m.away, m.id, 'Round of 32', m.date, m.stadium, m.city));

  const r16Schedules = [
    { id: 'R16_01', date: 'July 4', stadium: 'Lincoln Financial Field', city: 'Philadelphia', home: r32Results[0].winner, away: r32Results[1].winner },
    { id: 'R16_02', date: 'July 4', stadium: 'NRG Stadium', city: 'Houston', home: r32Results[2].winner, away: r32Results[3].winner },
    { id: 'R16_03', date: 'July 6', stadium: 'AT&T Stadium', city: 'Arlington', home: r32Results[4].winner, away: r32Results[5].winner },
    { id: 'R16_04', date: 'July 6', stadium: 'Lumen Field', city: 'Seattle', home: r32Results[6].winner, away: r32Results[7].winner },
    { id: 'R16_05', date: 'July 5', stadium: 'MetLife Stadium', city: 'E Rutherford', home: r32Results[8].winner, away: r32Results[9].winner },
    { id: 'R16_06', date: 'July 5', stadium: 'Estadio Azteca', city: 'Mexico City', home: r32Results[10].winner, away: r32Results[11].winner },
    { id: 'R16_07', date: 'July 7', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: r32Results[12].winner, away: r32Results[13].winner },
    { id: 'R16_08', date: 'July 7', stadium: 'BC Place', city: 'Vancouver', home: r32Results[14].winner, away: r32Results[15].winner }
  ];
  const r16Results = r16Schedules.map(m => simKnockout(m.home, m.away, m.id, 'Round of 16', m.date, m.stadium, m.city));

  const qfSchedules = [
    { id: 'QF_01', date: 'July 9', stadium: 'Gillette Stadium', city: 'Foxborough', home: r16Results[0].winner, away: r16Results[1].winner },
    { id: 'QF_02', date: 'July 10', stadium: 'SoFi Stadium', city: 'Inglewood', home: r16Results[2].winner, away: r16Results[3].winner },
    { id: 'QF_03', date: 'July 11', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: r16Results[4].winner, away: r16Results[5].winner },
    { id: 'QF_04', date: 'July 11', stadium: 'Arrowhead Stadium', city: 'Kansas City', home: r16Results[6].winner, away: r16Results[7].winner }
  ];
  const qfResults = qfSchedules.map(m => simKnockout(m.home, m.away, m.id, 'Quarter Final', m.date, m.stadium, m.city));

  const sfSchedules = [
    { id: 'SF_01', date: 'July 14', stadium: 'AT&T Stadium', city: 'Arlington', home: qfResults[0].winner, away: qfResults[1].winner },
    { id: 'SF_02', date: 'July 15', stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', home: qfResults[2].winner, away: qfResults[3].winner }
  ];
  const sfResults = sfSchedules.map(m => simKnockout(m.home, m.away, m.id, 'Semi Final', m.date, m.stadium, m.city));

  const thirdPlaceSchedule = { id: 'TP_01', date: 'July 18', stadium: 'Hard Rock Stadium', city: 'Miami Gardens', home: sfResults[0].winner === sfResults[0].home ? sfResults[0].away : sfResults[0].home, away: sfResults[1].winner === sfResults[1].home ? sfResults[1].away : sfResults[1].home };
  const thirdPlaceResult = simKnockout(thirdPlaceSchedule.home, thirdPlaceSchedule.away, thirdPlaceSchedule.id, '3rd Place Match', thirdPlaceSchedule.date, thirdPlaceSchedule.stadium, thirdPlaceSchedule.city);

  const finalSchedule = { id: 'FIN_01', date: 'July 19', stadium: 'MetLife Stadium', city: 'E Rutherford', home: sfResults[0].winner, away: sfResults[1].winner };
  const finalResult = simKnockout(finalSchedule.home, finalSchedule.away, finalSchedule.id, 'World Cup Final', finalSchedule.date, finalSchedule.stadium, finalSchedule.city);

  const ko = {};
  const findMatchForTeam = (results) => results.find(m => m.home === name || m.away === name);

  const myR32 = findMatchForTeam(r32Results);
  if (myR32) {
    ko.r32 = { opponent: myR32.home === name ? myR32.away : myR32.home, win: myR32.winner === name, score: `${myR32.home_score}-${myR32.away_score}`, prob: myR32.home === name ? myR32.prob : 100 - myR32.prob };
    
    if (ko.r32.win) {
      const myR16 = findMatchForTeam(r16Results);
      if (myR16) {
        ko.r16 = { opponent: myR16.home === name ? myR16.away : myR16.home, win: myR16.winner === name, score: `${myR16.home_score}-${myR16.away_score}`, prob: myR16.home === name ? myR16.prob : 100 - myR16.prob };
        
        if (ko.r16.win) {
          const myQF = findMatchForTeam(qfResults);
          if (myQF) {
            ko.qf = { opponent: myQF.home === name ? myQF.away : myQF.home, win: myQF.winner === name, score: `${myQF.home_score}-${myQF.away_score}`, prob: myQF.home === name ? myQF.prob : 100 - myQF.prob };
            
            if (ko.qf.win) {
              const mySF = findMatchForTeam(sfResults);
              if (mySF) {
                ko.sf = { opponent: mySF.home === name ? mySF.away : mySF.home, win: mySF.winner === name, score: `${mySF.home_score}-${mySF.away_score}`, prob: mySF.home === name ? mySF.prob : 100 - mySF.prob };
                
                if (ko.sf.win) {
                  ko.fin = { opponent: finalResult.home === name ? finalResult.away : finalResult.home, win: finalResult.winner === name, score: `${finalResult.home_score}-${finalResult.away_score}`, prob: finalResult.home === name ? finalResult.prob : 100 - finalResult.prob };
                } else {
                  ko.fin = { opponent: thirdPlaceResult.home === name ? thirdPlaceResult.away : thirdPlaceResult.home, win: thirdPlaceResult.winner === name, score: `${thirdPlaceResult.home_score}-${thirdPlaceResult.away_score}`, prob: thirdPlaceResult.home === name ? thirdPlaceResult.prob : 100 - thirdPlaceResult.prob, is_third_place: true };
                }
              }
            }
          }
        }
      }
    }
  }

  res.json({
    team: name, group: a.group, group_rank: groupRank, qualifies,
    group_standings: groupTeams,
    group_matches: groupMatches,
    full_bracket: {
      r32: r32Results,
      r16: r16Results,
      qf: qfResults,
      sf: sfResults,
      final: finalResult,
      third_place: thirdPlaceResult
    },
    knockout: {
      r32: ko.r32 || null,
      r16: ko.r16 || null,
      qf: ko.qf || null,
      sf: ko.sf || null,
      fin: ko.fin || null,
      champion: finalResult.winner
    }
  });
});

// 8. AI Inference (Groq)
app.post('/api/ai/analyze', async (req, res) => {
  const { player, opponent } = req.body;
  if (!player || !opponent) return res.status(400).json({ error: 'player and opponent required' });

  let playerData = null;
  for (const [team, squad] of Object.entries(SQUADS)) {
    const found = squad.find(p => p.name.toLowerCase().includes(player.toLowerCase()));
    if (found) { playerData = { ...found, team }; break; }
  }

  const oppAnalytics = ANALYTICS[opponent] || {};
  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const prompt = `You are a world-class football analyst covering FIFA World Cup 2026.

PLAYER: ${player}${playerData ? `
- Team: ${playerData.team} | Position: ${playerData.position} | Age: ${playerData.age}
- Club: ${playerData.club} | Market Value: €${playerData.value_m}M
- Tournament: ${playerData.goals} goals, ${playerData.assists} assists, ${playerData.minutes} mins, Rating: ${playerData.rating}` : ''}

OPPONENT: ${opponent}${oppAnalytics.overall_rating ? `
- Avg Rating: ${oppAnalytics.overall_rating} | Group: ${oppAnalytics.group}
- Offense: ${oppAnalytics.offense}/100 | Defense: ${oppAnalytics.defense}/100
- Passing: ${oppAnalytics.passing}% | Creativity: ${oppAnalytics.creativity}/100` : ''}

Write a 300-word expert matchup analysis covering:
**1. Player Form & Style** — current tournament performance
**2. Tactical Matchup** — how does this player exploit or struggle against this opponent?
**3. Key Stats to Watch** — expected goals, dribbles, passes, defensive actions
**4. Prediction** — will they have a standout performance? Specific goal/assist prediction.

Be specific, use the data provided, and sound like a Sky Sports analyst.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.75 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ analysis: r.data.choices[0].message.content, player_data: playerData });
  } catch (e) {
    console.error('Groq error:', e.response?.data || e.message);
    res.status(522).json({ error: 'AI inference failed. Groq API error.', detail: e.message });
  }
});

// 9. Auction Pool — top 5 players per sub-position from real WC 2026 CSV data
app.get('/api/auction/pool', (req, res) => {
  // Position buckets: GK, LB, LCB, RCB, RB, CDM, CM, CAM, LW, RW, ST
  const posMapping = {
    GK: p => p.position === 'Goalkeeper',
    LCB: p => p.position === 'Defender',
    RCB: p => p.position === 'Defender',
    LB: p => p.position === 'Defender',
    RB: p => p.position === 'Defender',
    CDM: p => p.position === 'Midfielder',
    CM: p => p.position === 'Midfielder',
    CAM: p => p.position === 'Midfielder',
    LW: p => p.position === 'Forward',
    RW: p => p.position === 'Forward',
    ST: p => p.position === 'Forward',
  };

  // Get real players with rating >= 6.8 who actually played
  const realPlayers = CSV_PLAYERS.filter(p => p.rating >= 6.8 && p.minutes > 0);
  
  const pool = [];
  const used = new Set();

  // Build GKs from top 5 GKs in CSV
  const gks = realPlayers.filter(p => p.position === 'Goalkeeper').sort((a,b) => b.rating - a.rating);
  gks.slice(0, 5).forEach((p, i) => {
    if (!used.has(p.name)) {
      used.add(p.name);
      pool.push({ ...p, position: 'GK', tier: p.rating >= 8.0 ? 'Elite' : p.rating >= 7.5 ? 'Star' : 'Good', base_cp: 1, max_expected_cp: Math.max(1, Math.round((p.rating - 6.0) * 12)) });
    }
  });

  // Build defenders: 5 per sub-position but share the defender pool
  const defenders = realPlayers.filter(p => p.position === 'Defender').sort((a,b) => b.rating - a.rating);
  const defSlots = ['LCB', 'RCB', 'LB', 'RB'];
  const defPerSlot = 5;
  let defIdx = 0;
  defenders.forEach(p => {
    if (used.has(p.name)) return;
    const slot = defSlots[defIdx % defSlots.length];
    if (pool.filter(x => x.position === slot).length < defPerSlot) {
      used.add(p.name);
      defIdx++;
      pool.push({ ...p, position: slot, tier: p.rating >= 8.0 ? 'Elite' : p.rating >= 7.5 ? 'Star' : 'Good', base_cp: 1, max_expected_cp: Math.max(1, Math.round((p.rating - 6.0) * 12)) });
    }
  });

  // Build midfielders: CDM, CM, CAM
  const mids = realPlayers.filter(p => p.position === 'Midfielder').sort((a,b) => b.rating - a.rating);
  const midSlots = ['CDM', 'CM', 'CAM'];
  let midIdx = 0;
  mids.forEach(p => {
    if (used.has(p.name)) return;
    const slot = midSlots[midIdx % midSlots.length];
    if (pool.filter(x => x.position === slot).length < 5) {
      used.add(p.name);
      midIdx++;
      pool.push({ ...p, position: slot, tier: p.rating >= 8.0 ? 'Elite' : p.rating >= 7.5 ? 'Star' : 'Good', base_cp: 1, max_expected_cp: Math.max(1, Math.round((p.rating - 6.0) * 12)) });
    }
  });

  // Build forwards: LW, RW, ST
  const fwds = realPlayers.filter(p => p.position === 'Forward').sort((a,b) => b.rating - a.rating);
  const fwdSlots = ['ST', 'LW', 'RW'];
  let fwdIdx = 0;
  fwds.forEach(p => {
    if (used.has(p.name)) return;
    const slot = fwdSlots[fwdIdx % fwdSlots.length];
    if (pool.filter(x => x.position === slot).length < 5) {
      used.add(p.name);
      fwdIdx++;
      pool.push({ ...p, position: slot, tier: p.rating >= 8.0 ? 'Elite' : p.rating >= 7.5 ? 'Star' : 'Good', base_cp: 1, max_expected_cp: Math.max(1, Math.round((p.rating - 6.0) * 12)) });
    }
  });

  // Shuffle pool
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  res.json({ players: pool, total: pool.length });
});

// 10. Match simulation
app.post('/api/auction/simulate', (req, res) => {
  const { userSquad, aiSquad } = req.body;
  if (!userSquad?.length || !aiSquad?.length) return res.status(400).json({ error: 'Both squads required' });

  const avgRating = squad => squad.reduce((s,p) => s + (p.rating||6.5), 0) / squad.length;
  const uPow = avgRating(userSquad), aiPow = avgRating(aiSquad);
  const uWinProb = uPow / (uPow + aiPow);

  const forwards = s => s.filter(p => p.position === 'Forward' || p.position === 'Midfielder');
  const gk = s => s.find(p => p.position === 'Goalkeeper') || s[0];

  let uGoals = 0, aGoals = 0;
  const events = [];

  for (let min = 1; min <= 90; min++) {
    if (Math.random() > 0.10) continue;
    const isUser = Math.random() < uWinProb;
    const rand = Math.random();
    if (rand < 0.40) {
      if (isUser) {
        uGoals++;
        const scorer = forwards(userSquad)[Math.floor(Math.random()*forwards(userSquad).length)] || userSquad[0];
        events.push({ min, type: 'GOAL', team: 'user', desc: `⚽ GOAL! ${scorer.name} fires it in!`, score: `${uGoals}-${aGoals}` });
      } else {
        aGoals++;
        const scorer = forwards(aiSquad)[Math.floor(Math.random()*forwards(aiSquad).length)] || aiSquad[0];
        events.push({ min, type: 'GOAL', team: 'ai', desc: `⚽ GOAL! ${scorer.name} scores for AI!`, score: `${uGoals}-${aGoals}` });
      }
    } else if (rand < 0.70) {
      const g = isUser ? gk(aiSquad) : gk(userSquad);
      events.push({ min, type: 'SAVE', team: isUser ? 'ai' : 'user', desc: `🧤 ${g.name} saves brilliantly!`, score: `${uGoals}-${aGoals}` });
    } else {
      const tm = isUser ? userSquad : aiSquad;
      const player = tm[Math.floor(Math.random()*tm.length)];
      events.push({ min, type: 'CARD', team: isUser ? 'user' : 'ai', desc: `🟨 ${player.name} booked!`, score: `${uGoals}-${aGoals}` });
    }
  }
  events.push({ min: 90, type: 'FT', team: 'both', desc: `🏁 Full Time! ${uGoals}-${aGoals}`, score: `${uGoals}-${aGoals}` });

  res.json({ userGoals: uGoals, aiGoals: aGoals, userPower: uPow.toFixed(2), aiPower: aiPow.toFixed(2), events });
});

// 11. Match Details Center (New Endpoint)
app.get('/api/match/:id', async (req, res) => {
  const matchId = req.params.id;
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures } = getTournamentState(simTime);

  const match = fixtures.find(f => f.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Generate stats dynamically
  const stats = getMatchStats(match.id, match.home, match.away, match.home_score, match.away_score);
  
  const hAnalytics = ANALYTICS[match.home] || {};
  const aAnalytics = ANALYTICS[match.away] || {};

  const key = nextKey();
  let aiAnalysis = `A tactical battle between ${match.home} and ${match.away}. Expect a highly competitive match!`;

  if (key) {
    try {
      const prompt = `You are a world-class football pundit and tactical analyst.
Match: ${match.home} vs ${match.away}
- ${match.home} (FIFA Overall: ${hAnalytics.overall_rating}/10, Offense: ${hAnalytics.offense}/100, Defense: ${hAnalytics.defense}/100, Passing: ${hAnalytics.passing}%, Creativity: ${hAnalytics.creativity}/100)
- ${match.away} (FIFA Overall: ${aAnalytics.overall_rating}/10, Offense: ${aAnalytics.offense}/100, Defense: ${aAnalytics.defense}/100, Passing: ${aAnalytics.passing}%, Creativity: ${aAnalytics.creativity}/100)

Provide a premium H2H tactical overview under 120 words.
Structure clearly with bold headers:
**H2H Playstyles**: Compare their main styles.
**Key Factor**: Mention the deciding factor (e.g. low block counter vs high press).
**Verdict**: Predict a specific scoreline and state why.`;

      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 250,
          temperature: 0.7
        },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 3500 }
      );
      aiAnalysis = r.data.choices[0].message.content.trim();
    } catch (err) {
      console.error('Match H2H Groq error:', err.message);
    }
  }

  res.json({ match, stats, ai_analysis: aiAnalysis, home_analytics: hAnalytics, away_analytics: aAnalytics });
});

// 12. AI Live Commentary (New Endpoint)
app.post('/api/ai/live-commentary', async (req, res) => {
  const { matchId, home, away, score, scorers, minute, stats } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const prompt = `You are a live football commentator reporting on a FIFA World Cup 2026 match (hosted in USA, Canada, and Mexico). DO NOT reference the 2022 World Cup or past events. Act as if it is the year 2026.
Match: ${home} vs ${away}
Current Minute: ${minute}'
Current Score: ${home} ${score} ${away}
Scorers: ${scorers && scorers.length ? scorers.map(s => `${s.name} (${s.min}')`).join(', ') : 'None'}
Stats: Possession ${stats?.possession?.home}% - ${stats?.possession?.away}%, Shots ${stats?.shots?.home} - ${stats?.shots?.away}

Write a short, engaging, 1-2 sentence live commentary event for the current minute (${minute}') of this match.
It should feel like a real-time text commentary update (e.g. BBC Sport or Sky Sports live text).
Be dramatic, describe a specific action (e.g., a near miss, a foul, a goal, a key pass), and mention player names from the scorers list or realistic generic descriptions.
Keep it strictly to 1 or 2 sentences max. Do not output anything other than the commentary text.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.8 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ commentary: r.data.choices[0].message.content.trim() });
  } catch (e) {
    console.error('Groq live-commentary error:', e.response?.data || e.message);
    res.json({ commentary: `Action heating up in the midfield as both teams fight for possession in the ${minute}' minute!` });
  }
});

// 12b. AI Assistant Chatbot (New Endpoint)
app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  // Generate a context of overall ratings for all teams for Llama 3
  const contextList = Object.entries(ANALYTICS).map(([team, data]) => {
    return `${team} (Rating: ${data.overall_rating}/10, Group: ${data.group}, Top Player: ${data.top_player})`;
  }).join(', ');

const systemMessage = `You are a world-class football analyst, tactician, and prediction expert covering the FIFA World Cup 2026, which is hosted across the USA, Canada, and Mexico.
CRITICAL: You are operating in the year 2026. Do NOT reference results, rosters, or events from the 2022 World Cup in Qatar as if they are current. Focus solely on the projected 2026 landscape.

Here is the context of all 48 participating teams, their overall ratings, groups, and top players:
${contextList}

Key Tactical Insights & Facts:
- Major Favorites (Overall 8.5+): Portugal (POR), France (FRA), Spain (ESP), Argentina (ARG), Germany (GER), and England (ENG). They boast elite squad depth, tactical flexibility, and superstars (Kylian Mbappé, Rodri, Lamine Yamal, Cristiano Ronaldo, Jamal Musiala, Jude Bellingham).
- Dark Horses (Overall 7.2 - 8.2): Morocco (defensive transition speed), Uruguay (relentless high pressing under Bielsa), Croatia (midfield control), USA (young, athletic wingers), Senegal (physical strength).
- Underdogs (Overall 5.0 - 6.8): Uzbekistan (UZB), Qatar (QAT), Haiti (HAI), South Africa (RSA). Specifically, Uzbekistan is renowned for its incredible defensive discipline, running a tight 5-4-1 low block and using quick direct counter-attacks, making them a very stubborn and dangerous opponent despite their low overall rating.
- Official Matchball (FIFA 2026 Golden Glory): Uses a aerodynamic textured surface for stable drag, high speed spin stability, and true flight paths. It speeds up passing plays.

Provide precise, analytical answers. Write in the style of a premium Sky Sports football pundit. Make your response highly detailed yet engaging and professional. Limit your response to 150-220 words.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: message }
        ],
        max_tokens: 300,
        temperature: 0.7
      },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ response: r.data.choices[0].message.content.trim() });
  } catch (e) {
    console.error('Groq chat error:', e.response?.data || e.message);
    res.json({ response: "I'm analyzing the tactical transitions on the pitch right now, but it looks like my feed is temporarily lagging. Portugal, Spain, and France are still heavy favorites due to their squad depth!" });
  }
});

// 12.5 AI-powered Live Match Stats
app.get('/api/live-stats-ai/:matchId', async (req, res) => {
  const matchId = req.params.matchId;
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures } = getTournamentState(simTime);
  const match = fixtures.find(f => f.id === matchId);
  
  if (!match) return res.status(404).json({ error: 'Match not found' });
  
  // Get deterministic numerical stats
  const stats = getMatchStats(matchId, match.home, match.away, match.home_score, match.away_score);
  
  // Build prompt for LLM
  const key = nextKey();
  if (!key) {
    return res.json({ stats, narrative: "AI offline.", commentary: ["Match is underway."] });
  }

  const prompt = `You are a real-time football data API. Generate a JSON response for the match ${match.home} vs ${match.away} in the FIFA World Cup 2026 (Hosted in USA/Canada/Mexico). DO NOT mention the 2022 World Cup. Operate strictly in the year 2026.
Current status: ${match.status} (Minute: ${match.minute || 'FT'}). Score: ${match.home} ${match.home_score} - ${match.away_score} ${match.away}.
Stats: Possession ${stats.possession.home}%-${stats.possession.away}%, Shots ${stats.shots.home}-${stats.shots.away}.

Respond EXACTLY in this JSON format, nothing else:
{
  "narrative": "A 2-sentence tactical summary of the match flow so far.",
  "commentary": [
    "Minute' - Action description (e.g. 73' - De Bruyne threads a perfect pass...)"
  ]
}
Include exactly 3 recent commentary events.`;

  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    
    let aiData;
    try {
      aiData = JSON.parse(r.data.choices[0].message.content);
    } catch(e) {
      aiData = { narrative: "A closely fought tactical battle.", commentary: ["Match ongoing..."] };
    }
    
    res.json({ match, stats, ...aiData });
  } catch (e) {
    console.error('Groq live-stats error:', e.message);
    res.json({ match, stats, narrative: "A highly intense match.", commentary: ["Waiting for live feed..."] });
  }
});

// 13. Sofascore proxy live scores (Fallback preserved)
app.get('/api/live', async (req, res) => {
  const key = process.env.rapidapi;
  if (key) {
    try {
      const r = await axios.get('https://sofascore.p.rapidapi.com/matches/get-live-events',
        { headers: { 'x-rapidapi-host': 'sofascore.p.rapidapi.com', 'x-rapidapi-key': key },
          params: { sport: 'football' }, timeout: 4000 });
      return res.json({ source: 'sofascore', events: r.data.events || [] });
    } catch {}
  }
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures } = getTournamentState(simTime);
  const todayMatches = fixtures.filter(f => f.date === simTime.split('T')[0]);
  res.json({ source: 'dataset', events: todayMatches.map(f => ({
    id: f.id, status: f.status === 'finished' ? 'finished' : f.status === 'live' ? 'inprogress' : 'scheduled',
    home: { name: f.home, flag: ANALYTICS[f.home]?.flag },
    away: { name: f.away, flag: ANALYTICS[f.away]?.flag },
    score: { home: f.home_score, away: f.away_score },
    stage: f.stage, stadium: f.stadium, city: f.city,
    scorers: f.scorers, minute: f.minute
  })) });
});

// 14. Player compare
app.get('/api/compare', (req, res) => {
  const { p1, p2 } = req.query;
  const find = name => {
    for (const [team, squad] of Object.entries(SQUADS)) {
      const p = squad.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
      if (p) return { ...p, team };
    }
    return null;
  };
  const player1 = find(p1), player2 = find(p2);
  if (!player1 || !player2) return res.status(404).json({ error: 'One or both players not found' });
  res.json({ player1, player2 });
});

// 15. Real Live Football Feed proxy (API-Football)
let realLiveCache = {
  dateStr: '',
  fetchedAt: 0,
  data: null
};

const getTodayISTString = () => {
  const d = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

function getDemoRealMatches() {
  return [
    {
      id: 1, league: 'European Championship', country: 'Europe',
      logo: 'https://media.api-sports.io/football/leagues/4.png',
      home: 'Germany', home_logo: 'https://media.api-sports.io/football/teams/25.png',
      away: 'Scotland', away_logo: 'https://media.api-sports.io/football/teams/32.png',
      score: { home: 5, away: 1 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 2, league: 'Copa America', country: 'South America',
      logo: 'https://media.api-sports.io/football/leagues/9.png',
      home: 'Argentina', home_logo: 'https://media.api-sports.io/football/teams/26.png',
      away: 'Canada', away_logo: 'https://media.api-sports.io/football/teams/30.png',
      score: { home: 2, away: 0 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 3, league: 'European Championship', country: 'Europe',
      logo: 'https://media.api-sports.io/football/leagues/4.png',
      home: 'Spain', home_logo: 'https://media.api-sports.io/football/teams/9.png',
      away: 'Croatia', away_logo: 'https://media.api-sports.io/football/teams/3.png',
      score: { home: 3, away: 0 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    },
    {
      id: 4, league: 'Major League Soccer', country: 'USA',
      logo: 'https://media.api-sports.io/football/leagues/253.png',
      home: 'Inter Miami', home_logo: 'https://media.api-sports.io/football/teams/1605.png',
      away: 'Columbus Crew', away_logo: 'https://media.api-sports.io/football/teams/1612.png',
      score: { home: 2, away: 1 }, status: 'FT', time: 90,
      kickoff: new Date().toISOString()
    }
  ];
}

app.get('/api/real-live', async (req, res) => {
  const key = process.env.fapi;
  const todayStr = getTodayISTString();
  const now = Date.now();

  // If cache is valid (fetched today, and is less than 1 hour old)
  if (realLiveCache.data && realLiveCache.dateStr === todayStr && (now - realLiveCache.fetchedAt < 60 * 60 * 1000)) {
    return res.json({ source: 'cache', refreshedAt: new Date(realLiveCache.fetchedAt).toISOString(), fixtures: realLiveCache.data });
  }

  if (!key || key.trim() === '' || key === 'a16312a1b9f2d53f5a3979a527f0f3d7') {
    // Return fallback demo data if fapi key is not configured or is a placeholder
    const demoMatches = getDemoRealMatches();
    return res.json({ source: 'demo', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
  }

  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      headers: {
        'x-apisports-key': key
      },
      params: {
        date: todayStr
      },
      timeout: 5000
    });

    const list = response.data?.response || [];
    if (list.length > 0) {
      const formatted = list.map(item => ({
        id: item.fixture.id,
        league: item.league.name,
        country: item.league.country,
        logo: item.league.logo,
        home: item.teams.home.name,
        home_logo: item.teams.home.logo,
        away: item.teams.away.name,
        away_logo: item.teams.away.logo,
        score: {
          home: item.goals.home !== null ? item.goals.home : 0,
          away: item.goals.away !== null ? item.goals.away : 0
        },
        status: item.fixture.status.short,
        time: item.fixture.status.elapsed || 0,
        kickoff: item.fixture.date
      }));

      // Update cache
      realLiveCache = {
        dateStr: todayStr,
        fetchedAt: now,
        data: formatted
      };

      return res.json({ source: 'api', refreshedAt: new Date(now).toISOString(), fixtures: formatted });
    } else {
      const demoMatches = getDemoRealMatches();
      return res.json({ source: 'demo_empty', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
    }
  } catch (err) {
    console.error('API-Football error:', err.message);
    const demoMatches = getDemoRealMatches();
    return res.json({ source: 'demo_fallback', refreshedAt: new Date().toISOString(), fixtures: demoMatches });
  }
});
// 15. Predictor Simulation
app.get('/api/predictor', (req, res) => {
  const r32 = [
    { id: 'R32-1', home: 'Argentina', away: 'Scotland', homeScore: 2, awayScore: 0 },
    { id: 'R32-2', home: 'France', away: 'Algeria', homeScore: 3, awayScore: 1 },
    { id: 'R32-3', home: 'Spain', away: 'Senegal', homeScore: 1, awayScore: 0 },
    { id: 'R32-4', home: 'Brazil', away: 'Norway', homeScore: 2, awayScore: 1 },
    { id: 'R32-5', home: 'Germany', away: 'Panama', homeScore: 4, awayScore: 0 },
    { id: 'R32-6', home: 'Portugal', away: 'Ghana', homeScore: 2, awayScore: 0 },
    { id: 'R32-7', home: 'England', away: 'Uzbekistan', homeScore: 1, awayScore: 0 },
    { id: 'R32-8', home: 'Netherlands', away: 'Costa Rica', homeScore: 2, awayScore: 0 },
    { id: 'R32-9', home: 'USA', away: 'Ecuador', homeScore: 1, awayScore: 1, pen: '4-3' },
    { id: 'R32-10', home: 'Mexico', away: 'Sweden', homeScore: 0, awayScore: 1 },
    { id: 'R32-11', home: 'Colombia', away: 'Morocco', homeScore: 1, awayScore: 2 },
    { id: 'R32-12', home: 'Uruguay', away: 'Nigeria', homeScore: 2, awayScore: 0 },
    { id: 'R32-13', home: 'Italy', away: 'Japan', homeScore: 1, awayScore: 0 },
    { id: 'R32-14', home: 'Croatia', away: 'Canada', homeScore: 2, awayScore: 1 },
    { id: 'R32-15', home: 'Belgium', away: 'South Korea', homeScore: 3, awayScore: 0 },
    { id: 'R32-16', home: 'Denmark', away: 'Switzerland', homeScore: 0, awayScore: 0, pen: '3-4' }
  ];
  
  const r16 = [
    { id: 'R16-1', home: 'Argentina', away: 'France', homeScore: 1, awayScore: 2 },
    { id: 'R16-2', home: 'Spain', away: 'Brazil', homeScore: 2, awayScore: 1 },
    { id: 'R16-3', home: 'Germany', away: 'Portugal', homeScore: 1, awayScore: 1, pen: '3-4' },
    { id: 'R16-4', home: 'England', away: 'Netherlands', homeScore: 2, awayScore: 0 },
    { id: 'R16-5', home: 'USA', away: 'Sweden', homeScore: 0, awayScore: 2 },
    { id: 'R16-6', home: 'Morocco', away: 'Uruguay', homeScore: 1, awayScore: 0 },
    { id: 'R16-7', home: 'Italy', away: 'Croatia', homeScore: 0, awayScore: 0, pen: '5-4' },
    { id: 'R16-8', home: 'Belgium', away: 'Switzerland', homeScore: 2, awayScore: 1 }
  ];
  
  const qf = [
    { id: 'QF-1', home: 'France', away: 'Spain', homeScore: 0, awayScore: 1 },
    { id: 'QF-2', home: 'Portugal', away: 'England', homeScore: 2, awayScore: 1 },
    { id: 'QF-3', home: 'Sweden', away: 'Morocco', homeScore: 1, awayScore: 2 },
    { id: 'QF-4', home: 'Italy', away: 'Belgium', homeScore: 1, awayScore: 0 }
  ];
  
  const sf = [
    { id: 'SF-1', home: 'Spain', away: 'Portugal', homeScore: 2, awayScore: 2, pen: '5-4' },
    { id: 'SF-2', home: 'Morocco', away: 'Italy', homeScore: 0, awayScore: 1 }
  ];
  
  const final = {
    home: 'Spain', away: 'Italy', homeScore: 2, awayScore: 0, winner: 'Spain'
  };

  res.json({ r32, r16, qf, sf, final });
});

app.listen(PORT, () => console.log(`\n🏆 FIFA 2026 Dashboard running → http://localhost:${PORT}\n`));
