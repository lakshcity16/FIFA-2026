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

// ── Tournament Live Match & Stats Engine ──────────────────────

const SPECIAL_MATCH_RESOLUTIONS = {
  "M001": { // Mexico vs South Africa (2-0)
    homeScore: 2, awayScore: 0,
    scorers: [
      { name: 'Santiago Giménez', min: 34, team: 'home' },
      { name: 'Hirving Lozano', min: 72, team: 'home' }
    ]
  },
  "M002": { // Korea Republic vs Czechia (2-1)
    homeScore: 2, awayScore: 1,
    scorers: [
      { name: 'Son Heung-min', min: 19, team: 'home' },
      { name: 'Cho Gue-sung', min: 64, team: 'home' },
      { name: 'Patrik Schick', min: 45, team: 'away' }
    ]
  },
  "M003": { // Canada vs Bosnia (1-1)
    homeScore: 1, awayScore: 1,
    scorers: [
      { name: 'Jonathan David', min: 58, team: 'home' },
      { name: 'Edin Džeko', min: 70, team: 'away' }
    ]
  },
  "M004": { // United States vs Paraguay (4-1)
    homeScore: 4, awayScore: 1,
    scorers: [
      { name: 'Christian Pulisic', min: 12, team: 'home' },
      { name: 'Folarin Balogun', min: 38, team: 'home' },
      { name: 'Weston McKennie', min: 55, team: 'home' },
      { name: 'Timothy Weah', min: 82, team: 'home' },
      { name: 'Miguel Almirón', min: 49, team: 'away' }
    ]
  },
  "M005": { // Haiti vs Scotland (0-1)
    homeScore: 0, awayScore: 1,
    scorers: [
      { name: 'John McGinn', min: 62, team: 'away' }
    ]
  },
  "M006": { // Australia vs Turkiye (2-0)
    homeScore: 2, awayScore: 0,
    scorers: [
      { name: 'Mitchell Duke', min: 22, team: 'home' },
      { name: 'Mathew Leckie', min: 78, team: 'home' }
    ]
  },
  "M007": { // Brazil vs Morocco (1-1)
    homeScore: 1, awayScore: 1,
    scorers: [
      { name: 'Vinícius Júnior', min: 27, team: 'home' },
      { name: 'Hakim Ziyech', min: 68, team: 'away' }
    ]
  },
  "M008": { // Qatar vs Switzerland (1-1)
    homeScore: 1, awayScore: 1,
    scorers: [
      { name: 'Almoez Ali', min: 41, team: 'home' },
      { name: 'Breel Embolo', min: 56, team: 'away' }
    ]
  },
  "M009": { // Cote d'Ivoire vs Ecuador (1-0)
    homeScore: 1, awayScore: 0,
    scorers: [
      { name: 'Sébastien Haller', min: 51, team: 'home' }
    ]
  },
  "M010": { // Germany vs Curacao (7-1)
    homeScore: 7, awayScore: 1,
    scorers: [
      { name: 'Florian Wirtz', min: 14, team: 'home', assist: 'Kai Havertz' },
      { name: 'Jamal Musiala', min: 28, team: 'home', assist: 'Joshua Kimmich' },
      { name: 'Kai Havertz', min: 41, team: 'home', assist: 'Florian Wirtz' },
      { name: 'Jamal Musiala', min: 55, team: 'home', assist: 'Ilkay Gündogan' },
      { name: 'Leroy Sané', min: 67, team: 'home', assist: 'Thomas Müller' },
      { name: 'Florian Wirtz', min: 78, team: 'home', assist: 'Jamal Musiala' },
      { name: 'Niclas Füllkrug', min: 89, team: 'home', assist: 'David Raum' },
      { name: 'Juninho Bacuna', min: 82, team: 'away', assist: 'Rangelo Janga' }
    ]
  },
  "M011": { // Netherlands vs Japan (2-2)
    homeScore: 2, awayScore: 2,
    scorers: [
      { name: 'Cody Gakpo', min: 33, team: 'home' },
      { name: 'Memphis Depay', min: 74, team: 'home' },
      { name: 'Kaoru Mitoma', min: 45, team: 'away' },
      { name: 'Kyogo Furuhashi', min: 81, team: 'away' }
    ]
  },
  "M012": { // Sweden vs Tunisia (5-1)
    homeScore: 5, awayScore: 1,
    scorers: [
      { name: 'Alexander Isak', min: 15, team: 'home' },
      { name: 'Dejan Kulusevski', min: 29, team: 'home' },
      { name: 'Viktor Gyökeres', min: 61, team: 'home' },
      { name: 'Alexander Isak', min: 53, team: 'home' },
      { name: 'Emil Forsberg', min: 88, team: 'home' },
      { name: 'Youssef Msakni', min: 42, team: 'away' }
    ]
  }
};

