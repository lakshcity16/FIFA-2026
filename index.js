const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3050;

// Security and utility middlewares
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Set global date threshold for the tournament (June 15, 2026)
const CURRENT_DATE_STR = '2026-06-15';
const CURRENT_DATE = new Date(CURRENT_DATE_STR);

// In-memory data store
let players = []; // List of all player match records
let playersIndex = {}; // player_id -> aggregated player profile
let teamsIndex = {}; // team_name -> team details (players, matches, stats)
let matchesIndex = {}; // match_id -> match details
let groups = {}; // Group letter (A-L) -> list of 4 teams
const GROUPS_LIST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Custom CSV Parser
function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim());
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        let row = [];
        let inQuotes = false;
        let currentValue = '';
        
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(currentValue.trim());
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        row.push(currentValue.trim());
        
        if (row.length === headers.length) {
            const obj = {};
            headers.forEach((header, index) => {
                const val = row[index];
                if (val === '') {
                    obj[header] = null;
                } else if (!isNaN(val) && val !== '') {
                    obj[header] = Number(val);
                } else {
                    obj[header] = val.replace(/^"|"$/g, ''); // strip outer quotes if any
                }
            });
            results.push(obj);
        }
    }
    return results;
}

// Load and process CSV
function loadCSVData() {
    console.log('🔄 Loading FIFA 2026 player performance dataset...');
    const csvPath = path.join(__dirname, 'fifa_world_cup_2026_player_performance.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV File not found at: ${csvPath}`);
        return;
    }
    
    try {
        const fileContent = fs.readFileSync(csvPath, 'utf8');
        const parsedRows = parseCSV(fileContent);
        players = parsedRows;
        console.log(`✅ Loaded ${parsedRows.length} player performance records.`);
        
        // Aggregate Players & Teams
        processAggregates();
    } catch (err) {
        console.error('❌ Error reading/parsing CSV:', err);
    }
}

