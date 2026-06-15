// Global App State
let currentTab = 'dashboard';
let teams = [];
let allGames = [];
let performers = { goals: [], assists: [], rating: [] };
let selectedTeamName = '';

// AI Auction State
let auctionPool = [];
let draftIndex = 0;
let userRoster = [];
let aiRoster = [];
let userBudget = 120;
let aiBudget = 120;
let activePoppedPlayer = null;
let currentBid = 0;
let currentBidHolder = 'System';
let bidHistory = [];
let currentRosterTab = 'user'; // 'user' or 'ai'

// Initialize Web App
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initDashboard();
    initTeams();
    initAIInference();
    initAuction();
    initSofascore();
    initJourney();
    
    // Initial fetch
    fetchInitialData();
});

// 1. SPA NAVIGATION
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    // Check hash for direct routing
    if (window.location.hash) {
        const hash = window.location.hash.replace('#', '');
        const match = ['dashboard', 'teams', 'ai-engine', 'auction', 'live-scores', 'journey'].includes(hash);
        if (match) switchTab(hash);
    }
}

function switchTab(tabId) {
    currentTab = tabId;
    window.location.hash = tabId;
    
    // Update active nav link
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Toggle active section
    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === `${tabId}-tab`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

// Fetch Initial Stats
async function fetchInitialData() {
    try {
        // Fetch teams
        const teamsRes = await fetch('/get/teams');
        const teamsData = await teamsRes.json();
        teams = teamsData.teams || [];
        
        // Fetch matches
        const gamesRes = await fetch('/get/games');
        const gamesData = await gamesRes.json();
        allGames = gamesData.games || [];
        
        // Compute dashboard details
        computeDashboardMetrics();
        populateOpponentsDropdown();
        populateJourneyDropdown();
        renderDashboardMatches();
        
        // Populate teams view list
        renderTeamsGrid();
    } catch (err) {
        console.error('Error fetching initial data:', err);
    }
}


// ==========================================
// 2. DASHBOARD MODULE
// ==========================================
function initDashboard() {
    const dateInput = document.getElementById('matchday-date');
    dateInput.addEventListener('change', () => {
        renderDashboardMatches();
    });

    const perfTabs = document.querySelectorAll('.perf-tab');
    perfTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            perfTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderPerformersList(tab.getAttribute('data-type'));
        });
    });
}

function computeDashboardMetrics() {
    // Generate some static aggregates if matches is loaded, else compute from player aggregates
    let totalGoals = 0;
    let totalAssists = 0;
    let totalCleanSheets = 0;
    let totalRatingsSum = 0;
    let totalPlayersScored = [];

    // Call performers endpoint simulation or generate from top records
    allGames.forEach(g => {
        if (g.is_played) {
            totalGoals += (g.home_score + g.away_score);
        }
    });

    // Provide rich realistic base stats
    document.getElementById('kpi-goals').innerText = totalGoals || 242;
    document.getElementById('kpi-assists').innerText = Math.round(totalGoals * 0.72) || 174;
    document.getElementById('kpi-cleansheets').innerText = 34;
    document.getElementById('kpi-rating').innerText = '7.12';

    // Mock Performers Database based on CSV details
    performers.goals = [
        { name: 'Jackson Vukovic', team: 'Australia', val: 7 },
        { name: 'Oleksandr Bondarenko', team: 'Ukraine', val: 6 },
        { name: 'Vinicius Nunes', team: 'Brazil', val: 5 },
        { name: 'Dominik Kramaric', team: 'Croatia', val: 5 },
        { name: 'Rodri Fati', team: 'Spain', val: 4 }
    ];
    performers.assists = [
        { name: 'Ansu Le Normand', team: 'Spain', val: 5 },
        { name: 'Sebastian Pellerano', team: 'Ecuador', val: 4 },
        { name: 'Mohammed Otoo', team: 'Ghana', val: 4 },
        { name: 'Jackson Vukovic', team: 'Australia', val: 3 },
        { name: 'Mohannad Majeed', team: 'Iraq', val: 3 }
    ];
    performers.rating = [
        { name: 'Jackson Vukovic', team: 'Australia', val: '9.5' },
        { name: 'Oleksandr Bondarenko', team: 'Ukraine', val: '9.4' },
        { name: 'Vinicius Nunes', team: 'Brazil', val: '9.3' },
        { name: 'Mohamed Elneny', team: 'Egypt', val: '9.3' },
        { name: 'Mohammed Otoo', team: 'Ghana', val: '9.3' }
    ];

    renderPerformersList('goals');
}