function getFuzzySquadPlayer(teamName, namePart) {
  const squad = SQUADS[teamName] || [];
  const clean = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchPart = clean(namePart);
  const found = squad.find(p => clean(p.name).includes(searchPart));
  return found ? found.name : namePart;
}

function getMatchScore(matchId, home, away) {
  if (SPECIAL_MATCH_RESOLUTIONS[matchId]) {
    const resObj = SPECIAL_MATCH_RESOLUTIONS[matchId];
    const scorers = resObj.scorers.map(s => ({
      ...s,
      name: getFuzzySquadPlayer(s.team === 'home' ? home : away, s.name),
      assist: s.assist ? getFuzzySquadPlayer(s.team === 'home' ? home : away, s.assist) : null
    }));
    return {
      homeScore: resObj.homeScore,
      awayScore: resObj.awayScore,
      scorers
    };
  }

  // Seeded random score generation based on team strengths
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

  // Expected goals
  const hXG = Math.max(0.2, (hRating - aRating) * 0.5 + 1.4 + seedRandom() * 0.5);
  const aXG = Math.max(0.2, (aRating - hRating) * 0.5 + 1.1 + seedRandom() * 0.5);

  const poisson = (xg) => {
    let L = Math.exp(-xg);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= seedRandom();
    } while (p > L && k < 10);
    return k - 1;
  };

  let homeScore = poisson(hXG);
  let awayScore = poisson(aXG);

  // Limit to reasonable scores
  homeScore = Math.min(8, Math.max(0, homeScore));
  awayScore = Math.min(8, Math.max(0, awayScore));

  // Generate scorers from team squads
  const getScorers = (team, score, side) => {
    const squad = SQUADS[team] || [];
    const forwards = squad.filter(p => p.position === 'Forward' || p.position === 'Midfielder');
    const defenders = squad.filter(p => p.position === 'Defender');
    const list = [];
    for (let i = 0; i < score; i++) {
      const scorer = forwards.length > 0 
        ? forwards[Math.floor(seedRandom() * forwards.length)] 
        : (squad.length > 0 ? squad[Math.floor(seedRandom() * squad.length)] : { name: 'Player' });
      
      const assistPlayer = forwards.length > 1
        ? forwards.filter(p => p.name !== scorer.name)[Math.floor(seedRandom() * (forwards.length - 1))]
        : (defenders.length > 0 ? defenders[Math.floor(seedRandom() * defenders.length)] : null);

      const min = Math.floor(seedRandom() * 88) + 2;
      list.push({ 
        name: scorer.name, 
        min, 
        team: side, 
        assist: assistPlayer && seedRandom() < 0.7 ? assistPlayer.name : null 
      });
    }
    return list.sort((a,b) => a.min - b.min);
  };

  const scorers = [
    ...getScorers(home, homeScore, 'home'),
    ...getScorers(away, awayScore, 'away')
  ].sort((a,b) => a.min - b.min);

  return { homeScore, awayScore, scorers };
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