function processAggregates() {
    const tempPlayers = {};
    const tempTeams = {};
    const tempMatches = {};
    
    // Group records by player_id and match_id
    players.forEach(row => {
        const {
            player_id, player_name, age, position, team, jersey_number, club_name, market_value_eur,
            match_id, match_date, opponent_team, tournament_stage, match_result, goals_team, goals_opponent,
            minutes_played, goals, assists, shots, shots_on_target, expected_goals_xg, expected_assists_xa,
            key_passes, pass_accuracy, tackles, interceptions, clearances, blocks, aerial_duels_won,
            recoveries, clean_sheet, goals_conceded, saves, save_percentage, stamina_score, player_rating,
            performance_score, offensive_contribution, defensive_contribution, possession_impact, creativity_score
        } = row;
        
        // 1. Index player profile
        if (!tempPlayers[player_id]) {
            tempPlayers[player_id] = {
                player_id,
                player_name,
                age: age || 24,
                position: position || 'Midfielder',
                team: team || 'Unknown',
                jersey_number: jersey_number || 10,
                club_name: club_name || 'Free Agent',
                market_value_eur: market_value_eur || 500000,
                ratings: [],
                goals: 0,
                assists: 0,
                minutes: 0,
                saves: 0,
                clean_sheets: 0,
                pass_accuracy_sum: 0,
                pass_accuracy_count: 0,
                recoveries: 0,
                tackles: 0,
                shots: 0,
                xg: 0,
                xa: 0,
                creativity: 0,
                offensive_contribution_sum: 0,
                defensive_contribution_sum: 0,
                possession_impact_sum: 0
            };
        }
        
        const p = tempPlayers[player_id];
        if (player_rating) p.ratings.push(player_rating);
        p.goals += goals || 0;
        p.assists += assists || 0;
        p.minutes += minutes_played || 0;
        p.saves += saves || 0;
        p.clean_sheets += clean_sheet || 0;
        p.recoveries += recoveries || 0;
        p.tackles += tackles || 0;
        p.shots += shots || 0;
        p.xg += expected_goals_xg || 0;
        p.xa += expected_assists_xa || 0;
        p.creativity += creativity_score || 0;
        p.offensive_contribution_sum += offensive_contribution || 0;
        p.defensive_contribution_sum += defensive_contribution || 0;
        p.possession_impact_sum += possession_impact || 0;
        
        if (pass_accuracy !== null && pass_accuracy !== undefined) {
            p.pass_accuracy_sum += pass_accuracy;
            p.pass_accuracy_count++;
        }
        
        // 2. Index match details
        if (!tempMatches[match_id]) {
            tempMatches[match_id] = {
                match_id,
                match_date,
                stage: tournament_stage,
                teams: {},
                date: new Date(match_date)
            };
        }
        
        const m = tempMatches[match_id];
        m.teams[team] = {
            team,
            opponent: opponent_team,
            goals: goals_team,
            opponent_goals: goals_opponent,
            result: match_result
        };
    });
    
    // Complete Player profiles
    Object.keys(tempPlayers).forEach(id => {
        const p = tempPlayers[id];
        p.overall_rating = p.ratings.length ? Number((p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length).toFixed(2)) : 6.0;
        p.avg_pass_accuracy = p.pass_accuracy_count ? Number((p.pass_accuracy_sum / p.pass_accuracy_count).toFixed(2)) : 0.70;
        p.avg_offense = Number((p.offensive_contribution_sum / p.ratings.length).toFixed(2)) || 0;
        p.avg_defense = Number((p.defensive_contribution_sum / p.ratings.length).toFixed(2)) || 0;
        p.avg_possession = Number((p.possession_impact_sum / p.ratings.length).toFixed(2)) || 0;
        p.avg_creativity = Number((p.creativity / p.ratings.length).toFixed(2)) || 0;
    });
    playersIndex = tempPlayers;
    
    // Extract unique teams
    const uniqueTeams = [...new Set(Object.values(playersIndex).map(p => p.team))].sort();
    
    // 3. Assign teams to 12 groups of 4 alphabetically
    groups = {};
    GROUPS_LIST.forEach((g, idx) => {
        groups[g] = uniqueTeams.slice(idx * 4, idx * 4 + 4);
    });
    
    // 4. Index teams details
    uniqueTeams.forEach(teamName => {
        const groupLetter = GROUPS_LIST.find(g => groups[g].includes(teamName)) || 'A';
        const teamPlayers = Object.values(playersIndex).filter(p => p.team === teamName);
        
        // Compute average rating
        const teamRating = teamPlayers.length ? Number((teamPlayers.reduce((sum, p) => sum + p.overall_rating, 0) / teamPlayers.length).toFixed(2)) : 6.0;
        
        // Extract team matches from matches index
        const teamMatches = [];
        Object.keys(tempMatches).forEach(matchId => {
            const m = tempMatches[matchId];
            if (m.teams[teamName]) {
                const outcome = m.teams[teamName];
                teamMatches.push({
                    match_id: m.match_id,
                    match_date: m.match_date,
                    date: m.date,
                    stage: m.stage,
                    opponent: outcome.opponent,
                    goals: outcome.goals,
                    opponent_goals: outcome.opponent_goals,
                    result: outcome.result
                });
            }
        });
        
        // Sort matches by date
        teamMatches.sort((a, b) => a.date - b.date);
        
        // Split into completed and upcoming matches based on June 15, 2026
        const prevResults = teamMatches.filter(m => m.date <= CURRENT_DATE);
        const upcomingSchedule = teamMatches.filter(m => m.date > CURRENT_DATE);
        
        // Compute stats for Strengths & Weaknesses
        const avgOffense = teamPlayers.length ? Number((teamPlayers.reduce((s, p) => s + p.avg_offense, 0) / teamPlayers.length).toFixed(1)) : 50;
        const avgDefense = teamPlayers.length ? Number((teamPlayers.reduce((s, p) => s + p.avg_defense, 0) / teamPlayers.length).toFixed(1)) : 50;
        const avgPossession = teamPlayers.length ? Number((teamPlayers.reduce((s, p) => s + p.avg_possession, 0) / teamPlayers.length).toFixed(1)) : 50;
        const avgPassAccuracy = teamPlayers.length ? Number((teamPlayers.reduce((s, p) => s + p.avg_pass_accuracy, 0) / teamPlayers.length * 100).toFixed(1)) : 75;
        
        // Identify strengths and weaknesses
        const strengths = [];
        const weaknesses = [];
        
        if (avgOffense > 60) strengths.push({ title: 'Clinical Attack', desc: 'Capable of creating high xG opportunities and converting shots from inside the box.' });
        if (avgDefense > 60) strengths.push({ title: 'Compact Defense', desc: 'Maintains structure, high rate of clean sheets and defensive blocks.' });
        if (avgPossession > 55) strengths.push({ title: 'Possession Control', desc: 'Dominates midfield transitions, keeping opponent pressure low.' });
        if (avgPassAccuracy > 82) strengths.push({ title: 'Pinpoint Passing', desc: 'Excellent link-up play with high completion ratios in the final third.' });
        
        if (strengths.length === 0) {
            strengths.push({ title: 'Balanced Build-up', desc: 'Shows stable performance across defensive and offensive phases.' });
        }
        
        if (avgOffense < 48) weaknesses.push({ title: 'Shallow Goalscoring', desc: 'Relies heavily on set pieces, struggle to find space against low-blocks.' });
        if (avgDefense < 48) weaknesses.push({ title: 'Vulnerable Defensive Line', desc: 'Susceptible to counter-attacks and high aerial crosses.' });
        if (avgPossession < 48) weaknesses.push({ title: 'Midfield Disconnection', desc: 'Prone to turnovers under high press, low creativity index.' });
        if (avgPassAccuracy < 76) weaknesses.push({ title: 'Inconsistent Transitions', desc: 'Struggles with long-range distribution and key passes.' });
        
        if (weaknesses.length === 0) {
            weaknesses.push({ title: 'High Pressure Fatigue', desc: 'Physical stamina drops when maintaining high tempo over 90 minutes.' });
        }
        
        tempTeams[teamName] = {
            team_name: teamName,
            group: groupLetter,
            overall_rating: teamRating,
            players: teamPlayers,
            allMatches: teamMatches,
            prevResults,
            upcomingSchedule,
            strengths,
            weaknesses,
            metrics: {
                offense: avgOffense,
                defense: avgDefense,
                possession: avgPossession,
                passing: avgPassAccuracy
            }
        };
    });
    
    teamsIndex = tempTeams;
    matchesIndex = tempMatches;
    console.log('✅ Aggregation and indexing complete.');
}