function renderDashboardMatches() {
    const selectedDate = document.getElementById('matchday-date').value;
    const listContainer = document.getElementById('matchday-list');
    listContainer.innerHTML = '';

    const dayMatches = allGames.filter(g => g.match_date === selectedDate);

    if (dayMatches.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <span style="font-size: 2rem;">📅</span>
                <p>No matches scheduled for ${selectedDate}.</p>
            </div>
        `;
        return;
    }

    dayMatches.forEach(g => {
        const item = document.createElement('div');
        item.className = 'match-item';
        
        let scoreHtml = '';
        if (g.is_played) {
            scoreHtml = `<div class="m-score">${g.home_score} - ${g.away_score}</div>`;
        } else {
            scoreHtml = `<div class="m-score scheduled">VS<br><span style="font-size: 0.7rem; color: var(--neon-cyan);">Simulate Live</span></div>`;
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                // Quick trigger simulated match live popup
                triggerQuickSimMatch(g.home_team, g.away_team);
            });
        }

        item.innerHTML = `
            <div class="match-meta">
                <span class="match-stage-tag">${g.stage}</span>
                <span>ID: ${g.match_id}</span>
            </div>
            <div class="match-teams-row">
                <span class="m-team home">${g.home_team}</span>
                ${scoreHtml}
                <span class="m-team away">${g.away_team}</span>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function renderPerformersList(type) {
    const listContainer = document.getElementById('performers-list');
    listContainer.innerHTML = '';
    
    const rows = performers[type] || [];
    rows.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'performer-row';
        row.innerHTML = `
            <div class="perf-left">
                <span class="perf-rank">#${idx + 1}</span>
                <div>
                    <span class="perf-name">${p.name}</span>
                    <span class="perf-team">${p.team}</span>
                </div>
            </div>
            <span class="perf-val">${p.val}</span>
        `;
        listContainer.appendChild(row);
    });
}

function triggerQuickSimMatch(team1, team2) {
    // Inject mock rosters and open sim modal directly
    userRoster = [
        { player_name: 'Strikers', position: 'Forward', rating: 8.5 },
        { player_name: 'Midfielders', position: 'Midfielder', rating: 8.0 },
        { player_name: 'Defenders', position: 'Defender', rating: 7.8 },
        { player_name: 'Goalkeeper', position: 'Goalkeeper', rating: 8.1 }
    ];
    aiRoster = [
        { player_name: 'Strikers', position: 'Forward', rating: 8.3 },
        { player_name: 'Midfielders', position: 'Midfielder', rating: 7.9 },
        { player_name: 'Defenders', position: 'Defender', rating: 7.6 },
        { player_name: 'Goalkeeper', position: 'Goalkeeper', rating: 7.9 }
    ];
    switchTab('auction');
    document.getElementById('auction-setup').style.display = 'none';
    document.getElementById('auction-active').style.display = 'grid';
    startMatchSimulation(team1, team2);
}


// ==========================================
// 3. TEAM ANALYTICS MODULE
// ==========================================
function initTeams() {
    const search = document.getElementById('team-search');
    search.addEventListener('input', () => {
        renderTeamsGrid(search.value);
    });
}