function getTournamentState(simTimeStr) {
  const simTime = new Date(simTimeStr || '2026-06-15T12:00:00Z');
  
  const fixtures = FIXTURES.map(f => {
    const kickoff = new Date(f.kickoff);
    const duration = 2 * 60 * 60 * 1000; // 2 hours
    const elapsed = simTime - kickoff;
    
    let status = 'upcoming';
    let is_played = false;
    let minute = 0;
    
    if (elapsed >= duration) {
      status = 'finished';
      is_played = true;
    } else if (elapsed >= 0) {
      status = 'live';
      is_played = true;
      minute = Math.min(90, Math.floor(elapsed / 60000));
    }
    
    const resolved = getMatchScore(f.id, f.home, f.away);
    
    let home_score = 0;
    let away_score = 0;
    let scorers = [];
    
    if (status === 'finished') {
      home_score = resolved.homeScore;
      away_score = resolved.awayScore;
      scorers = resolved.scorers;
    } else if (status === 'live') {
      scorers = resolved.scorers.filter(s => s.min <= minute);
      home_score = scorers.filter(s => s.team === 'home').length;
      away_score = scorers.filter(s => s.team === 'away').length;
    }
    
    return {
      ...f,
      status,
      is_played,
      minute: status === 'live' ? minute : null,
      home_score,
      away_score,
      scorers
    };
  });
  
  // Standings
  const groups = {};
  Object.entries(TEAM_MAP).forEach(([team, meta]) => {
    const g = meta.group;
    if (!groups[g]) groups[g] = {};
    groups[g][team] = {
      team, group: g, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      flag: meta.flag, fifa_code: meta.fifa_code
    };
  });
  
  fixtures.forEach(fix => {
    if (!fix.is_played || fix.stage !== 'group-stage') return;
    
    const g = fix.group;
    if (!g || !groups[g]) return;
    
    const home = fix.home;
    const away = fix.away;
    const hg = fix.home_score;
    const ag = fix.away_score;
    
    if (groups[g][home]) {
      const r = groups[g][home];
      r.mp += 1; r.gf += hg; r.ga += ag; r.gd = r.gf - r.ga;
      if (hg > ag) { r.w += 1; r.pts += 3; }
      else if (hg === ag) { r.d += 1; r.pts += 1; }
      else { r.l += 1; }
    }
    if (groups[g][away]) {
      const r = groups[g][away];
      r.mp += 1; r.gf += ag; r.ga += hg; r.gd = r.gf - r.ga;
      if (ag > hg) { r.w += 1; r.pts += 3; }
      else if (hg === ag) { r.d += 1; r.pts += 1; }
      else { r.l += 1; }
    }
  });
  
  const sortedGroups = {};
  Object.entries(groups).forEach(([g, teamObj]) => {
    const teams = Object.values(teamObj);
    teams.sort((a,b) => (-a.pts) - (-b.pts) || (-a.gd) - (-b.gd) || (-a.gf) - (-b.gf) || a.team.localeCompare(b.team));
    sortedGroups[g] = teams;
  });

  // Calculate dynamic players stats
  const playerStats = {};
  Object.entries(SQUADS).forEach(([team, squad]) => {
    squad.forEach(p => {
      playerStats[p.name] = {
        name: p.name,
        player_name: p.name,
        team: team,
        position: p.position,
        age: p.age,
        club: p.club,
        goals: 0,
        assists: 0,
        rating: p.rating || 6.5,
        ratingSum: 0,
        ratingCount: 0,
        clean_sheets: p.clean_sheets || 0
      };
    });
  });

  fixtures.forEach(fix => {
    if (!fix.is_played) return;
    
    fix.scorers.forEach(s => {
      if (playerStats[s.name]) {
        playerStats[s.name].goals += 1;
      }
      if (s.assist && playerStats[s.assist]) {
        playerStats[s.assist].assists += 1;
      }
    });

    let matchHash = 0;
    for (let i = 0; i < fix.id.length; i++) {
      matchHash = fix.id.charCodeAt(i) + ((matchHash << 5) - matchHash);
    }
    const seedRandom = () => {
      const x = Math.sin(matchHash++) * 10000;
      return x - Math.floor(x);
    };

    const homeSquad = SQUADS[fix.home] || [];
    const awaySquad = SQUADS[fix.away] || [];

    const applyRatings = (squad, sideScore, sideScorers) => {
      squad.forEach(p => {
        if (!playerStats[p.name]) return;
        
        let baseline = p.rating || 6.5;
        let matchRating = baseline + (seedRandom() - 0.5) * 1.5;
        
        const goalsCount = sideScorers.filter(s => s.name === p.name).length;
        matchRating += goalsCount * 1.2;
        
        const assistsCount = sideScorers.filter(s => s.assist === p.name).length;
        matchRating += assistsCount * 0.8;
        
        matchRating = Math.min(10.0, Math.max(4.0, matchRating));
        
        playerStats[p.name].ratingSum += matchRating;
        playerStats[p.name].ratingCount += 1;
      });
    };

    const homeScorers = fix.scorers.filter(s => s.team === 'home');
    const awayScorers = fix.scorers.filter(s => s.team === 'away');

    applyRatings(homeSquad, fix.home_score, homeScorers);
    applyRatings(awaySquad, fix.away_score, awayScorers);
  });

  Object.values(playerStats).forEach(p => {
    if (p.ratingCount > 0) {
      p.rating = parseFloat((p.ratingSum / p.ratingCount).toFixed(2));
    }
  });

  const flatPlayers = Object.values(playerStats);
  const topGoals = [...flatPlayers].sort((a,b) => b.goals - a.goals || b.rating - a.rating).slice(0, 15);
  const topAssists = [...flatPlayers].sort((a,b) => b.assists - a.assists || b.rating - a.rating).slice(0, 15);
  const topRating = [...flatPlayers].filter(p => p.ratingCount > 0 || p.goals > 0).sort((a,b) => b.rating - a.rating).slice(0, 15);
  const topSaves = [...flatPlayers].filter(p => p.position === 'Goalkeeper').sort((a,b) => b.clean_sheets - a.clean_sheets).slice(0, 10);

  return {
    fixtures,
    groups: sortedGroups,
    simTime,
    playerStats,
    performers: {
      goals: topGoals,
      assists: topAssists,
      rating: topRating,
      saves: topSaves
    }
  };
}

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