// Initialize on startup
loadCSVData();


// ==========================================
// 1. GET ENDPOINTS
// ==========================================

// Get all teams
app.get('/get/teams', (req, res) => {
    const list = Object.values(teamsIndex).map(t => ({
        team_name: t.team_name,
        group: t.group,
        overall_rating: t.overall_rating,
        player_count: t.players.length
    }));
    res.json({ teams: list });
});

// Get team details
app.get('/get/team', (req, res) => {
    const name = req.query.name;
    if (!name || !teamsIndex[name]) {
        return res.status(404).json({ error: 'Team not found' });
    }
    const t = teamsIndex[name];
    res.json({
        team_name: t.team_name,
        group: t.group,
        overall_rating: t.overall_rating,
        strengths: t.strengths,
        weaknesses: t.weaknesses,
        metrics: t.metrics,
        prevResults: t.prevResults.map(m => ({
            match_id: m.match_id,
            match_date: m.match_date,
            opponent: m.opponent,
            goals: m.goals,
            opponent_goals: m.opponent_goals,
            result: m.result,
            stage: m.stage
        })),
        upcomingSchedule: t.upcomingSchedule.map(m => ({
            match_id: m.match_id,
            match_date: m.match_date,
            opponent: m.opponent,
            stage: m.stage
        })),
        players: t.players.map(p => ({
            player_id: p.player_id,
            player_name: p.player_name,
            age: p.age,
            position: p.position,
            jersey_number: p.jersey_number,
            club_name: p.club_name,
            market_value_eur: p.market_value_eur,
            overall_rating: p.overall_rating,
            goals: p.goals,
            assists: p.assists
        }))
    });
});