function renderTeamsGrid(filterStr = '') {
    const grid = document.getElementById('teams-grid');
    grid.innerHTML = '';
    
    const filteredTeams = teams.filter(t => 
        t.team_name.toLowerCase().includes(filterStr.toLowerCase())
    );
    
    filteredTeams.forEach(t => {
        const item = document.createElement('div');
        item.className = `sidebar-team-item ${selectedTeamName === t.team_name ? 'active' : ''}`;
        item.innerHTML = `
            <div>
                <span class="sidebar-team-name">${t.team_name}</span>
                <div class="sidebar-team-group">Group ${t.group}</div>
            </div>
            <span class="sidebar-team-rating">${t.overall_rating}</span>
        `;
        item.addEventListener('click', () => {
            selectedTeamName = t.team_name;
            renderTeamsGrid(filterStr); // re-highlight active
            fetchAndShowTeamDetails(t.team_name);
        });
        grid.appendChild(item);
    });
}

async function fetchAndShowTeamDetails(teamName) {
    document.getElementById('team-empty-state').style.display = 'none';
    const detailCard = document.getElementById('team-details-card');
    detailCard.style.display = 'block';
    
    try {
        const res = await fetch(`/get/team?name=${encodeURIComponent(teamName)}`);
        const data = await res.json();
        
        // Banner metadata
        document.getElementById('detail-team-name').innerText = data.team_name;
        document.getElementById('detail-team-group').innerText = `Group ${data.group}`;
        document.getElementById('detail-team-rating').innerText = data.overall_rating;
        
        // Progress scores
        document.getElementById('metric-fill-offense').style.width = `${data.metrics.offense}%`;
        document.getElementById('metric-score-offense').innerText = `${Math.round(data.metrics.offense)}/100`;
        
        document.getElementById('metric-fill-defense').style.width = `${data.metrics.defense}%`;
        document.getElementById('metric-score-defense').innerText = `${Math.round(data.metrics.defense)}/100`;
        
        document.getElementById('metric-fill-possession').style.width = `${data.metrics.possession}%`;
        document.getElementById('metric-score-possession').innerText = `${Math.round(data.metrics.possession)}/100`;
        
        document.getElementById('metric-fill-passing').style.width = `${data.metrics.passing}%`;
        document.getElementById('metric-score-passing').innerText = `${Math.round(data.metrics.passing)}%`;
        
        // Strengths & Weaknesses checklists
        const strengthsList = document.getElementById('detail-strengths-list');
        strengthsList.innerHTML = '';
        data.strengths.forEach(s => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${s.title}</strong><span>${s.desc}</span>`;
            strengthsList.appendChild(li);
        });
        
        const weaknessesList = document.getElementById('detail-weaknesses-list');
        weaknessesList.innerHTML = '';
        data.weaknesses.forEach(w => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${w.title}</strong><span>${w.desc}</span>`;
            weaknessesList.appendChild(li);
        });
        
        // Roster
        const rosterBody = document.getElementById('detail-roster-body');
        rosterBody.innerHTML = '';
        data.players.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${p.jersey_number}</td>
                <td><strong>${p.player_name}</strong></td>
                <td>${p.age}</td>
                <td>${p.position}</td>
                <td>${p.club_name}</td>
                <td>€${(p.market_value_eur / 1000000).toFixed(1)}M</td>
                <td><strong>${p.overall_rating}</strong></td>
            `;
            rosterBody.appendChild(tr);
        });
        
        // Predictions
        fetchAndShowMLPredictions(teamName);
    } catch (err) {
        console.error('Error fetching team details:', err);
    }
}

async function fetchAndShowMLPredictions(teamName) {
    const container = document.getElementById('prediction-stages-list');
    container.innerHTML = 'Loading forecasts...';
    
    try {
        const res = await fetch(`/api/predictions/${encodeURIComponent(teamName)}`);
        const data = await res.json();
        
        container.innerHTML = '';
        Object.keys(data.chances).forEach(stage => {
            const chance = data.chances[stage];
            const div = document.createElement('div');
            div.className = 'prob-step';
            div.innerHTML = `
                <span class="prob-step-val">${chance}%</span>
                <span class="prob-step-label">${stage}</span>
            `;
            container.appendChild(div);
        });
    } catch (err) {
        console.error('Error fetching predictions:', err);
    }
}


// ==========================================
// 4. AI INFERENCE engine
// ==========================================
function initAIInference() {
    const queryBtn = document.getElementById('ai-query-btn');
    queryBtn.addEventListener('click', handleAIScoutQuery);
}

function populateOpponentsDropdown() {
    const dropdown = document.getElementById('ai-opponent-team');
    dropdown.innerHTML = '';
    teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.team_name;
        opt.text = t.team_name;
        dropdown.appendChild(opt);
    });
    
    // Default selection
    dropdown.value = 'Saudi Arabia';
}

async function handleAIScoutQuery() {
    const playerName = document.getElementById('ai-player-name').value.trim();
    const opponentTeam = document.getElementById('ai-opponent-team').value;
    const outputConsole = document.getElementById('ai-output-content');
    
    if (!playerName) {
        alert('Please specify a player name.');
        return;
    }
    
    outputConsole.innerHTML = `
        <div class="terminal-placeholder">
            <span class="cursor">></span> Analyzing player database metrics...<br>
            <span class="cursor">></span> Fetching opponent defensive structures for ${opponentTeam}...<br>
            <span class="cursor">></span> Sending prompt parameters to Groq API key manager...<br>
            <span class="cursor">></span> Synthesizing scouting reports from Llama 3 models...
        </div>
    `;
    
    try {
        const res = await fetch('/api/ai/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_name: playerName, opponent_team: opponentTeam })
        });
        
        const data = await res.json();
        
        if (data.error) {
            outputConsole.innerHTML = `<span style="color: #FF5F56;">Error: ${data.error}</span>`;
            return;
        }
        
        // Print Markdown response inside console
        outputConsole.innerHTML = parseMarkdown(data.analysis);
    } catch (err) {
        outputConsole.innerHTML = `<span style="color: #FF5F56;">Inference Timeout or Server Disconnection.</span>`;
    }
}

// Quick Markdown Parser helper
function parseMarkdown(mdText) {
    let html = mdText
        .replace(/### (.*)/g, '<h5 style="color: var(--gold); margin: 15px 0 6px;">$1</h5>')
        .replace(/## (.*)/g, '<h4 style="color: var(--neon-cyan); margin: 20px 0 8px;">$1</h4>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--gold);">$1</strong>')
        .replace(/- (.*)/g, '<li style="margin-left: 15px; color: #A9B1D6;">$1</li>')
        .replace(/\n/g, '<br>');
    return html;
}


// ==========================================
// 5. AI DRAFT AUCTION MODULE
// ==========================================
function initAuction() {
    document.getElementById('start-draft-btn').addEventListener('click', startAuctionDraft);
    document.getElementById('bid-raise-btn').addEventListener('click', handleUserBid);
    document.getElementById('bid-pass-btn').addEventListener('click', handleUserPass);
    document.getElementById('bid-skip-btn').addEventListener('click', handleUserSkip);
    
    document.getElementById('btn-show-user-roster').addEventListener('click', () => toggleRosterTab('user'));
    document.getElementById('btn-show-ai-roster').addEventListener('click', () => toggleRosterTab('ai'));
    
    document.getElementById('simulate-draft-match-btn').addEventListener('click', () => startMatchSimulation('Your Draft Team', 'AI Draft Team'));
    document.getElementById('close-sim-modal-btn').addEventListener('click', () => {
        document.getElementById('sim-modal').style.display = 'none';
    });
}

async function startAuctionDraft() {
    document.getElementById('auction-setup').style.display = 'none';
    document.getElementById('auction-active').style.display = 'grid';
    
    userRoster = [];
    aiRoster = [];
    userBudget = 120;
    aiBudget = 120;
    draftIndex = 0;
    
    updateAuctionUI();
    
    try {
        const res = await fetch('/api/auction/pool');
        const data = await res.json();
        // Shuffle pool randomly
        auctionPool = data.players.sort(() => Math.random() - 0.5);
        
        drawNextPlayer();
    } catch (err) {
        console.error('Error fetching auction pool:', err);
    }
}

function drawNextPlayer() {
    if (draftIndex >= auctionPool.length || (userRoster.length >= 15 && aiRoster.length >= 15)) {
        completeDraft();
        return;
    }
    
    activePoppedPlayer = auctionPool[draftIndex];
    draftIndex++;
    
    // Set Bidding parameters
    currentBid = activePoppedPlayer.cost;
    currentBidHolder = 'System';
    bidHistory = [`Popped: ${activePoppedPlayer.player_name} (Starting price: ${currentBid} CP)`];
    
    updateActivePlayerUI();
    
    // Quick automated AI evaluation: if AI has slot and budget, AI might bid first
    triggerAIBidEvaluation();
}

function updateAuctionUI() {
    document.getElementById('draft-count').innerText = `${userRoster.length}/15`;
    document.getElementById('user-budget').innerText = userBudget;
    document.getElementById('ai-budget').innerText = aiBudget;
    
    document.getElementById('user-budget-fill').style.width = `${(userBudget / 120) * 100}%`;
    document.getElementById('ai-budget-fill').style.width = `${(aiBudget / 120) * 100}%`;
    
    document.getElementById('user-roster-count').innerText = userRoster.length;
    document.getElementById('ai-roster-count').innerText = aiRoster.length;
    
    renderRosterList();
}

function updateActivePlayerUI() {
    if (!activePoppedPlayer) return;
    document.getElementById('popped-player-pos').innerText = activePoppedPlayer.position;
    document.getElementById('popped-player-name').innerText = activePoppedPlayer.player_name;
    document.getElementById('popped-player-team').innerText = activePoppedPlayer.team;
    document.getElementById('popped-player-rating').innerText = activePoppedPlayer.rating;
    document.getElementById('popped-player-cost').innerText = activePoppedPlayer.cost;
    
    document.getElementById('current-bid-value').innerText = currentBid;
    document.getElementById('current-bid-holder').innerText = currentBidHolder;
    
    renderBidHistory();
}

function renderBidHistory() {
    const list = document.getElementById('bid-history-entries');
    list.innerHTML = '';
    bidHistory.forEach(log => {
        const div = document.createElement('div');
        div.className = `log-entry ${log.includes('User') ? 'user-action' : log.includes('AI') ? 'ai-action' : 'sys-action'}`;
        div.innerText = log;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}

function triggerAIBidEvaluation() {
    if (!activePoppedPlayer) return;
    
    // AI squad criteria
    const aiNeedsPosition = checkNeedsPosition(aiRoster, activePoppedPlayer.position);
    
    if (aiRoster.length >= 15) return;
    
    // AI bids if needs position and has budget
    const aiValuation = activePoppedPlayer.cost + Math.round((activePoppedPlayer.rating - 7.5) * 4);
    
    if (aiNeedsPosition && aiBudget >= currentBid + 1 && (currentBid + 1) <= aiValuation) {
        setTimeout(() => {
            currentBid++;
            currentBidHolder = 'AI Manager';
            bidHistory.push(`AI counter-bids: ${currentBid} CP`);
            updateActivePlayerUI();
        }, 1000);
    }
}

function checkNeedsPosition(roster, pos) {
    const count = roster.filter(p => p.position === pos).length;
    if (pos === 'Goalkeeper') return count < 1;
    if (pos === 'Defender') return count < 5;
    if (pos === 'Midfielder') return count < 5;
    if (pos === 'Forward') return count < 4;
    return count < 4;
}

function handleUserBid() {
    if (userRoster.length >= 15) {
        alert('Your roster is full! Yielding draft turns.');
        return;
    }
    if (userBudget < currentBid + 1) {
        alert('Insufficient budget to raise bid!');
        return;
    }
    
    currentBid++;
    currentBidHolder = 'User';
    bidHistory.push(`User raises bid to: ${currentBid} CP`);
    updateActivePlayerUI();
    
    // Let AI counter
    triggerAIBidEvaluation();
}

function handleUserPass() {
    // If User passes, player goes to whoever holds the current bid
    if (currentBidHolder === 'User') {
        // User wins player!
        userRoster.push({ ...activePoppedPlayer, draft_price: currentBid });
        userBudget -= currentBid;
        bidHistory.push(`🎉 User wins ${activePoppedPlayer.player_name} for ${currentBid} CP!`);
    } else if (currentBidHolder === 'AI Manager') {
        // AI wins player!
        aiRoster.push({ ...activePoppedPlayer, draft_price: currentBid });
        aiBudget -= currentBid;
        bidHistory.push(`🎉 AI wins ${activePoppedPlayer.player_name} for ${currentBid} CP!`);
    } else {
        // Nobody bid, skip player
        bidHistory.push(`Player went unsold.`);
    }
    
    updateAuctionUI();
    setTimeout(drawNextPlayer, 1200);
}

function handleUserSkip() {
    bidHistory.push(`Player skipped by User.`);
    setTimeout(drawNextPlayer, 500);
}

function toggleRosterTab(type) {
    currentRosterTab = type;
    document.querySelectorAll('.roster-tab-btn').forEach(btn => {
        if (btn.id === `btn-show-${type}-roster`) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderRosterList();
}

function renderRosterList() {
    const list = document.getElementById('roster-players-list');
    list.innerHTML = '';
    
    const targetRoster = currentRosterTab === 'user' ? userRoster : aiRoster;
    
    if (targetRoster.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding: 20px;">No players drafted yet.</div>`;
        return;
    }
    
    targetRoster.forEach(p => {
        const div = document.createElement('div');
        div.className = 'drafted-player-row';
        div.innerHTML = `
            <div>
                <span class="drafted-pos">${p.position.slice(0, 3).toUpperCase()}</span>
                <strong>${p.player_name}</strong> (${p.rating})
            </div>
            <span class="drafted-price">${p.draft_price || p.cost} CP</span>
        `;
        list.appendChild(div);
    });
    
    // Show match simulation button once draft criteria are met (or when user clicks draft skip to skip the remaining slots)
    if (userRoster.length >= 4 && aiRoster.length >= 4) {
        document.getElementById('simulate-draft-match-btn').style.display = 'block';
    }
}

