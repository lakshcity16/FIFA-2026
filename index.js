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
app.get('/api/groups', (req, res) => res.json({ groups: GROUPS }));

// 3. Single team full profile
app.get('/api/team/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const analytics = ANALYTICS[name];
  if (!analytics) return res.status(404).json({ error: 'Team not found' });

  const squad = SQUADS[name] || [];
  const fixtures = (teamFixtures[name] || []).map(f => ({
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

  // Strengths & weaknesses from metrics
  const metrics = { offense: analytics.offense, defense: analytics.defense,
    passing: analytics.passing, possession: analytics.possession, creativity: analytics.creativity };
  const sorted = Object.entries(metrics).sort((a,b)=>b[1]-a[1]);
  const strengths = sorted.slice(0,2).map(([k,v])=>({ metric: k, value: v }));
  const weaknesses = sorted.slice(-2).reverse().map(([k,v])=>({ metric: k, value: v }));

  res.json({ name, analytics, squad, played, upcoming, w, d, l, strengths, weaknesses });
});

// 4. All fixtures (with optional date filter)
app.get('/api/fixtures', (req, res) => {
  let list = FIXTURES;
  if (req.query.date) list = list.filter(f => f.date === req.query.date);
  if (req.query.stage) list = list.filter(f => f.stage === req.query.stage);
  if (req.query.played !== undefined) {
    const played = req.query.played === 'true';
    list = list.filter(f => f.is_played === played);
  }
  res.json({ fixtures: list });
});

// 5. Top performers
app.get('/api/performers', (req, res) => res.json(PERFORMERS));

// 6. ML Predictions — Monte Carlo sim
app.get('/api/predict/:team', (req, res) => {
  const name = decodeURIComponent(req.params.team);
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  // Weights from multiple metrics
  const power = (a.offense*0.3 + a.defense*0.25 + a.passing*0.2 + a.possession*0.15 + a.creativity*0.1) / 100;
  const groupRank = (GROUPS[a.group] || []).findIndex(t => t.team === name) + 1;
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
  const a = ANALYTICS[name];
  if (!a) return res.status(404).json({ error: 'Team not found' });

  const groupTeams = (GROUPS[a.group] || []);
  const groupRank = groupTeams.findIndex(t => t.team === name) + 1;
  const qualifies = groupRank <= 2;

  // Simulate group matches
  const groupMatches = [];
  const gFixtures = FIXTURES.filter(f =>
    f.stage === 'Group Stage' && (f.home === name || f.away === name)
  );
  gFixtures.forEach(f => {
    const isHome = f.home === name;
    const ts = isHome ? f.home_score : f.away_score;
    const os = isHome ? f.away_score : f.home_score;
    groupMatches.push({
      date: f.date, opponent: isHome ? f.away : f.home,
      team_score: ts, opp_score: os,
      result: f.is_played ? (ts > os ? 'W' : ts === os ? 'D' : 'L') : null,
      is_played: f.is_played
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

  // Find player stats across all squads
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
      { model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.75 },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    res.json({ analysis: r.data.choices[0].message.content, player_data: playerData });
  } catch (e) {
    console.error('Groq error:', e.response?.data || e.message);
    res.status(502).json({ error: 'AI inference failed. Groq API error.', detail: e.message });
  }
});

// 9. Auction Pool — top players, start price = 1 CP always
app.get('/api/auction/pool', (req, res) => {
  const pool = [];
  const POSITIONS = ['Goalkeeper','Defender','Midfielder','Forward'];
  POSITIONS.forEach(pos => {
    const byPos = [];
    Object.entries(SQUADS).forEach(([team, squad]) => {
      squad.filter(p => p.position === pos).forEach(p => {
        byPos.push({ ...p, team,
          // Linear CP value: rating maps to 1-30 CP range
          // All start at 1 CP — bid increments are +1 each round
          base_cp: 1,
          // Display tier: how many bid increments it might go (based on rating)
          tier: p.rating >= 9 ? 'Elite' : p.rating >= 8 ? 'Star' : p.rating >= 7 ? 'Good' : 'Regular',
          max_expected_cp: Math.max(1, Math.round((p.rating - 5) * 7)) // informational
        });
      });
    });
    // Take top 20 per position by rating
    byPos.sort((a,b) => b.rating - a.rating);
    pool.push(...byPos.slice(0, 20));
  });
  // Shuffle
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
  const addEvent = (min, type, team, desc) => events.push({ min, type, team, desc, score: `${uGoals}-${aGoals}` });

  for (let min = 1; min <= 90; min++) {
    if (Math.random() > 0.10) continue; // ~10 events per match
    const isUser = Math.random() < uWinProb;
    const rand = Math.random();
    if (rand < 0.40) { // Goal
      if (isUser) {
        uGoals++;
        const scorer = forwards(userSquad)[Math.floor(Math.random()*forwards(userSquad).length)] || userSquad[0];
        events.push({ min, type: 'GOAL', team: 'user', desc: `⚽ GOAL! ${scorer.name} fires it in!`, score: `${uGoals}-${aGoals}` });
      } else {
        aGoals++;
        const scorer = forwards(aiSquad)[Math.floor(Math.random()*forwards(aiSquad).length)] || aiSquad[0];
        events.push({ min, type: 'GOAL', team: 'ai', desc: `⚽ GOAL! ${scorer.name} scores for AI!`, score: `${uGoals}-${aGoals}` });
      }
    } else if (rand < 0.70) { // Save
      const g = isUser ? gk(aiSquad) : gk(userSquad);
      events.push({ min, type: 'SAVE', team: isUser ? 'ai' : 'user', desc: `🧤 ${g.name} saves brilliantly!`, score: `${uGoals}-${aGoals}` });
    } else { // Card
      const tm = isUser ? userSquad : aiSquad;
      const player = tm[Math.floor(Math.random()*tm.length)];
      events.push({ min, type: 'CARD', team: isUser ? 'user' : 'ai', desc: `🟨 ${player.name} booked!`, score: `${uGoals}-${aGoals}` });
    }
  }
  events.push({ min: 90, type: 'FT', team: 'both', desc: `🏁 Full Time! ${uGoals}-${aGoals}`, score: `${uGoals}-${aGoals}` });

  res.json({ userGoals: uGoals, aiGoals: aGoals, userPower: uPow.toFixed(2), aiPower: aiPow.toFixed(2), events });
});

// 11. Live scores proxy (Sofascore)
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
  // Fallback: today's dataset fixtures
  const today = new Date().toISOString().split('T')[0];
  const todayMatches = FIXTURES.filter(f => f.date === '2026-06-15');
  res.json({ source: 'dataset', events: todayMatches.map(f => ({
    id: f.id, status: f.is_played ? 'finished' : 'scheduled',
    home: { name: f.home, flag: ANALYTICS[f.home]?.flag },
    away: { name: f.away, flag: ANALYTICS[f.away]?.flag },
    score: { home: f.home_score, away: f.away_score },
    stage: f.stage, stadium: f.stadium, city: f.city,
    scorers: f.scorers
  })) });
});

// 12. Player compare
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

app.listen(PORT, () => console.log(`\n🏆 FIFA 2026 Dashboard running → http://localhost:${PORT}\n`));