// Get matches (fixtures & results)
app.get('/get/games', (req, res) => {
    const games = [];
    Object.values(matchesIndex).forEach(m => {
        // Since each match has 2 records (Team A and Team B), group them into 1 game object
        const teamNames = Object.keys(m.teams);
        if (teamNames.length >= 2) {
            const teamA = teamNames[0];
            const teamB = teamNames[1];
            const dataA = m.teams[teamA];
            
            // Deduplicate matching by looking at match_id
            if (!games.some(g => g.match_id === m.match_id)) {
                games.push({
                    match_id: m.match_id,
                    match_date: m.match_date,
                    stage: m.stage,
                    home_team: teamA,
                    away_team: teamB,
                    home_score: dataA.goals,
                    away_score: dataA.opponent_goals,
                    result: dataA.result, // from home perspective
                    is_played: new Date(m.match_date) <= CURRENT_DATE
                });
            }
        }
    });
    games.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
    res.json({ games });
});

// Get groups and standings
app.get('/get/groups', (req, res) => {
    const standings = {};
    
    // Initialize points for all teams
    Object.keys(teamsIndex).forEach(teamName => {
        standings[teamName] = {
            team_name: teamName,
            group: teamsIndex[teamName].group,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            gf: 0,
            ga: 0,
            gd: 0,
            points: 0
        };
    });
    
    // Process completed group matches to build standings tables
    Object.values(matchesIndex).forEach(m => {
        if (m.stage !== 'Group Stage' || new Date(m.match_date) > CURRENT_DATE) return;
        
        const teamNames = Object.keys(m.teams);
        if (teamNames.length >= 2) {
            const tA = teamNames[0];
            const tB = teamNames[1];
            const goalsA = m.teams[tA].goals;
            const goalsB = m.teams[tB].goals;
            
            standings[tA].played++;
            standings[tB].played++;
            standings[tA].gf += goalsA;
            standings[tA].ga += goalsB;
            standings[tB].gf += goalsB;
            standings[tB].ga += goalsA;
            standings[tA].gd = standings[tA].gf - standings[tA].ga;
            standings[tB].gd = standings[tB].gf - standings[tB].ga;
            
            if (goalsA > goalsB) {
                standings[tA].won++;
                standings[tA].points += 3;
                standings[tB].lost++;
            } else if (goalsA < goalsB) {
                standings[tB].won++;
                standings[tB].points += 3;
                standings[tA].lost++;
            } else {
                standings[tA].drawn++;
                standings[tA].points += 1;
                standings[tB].drawn++;
                standings[tB].points += 1;
            }
        }
    });
    
    // Sort groups standings
    const formattedGroups = {};
    Object.keys(groups).forEach(g => {
        formattedGroups[g] = groups[g].map(teamName => standings[teamName]);
        formattedGroups[g].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.gd !== a.gd) return b.gd - a.gd;
            return b.gf - a.gf;
        });
    });
    
    res.json({ groups: formattedGroups });
});


// ==========================================
// 2. ML & PREDICTION ENDPOINTS
// ==========================================

// Predict knockout round probabilities
app.get('/api/predictions/:team', (req, res) => {
    const teamName = req.params.team;
    if (!teamName || !teamsIndex[teamName]) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    const team = teamsIndex[teamName];
    const teamRating = team.overall_rating;
    
    // Statistical Monte Carlo prediction logic
    // Win odds based on rating differences:
    // P(win) is simulated through remaining stages.
    // Group stage: what are its current group standings?
    // Let's compute a simple but logical advance chance:
    const baseQualifyChance = Math.min(99, Math.max(5, Math.round(50 + (teamRating - 7.5) * 25)));
    
    // Probabilities of reaching stages: R32, R16, QF, SF, Final, Winner
    const r32 = baseQualifyChance;
    const r16 = Math.round(r32 * (teamRating / 15 + 0.35));
    const qf = Math.round(r16 * (teamRating / 16 + 0.30));
    const sf = Math.round(qf * (teamRating / 17 + 0.25));
    const finalChance = Math.round(sf * (teamRating / 18 + 0.20));
    const winChance = Math.round(finalChance * (teamRating / 19 + 0.15));
    
    res.json({
        team_name: teamName,
        rating: teamRating,
        chances: {
            'Round of 32': Math.min(100, r32),
            'Round of 16': Math.min(r32, r16),
            'Quarter Finals': Math.min(r16, qf),
            'Semi Finals': Math.min(qf, sf),
            'Final': Math.min(sf, finalChance),
            'Champion': Math.min(finalChance, winChance)
        }
    });
});