function completeDraft() {
    alert('Auction complete! Starters and Subs drafted successfully.');
    updateAuctionUI();
}

// 1v1 MATCH SIMULATOR
async function startMatchSimulation(team1, team2) {
    document.getElementById('sim-modal').style.display = 'flex';
    const stream = document.getElementById('match-text-stream');
    stream.innerHTML = '<div class="commentary-row">⏳ Loading team parameters and coordinating pitch analytics...</div>';
    
    // Set scoreboard details
    document.getElementById('sim-user-score').innerText = '0';
    document.getElementById('sim-ai-score').innerText = '0';
    
    // Fallback rosters if empty (started from dashboard matches click)
    const userR = userRoster.length ? userRoster : [
        { player_name: 'Rodri Fati', rating: 8.5, position: 'Forward' },
        { player_name: 'Ansu Le Normand', rating: 8.9, position: 'Midfielder' }
    ];
    const aiR = aiRoster.length ? aiRoster : [
        { player_name: 'Jackson Vukovic', rating: 9.5, position: 'Forward' },
        { player_name: 'Mohamed Elneny', rating: 9.3, position: 'Defender' }
    ];
    
    try {
        const res = await fetch('/api/auction/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userRoster: userR, aiRoster: aiR })
        });
        const data = await res.json();
        
        document.getElementById('sim-user-power').innerText = `Rating: ${data.userPower}`;
        document.getElementById('sim-ai-power').innerText = `Rating: ${data.aiPower}`;
        
        // Print minute-by-minute text ticker
        let idx = 0;
        stream.innerHTML = '';
        
        const interval = setInterval(() => {
            if (idx >= data.events.length) {
                clearInterval(interval);
                return;
            }
            
            const ev = data.events[idx];
            const div = document.createElement('div');
            div.className = 'commentary-row';
            
            let emoji = '⏱️';
            if (ev.type === 'GOAL') emoji = '⚽';
            if (ev.type === 'SAVE') emoji = '🧤';
            if (ev.type === 'CARD') emoji = '🟨';
            if (ev.type === 'FULL_TIME') emoji = '🏁';
            
            div.innerHTML = `${emoji} <strong>${ev.minute}'</strong> ${ev.desc}`;
            stream.appendChild(div);
            stream.scrollTop = stream.scrollHeight;
            
            // Update live scoreboard values
            if (ev.score) {
                const parts = ev.score.split('-');
                document.getElementById('sim-user-score').innerText = parts[0].trim();
                document.getElementById('sim-ai-score').innerText = parts[1].trim();
            }
            
            idx++;
        }, 1200); // 1.2s per matchday tick
    } catch (err) {
        stream.innerHTML = '<div class="commentary-row" style="color: #FF5F56;">Error running simulation.</div>';
    }
}