// 7. Journey Simulator
app.get('/api/journey/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures: allFix, groups } = getTournamentState(simTime);
  
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const groupTeams = groups[a.group] || [];
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2;

  // Group matches
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

  // Simulate knockout path using power ratings
  const simRound = (opponent) => {
    const oa = ANALYTICS[opponent] || { offense:50, defense:50, passing:70, possession:50, creativity:50 };
    const myPower = (a.offense*0.3 + a.defense*0.25 + a.passing*0.2 + a.possession*0.15 + a.creativity*0.1);
    const oppPower = (oa.offense*0.3 + oa.defense*0.25 + oa.passing*0.2 + oa.possession*0.15 + oa.creativity*0.1);
    const winProb = myPower / (myPower + oppPower);
    const win = Math.random() < winProb;
    const myGoals = win ? Math.floor(Math.random()*3)+1 : Math.floor(Math.random()*2);
    const oppGoals = win ? Math.floor(Math.random()*2) : Math.floor(Math.random()*3)+1;
    return { opponent, win, score: `${myGoals}-${oppGoals}`, prob: Math.round(winProb*100) };
  };

  const potentialOpponents = Object.keys(ANALYTICS).filter(t => t !== name && ANALYTICS[t].group !== a.group);
  const pick = () => potentialOpponents[Math.floor(Math.random()*potentialOpponents.length)];

  const r32Opp = pick(); const r32 = qualifies ? simRound(r32Opp) : null;
  const r16Opp = pick(); const r16 = r32?.win ? simRound(r16Opp) : null;
  const qfOpp  = pick(); const qf  = r16?.win ? simRound(qfOpp)  : null;
  const sfOpp  = pick(); const sf  = qf?.win  ? simRound(sfOpp)  : null;
  const finOpp = pick(); const fin = sf?.win  ? simRound(finOpp) : null;

  res.json({
    team: name, group: a.group, group_rank: groupRank, qualifies,
    group_standings: groupTeams,
    group_matches: groupMatches,
    knockout: { r32, r16, qf, sf, fin,
      champion: fin?.win ? name : (fin ? fin.opponent : null)
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

// 9. Auction Pool — top players, start price = 1 CP always
app.get('/api/auction/pool', (req, res) => {
  const allPlayers = [];
  Object.entries(SQUADS).forEach(([team, squad]) => {
    squad.forEach(p => {
      allPlayers.push({ ...p, team });
    });
  });

  const goalkeepers = allPlayers.filter(p => p.position === 'Goalkeeper').sort((a,b) => b.rating - a.rating);
  const defenders = allPlayers.filter(p => p.position === 'Defender').sort((a,b) => b.rating - a.rating);
  const midfielders = allPlayers.filter(p => p.position === 'Midfielder').sort((a,b) => b.rating - a.rating);
  const forwards = allPlayers.filter(p => p.position === 'Forward').sort((a,b) => b.rating - a.rating);

  const posMap = {
    GK: [],
    LB: [], LCB: [], RCB: [], RB: [],
    CDM: [], CM: [], CAM: [],
    LW: [], RW: [], ST: []
  };

  goalkeepers.forEach(p => {
    p.specific_position = 'GK';
    posMap.GK.push(p);
  });

  defenders.forEach((p, idx) => {
    const subPos = ['LCB', 'RCB', 'LB', 'RB'][idx % 4];
    p.specific_position = subPos;
    posMap[subPos].push(p);
  });

  midfielders.forEach((p, idx) => {
    const subPos = ['CM', 'CDM', 'CAM'][idx % 3];
    p.specific_position = subPos;
    posMap[subPos].push(p);
  });

  forwards.forEach((p, idx) => {
    const subPos = ['ST', 'LW', 'RW'][idx % 3];
    p.specific_position = subPos;
    posMap[subPos].push(p);
  });

  const pool = [];
  Object.entries(posMap).forEach(([posName, list]) => {
    list.sort((a,b) => b.rating - a.rating);
    const top5 = list.slice(0, 5).map(p => ({
      ...p,
      position: p.specific_position,
      base_cp: 1,
      tier: p.rating >= 9 ? 'Elite' : p.rating >= 8 ? 'Star' : p.rating >= 7 ? 'Good' : 'Regular',
      max_expected_cp: Math.max(1, Math.round((p.rating - 5) * 7))
    }));
    pool.push(...top5);
  });

  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]] = [pool[j],pool[i]];
  }
  res.json({ players: pool });
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
app.get('/api/match/:id', (req, res) => {
  const matchId = req.params.id;
  const simTime = req.query.simulated_time || '2026-06-15T12:00:00Z';
  const { fixtures } = getTournamentState(simTime);

  const match = fixtures.find(f => f.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Generate stats dynamically
  const stats = getMatchStats(match.id, match.home, match.away, match.home_score, match.away_score);
  res.json({ match, stats });
});

// 12. AI Live Commentary (New Endpoint)
app.post('/api/ai/live-commentary', async (req, res) => {
  const { matchId, home, away, score, scorers, minute, stats } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });

  const key = nextKey();
  if (!key) return res.status(500).json({ error: 'No Groq API keys available' });

  const prompt = `You are a live football commentator reporting on a FIFA World Cup 2026 match.
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

  const systemMessage = `You are a world-class football analyst, tactician, and prediction expert covering the FIFA World Cup 2026.
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

app.listen(PORT, () => console.log(`\n🏆 FIFA 2026 Dashboard running → http://localhost:${PORT}\n`));