// ==========================================
// 3. GROQ AI INFERENCE ENGINE
// ==========================================

// Groq keys array
const GROQ_KEYS = [
    process.env.fifa1,
    process.env.fifa2,
    process.env.fifa3,
    process.env.fifa4,
    process.env.fifa5
].filter(k => !!k); // filter out blank values

let currentKeyIndex = 0;

// Rotate key helper
function getGroqKey() {
    if (GROQ_KEYS.length === 0) return null;
    const key = GROQ_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
    return key;
}

// AI Custom Analysis
app.post('/api/ai/query', async (req, res) => {
    const { player_name, opponent_team } = req.body;
    if (!player_name || !opponent_team) {
        return res.status(400).json({ error: 'player_name and opponent_team are required' });
    }
    
    // Find player in database
    const player = Object.values(playersIndex).find(
        p => p.player_name.toLowerCase().includes(player_name.toLowerCase())
    );
    
    // Find opponent team in database
    const opponent = teamsIndex[opponent_team];
    
    const groqKey = getGroqKey();
    if (!groqKey) {
        return res.status(500).json({ 
            error: 'No Groq API keys configured in .env file.' 
        });
    }
    
    // Compile player context
    let playerContextText = `Player Details:\n- Name: ${player_name}\n`;
    if (player) {
        playerContextText += `- Nationality/Team: ${player.team}\n- Age: ${player.age}\n- Position: ${player.position}\n- Current Club: ${player.club_name}\n- Average Match Rating: ${player.overall_rating}\n- Tournament Stats: ${player.goals} Goals, ${player.assists} Assists, ${player.saves} Saves.\n`;
    } else {
        playerContextText += `- Roster context: Player not in database (using default estimation for Lamine Yamal-style wonderkid).\n`;
    }
    
    // Compile opponent context
    let opponentContextText = `Opponent Details: ${opponent_team}\n`;
    if (opponent) {
        opponentContextText += `- Overall FIFA Rating: ${opponent.overall_rating}\n- Core Strengths: ${opponent.strengths.map(s=>s.title).join(', ')}\n- Weaknesses: ${opponent.weaknesses.map(w=>w.title).join(', ')}\n- Defending Metric: ${opponent.metrics.defense}/100\n`;
    }
    
    const prompt = `You are a professional tactical analyst for the FIFA World Cup 2026.
Analyze the following match-up and write a scouting report:
${playerContextText}
${opponentContextText}

Provide your analysis in Markdown format:
1. **Player Overview & Current Form**
2. **Tactical Match-ups**: How will the player expose the opponent's weaknesses or struggle against their strengths?
3. **Statistical Expected Outputs**: Expected Goals (xG), assists, pass accuracy, shots, and rating for this specific game.
4. **Final Verdict**: A creative, paragraph prediction of the scoreline contribution.

Keep the tone expert, concise, and highly detailed.`;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama3-8b-8192', // Robust fast LLM
                messages: [
                    { role: 'system', content: 'You are an advanced football analyst specializing in FIFA World Cup tactical analytics.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 800
            },
            {
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const answer = response.data.choices[0].message.content;
        res.json({ analysis: answer });
    } catch (err) {
        console.error('❌ Groq LLM API Call failed:', err.response ? err.response.data : err.message);
        res.status(502).json({ 
            error: 'AI Inference failed due to Groq rate limits or credentials. Please try again later.',
            details: err.message 
        });
    }
});


// ==========================================
// 4. AI AUCTION & DRAFT SIMULATOR
// ==========================================

// Get Top Players for Auction pool
app.get('/api/auction/pool', (req, res) => {
    const pool = [];
    const positions = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
    
    positions.forEach(pos => {
        // Get all players in this position, sort by rating
        const posPlayers = Object.values(playersIndex)
            .filter(p => p.position === pos)
            .sort((a, b) => b.overall_rating - a.overall_rating);
        
        // Take top 15 in this position to ensure premium selection
        const topPos = posPlayers.slice(0, 15).map(p => {
            // Calculate auction cost (CP) based on overall rating (8.0 rating -> ~23 CP, 9.5 rating -> ~32 CP)
            const rating = p.overall_rating;
            const cost = Math.max(10, Math.round(5 + (rating - 5) * 6));
            return {
                player_id: p.player_id,
                player_name: p.player_name,
                position: p.position,
                team: p.team,
                rating: p.overall_rating,
                market_value: p.market_value_eur,
                cost: cost
            };
        });
        pool.push(...topPos);
    });
    
    res.json({ players: pool });
});

// Simulate Draft 1v1 Match
app.post('/api/auction/simulate', (req, res) => {
    const { userRoster, aiRoster } = req.body;
    
    if (!userRoster || userRoster.length === 0 || !aiRoster || aiRoster.length === 0) {
        return res.status(400).json({ error: 'Rosters cannot be empty' });
    }
    
    // Calculate team values
    const userRatingSum = userRoster.reduce((sum, p) => sum + (p.rating || p.overall_rating || 6.0), 0);
    const aiRatingSum = aiRoster.reduce((sum, p) => sum + (p.rating || p.overall_rating || 6.0), 0);
    
    const userPower = userRatingSum / userRoster.length;
    const aiPower = aiRatingSum / aiRoster.length;
    
    // Simulate game minute by minute
    const events = [];
    let userGoals = 0;
    let aiGoals = 0;
    
    // Filter forwards/midfielders for goals/assists
    const userScorers = userRoster.filter(p => ['Forward', 'Midfielder'].includes(p.position));
    const aiScorers = aiRoster.filter(p => ['Forward', 'Midfielder'].includes(p.position));
    
    for (let min = 1; min <= 90; min++) {
        // Event probability per minute (12% chance of an event)
        if (Math.random() < 0.12) {
            const isUserEvent = Math.random() < (userPower / (userPower + aiPower));
            const rand = Math.random();
            
            if (rand < 0.35) {
                // Goal Event!
                if (isUserEvent) {
                    userGoals++;
                    const scorer = userScorers.length ? userScorers[Math.floor(Math.random() * userScorers.length)] : userRoster[0];
                    const assister = userRoster.filter(p => p.player_id !== scorer.player_id)[Math.floor(Math.random() * (userRoster.length - 1))];
                    events.push({
                        minute: min,
                        type: 'GOAL',
                        team: 'User Draft Team',
                        player: scorer.player_name,
                        assist: assister ? assister.player_name : 'None',
                        score: `${userGoals} - ${aiGoals}`,
                        desc: `⚽ GOAL! Superb finish by ${scorer.player_name} after a neat pass from ${assister ? assister.player_name : 'midfield'}!`
                    });
                } else {
                    aiGoals++;
                    const scorer = aiScorers.length ? aiScorers[Math.floor(Math.random() * aiScorers.length)] : aiRoster[0];
                    const assister = aiRoster.filter(p => p.player_id !== scorer.player_id)[Math.floor(Math.random() * (aiRoster.length - 1))];
                    events.push({
                        minute: min,
                        type: 'GOAL',
                        team: 'AI Draft Team',
                        player: scorer.player_name,
                        assist: assister ? assister.player_name : 'None',
                        score: `${userGoals} - ${aiGoals}`,
                        desc: `⚽ GOAL! ${scorer.player_name} fires it home! Assisted by ${assister ? assister.player_name : 'midfield'}.`
                    });
                }
            } else if (rand < 0.70) {
                // Shot / Save Event
                if (isUserEvent) {
                    const attacker = userRoster[Math.floor(Math.random() * userRoster.length)];
                    const gk = aiRoster.find(p => p.position === 'Goalkeeper') || aiRoster[0];
                    events.push({
                        minute: min,
                        type: 'SAVE',
                        team: 'AI Draft Team',
                        player: gk.player_name,
                        desc: `🧤 Great Save! ${gk.player_name} dives to deny a powerful header from ${attacker.player_name}!`
                    });
                } else {
                    const attacker = aiRoster[Math.floor(Math.random() * aiRoster.length)];
                    const gk = userRoster.find(p => p.position === 'Goalkeeper') || userRoster[0];
                    events.push({
                        minute: min,
                        type: 'SAVE',
                        team: 'User Draft Team',
                        player: gk.player_name,
                        desc: `🧤 Saved! ${gk.player_name} blocks a dangerous low drive by ${attacker.player_name}.`
                    });
                }
            } else {
                // Booking event
                const teamName = isUserEvent ? 'User Draft Team' : 'AI Draft Team';
                const playersList = isUserEvent ? userRoster : aiRoster;
                const defender = playersList.filter(p => p.position === 'Defender')[Math.floor(Math.random() * 4)] || playersList[Math.floor(Math.random() * playersList.length)];
                
                events.push({
                    minute: min,
                    type: 'CARD',
                    team: teamName,
                    player: defender.player_name,
                    desc: `🟨 Yellow Card! Tactical foul committed by ${defender.player_name} to stop the break.`
                });
            }
        }
    }
    
    events.push({
        minute: 90,
        type: 'FULL_TIME',
        score: `${userGoals} - ${aiGoals}`,
        desc: `🏁 Full Time! The referee blows the whistle. Final Score: User Draft Team ${userGoals} - ${aiGoals} AI Draft Team.`
    });
    
    res.json({
        userGoals,
        aiGoals,
        userPower: Number(userPower.toFixed(2)),
        aiPower: Number(aiPower.toFixed(2)),
        events
    });
});


// ==========================================
// 5. SOFASCORE LIVE PIPELINE
// ==========================================

// Proxy Live Scores / Comparisons
app.get('/api/sofascore/live', async (req, res) => {
    const apiKey = process.env.rapidapi;
    if (!apiKey) {
        return res.json(getSimulatedLiveMatches());
    }
    
    try {
        // Real RapidAPI Sofascore Call
        const response = await axios.get('https://sofascore.p.rapidapi.com/matches/get-live-events', {
            headers: {
                'x-rapidapi-host': 'sofascore.p.rapidapi.com',
                'x-rapidapi-key': apiKey
            },
            params: {
                sport: 'football'
            },
            timeout: 5000 // short timeout
        });
        
        res.json({
            source: 'Sofascore API',
            events: response.data.events || []
        });
    } catch (err) {
        console.warn('⚠️ Sofascore API rate limited/failed. Triggering fallback simulation...');
        res.json(getSimulatedLiveMatches());
    }
});

// Compare two players
app.get('/api/sofascore/compare', (req, res) => {
    const { player1, player2 } = req.query;
    
    const p1 = Object.values(playersIndex).find(p => p.player_name.toLowerCase().includes(player1.toLowerCase()));
    const p2 = Object.values(playersIndex).find(p => p.player_name.toLowerCase().includes(player2.toLowerCase()));
    
    if (!p1 || !p2) {
        return res.status(404).json({ error: 'One or both players not found in local database.' });
    }
    
    res.json({
        player1: {
            name: p1.player_name,
            team: p1.team,
            position: p1.position,
            age: p1.age,
            rating: p1.overall_rating,
            goals: p1.goals,
            assists: p1.assists,
            passing: p1.avg_pass_accuracy,
            offense: p1.avg_offense,
            defense: p1.avg_defense,
            possession: p1.avg_possession
        },
        player2: {
            name: p2.player_name,
            team: p2.team,
            position: p2.position,
            age: p2.age,
            rating: p2.overall_rating,
            goals: p2.goals,
            assists: p2.assists,
            passing: p2.avg_pass_accuracy,
            offense: p2.avg_offense,
            defense: p2.avg_defense,
            possession: p2.avg_possession
        }
    });
});

// Helper for simulated live scores
function getSimulatedLiveMatches() {
    return {
        source: 'Simulated Live Stream',
        events: [
            {
                id: 'L001',
                homeTeam: { name: 'Spain', rating: 8.2 },
                awayTeam: { name: 'Saudi Arabia', rating: 6.9 },
                homeScore: { current: 2 },
                awayScore: { current: 1 },
                status: { description: 'In progress', period: '2nd half' },
                minute: 68,
                lastEvent: '🔄 Substitution: Lamine Yamal comes off for Ferran Torres'
            },
            {
                id: 'L002',
                homeTeam: { name: 'Brazil', rating: 8.4 },
                awayTeam: { name: 'Germany', rating: 8.1 },
                homeScore: { current: 0 },
                awayScore: { current: 0 },
                status: { description: 'First half', period: '1st half' },
                minute: 24,
                lastEvent: '🟨 Yellow Card: Vinicius Jr booked for dissent'
            },
            {
                id: 'L003',
                homeTeam: { name: 'United States', rating: 7.4 },
                awayTeam: { name: 'Japan', rating: 7.7 },
                homeScore: { current: 1 },
                awayScore: { current: 2 },
                status: { description: 'Halftime', period: 'HT' },
                minute: 45,
                lastEvent: '⚽ GOAL! Japan converts penalty just before HT whistle!'
            }
        ]
    };
}


// ==========================================
// 6. JOURNEY SIMULATOR ENDPOINTS
// ==========================================

// Run Group stages and Knockout for selected team
app.get('/api/journey/simulate', (req, res) => {
    const selectedTeam = req.query.team;
    if (!selectedTeam || !teamsIndex[selectedTeam]) {
        return res.status(404).json({ error: 'Team not found' });
    }
    
    // Fetch group of the team
    const t = teamsIndex[selectedTeam];
    const groupLetter = t.group;
    const groupTeams = groups[groupLetter];
    
    // Simulate Group Stage Matches for this group
    const groupStandings = groupTeams.map(name => ({
        team_name: name,
        played: 3,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        points: 0
    }));
    
    const matchLogs = [];
    
    // Simulate Round-Robin in group
    for (let i = 0; i < groupTeams.length; i++) {
        for (let j = i + 1; j < groupTeams.length; j++) {
            const teamA = groupTeams[i];
            const teamB = groupTeams[j];
            const ratingA = teamsIndex[teamA].overall_rating;
            const ratingB = teamsIndex[teamB].overall_rating;
            
            // Goal estimation based on ratings
            const baseGoalsA = Math.round(Math.max(0, (ratingA - ratingB) * 1.5 + Math.random() * 3));
            const baseGoalsB = Math.round(Math.max(0, (ratingB - ratingA) * 1.5 + Math.random() * 3));
            
            const standA = groupStandings.find(s => s.team_name === teamA);
            const standB = groupStandings.find(s => s.team_name === teamB);
            
            standA.gf += baseGoalsA;
            standA.ga += baseGoalsB;
            standB.gf += baseGoalsB;
            standB.ga += baseGoalsA;
            
            if (baseGoalsA > baseGoalsB) {
                standA.won++;
                standA.points += 3;
                standB.lost++;
            } else if (baseGoalsA < baseGoalsB) {
                standB.won++;
                standB.points += 3;
                standA.lost++;
            } else {
                standA.drawn++;
                standA.points += 1;
                standB.drawn++;
                standB.points += 1;
            }
            
            matchLogs.push({
                home: teamA,
                away: teamB,
                score: `${baseGoalsA} - ${baseGoalsB}`,
                stage: 'Group Stage'
            });
        }
    }
    
    // Sort Standings
    groupStandings.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    
    // Check if Selected Team qualifies (top 2 qualify)
    const userStandRank = groupStandings.findIndex(s => s.team_name === selectedTeam) + 1;
    const qualifies = userStandRank <= 2;
    
    // Generate simulated bracket nodes down to the final
    const brackets = {
        'Round of 32': { opponent: 'Mexico', userResult: qualifies ? 'W' : 'Did not qualify', score: qualifies ? '2 - 1' : null },
        'Round of 16': { opponent: 'England', userResult: qualifies ? (Math.random() < 0.65 ? 'W' : 'L') : null, score: qualifies ? '3 - 2' : null },
        'Quarter Finals': { opponent: 'Brazil', userResult: qualifies && Math.random() < 0.45 ? 'W' : 'L', score: '1 - 2' },
        'Semi Finals': { opponent: 'France', userResult: 'L', score: null },
        'Final': { opponent: 'Argentina', userResult: 'L', score: null }
    };
    
    res.json({
        team: selectedTeam,
        rank: userStandRank,
        qualifies,
        groupStandings,
        matchLogs,
        brackets
    });
});


// Start server
app.listen(PORT, () => {
    console.log(`🚀 FIFA 2026 server running at http://localhost:${PORT}`);
});