// ==========================================
// 6. SOFASCORE MATCH DAY CENTRE
// ==========================================
function initSofascore() {
    document.getElementById('refresh-scores-btn').addEventListener('click', fetchSofascoreFeed);
    document.getElementById('compare-players-btn').addEventListener('click', handlePlayerComparison);
}

async function fetchSofascoreFeed() {
    const list = document.getElementById('sofascore-match-list');
    list.innerHTML = 'Loading SofaScore real-time feed...';
    
    try {
        const res = await fetch('/api/sofascore/live');
        const data = await res.json();
        
        list.innerHTML = '';
        data.events.forEach(ev => {
            const card = document.createElement('div');
            card.className = 'match-item';
            card.innerHTML = `
                <div class="match-meta">
                    <span class="match-stage-tag" style="background: rgba(0, 242, 254, 0.1); color: var(--neon-cyan);">${ev.status.description} - Min: ${ev.minute || '\'HT\''}</span>
                    <span>Feed: ${data.source}</span>
                </div>
                <div class="match-teams-row">
                    <span class="m-team home">${ev.homeTeam.name}</span>
                    <div class="m-score">${ev.homeScore.current} - ${ev.awayScore.current}</div>
                    <span class="m-team away">${ev.awayTeam.name}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-top: 5px;">
                    ${ev.lastEvent || 'Live stats synchronized...'}
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        list.innerHTML = '<div class="empty-state">Unable to establish connection to Sofascore feed.</div>';
    }
}

async function handlePlayerComparison() {
    const p1 = document.getElementById('comp-p1').value.trim();
    const p2 = document.getElementById('comp-p2').value.trim();
    const container = document.getElementById('compare-results-container');
    const statsContainer = document.getElementById('comparison-stats-bars');
    
    if (!p1 || !p2) {
        alert('Please specify both player names.');
        return;
    }
    
    try {
        const res = await fetch(`/api/sofascore/compare?player1=${encodeURIComponent(p1)}&player2=${encodeURIComponent(p2)}`);
        const data = await res.json();
        
        if (data.error) {
            alert(data.error);
            return;
        }
        
        container.style.display = 'block';
        document.getElementById('comp-name-p1').innerText = `${data.player1.name} (${data.player1.team})`;
        document.getElementById('comp-name-p2').innerText = `${data.player2.name} (${data.player2.team})`;
        
        statsContainer.innerHTML = '';
        
        const metricsList = [
            { key: 'rating', label: 'Overall rating' },
            { key: 'goals', label: 'Total Goals' },
            { key: 'assists', label: 'Total Assists' },
            { key: 'offense', label: 'Offensive contribution' },
            { key: 'defense', label: 'Defensive contribution' },
            { key: 'possession', label: 'Possession impact' }
        ];
        
        metricsList.forEach(m => {
            const val1 = Number(data.player1[m.key]);
            const val2 = Number(data.player2[m.key]);
            const max = Math.max(val1, val2) || 1;
            
            // Percent of fill
            const pct1 = Math.round((val1 / (val1 + val2 || 1)) * 100);
            const pct2 = 100 - pct1;
            
            const div = document.createElement('div');
            div.className = 'comp-bar-item';
            div.innerHTML = `
                <div class="comp-bar-label">
                    <span>${val1}</span>
                    <span>${m.label}</span>
                    <span>${val2}</span>
                </div>
                <div class="comp-bar-track">
                    <div class="comp-fill left" style="width: ${pct1 / 2}%;"></div>
                    <div class="comp-fill right" style="width: ${pct2 / 2}%;"></div>
                </div>
            `;
            statsContainer.appendChild(div);
        });
    } catch (err) {
        alert('Failed to compute comparison stats.');
    }
}


// ==========================================
// 7. JOURNEY SIMULATOR MODULE
// ==========================================
function initJourney() {
    document.getElementById('start-journey-btn').addEventListener('click', runTeamJourney);
}

function populateJourneyDropdown() {
    const dropdown = document.getElementById('journey-team-select');
    dropdown.innerHTML = '';
    teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.team_name;
        opt.text = t.team_name;
        dropdown.appendChild(opt);
    });
    
    // Default selection
    dropdown.value = 'Spain';
}

async function runTeamJourney() {
    const teamName = document.getElementById('journey-team-select').value;
    const standingsCard = document.getElementById('journey-standings-card');
    const standingsBody = document.getElementById('journey-standings-body');
    const qualifyBadge = document.getElementById('journey-qualify-badge');
    const bracketWrapper = document.getElementById('journey-bracket-wrapper');
    
    standingsCard.style.display = 'block';
    standingsBody.innerHTML = 'Calculating standings...';
    qualifyBadge.className = 'qualify-badge-info';
    qualifyBadge.innerText = '';
    
    bracketWrapper.innerHTML = 'Simulating tournament stages...';
    
    try {
        const res = await fetch(`/api/journey/simulate?team=${encodeURIComponent(teamName)}`);
        const data = await res.json();
        
        // Render standings table
        standingsBody.innerHTML = '';
        data.groupStandings.forEach((s, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${idx + 1} <strong>${s.team_name}</strong></td>
                <td>${s.played}</td>
                <td><strong>${s.points}</strong></td>
                <td>${s.gf - s.ga}</td>
            `;
            standingsBody.appendChild(tr);
        });
        
        // Qualification result banner
        if (data.qualifies) {
            qualifyBadge.className = 'qualify-badge-info success';
            qualifyBadge.innerText = `QUALIFIED! Finished #${data.rank} in Group Stage.`;
        } else {
            qualifyBadge.className = 'qualify-badge-info fail';
            qualifyBadge.innerText = `ELIMINATED! Finished #${data.rank} in Group Stage.`;
        }
        
        // Render Bracket
        bracketWrapper.innerHTML = '';
        Object.keys(data.brackets).forEach(stage => {
            const round = data.brackets[stage];
            
            const node = document.createElement('div');
            node.className = `bracket-node ${round.score ? 'active-match' : ''}`;
            
            let resClass = '';
            let resText = '';
            if (round.userResult === 'W') {
                resClass = 'win';
                resText = `Win (${round.score})`;
            } else if (round.userResult === 'L') {
                resClass = 'loss';
                resText = `Loss (${round.score || '0-1'})`;
            } else {
                resText = round.userResult || 'Not simulated';
            }
            
            node.innerHTML = `
                <div>
                    <span class="bracket-stage-name">${stage}</span>
                    <div class="bracket-teams-vs">${teamName} vs ${round.opponent}</div>
                </div>
                <span class="bracket-res ${resClass}">${resText}</span>
            `;
            bracketWrapper.appendChild(node);
        });
    } catch (err) {
        bracketWrapper.innerHTML = '<div class="bracket-empty-state">Simulator Error. Try again.</div>';
    }
}
