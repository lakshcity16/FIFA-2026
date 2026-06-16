/* ─────────────────────────────────────────────────────────────
   FIFA 2026 AI HUB — app.js
   Complete client-side logic: charts, auction (1CP start),
   journey simulator, team profiles, AI inference
───────────────────────────────────────────────────────────── */

const API = '';
let _teams = [], _groups = {}, _fixtures = [], _analytics = {}, _performers = {};

// Chart instances (kept for destroy-on-redraw)
let chartGoalsGroup, chartRadar, chartBar, chartJourney, chartPrediction;

// Time Machine State — default to real-world "now" (past midnight UTC so today's matches are finished)
const _defaultSimDate = (() => {
  const now = new Date();
  // Always start at end of current real-world day so today's scheduled matches appear as played
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 0));
  return d;
})();
let _simulatedDate = _defaultSimDate;
let _tmInterval = null;
let _tmIsPlaying = false;
let _commentaryIntervals = {};

// Click delegation for match center
document.addEventListener('click', (e) => {
  const fixtureItem = e.target.closest('.fixture-item');
  if (fixtureItem && fixtureItem.dataset.matchId) {
    openMatchCenter(fixtureItem.dataset.matchId);
    return;
  }
  
  const jrnMatch = e.target.closest('.jrn-match');
  if (jrnMatch && jrnMatch.dataset.matchId) {
    openMatchCenter(jrnMatch.dataset.matchId);
    return;
  }

  const bracketMatch = e.target.closest('.bracket-match');
  if (bracketMatch && bracketMatch.dataset.matchId) {
    openMatchCenter(bracketMatch.dataset.matchId);
    return;
  }
});

// Close modal triggers
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('close-match-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('match-modal').style.display = 'none';
    });
  }
});

/* ══════════════════ INIT ══════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initTimeMachine();
  initThemes();
  initMatchball();
  await Promise.all([
    fetchTeams(), fetchGroups(), fetchPerformers()
  ]);
  initNav();
  await refreshOverviewTab();
  initGroupsTab();
  initTeamsTab();
  initAI();
  initAuction();
  initJourney();
  initPredictor();
  initChatbot();

  // 2-hour refresh pipeline
  setInterval(async () => {
    console.log('Running 2-hour refresh pipeline...');
    await triggerTimeRefresh(true);
  }, 2 * 60 * 60 * 1000);
});

/* ── Fetch helpers (automatically append simulated_time) ── */
const $get = url => {
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = url + separator + `simulated_time=${encodeURIComponent(_simulatedDate.toISOString())}`;
  return fetch(API + fullUrl).then(r => r.json()).catch(() => ({}));
};

const $post = (url, body) => {
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = url + separator + `simulated_time=${encodeURIComponent(_simulatedDate.toISOString())}`;
  return fetch(API + fullUrl, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  }).then(r => r.json()).catch(e => ({ error: e.message }));
};

async function fetchTeams() {
  const d = await $get('/api/teams');
  _teams = d.teams || [];
}
async function fetchGroups() {
  const d = await $get('/api/groups');
  _groups = d.groups || {};
}
async function fetchPerformers() {
  _performers = await $get('/api/performers');
}

/* ══════════════════ TIME MACHINE ══════════════════ */
function initTimeMachine() {
  updateTimeMachineUI();
  setInterval(updateTimeMachineUI, 1000);
}

function updateTimeMachineUI() {
  const clock = document.getElementById('tm-clock');
  if (clock) {
    const now = new Date();
    clock.textContent = now.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) + ' ' + now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  }
}

function startTimeMachineLoop() {
  if (_tmInterval) clearInterval(_tmInterval);
  _tmInterval = setInterval(() => {
    // Advance simulated time by 2 hours
    _simulatedDate.setUTCHours(_simulatedDate.getUTCHours() + 2);
    
    // Check if we hit the end of the tournament (July 20)
    const endTourney = new Date('2026-07-20T00:00:00Z');
    if (_simulatedDate >= endTourney) {
      _simulatedDate = endTourney;
      _tmIsPlaying = false;
      const playBtn = document.getElementById('tm-play-btn');
      if (playBtn) playBtn.textContent = '▶';
      clearInterval(_tmInterval);
    }
    
    // Sync slider value
    const base = new Date('2026-06-11T12:00:00Z');
    const diffDays = Math.floor((_simulatedDate - base) / (24 * 60 * 60 * 1000));
    const slider = document.getElementById('tm-slider');
    if (slider) {
      slider.value = Math.max(0, Math.min(38, diffDays));
    }
    
    updateTimeMachineUI();
    triggerTimeRefresh(false);
  }, 2000);
}

async function triggerTimeRefresh(fullRedraw = true) {
  // Re-fetch standing, performers
  await Promise.all([
    fetchGroups(), fetchPerformers()
  ]);
  
  const tagline = document.getElementById('overview-tagline');
  if (tagline) {
    tagline.textContent = `Live results & stats as of ${_simulatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} — Group Stage in progress`;
  }
  
  const activeTabBtn = document.querySelector('.nav-btn.active');
  const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'overview';
  
  if (activeTab === 'overview') {
    await refreshOverviewTab();
  } else if (activeTab === 'groups') {
    initGroupsTab();
  } else if (activeTab === 'teams') {
    const selectedTeamItem = document.querySelector('.team-list-item.selected');
    if (selectedTeamItem) {
      loadTeamProfile(selectedTeamItem.dataset.team);
    }
  } else if (activeTab === 'journey') {
    const sel = document.getElementById('journey-team-select');
    if (sel && sel.value) {
      runJourney(sel.value);
    }
  }
}

/* ══════════════════ NAVIGATION ══════════════════ */
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.tab !== 'auction' && _auctionTimer) {
        clearInterval(_auctionTimer);
        _auctionTimer = null;
      }
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      
      await triggerTimeRefresh(true);
    });
  });
}

/* ══════════════════ TAB 1: OVERVIEW ══════════════════ */
async function refreshOverviewTab() {
  // Load played fixtures for KPIs
  const d = await $get('/api/fixtures?played=true');
  _fixtures = d.fixtures || [];

  // KPIs
  const totalGoals = _fixtures.reduce((s,f) => s + f.home_score + f.away_score, 0);
  const gpg = _fixtures.length ? (totalGoals / _fixtures.length).toFixed(2) : '-';

  document.getElementById('kpi-matches').textContent = _fixtures.length;
  document.getElementById('kpi-goals').textContent = totalGoals;
  document.getElementById('kpi-gpg').textContent = gpg;

  // Top performers from performers
  if (_performers.goals?.length) {
    const ts = _performers.goals[0];
    document.getElementById('kpi-top-scorer').textContent = ts.player_name.split(' ').pop() + ' (' + ts.goals + '⚽)';
  } else {
    document.getElementById('kpi-top-scorer').textContent = '--';
  }
  if (_performers.assists?.length) {
    const ta = _performers.assists[0];
    document.getElementById('kpi-top-asst').textContent = ta.player_name.split(' ').pop() + ' (' + ta.assists + '🎯)';
  } else {
    document.getElementById('kpi-top-asst').textContent = '--';
  }
  if (_performers.rating?.length) {
    const tr = _performers.rating[0];
    document.getElementById('kpi-top-rated').textContent = tr.player_name.split(' ').pop() + ' (' + tr.rating + '★)';
  } else {
    document.getElementById('kpi-top-rated').textContent = '--';
  }

  // Date-filtered fixtures list (synced to the current simulated date)
  const dateStr = _simulatedDate.toISOString().split('T')[0];
  const dateInput = document.getElementById('date-filter');
  if (dateInput) {
    dateInput.value = dateStr;
  }
  const dateHeader = document.getElementById('overview-date-header');
  if (dateHeader) {
    const formattedDate = _simulatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    // Check if it's today in real world
    const realTodayStr = new Date().toISOString().split('T')[0];
    const isToday = dateStr === realTodayStr;
    dateHeader.textContent = isToday ? `Today's Matches · ${formattedDate}` : `Matches on ${formattedDate}`;
  }
  
  const todayData = await $get('/api/fixtures?date=' + dateStr);
  renderFixtureList(todayData.fixtures || [], document.getElementById('today-fixtures'));
  renderDailyPerformers(todayData.fixtures || []);

  // Live match center update
  updateLiveMonitor(todayData.fixtures || []);

  // Goals by Group chart
  drawGoalsByGroupChart();
}

async function initOverview() {
  const dateInput = document.getElementById('date-filter');
  if (dateInput) {
    dateInput.addEventListener('change', async (e) => {
      // Offset simulated time to the selected date
      const selectedDate = e.target.value;
      const hours = _simulatedDate.getUTCHours();
      const mins = _simulatedDate.getUTCMinutes();
      const nextDt = new Date(`${selectedDate}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00Z`);
      
      const base = new Date('2026-06-11T12:00:00Z');
      const diffDays = Math.floor((nextDt - base) / (24 * 60 * 60 * 1000));
      const slider = document.getElementById('tm-slider');
      if (slider) {
        slider.value = Math.max(0, Math.min(38, diffDays));
      }
      
      _simulatedDate = nextDt;
      updateTimeMachineUI();
      await triggerTimeRefresh();
    });
  }

  // Performers list
  renderPerformers('goals');
  document.querySelectorAll('.pill[data-perf]').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-perf]').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      renderPerformers(p.dataset.perf);
    });
  });

  await refreshOverviewTab();
}

function updateLiveMonitor(fixtures) {
  const liveMatches = fixtures.filter(f => f.status === 'live');
  const panel = document.getElementById('live-monitor-panel');
  const grid = document.getElementById('live-monitor-grid');
  
  if (!liveMatches.length) {
    panel.style.display = 'none';
    grid.innerHTML = '';
    Object.values(_commentaryIntervals).forEach(clearInterval);
    _commentaryIntervals = {};
    return;
  }

  panel.style.display = 'block';
  document.getElementById('live-monitor-meta').textContent = `${liveMatches.length} Match${liveMatches.length > 1 ? 'es' : ''} Currently Playing`;

  grid.innerHTML = liveMatches.map(m => {
    const hFlag = getFlagUrl(m.home);
    const aFlag = getFlagUrl(m.away);
    return `
      <div class="live-card" data-match-id="${m.id}">
        <div class="live-card-header">
          <span class="live-badge"><span class="live-dot pulse"></span> LIVE</span>
          <span class="live-card-minute">${m.minute}'</span>
        </div>
        <div class="live-card-body">
          <div class="live-team-col">
            ${hFlag ? `<img class="live-team-flag" src="${hFlag}" alt="">` : ''}
            <span class="live-team-name">${m.home}</span>
          </div>
          <span class="live-card-score">${m.home_score} – ${m.away_score}</span>
          <div class="live-team-col">
            ${aFlag ? `<img class="live-team-flag" src="${aFlag}" alt="">` : ''}
            <span class="live-team-name">${m.away}</span>
          </div>
        </div>
        <div class="live-commentary-terminal">
          <div class="live-commentary-title">
            <span>🔴 Live AI Commentary</span>
            <span style="font-size: 8px; color: var(--text-2);">Llama 3.1</span>
          </div>
          <div id="live-commentary-${m.id}" style="line-height: 1.4;">
            Commentary incoming...
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.live-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.live-commentary-terminal')) return;
      openMatchCenter(card.dataset.matchId);
    });
  });

  liveMatches.forEach(m => {
    if (!_commentaryIntervals[m.id]) {
      fetchLiveCommentary(m);
      _commentaryIntervals[m.id] = setInterval(() => {
        fetchLiveCommentary(m);
      }, 15000);
    }
  });
}

async function fetchLiveCommentary(match) {
  const commContainer = document.getElementById(`live-commentary-${match.id}`);
  if (!commContainer) return;

  const statsRes = await $get(`/api/match/${match.id}`);
  const res = await $post('/api/ai/live-commentary', {
    matchId: match.id,
    home: match.home,
    away: match.away,
    score: `${match.home_score}-${match.away_score}`,
    scorers: match.scorers,
    minute: match.minute,
    stats: statsRes.stats
  });

  if (res.commentary) {
    commContainer.innerHTML = `<span style="color:var(--accent); font-weight:700;">[${match.minute}']</span> ${res.commentary}`;
  }
}

async function openMatchCenter(matchId) {
  const modal = document.getElementById('match-modal');
  const content = document.getElementById('match-center-content');
  
  modal.style.display = 'flex';
  content.innerHTML = '<div style="text-align:center; padding:40px;"><div class="spinner" style="margin:auto; width:28px; height:28px; border-width:3px; border-top-color:var(--accent)"></div></div>';

  const res = await $get(`/api/live-stats-ai/${matchId}`);
  if (res.error) {
    content.innerHTML = `<div style="color:var(--red); text-align:center; padding:20px;">${res.error}</div>`;
    return;
  }

  const { match, stats, narrative, commentary } = res;
  const hFlag = getFlagUrl(match.home);
  const aFlag = getFlagUrl(match.away);
  
  const dateStr = new Date(match.kickoff).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';

  const homeScorers = match.scorers.filter(s => s.team === 'home');
  const awayScorers = match.scorers.filter(s => s.team === 'away');

  let scorersHtml = '';
  if (match.scorers.length > 0) {
    scorersHtml = `
      <div class="match-modal-scorers-list">
        <div>
          ${homeScorers.map(s => `<div class="match-modal-scorer">⚽ ${s.name} (${s.min}'${s.assist ? `, assist: ${s.assist}` : ''})</div>`).join('')}
        </div>
        <div style="text-align: right;">
          ${awayScorers.map(s => `<div class="match-modal-scorer away">(${s.min}'${s.assist ? `, assist: ${s.assist}` : ''}) ${s.name} ⚽</div>`).join('')}
        </div>
      </div>
    `;
  }

  const statRow = (name, hVal, aVal, isPct = false) => {
    let hWidth = 50;
    let aWidth = 50;
    if (hVal + aVal > 0) {
      hWidth = (hVal / (hVal + aVal)) * 100;
      aWidth = (aVal / (hVal + aVal)) * 100;
    }
    return `
      <div class="match-stat-row">
        <div class="match-stat-labels">
          <span>${hVal}${isPct ? '%' : ''}</span>
          <span class="match-stat-label-name">${name}</span>
          <span>${aVal}${isPct ? '%' : ''}</span>
        </div>
        <div class="match-stat-bar-container">
          <div class="match-stat-bar-home" style="width: ${hWidth}%"></div>
          <div class="match-stat-bar-away" style="width: ${aWidth}%"></div>
        </div>
      </div>
    `;
  };

  const hAnalytics = res.home_analytics || {};
  const aAnalytics = res.away_analytics || {};
  const hRating = hAnalytics.overall_rating || 5.0;
  const aRating = aAnalytics.overall_rating || 5.0;
  const hGroup = hAnalytics.group || '—';
  const aGroup = aAnalytics.group || '—';

  const h2hMetricRow = (metricName, hVal, aVal, suffix = '') => {
    const total = hVal + aVal;
    const hWidth = total > 0 ? (hVal / total) * 100 : 50;
    const aWidth = total > 0 ? (aVal / total) * 100 : 50;
    return `
      <div class="h2h-row">
        <div class="h2h-label-row">
          <span>${metricName}</span>
        </div>
        <div class="h2h-bars-container">
          <span class="h2h-val-left">${hVal}${suffix}</span>
          <div class="h2h-bar-track">
            <div class="h2h-bar-fill-left" style="width: ${hWidth}%;"></div>
            <div class="h2h-bar-fill-right" style="width: ${aWidth}%;"></div>
          </div>
          <span class="h2h-val-right">${aVal}${suffix}</span>
        </div>
      </div>
    `;
  };

  const h2hHtml = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px;">
      <div style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 10px; text-transform: uppercase; color: var(--text-2); margin-bottom: 4px;">FIFA overall rating</div>
        <div style="font-size: 20px; font-weight: 900; color: var(--accent-3);">★ ${hRating}</div>
        <div style="font-size: 11px; color: var(--text-2); margin-top: 4px;">Group ${hGroup}</div>
      </div>
      <div style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 10px; text-transform: uppercase; color: var(--text-2); margin-bottom: 4px;">FIFA overall rating</div>
        <div style="font-size: 20px; font-weight: 900; color: var(--accent-2);">★ ${aRating}</div>
        <div style="font-size: 11px; color: var(--text-2); margin-top: 4px;">Group ${aGroup}</div>
      </div>
    </div>

    <div class="h2h-chart-panel">
      <div class="h2h-chart-title">📊 Key Metrics Head-to-Head</div>
      ${h2hMetricRow('Offense Power', hAnalytics.offense || 50, aAnalytics.offense || 50)}
      ${h2hMetricRow('Defense Solidity', hAnalytics.defense || 50, aAnalytics.defense || 50)}
      ${h2hMetricRow('Passing Precision', hAnalytics.passing || 70, aAnalytics.passing || 70, '%')}
      ${h2hMetricRow('Tactical Possession', hAnalytics.possession || 50, aAnalytics.possession || 50, '%')}
      ${h2hMetricRow('Creativity Rating', hAnalytics.creativity || 50, aAnalytics.creativity || 50)}
    </div>
    <div class="ai-pundit-box" style="margin-top:16px;">
      <div class="ai-pundit-header" style="background:var(--accent); color:#000;">
        <span>✨ Groq Llama 3 Live Narrative</span>
      </div>
      <div class="ai-pundit-content">
        <strong>Match Flow:</strong> ${narrative || "Waiting for live feed..."}
        <ul style="margin-top:8px; padding-left:16px; list-style-type:square; color:var(--text-2);">
          ${(commentary || []).map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
      ${match.status === 'finished' && match.highlights ? `
      <div style="margin-top:12px; text-align:center;">
        <a href="${match.highlights}" target="_blank" style="display:inline-block; background:var(--accent-2); color:#000; padding:8px 16px; border-radius:4px; font-weight:800; text-decoration:none;">▶ Watch FIFA+ Highlights</a>
      </div>` : ''}
    </div>
  `;

  content.innerHTML = `
    <div style="font-size:11px; color:var(--text-2); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; text-align:center;">
      ${match.stage} · ${match.stadium}, ${match.city}
    </div>
    
    <div class="match-modal-header-row">
      <div class="match-modal-team">
        ${hFlag ? `<img src="${hFlag}" alt="">` : ''}
        <span>${match.home}</span>
      </div>
      <div class="match-modal-score">
        ${match.is_played ? `${match.home_score} – ${match.away_score}` : 'VS'}
      </div>
      <div class="match-modal-team">
        ${aFlag ? `<img src="${aFlag}" alt="">` : ''}
        <span>${match.away}</span>
      </div>
    </div>
    
    <div style="text-align:center; font-size:11px; color:var(--text-2); margin-top:-10px; margin-bottom:15px;">
      ${match.status === 'live' ? `<span class="live-badge" style="display:inline-block;"><span class="live-dot pulse"></span> LIVE · ${match.minute}'</span>` : dateStr}
    </div>

    ${scorersHtml}

    ${h2hHtml}

    <div class="match-modal-tabs" style="margin-top: 20px;">
      <button class="match-modal-tab active" id="tab-stats" onclick="switchMatchTab('stats')">Statistics</button>
      <button class="match-modal-tab" id="tab-shotmap" style="border:1px solid #16a085; background:rgba(22, 160, 133, 0.1); color:#1abc9c;" onclick="switchMatchTab('shotmap', '${match.id}')">Live Shotmap (RapidAPI)</button>
    </div>

    <div id="match-stats-pane" class="match-stats-grid">
      ${statRow('Possession', stats.possession.home, stats.possession.away, true)}
      ${statRow('Total Shots', stats.shots.home, stats.shots.away)}
      ${statRow('Shots on Target', stats.shots_on_target.home, stats.shots_on_target.away)}
      ${statRow('Passes Completed', stats.passes.home, stats.passes.away)}
      ${statRow('Pass Accuracy', stats.pass_accuracy.home, stats.pass_accuracy.away, true)}
      ${statRow('Fouls committed', stats.fouls.home, stats.fouls.away)}
      ${statRow('Yellow Cards', stats.yellow_cards.home, stats.yellow_cards.away)}
      ${statRow('Red Cards', stats.red_cards.home, stats.red_cards.away)}
    </div>
    
    <div id="match-shotmap-pane" style="display:none; position:relative; margin-top:20px; text-align:center;">
       <div style="font-size:11px; color:var(--text-2); margin-bottom:10px;">Powered by Sofascore Sport API via RapidAPI</div>
       <div id="shotmap-container" style="position:relative; width:100%; max-width:400px; height:260px; margin:auto; background:#22a6b3; border:2px solid var(--border); border-radius:8px; overflow:hidden;">
          <!-- Pitch Lines -->
          <div style="position:absolute; top:0; bottom:0; left:50%; border-left:2px solid rgba(255,255,255,0.3);"></div>
          <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:60px; height:60px; border:2px solid rgba(255,255,255,0.3); border-radius:50%;"></div>
          <!-- Penalty Areas -->
          <div style="position:absolute; top:20%; bottom:20%; left:0; width:15%; border:2px solid rgba(255,255,255,0.3); border-left:none;"></div>
          <div style="position:absolute; top:20%; bottom:20%; right:0; width:15%; border:2px solid rgba(255,255,255,0.3); border-right:none;"></div>
          <div id="shotmap-dots"></div>
       </div>
    </div>
  `;
}

window.switchMatchTab = async function(tab, matchId) {
  document.getElementById('tab-stats').classList.toggle('active', tab === 'stats');
  document.getElementById('tab-shotmap').classList.toggle('active', tab === 'shotmap');
  document.getElementById('match-stats-pane').style.display = tab === 'stats' ? 'grid' : 'none';
  document.getElementById('match-shotmap-pane').style.display = tab === 'shotmap' ? 'block' : 'none';

  if (tab === 'shotmap') {
    const container = document.getElementById('shotmap-dots');
    container.innerHTML = '<div style="padding:20px; color:white; font-weight:bold; font-size:14px; margin-top:100px;">Fetching Live Shotmap from RapidAPI...</div>';
    
    try {
      const res = await $get(`/api/match/${matchId}/shotmap`);
      const shots = res.shotmap || [];
      if (shots.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:white; font-size:12px; margin-top:100px;">No shotmap data available yet.</div>';
        return;
      }
      
      container.innerHTML = shots.map(shot => {
        // Sofascore coordinates: X is 0 to 100 (width), Y is 0 to 100 (height)
        let x = shot.playerCoordinates ? shot.playerCoordinates.x : 50;
        let y = shot.playerCoordinates ? shot.playerCoordinates.y : 50;
        // Adjust for home/away sides (simplistic mapping)
        if (!shot.isHome) x = 100 - x;
        
        const color = shot.shotType === 'goal' ? '#2ecc71' : shot.shotType === 'save' ? '#f39c12' : '#e74c3c';
        const icon = shot.shotType === 'goal' ? '⚽' : '•';
        const size = shot.shotType === 'goal' ? '18px' : '14px';
        
        return `<div style="position:absolute; top:${y}%; left:${x}%; transform:translate(-50%, -50%); 
                     color:${color}; font-size:${size}; text-shadow:0 0 3px #000;" 
                     title="${shot.player?.name || 'Player'} - ${shot.shotType}">
                  ${icon}
                </div>`;
      }).join('');
      
    } catch (e) {
      container.innerHTML = '<div style="padding:20px; color:var(--red); font-size:12px; margin-top:100px;">Failed to load RapidAPI shotmap.</div>';
    }
  }
}

function renderFixtureList(fixtures, container) {
  if (!fixtures.length) {
    container.innerHTML = '<div style="color:var(--text-2);font-size:13px;padding:20px;text-align:center">No matches on this date</div>';
    return;
  }
  container.innerHTML = fixtures.map(f => {
    const hFlag = getFlagUrl(f.home);
    const aFlag = getFlagUrl(f.away);
    
    let statusBadge = '';
    if (f.status === 'live') {
      statusBadge = `<span class="live-badge" style="padding:1px 6px; font-size:8px; margin-left:6px;"><span class="live-dot pulse"></span> ${f.minute}'</span>`;
    }
    
    const scoreHtml = f.is_played
      ? `<div class="fix-score">${f.home_score} – ${f.away_score}</div>`
      : `<div class="fix-score upcoming">vs</div>`;
    const scorersHtml = f.scorers?.length
      ? `<div style="padding:0 8px 6px;font-size:10px;color:var(--text-2)">${f.scorers.map(s=>`⚽ ${s.name} ${s.min}'${s.assist ? ` (assist: ${s.assist})` : ''}`).join(' · ')}</div>`
      : '';
    return `
      <div class="fixture-item" data-match-id="${f.id}">
        <div>
          <div class="fix-stage" style="display:flex; align-items:center;">${f.stage} ${statusBadge}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">${f.stadium || ''}</div>
        </div>
        <div class="fix-teams">
          <div class="fix-team">${f.home}</div>
          ${hFlag ? `<img class="fix-flag" src="${hFlag}" alt="" onerror="this.style.display='none'">` : ''}
          ${scoreHtml}
          ${aFlag ? `<img class="fix-flag" src="${aFlag}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="fix-team away">${f.away}</div>
        </div>
        <div class="fix-meta" style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <span>${f.city || ''}</span>
          ${f.status === 'finished' && f.highlights ? `<a href="${f.highlights}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px; background:var(--accent-2); color:#000; padding:2px 6px; border-radius:3px; text-decoration:none; font-weight:800;">▶ Highlights</a>` : ''}
        </div>
      </div>
      ${scorersHtml}
    `;
  }).join('');
}

function renderPerformers(type) {
  const data = _performers[type] || [];
  const maxVal = data.length ? Math.max(...data.map(p => p[type])) : 1;
  const container = document.getElementById('performers-list');
  container.className = 'performers-list';
  container.innerHTML = data.slice(0, 10).map((p, i) => {
    const val = p[type];
    const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const flag = getFlagUrl(p.team);
    const posCode = p.position === 'Goalkeeper' ? 'GK' : p.position === 'Defender' ? 'DEF' : p.position === 'Midfielder' ? 'MID' : 'FWD';
    return `
      <div class="perf-row">
        <span class="perf-rank ${rankCls}">${i+1}</span>
        ${flag ? `<img style="width:18px;height:12px;border-radius:2px;object-fit:cover" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;min-width:0">
          <div class="perf-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.player_name}</div>
          <div class="perf-team">${p.team}</div>
        </div>
        <span class="pos-badge pos-${posCode}">${posCode}</span>
        <div style="text-align:right">
          <div class="perf-val">${typeof val === 'number' ? val.toFixed(val%1===0?0:2) : val}</div>
          <div class="perf-bar-wrap"><div class="perf-bar" style="width:${Math.round((val/maxVal)*100)}%"></div></div>
        </div>
      </div>
    `;
  }).join('');
}

function drawGoalsByGroupChart() {
  const groups = Object.keys(_groups).sort();
  const goalsByGroup = groups.map(g => {
    const teams = _groups[g];
    return teams.reduce((s,t) => s + t.gf, 0);
  });

  const ctx = document.getElementById('chart-goals-group').getContext('2d');
  if (chartGoalsGroup) chartGoalsGroup.destroy();
  chartGoalsGroup = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: groups.map(g => 'Group ' + g),
      datasets: [{
        label: 'Goals Scored',
        data: goalsByGroup,
        backgroundColor: groups.map((_, i) => {
          const colors = ['#3b82f6','#22d3ee','#a78bfa','#10b981','#f59e0b','#ef4444','#f97316','#8b5cf6','#06b6d4','#84cc16','#ec4899','#14b8a6'];
          return colors[i % colors.length] + 'cc';
        }),
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#0d1526',
        titleColor: '#e8edf7', bodyColor: '#8da3c4', borderColor: 'rgba(99,179,237,0.3)', borderWidth: 1
      }},
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8da3c4', font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { color: '#8da3c4', font: { size: 11 } } }
      }
    }
  });
}

/* ══════════════════ TAB 2: GROUPS ══════════════════ */
function initGroupsTab() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = Object.entries(_groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([letter, teams]) => {
    const rows = teams.map((t, i) => {
      const flag = getFlagUrl(t.team);
      const isQual = i < 2;
      return `
        <tr>
          <td>
            ${flag ? `<img class="g-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
            ${t.team}${isQual ? '<span class="qual-icon">✓</span>' : ''}
          </td>
          <td>${t.mp}</td>
          <td>${t.w}</td>
          <td>${t.d}</td>
          <td>${t.l}</td>
          <td>${t.gf}</td>
          <td>${t.ga}</td>
          <td style="color:${t.gd>=0?'var(--green)':'var(--red)'}">${t.gd>0?'+':''}${t.gd}</td>
          <td><span class="pts-badge">${t.pts}</span></td>
        </tr>
      `;
    }).join('');
    return `
      <div class="group-card">
        <div class="group-card-header">
          <span class="group-letter">Group ${letter}</span>
          <span class="group-label">WC 2026</span>
        </div>
        <table class="group-table">
          <thead><tr>
            <th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th>
            <th>GF</th><th>GA</th><th>GD</th><th>PTS</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

/* ══════════════════ TAB 3: 48 TEAMS ══════════════════ */
function initTeamsTab() {
  // Populate dropdowns
  const dropdown = document.getElementById('team-dropdown');
  const groupFilter = document.getElementById('group-filter');
  const groups = [...new Set(_teams.map(t=>t.group))].sort();

  groups.forEach(g => {
    const o = document.createElement('option'); o.value = g; o.textContent = 'Group ' + g;
    groupFilter.appendChild(o);
  });

  _teams.forEach(t => {
    const o = document.createElement('option'); o.value = t.name; o.textContent = t.name;
    dropdown.appendChild(o);
  });

  // Build sidebar list
  const teamsList = document.getElementById('teams-list');
  const renderSidebar = (filter = '', group = '') => {
    const filtered = _teams.filter(t =>
      t.name.toLowerCase().includes(filter.toLowerCase()) &&
      (!group || t.group === group)
    );
    teamsList.innerHTML = filtered.map(t => {
      const flag = getFlagUrl(t.name);
      return `
        <div class="team-list-item" data-team="${t.name}">
          ${flag ? `<img class="tli-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="tli-name">${t.name}</span>
          <span class="tli-group">${t.group}</span>
        </div>
      `;
    }).join('');
    teamsList.querySelectorAll('.team-list-item').forEach(el => {
      el.addEventListener('click', () => {
        teamsList.querySelectorAll('.team-list-item').forEach(x=>x.classList.remove('selected'));
        el.classList.add('selected');
        loadTeamProfile(el.dataset.team);
      });
    });
  };

  document.getElementById('team-search').addEventListener('input', e => renderSidebar(e.target.value, groupFilter.value));
  groupFilter.addEventListener('change', e => renderSidebar(document.getElementById('team-search').value, e.target.value));
  dropdown.addEventListener('change', e => {
    if (e.target.value) loadTeamProfile(e.target.value);
  });

  renderSidebar();
}

async function loadTeamProfile(teamName) {
  const profile = document.getElementById('team-profile');
  profile.innerHTML = '<div class="empty-state"><div class="spinner" style="width:28px;height:28px;border-width:3px;border-top-color:var(--accent)"></div></div>';

  const [data, pred] = await Promise.all([
    $get('/api/team/' + encodeURIComponent(teamName)),
    $get('/api/predict/' + encodeURIComponent(teamName))
  ]);

  if (data.error) { profile.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`; return; }

  const a = data.analytics;
  const flag = getFlagUrl(teamName);

  // Build profile HTML
  profile.innerHTML = `
    <div class="tp-header">
      ${flag ? `<img class="tp-flag" src="${flag}" alt="${teamName}">` : ''}
      <div class="tp-info">
        <div class="tp-name">${teamName}</div>
        <div class="tp-meta">
          <span class="tp-group-badge">Group ${a.group}</span>
          <span class="tp-rating">★ ${a.overall_rating}</span>
          <span style="font-size:12px;color:var(--text-2)">${a.fifa_code}</span>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--text-2);margin-bottom:4px">Advance chance</div>
        <div style="font-size:28px;font-weight:900;color:${pred.qualifies?'var(--green)':'var(--red)'}">${pred.stages?.['Round of 32'] || 0}%</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tp-tabs">
      <button class="tp-tab active" data-tptab="overview">Overview</button>
      <button class="tp-tab" data-tptab="squad">Squad (${data.squad.length})</button>
      <button class="tp-tab" data-tptab="fixtures">Fixtures</button>
      <button class="tp-tab" data-tptab="prediction">Prediction</button>
    </div>
    <div class="tp-body" id="tp-body"></div>
  `;

  // Inner tab switching
  const tpBody = profile.querySelector('#tp-body');
  const tpTabs = profile.querySelectorAll('.tp-tab');
  const renderTPTab = (tab) => {
    tpTabs.forEach(t => t.classList.toggle('active', t.dataset.tptab === tab));
    tpBody.innerHTML = '';
    if (tab === 'overview') renderTeamOverview(tpBody, data, pred, a);
    if (tab === 'squad')    renderTeamSquad(tpBody, data.squad);
    if (tab === 'fixtures') renderTeamFixtures(tpBody, data.played, data.upcoming);
    if (tab === 'prediction') renderTeamPrediction(tpBody, pred, teamName);
  };
  tpTabs.forEach(t => t.addEventListener('click', () => renderTPTab(t.dataset.tptab)));
  renderTPTab('overview');

  // Sync sidebar selection
  document.querySelectorAll('.team-list-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.team === teamName);
  });
}

function renderTeamOverview(container, data, pred, a) {
  // WDL
  const wdlHtml = `
    <div class="wdl-row">
      <div class="wdl-badge wdl-w">${data.w}<span>W</span></div>
      <div class="wdl-badge wdl-d">${data.d}<span>D</span></div>
      <div class="wdl-badge wdl-l">${data.l}<span>L</span></div>
    </div>`;

  // Strengths / weaknesses
  const swHtml = `
    <div class="sw-grid">
      ${data.strengths.map(s => `
        <div class="sw-card strength">
          <div class="sw-icon">💪</div>
          <div class="sw-metric strength">${s.metric}</div>
          <div class="sw-val strength">${s.value}</div>
        </div>
      `).join('')}
      ${data.weaknesses.map(w => `
        <div class="sw-card weakness">
          <div class="sw-icon">⚠️</div>
          <div class="sw-metric weakness">${w.metric}</div>
          <div class="sw-val weakness">${w.value}</div>
        </div>
      `).join('')}
    </div>`;

  container.innerHTML = wdlHtml + swHtml + `
    <div class="tp-charts">
      <div class="tp-chart-box">
        <h4>Team Radar</h4>
        <div class="chart-wrap"><canvas id="tp-radar"></canvas></div>
      </div>
      <div class="tp-chart-box">
        <h4>Avg per Match</h4>
        <div class="chart-wrap"><canvas id="tp-bar"></canvas></div>
      </div>
    </div>`;

  // Radar
  setTimeout(() => {
    const ctx1 = document.getElementById('tp-radar')?.getContext('2d');
    if (ctx1) {
      if (chartRadar) chartRadar.destroy();
      chartRadar = new Chart(ctx1, {
        type: 'radar',
        data: {
          labels: ['Offense','Defense','Passing','Possession','Creativity'],
          datasets: [{
            label: a.team || 'Team',
            data: [a.offense, a.defense, a.passing, a.possession, a.creativity],
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)',
            borderWidth: 2, pointBackgroundColor: '#22d3ee', pointRadius: 3
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.07)' },
            pointLabels: { color: '#8da3c4', font: { size: 10, family: 'Outfit' } },
            ticks: { display: false } }},
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0d1526', titleColor: '#e8edf7', bodyColor: '#8da3c4' } }
        }
      });
    }
    const ctx2 = document.getElementById('tp-bar')?.getContext('2d');
    if (ctx2) {
      if (chartBar) chartBar.destroy();
      chartBar = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: ['Goals','Shots','xG'],
          datasets: [{
            data: [a.avg_goals, a.avg_shots, a.avg_xg],
            backgroundColor: ['rgba(34,211,238,0.6)','rgba(59,130,246,0.6)','rgba(167,139,250,0.6)'],
            borderRadius: 5, borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0d1526', titleColor: '#e8edf7', bodyColor: '#8da3c4' } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8da3c4', font:{size:10} } },
            y: { grid: { display: false }, ticks: { color: '#8da3c4', font:{size:11} } }
          }
        }
      });
    }
  }, 50);
}

function renderTeamSquad(container, squad) {
  const posSorted = [...squad].sort((a,b) => {
    const o = {Goalkeeper:0,Defender:1,Midfielder:2,Forward:3};
    return (o[a.position]||4) - (o[b.position]||4) || a.jersey - b.jersey;
  });
  const posCode = p => p === 'Goalkeeper' ? 'GK' : p === 'Defender' ? 'DEF' : p === 'Midfielder' ? 'MID' : 'FWD';
  container.innerHTML = `
    <div style="overflow-x:auto">
    <table class="squad-table">
      <thead><tr>
        <th>#</th><th>Name</th><th>Pos</th><th>Age</th><th>Club</th>
        <th>Goals</th><th>Assists</th><th>Mins</th><th>Rating</th>
      </tr></thead>
      <tbody>
        ${posSorted.map(p => `
          <tr>
            <td style="color:var(--text-2)">${p.jersey||'-'}</td>
            <td style="font-weight:600">${p.name}</td>
            <td><span class="pos-badge pos-${posCode(p.position)}">${posCode(p.position)}</span></td>
            <td>${p.age||'-'}</td>
            <td style="color:var(--text-2);font-size:11px">${p.club||'-'}</td>
            <td>${p.goals}</td>
            <td>${p.assists}</td>
            <td>${p.minutes}</td>
            <td style="color:var(--gold)">${p.rating}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderTeamFixtures(container, played, upcoming) {
  const rowHtml = (f, isPlayed) => {
    const flag = getFlagUrl(f.opponent);
    const resultColor = f.result === 'W' ? 'var(--green)' : f.result === 'D' ? 'var(--gold)' : 'var(--red)';
    return `
      <div class="fixture-item" data-match-id="${f.id}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border);font-size:12px">
        <span style="color:var(--text-2);min-width:80px">${f.date}</span>
        ${flag ? `<img style="width:18px;height:12px;border-radius:2px;object-fit:cover" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
        <span style="flex:1;font-weight:600">vs ${f.opponent}</span>
        <span style="font-size:10px;color:var(--accent)">${f.stage}</span>
        ${isPlayed
          ? `<span style="font-weight:800;color:${resultColor}">${f.result}</span>
             <span style="font-size:13px;font-weight:700">${f.team_score}–${f.opp_score}</span>`
          : `<span style="color:var(--text-2)">Upcoming</span>`
        }
      </div>`;
  };
  container.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Results</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${played.map(f => rowHtml(f, true)).join('') || '<p style="color:var(--text-2);font-size:13px">No results yet</p>'}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Upcoming</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${upcoming.slice(0,6).map(f => rowHtml(f, false)).join('') || '<p style="color:var(--text-2);font-size:13px">No upcoming fixtures</p>'}
      </div>
    </div>`;
}

function renderTeamPrediction(container, pred, teamName) {
  const stages = pred.stages || {};
  container.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-2);margin-bottom:6px">Group ${pred.group || '?'} · Current rank: <strong style="color:#fff">#${pred.group_rank||'?'}</strong></div>
      <div style="font-size:13px;color:var(--text-2)">Overall power index: <strong style="color:var(--accent-2)">${pred.power||0}/100</strong></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      ${Object.entries(stages).map(([stage, pct]) => `
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;color:var(--text-2);min-width:130px">${stage}</span>
          <div style="flex:1;background:rgba(255,255,255,.06);border-radius:4px;height:8px">
            <div style="width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent-2));height:8px;border-radius:4px;transition:width .6s ease"></div>
          </div>
          <span style="font-size:13px;font-weight:700;min-width:36px;text-align:right;color:${pct>=50?'var(--green)':pct>=25?'var(--gold)':'var(--red)'}">${pct}%</span>
        </div>
      `).join('')}
    </div>
    <div style="height:200px"><canvas id="tp-pred-chart"></canvas></div>`;

  setTimeout(() => {
    const ctx = document.getElementById('tp-pred-chart')?.getContext('2d');
    if (!ctx) return;
    if (chartPrediction) chartPrediction.destroy();
    chartPrediction = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Object.keys(stages),
        datasets: [{
          label: 'Advance Probability %',
          data: Object.values(stages),
          borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.1)',
          borderWidth: 2, fill: true, tension: 0.4,
          pointBackgroundColor: '#22d3ee', pointRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend:{display:false}, tooltip:{backgroundColor:'#0d1526',titleColor:'#e8edf7',bodyColor:'#8da3c4'}},
        scales: {
          y: { min:0, max:100, grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#8da3c4',font:{size:10},callback:v=>v+'%'}},
          x: { grid:{display:false}, ticks:{color:'#8da3c4',font:{size:10}}}
        }
      }
    });
  }, 50);
}

/* ══════════════════ TAB 4: AI INFERENCE ══════════════════ */
function initAI() {
  const oppSelect = document.getElementById('ai-opponent');
  _teams.forEach(t => {
    const o = document.createElement('option'); o.value = t.name; o.textContent = t.name;
    oppSelect.appendChild(o);
  });

  document.getElementById('ai-run-btn').addEventListener('click', runAI);
  document.getElementById('cmp-btn').addEventListener('click', runCompare);
}

async function runAI() {
  const player = document.getElementById('ai-player').value.trim();
  const opponent = document.getElementById('ai-opponent').value;
  if (!player || !opponent) return;

  const output = document.getElementById('ai-output');
  output.innerHTML = `<span class="t-prompt">&gt; </span><div class="ai-thinking"><div class="spinner"></div> Querying Groq · Llama 3 · analyzing ${player} vs ${opponent}...</div>`;

  const res = await $post('/api/ai/analyze', { player, opponent });

  if (res.error) {
    output.innerHTML = `<span class="t-prompt">&gt; </span><span style="color:var(--red)">Error: ${res.error}</span>`;
    return;
  }

  const text = res.analysis || 'No analysis returned.';
  output.innerHTML = `<span class="t-prompt">&gt; ${player} vs ${opponent}</span>\n\n`;
  // Typewriter effect
  let i = 0;
  const span = document.createElement('span');
  output.appendChild(span);
  const type = () => {
    if (i < text.length) {
      span.textContent += text[i++];
      output.scrollTop = output.scrollHeight;
      setTimeout(type, 8);
    }
  };
  type();
}

async function runCompare() {
  const p1 = document.getElementById('cmp-p1').value.trim();
  const p2 = document.getElementById('cmp-p2').value.trim();
  if (!p1 || !p2) return;
  const out = document.getElementById('compare-out');
  out.style.display = 'none';
  out.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px"><div class="spinner" style="margin:auto;width:20px;height:20px"></div></div>';
  out.style.display = 'grid';

  const res = await $get('/api/compare?p1=' + encodeURIComponent(p1) + '&p2=' + encodeURIComponent(p2));
  if (res.error) { out.innerHTML = `<div style="grid-column:1/-1;color:var(--red)">${res.error}</div>`; return; }

  const renderPlayer = (p) => {
    const posCode = p.position === 'Goalkeeper' ? 'GK' : p.position === 'Defender' ? 'DEF' : p.position === 'Midfielder' ? 'MID' : 'FWD';
    return `
      <div class="cmp-player">
        <h4>${p.name}</h4>
        <div class="team">${p.team} · <span class="pos-badge pos-${posCode}">${posCode}</span></div>
        ${[['Age', p.age||'-'],['Club', p.club||'-'],['Goals', p.goals],['Assists', p.assists],
           ['Minutes', p.minutes],['Rating', p.rating],['Height', (p.height||'-')+'cm'],
           ['Value', '€'+(p.value_m||0)+'M']].map(([l,v])=>`
          <div class="cmp-stat"><span class="label">${l}</span><span class="val">${v}</span></div>
        `).join('')}
      </div>`;
  };
  out.innerHTML = renderPlayer(res.player1) + '<div class="cmp-vs">VS</div>' + renderPlayer(res.player2);
}

/* ══════════════════ TAB 5: AUCTION ══════════════════ */
let _pool = [], _poolIdx = 0;
let _userBudget = 120, _aiBudget = 120;
let _userSquad = [], _aiSquad = [];
let _curBid = 1, _curHolder = null; // starts at 1 CP
let _curPlayer = null;
let _auctionTimer = null;
let _auctionSecondsLeft = 10;

function initAuction() {
  document.getElementById('start-auction-btn').addEventListener('click', startAuction);
  document.getElementById('btn-raise').addEventListener('click', userRaise);
  document.getElementById('btn-pass').addEventListener('click', userPass);
  document.getElementById('btn-skip').addEventListener('click', skipPlayer);
  document.getElementById('simulate-btn').addEventListener('click', simulateMatch);
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('sim-modal').style.display = 'none';
  });
}

async function startAuction() {
  const res = await $get('/api/auction/pool');
  _pool = res.players || [];
  _poolIdx = 0;
  _userBudget = 120; _aiBudget = 120;
  _userSquad = []; _aiSquad = [];

  document.getElementById('auction-setup').style.display = 'none';
  document.getElementById('auction-board').style.display = 'grid';
  document.getElementById('sim-ready').style.display = 'none';

  // Clear AI roster list visual
  document.getElementById('ai-roster').innerHTML = '';

  updateBudgetDisplays();
  updatePitchView();
  nextPlayer();
}

function nextPlayer() {
  const totalNeeded = 11;
  const userDone = _userSquad.length >= totalNeeded;
  const aiDone = _aiSquad.length >= totalNeeded;

  if (userDone && aiDone) {
    endAuction(); return;
  }

  if (_poolIdx >= _pool.length) {
    endAuction(); return;
  }

  _curPlayer = _pool[_poolIdx++];
  _curBid = 1; // Always start at 1 CP
  _curHolder = null;

  // Display player card
  const groupPos = ['GK'].includes(_curPlayer.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(_curPlayer.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(_curPlayer.position) ? 'MID' : 'FWD';
  document.getElementById('cur-pos').textContent = _curPlayer.position;
  document.getElementById('cur-pos').className = 'cur-pos pos-badge pos-' + groupPos;
  document.getElementById('cur-tier').textContent = _curPlayer.tier || '';
  const flagUrl = getFlagUrl(_curPlayer.team);
  const flagImg = document.getElementById('cur-flag');
  if (flagImg) {
    if (flagUrl) {
      flagImg.src = flagUrl;
      flagImg.style.display = 'inline-block';
    } else {
      flagImg.style.display = 'none';
    }
  }
  const nameText = document.getElementById('cur-name-text');
  if (nameText) nameText.textContent = _curPlayer.name;
  document.getElementById('cur-team').textContent = _curPlayer.team;
  document.getElementById('cur-rating').textContent = _curPlayer.rating;
  document.getElementById('cur-goals').textContent = _curPlayer.goals;
  document.getElementById('cur-assists').textContent = _curPlayer.assists;
  document.getElementById('cur-age').textContent = _curPlayer.age;
  updateBidDisplay();
  clearBidLog();
  logBid(`Player drawn: ${_curPlayer.name} (${_curPlayer.team}) · Start: 1 CP`, 'neutral');

  // Check if position already filled for user
  const userHasPos = _userSquad.some(p => p.position === _curPlayer.position);
  const raiseBtn = document.getElementById('btn-raise');
  if (userHasPos) {
    raiseBtn.disabled = true;
    raiseBtn.textContent = `Position ${_curPlayer.position} Filled`;
    raiseBtn.style.opacity = 0.5;
  } else {
    raiseBtn.disabled = false;
    raiseBtn.textContent = "▲ Raise Bid (+1 CP)";
    raiseBtn.style.opacity = 1;
  }

  // Enable pass button
  document.getElementById('btn-pass').disabled = false;

  resetAuctionTimer();

  // AI auto-bids after short delay if it wants this player
  setTimeout(aiDecide, 350);
}

function aiDecide() {
  if (_aiSquad.length >= 11) return;
  const aiHasPos = _aiSquad.some(p => p.position === _curPlayer.position);
  const rating = _curPlayer.rating || 7;
  const isDesperate = (_pool.length - _poolIdx) < (11 - _aiSquad.length) * 3;
  const wantsPlayer = !aiHasPos && _aiBudget > _curBid && (rating >= 7.6 || isDesperate);

  if (wantsPlayer) {
    // AI bids heavily on top players, passes on mediocre ones
    let maxAIBid = Math.min(_aiBudget - (11 - _aiSquad.length - 1), Math.round((rating - 7.0) * 15 + 5));
    if (rating >= 8.2) maxAIBid = Math.min(_aiBudget - (11 - _aiSquad.length - 1), 60); // Goes all in for superstars
    if (rating < 7.6 && !isDesperate) maxAIBid = 0;
    if (_curHolder !== 'ai' && _curBid <= maxAIBid) {
      _curBid += 1;
      _curHolder = 'ai';
      updateBidDisplay();
      logBid(`AI bids ${_curBid} CP`, 'ai');
      resetAuctionTimer();
    }
  }
}

function userRaise() {
  if (_userBudget <= _curBid) {
    logBid('Not enough budget!', 'neutral'); return;
  }
  if (_userSquad.length >= 11) {
    logBid('Your squad is full!', 'neutral'); return;
  }
  _curBid += 1;
  _curHolder = 'user';
  updateBidDisplay();
  logBid(`You bid ${_curBid} CP`, 'user');
  resetAuctionTimer();

  // AI counter after delay
  setTimeout(() => {
    if (_aiSquad.length >= 11) return;
    const aiHasPos = _aiSquad.some(p => p.position === _curPlayer.position);
    const rating = _curPlayer.rating || 7;
    const isDesperate = (_pool.length - _poolIdx) < (11 - _aiSquad.length) * 3;
    let maxAIBid = Math.min(_aiBudget - (11 - _aiSquad.length - 1), Math.round((rating - 7.0) * 15 + 5));
    if (rating >= 8.2) maxAIBid = Math.min(_aiBudget - (11 - _aiSquad.length - 1), 60);
    if (rating < 7.6 && !isDesperate) maxAIBid = 0;

    if (!aiHasPos && _curBid < maxAIBid && _aiBudget > _curBid && (rating >= 7.6 || isDesperate)) {
      _curBid += 1;
      _curHolder = 'ai';
      updateBidDisplay();
      logBid(`AI raises to ${_curBid} CP`, 'ai');
      resetAuctionTimer();
    }
  }, 300);
}

function userPass() {
  if (_auctionTimer) clearInterval(_auctionTimer);
  // User passes → if AI is holder, AI wins; if no holder, draw next
  if (_curHolder === 'user') {
    // User was winning, now passes — AI gets at current price
    _curHolder = 'ai';
    awardPlayer('ai');
  } else if (_curHolder === 'ai') {
    // AI wins current bid
    awardPlayer('ai');
  } else {
    // No one bid, draw next
    nextPlayer();
  }
}

function skipPlayer() {
  if (_auctionTimer) clearInterval(_auctionTimer);
  if (_curHolder === 'ai') {
    logBid(`Skipped: awarding ${_curPlayer.name} to AI at ${_curBid} CP`, 'ai');
    awardPlayer('ai');
  } else {
    logBid('Player skipped — drawing next...', 'neutral');
    nextPlayer();
  }
}

function awardPlayer(winner) {
  if (_auctionTimer) clearInterval(_auctionTimer);
  const price = _curBid;
  const p = { ..._curPlayer, paid_cp: price };

  if (winner === 'user') {
    _userBudget -= price;
    _userSquad.push(p);
    logBid(`✅ You win ${_curPlayer.name} for ${price} CP!`, 'user');
    updatePitchView();
  } else {
    _aiBudget -= price;
    _aiSquad.push(p);
    logBid(`🤖 AI wins ${_curPlayer.name} for ${price} CP`, 'ai');
    addToRoster('ai-roster', p);
  }

  updateBudgetDisplays();

  const userDone = _userSquad.length >= 11;
  const aiDone   = _aiSquad.length >= 11;
  if (userDone && aiDone) { endAuction(); return; }

  setTimeout(nextPlayer, 1200);
}

function addToRoster(id, p) {
  const groupPos = ['GK'].includes(p.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(p.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(p.position) ? 'MID' : 'FWD';
  const flag = getFlagUrl(p.team);
  const div = document.createElement('div');
  div.className = 'roster-item';
  div.innerHTML = `
    <span class="ri-pos pos-badge pos-${groupPos}">${p.position}</span>
    ${flag ? `<img src="${flag}" style="width:14px; height:10px; border-radius:1px; object-fit:cover; margin-right:6px; vertical-align:middle;">` : ''}
    <span class="ri-name">${p.name}</span>
    <span class="ri-cp">${p.paid_cp}CP</span>`;
  document.getElementById(id).appendChild(div);
}

function updateBidDisplay() {
  document.getElementById('cur-bid').textContent = _curBid;
  document.getElementById('cur-holder').textContent = _curHolder === 'user' ? 'You' : _curHolder === 'ai' ? 'AI' : '—';
}

function updateBudgetDisplays() {
  document.getElementById('user-budget').textContent = _userBudget;
  document.getElementById('ai-budget').textContent = _aiBudget;
  document.getElementById('user-bar').style.width = (_userBudget / 120 * 100) + '%';
  document.getElementById('ai-bar').style.width = (_aiBudget / 120 * 100) + '%';
}

function logBid(msg, type) {
  const log = document.getElementById('bid-log');
  const div = document.createElement('div');
  div.className = 'bid-entry ' + (type || '');
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function clearBidLog() {
  document.getElementById('bid-log').innerHTML = '';
}

function getNeededPositions(squad) {
  const counts = { Goalkeeper: 0, Defender: 0, Midfielder: 0, Forward: 0 };
  squad.forEach(p => { if (counts[p.position] !== undefined) counts[p.position]++; });
  const needed = [];
  if (counts.Goalkeeper < 2) needed.push('Goalkeeper');
  if (counts.Defender < 5) needed.push('Defender');
  if (counts.Midfielder < 5) needed.push('Midfielder');
  if (counts.Forward < 3) needed.push('Forward');
  return needed;
}

function endAuction() {
  if (_auctionTimer) clearInterval(_auctionTimer);
  logBid('🏁 Draft complete!', 'neutral');
  document.getElementById('btn-raise').disabled = true;
  document.getElementById('btn-pass').disabled = true;
  if (_userSquad.length >= 11 && _aiSquad.length >= 11) {
    document.getElementById('sim-ready').style.display = 'block';
  }
}

async function simulateMatch() {
  const res = await $post('/api/auction/simulate', {
    userSquad: _userSquad.slice(0,11),
    aiSquad: _aiSquad.slice(0,11)
  });
  if (res.error) { alert(res.error); return; }

  const modal = document.getElementById('sim-modal');
  document.getElementById('sb-user').textContent = '0';
  document.getElementById('sb-ai').textContent = '0';
  document.getElementById('sb-upow').textContent = 'Avg Rating: ' + res.userPower;
  document.getElementById('sb-apow').textContent = 'Avg Rating: ' + res.aiPower;
  document.getElementById('match-feed').innerHTML = '';
  
  // Dynamic flag icons on the scoreboard
  const userFlags = [...new Set(_userSquad.map(p => getFlagUrl(p.team)).filter(Boolean))].slice(0, 3).map(f => `<img src="${f}" style="width:14px; height:9px; border-radius:1px; margin-right:2px; vertical-align:middle;">`).join('');
  const aiFlags = [...new Set(_aiSquad.map(p => getFlagUrl(p.team)).filter(Boolean))].slice(0, 3).map(f => `<img src="${f}" style="width:14px; height:9px; border-radius:1px; margin-left:2px; vertical-align:middle;">`).join('');

  document.querySelector('.sb-team:first-child .sb-name').innerHTML = `<span style="display:flex; align-items:center; justify-content:center; gap:6px;">⭐ User Dream Team ${userFlags}</span>`;
  document.querySelector('.sb-team:last-child .sb-name').innerHTML = `<span style="display:flex; align-items:center; justify-content:center; gap:6px;">${aiFlags} AI Elite Manager 🤖</span>`;

  modal.style.display = 'flex';

  // Animate events
  let delay = 0;
  let lastScore = '0-0';
  res.events.forEach(ev => {
    delay += 400;
    setTimeout(() => {
      if (ev.type === 'GOAL') {
        const [u, a] = ev.score.split('-');
        document.getElementById('sb-user').textContent = u;
        document.getElementById('sb-ai').textContent = a;
      }
      const div = document.createElement('div');
      div.className = 'mf-event ' + ev.type;
      div.innerHTML = `<span class="mf-min">${ev.min}'</span><span style="flex:1">${ev.desc}</span><span class="mf-score">${ev.score}</span>`;
      const feed = document.getElementById('match-feed');
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }, delay);
  });
}

/* ══════════════════ TAB 6: JOURNEY ══════════════════ */
function initJourney() {
  const sel = document.getElementById('journey-team-select');
  sel.innerHTML = '<option value="">-- Select Nation --</option>';
  _teams.forEach(t => {
    const o = document.createElement('option'); o.value = t.name; o.textContent = t.name + ' (Group ' + t.group + ')';
    sel.appendChild(o);
  });
  document.getElementById('run-journey-btn').addEventListener('click', async () => {
    const team = sel.value;
    if (!team) return;
    await runJourney(team);
  });
}

async function runJourney(teamName) {
  const content = document.getElementById('journey-content');
  content.innerHTML = '<div class="empty-state"><div class="spinner" style="width:28px;height:28px;border-width:3px;border-top-color:var(--accent);margin:auto"></div></div>';

  const data = await $get('/api/journey/' + encodeURIComponent(teamName));
  if (data.error) { content.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`; return; }

  const flag = getFlagUrl(teamName);
  const ko = data.knockout;

  // Group info
  const groupInfoEl = document.getElementById('journey-group-info');
  groupInfoEl.style.display = 'block';
  groupInfoEl.innerHTML = `
    <strong>Group ${data.group}</strong> · Current rank: #${data.group_rank}
    <span style="color:${data.qualifies?'var(--green)':'var(--red)'}">· ${data.qualifies?'✓ Qualifying':'✗ Not qualifying'}</span>`;

  // Group matches
  const groupMatchesHtml = data.group_matches.map(m => {
    const oppFlag = getFlagUrl(m.opponent);
    return `
      <div class="jrn-match" data-match-id="${m.id}">
        <span style="color:var(--text-2);font-size:11px;min-width:80px">${m.date}</span>
        <span style="flex:1; display:flex; align-items:center; gap:6px;">vs ${oppFlag ? `<img class="bm-team-flag" src="${oppFlag}">` : ''}<strong>${m.opponent}</strong></span>
        ${m.is_played
          ? `<span class="jrn-result-badge ${m.result}">${m.result}</span>
             <span style="font-weight:700">${m.team_score}–${m.opp_score}</span>`
          : `<span class="jrn-result-badge TBD">TBD</span>`
        }
      </div>`;
  }).join('');

  // Travel Tracker timeline HTML (initially set to Groups active)
  let vehicleEmoji = '🚌';
  if (ko.fin && ko.fin.win) {
    vehicleEmoji = '🏆';
  } else {
    vehicleEmoji = ['MEX', 'CAN', 'USA'].includes(data.fifa_code) ? '🚄' : '🚌';
  }

  const travelTrackerHtml = `
    <div class="travel-tracker">
      <h4 style="font-size: 11px; color: var(--accent-2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; display:flex; align-items:center; gap:6px;">
        ${vehicleEmoji} Team Travel Progress Tracker
      </h4>
      <div class="travel-timeline">
        <div class="travel-line"></div>
        <div class="travel-line-progress" style="width: 0%;"></div>
        <div class="travel-vehicle" style="left: 0%;">${vehicleEmoji}</div>
        
        <div class="travel-node active" title="Group Stage">
          G
          <span class="travel-label">Groups<span class="travel-stadium">CDMX 🇲🇽</span></span>
        </div>
        <div class="travel-node" title="Round of 32">
          32
          <span class="travel-label">R32<span class="travel-stadium">Boston 🇺🇸</span></span>
        </div>
        <div class="travel-node" title="Round of 16">
          16
          <span class="travel-label">R16<span class="travel-stadium">Seattle 🇺🇸</span></span>
        </div>
        <div class="travel-node" title="Quarter Finals">
          QF
          <span class="travel-label">QF<span class="travel-stadium">Miami 🇺🇸</span></span>
        </div>
        <div class="travel-node" title="Semi Finals">
          SF
          <span class="travel-label">SF<span class="travel-stadium">Dallas 🇺🇸</span></span>
        </div>
        <div class="travel-node" title="Final">
          F
          <span class="travel-label">Final<span class="travel-stadium">New York 🇺🇸</span></span>
        </div>
      </div>
    </div>
  `;

  // Render initial layout structure
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      ${flag ? `<img style="width:48px;height:32px;border-radius:4px;object-fit:cover" src="${flag}" alt="">` : ''}
      <h3 style="font-size:18px;font-weight:800">${teamName} — Tournament Journey</h3>
    </div>
    
    ${travelTrackerHtml}
    
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Group ${data.group} Matches</div>
      <div class="jrn-group-matches">${groupMatchesHtml || '<p style="color:var(--text-2)">No group matches found</p>'}</div>
    </div>
    
    <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Simulated Knockout Bracket Path</div>
    <div class="bracket-container">
      <!-- Live bracket matches will load and animate here -->
    </div>
    
    <div id="journey-champ-banner-container"></div>
  `;

  // Journey chart initialization
  const stagesList = ['R32','R16','QF','SF','Final','🏆'];
  const probs = [data.qualifies?85:30, 55, 35, 22, 12, 6].map((v,i) => {
    const rd = [ko.r32,ko.r16,ko.qf,ko.sf,ko.fin,null][i];
    return rd ? rd.prob : (data.qualifies && i===0 ? 85 : 5);
  });

  const chartSection = document.getElementById('journey-chart-section');
  chartSection.style.display = 'block';
  setTimeout(() => {
    const ctx = document.getElementById('chart-journey').getContext('2d');
    if (chartJourney) chartJourney.destroy();
    chartJourney = new Chart(ctx, {
      type: 'line',
      data: {
        labels: stagesList,
        datasets: [{
          label: 'Advance Probability %',
          data: probs,
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)',
          borderWidth: 2, fill: true, tension: 0.4,
          pointBackgroundColor: probs.map(p => p > 50 ? '#10b981' : p > 25 ? '#f59e0b' : '#ef4444'),
          pointRadius: 6, pointBorderColor: '#fff', pointBorderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#0d1526', titleColor: '#e8edf7', bodyColor: '#8da3c4',
            callbacks: { label: ctx => ctx.parsed.y + '% probability' } }
        },
        scales: {
          y: { min:0, max:100, grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#8da3c4',font:{size:11},callback:v=>v+'%'}},
          x: { grid:{display:false}, ticks:{color:'#8da3c4',font:{size:12}}}
        }
      }
    });
  }, 50);

  // Setup knockout states for BFS simulation
  let currentR32 = data.full_bracket.r32.map(m => ({ ...m, resolved: false }));
  let currentR16 = data.full_bracket.r16.map(m => ({ ...m, resolved: false, home: 'TBD', away: 'TBD' }));
  let currentQF = data.full_bracket.qf.map(m => ({ ...m, resolved: false, home: 'TBD', away: 'TBD' }));
  let currentSF = data.full_bracket.sf.map(m => ({ ...m, resolved: false, home: 'TBD', away: 'TBD' }));
  let currentFinal = { ...data.full_bracket.final, resolved: false, home: 'TBD', away: 'TBD' };

  // Status text ticker element
  const simStatus = document.getElementById('journey-sim-status');
  const simTickerText = document.getElementById('journey-sim-ticker-text');
  
  simStatus.style.display = 'block';
  simTickerText.textContent = `🚀 Starting Live Tournament Simulation for ${teamName}...`;

  // Draw initial blank/TBD tree
  const drawLiveBracket = () => {
    const r32Html = currentR32.map(m => renderLiveBracketMatch(m, teamName)).join('');
    const r16Html = currentR16.map(m => renderLiveBracketMatch(m, teamName)).join('');
    const qfHtml = currentQF.map(m => renderLiveBracketMatch(m, teamName)).join('');
    const sfHtml = currentSF.map(m => renderLiveBracketMatch(m, teamName)).join('');
    const finHtml = renderLiveBracketMatch(currentFinal, teamName);

    const container = document.querySelector('.bracket-container');
    if (container) {
      container.innerHTML = `
        <div class="bracket-column" style="gap: 0 !important; justify-content: space-around;">${r32Html}</div>
        <div class="bracket-column" style="gap: 0 !important; justify-content: space-around;">${r16Html}</div>
        <div class="bracket-column" style="gap: 0 !important; justify-content: space-around;">${qfHtml}</div>
        <div class="bracket-column" style="gap: 0 !important; justify-content: space-around;">${sfHtml}</div>
        <div class="bracket-column" style="gap: 0 !important; justify-content: space-around;">${finHtml}</div>
      `;
    }
  };

  const updateTimelineProgress = (nodeIndex) => {
    const lineProgress = document.querySelector('.travel-line-progress');
    const vehicle = document.querySelector('.travel-vehicle');
    const nodes = document.querySelectorAll('.travel-node');
    
    if (lineProgress) lineProgress.style.width = `${nodeIndex * 20}%`;
    if (vehicle) vehicle.style.left = `${nodeIndex * 20}%`;
    
    nodes.forEach((node, i) => {
      node.classList.remove('completed', 'active');
      if (i < nodeIndex) {
        node.classList.add('completed');
      } else if (i === nodeIndex) {
        node.classList.add('active');
      }
    });
  };

  // Draw starting tree
  drawLiveBracket();

  // If team did not qualify from Group stage, stop transport progression at Groups but animate bracket anyway
  if (!data.qualifies) {
    simTickerText.innerHTML = `❌ <span style="color:var(--red); font-weight:800;">${teamName} failed to qualify</span> from Group stage. Simulating rest of tournament...`;
  } else {
    // Moves to R32 node
    updateTimelineProgress(1);
  }

  // Round of 32 Resolution Loop
  for (let i = 0; i < currentR32.length; i++) {
    const m = currentR32[i];
    const isSelected = (m.home === teamName || m.away === teamName);
    const delay = isSelected ? 1400 : 200;
    
    if (isSelected) {
      simTickerText.innerHTML = `🔴 LIVE: <span style="color:var(--accent-2); font-weight:800;">${m.home} vs ${m.away}</span> (Round of 32)`;
    }
    
    await new Promise(r => setTimeout(r, delay));
    m.resolved = true;
    m.winner = data.full_bracket.r32[i].winner;
    m.home_score = data.full_bracket.r32[i].home_score;
    m.away_score = data.full_bracket.r32[i].away_score;
    
    // Update next round slot
    const nextIdx = Math.floor(i / 2);
    if (i % 2 === 0) {
      currentR16[nextIdx].home = m.winner;
    } else {
      currentR16[nextIdx].away = m.winner;
    }
    
    drawLiveBracket();
  }

  let isAlive = data.qualifies && currentR32.some(m => (m.home === teamName || m.away === teamName) && m.winner === teamName);
  if (isAlive) {
    updateTimelineProgress(2); // Move to R16 Seattle
  } else if (data.qualifies) {
    simTickerText.innerHTML = `❌ <span style="color:var(--red); font-weight:800;">${teamName} Eliminated</span> in Round of 32. Simulating rest of tournament...`;
  }

  // Round of 16 Resolution Loop
  for (let i = 0; i < currentR16.length; i++) {
    const m = currentR16[i];
    const isSelected = (m.home === teamName || m.away === teamName);
    const delay = isSelected ? 1400 : 200;
    
    if (isSelected && isAlive) {
      simTickerText.innerHTML = `🔴 LIVE: <span style="color:var(--accent-2); font-weight:800;">${m.home} vs ${m.away}</span> (Round of 16)`;
    }
    
    await new Promise(r => setTimeout(r, delay));
    m.resolved = true;
    m.winner = data.full_bracket.r16[i].winner;
    m.home_score = data.full_bracket.r16[i].home_score;
    m.away_score = data.full_bracket.r16[i].away_score;
    
    const nextIdx = Math.floor(i / 2);
    if (i % 2 === 0) {
      currentQF[nextIdx].home = m.winner;
    } else {
      currentQF[nextIdx].away = m.winner;
    }
    
    drawLiveBracket();
  }

  isAlive = isAlive && currentR16.some(m => (m.home === teamName || m.away === teamName) && m.winner === teamName);
  if (isAlive) {
    updateTimelineProgress(3); // Move to QF Miami
  } else if (isAlive === false && data.qualifies && !simTickerText.textContent.includes("Eliminated")) {
    simTickerText.innerHTML = `❌ <span style="color:var(--red); font-weight:800;">${teamName} Eliminated</span> in Round of 16. Simulating rest of tournament...`;
  }

  // Quarter Finals Resolution Loop
  for (let i = 0; i < currentQF.length; i++) {
    const m = currentQF[i];
    const isSelected = (m.home === teamName || m.away === teamName);
    const delay = isSelected ? 1400 : 200;
    
    if (isSelected && isAlive) {
      simTickerText.innerHTML = `🔴 LIVE: <span style="color:var(--accent-2); font-weight:800;">${m.home} vs ${m.away}</span> (Quarter Finals)`;
    }
    
    await new Promise(r => setTimeout(r, delay));
    m.resolved = true;
    m.winner = data.full_bracket.qf[i].winner;
    m.home_score = data.full_bracket.qf[i].home_score;
    m.away_score = data.full_bracket.qf[i].away_score;
    
    const nextIdx = Math.floor(i / 2);
    if (i % 2 === 0) {
      currentSF[nextIdx].home = m.winner;
    } else {
      currentSF[nextIdx].away = m.winner;
    }
    
    drawLiveBracket();
  }

  isAlive = isAlive && currentQF.some(m => (m.home === teamName || m.away === teamName) && m.winner === teamName);
  if (isAlive) {
    updateTimelineProgress(4); // Move to SF Dallas
  } else if (isAlive === false && data.qualifies && !simTickerText.textContent.includes("Eliminated")) {
    simTickerText.innerHTML = `❌ <span style="color:var(--red); font-weight:800;">${teamName} Eliminated</span> in Quarter Finals. Simulating rest of tournament...`;
  }

  // Semi Finals Resolution Loop
  for (let i = 0; i < currentSF.length; i++) {
    const m = currentSF[i];
    const isSelected = (m.home === teamName || m.away === teamName);
    const delay = isSelected ? 1400 : 200;
    
    if (isSelected && isAlive) {
      simTickerText.innerHTML = `🔴 LIVE: <span style="color:var(--accent-2); font-weight:800;">${m.home} vs ${m.away}</span> (Semi Finals)`;
    }
    
    await new Promise(r => setTimeout(r, delay));
    m.resolved = true;
    m.winner = data.full_bracket.sf[i].winner;
    m.home_score = data.full_bracket.sf[i].home_score;
    m.away_score = data.full_bracket.sf[i].away_score;
    
    if (i === 0) {
      currentFinal.home = m.winner;
    } else {
      currentFinal.away = m.winner;
    }
    
    drawLiveBracket();
  }

  isAlive = isAlive && currentSF.some(m => (m.home === teamName || m.away === teamName) && m.winner === teamName);
  if (isAlive) {
    updateTimelineProgress(5); // Move to Final New York
  } else if (isAlive === false && data.qualifies && !simTickerText.textContent.includes("Eliminated")) {
    simTickerText.innerHTML = `❌ <span style="color:var(--red); font-weight:800;">${teamName} Eliminated</span> in Semi Finals. Simulating rest of tournament...`;
  }

  // World Cup Final Match Resolution
  {
    const m = currentFinal;
    const isSelected = (m.home === teamName || m.away === teamName);
    const delay = isSelected ? 1400 : 200;
    
    if (isSelected && isAlive) {
      simTickerText.innerHTML = `👑 LIVE: <span style="color:var(--accent-2); font-weight:800;">${m.home} vs ${m.away}</span> (World Cup Final)`;
    }
    
    await new Promise(r => setTimeout(r, delay));
    m.resolved = true;
    m.winner = data.full_bracket.final.winner;
    m.home_score = data.full_bracket.final.home_score;
    m.away_score = data.full_bracket.final.away_score;
    
    drawLiveBracket();
  }

  const isChamp = data.knockout.champion === teamName;
  if (isChamp) {
    simTickerText.innerHTML = `🏆 <span style="color:var(--gold); font-weight:900;">${teamName} has won the FIFA World Cup 2026!</span>`;
    const vehicle = document.querySelector('.travel-vehicle');
    if (vehicle) vehicle.textContent = '🏆';
    playChampCelebration();
  } else {
    simTickerText.innerHTML = `🏁 Simulation complete! Winner: <span style="color:var(--accent-2); font-weight:800;">${data.knockout.champion}</span>`;
  }

  // Add the final champion banner
  const champBannerContainer = document.getElementById('journey-champ-banner-container');
  if (champBannerContainer) {
    champBannerContainer.innerHTML = isChamp
      ? `<div class="champion-banner"><div class="crown">🏆</div><h3>${teamName} WIN THE WORLD CUP!</h3></div>`
      : `<div class="champion-banner" style="border-color:var(--text-2);background:rgba(255,255,255,.04)">
           <div class="crown" style="font-size:28px">📅</div>
           <h3 style="color:var(--text-2);font-size:16px">Predicted Champion: ${data.knockout.champion || '?'}</h3>
         </div>`;
  }
}

/* ══════════════════ UTILITIES ══════════════════ */
function getFlagUrl(teamName) {
  // Real WC 2026 teams from fixtures CSV
  const iso2Map = {
    'Mexico':'mx','South Africa':'za','Korea Republic':'kr','Czechia':'cz',
    'Canada':'ca','Bosnia and Herzegovina':'ba','Qatar':'qa','Switzerland':'ch',
    'Brazil':'br','Haiti':'ht','Morocco':'ma','Scotland':'gb-sct',
    'United States':'us','Paraguay':'py','Australia':'au','Turkiye':'tr',
    'Germany':'de','Ecuador':'ec',"Cote d'Ivoire":'ci','Curacao':'cw',
    'Netherlands':'nl','Japan':'jp','Sweden':'se','Tunisia':'tn',
    'Belgium':'be','Egypt':'eg','IR Iran':'ir','New Zealand':'nz',
    'Spain':'es','Saudi Arabia':'sa','Uruguay':'uy','Cabo Verde':'cv',
    'France':'fr','Iraq':'iq','Norway':'no','Senegal':'sn',
    'Argentina':'ar','Algeria':'dz','Austria':'at','Jordan':'jo',
    'Colombia':'co','Portugal':'pt','Uzbekistan':'uz','Congo DR':'cd',
    'Croatia':'hr','England':'gb-eng','Ghana':'gh','Panama':'pa',
  };
  const iso = iso2Map[teamName];
  return iso ? `https://flagcdn.com/w40/${iso}.png` : null;
}

/* ══════════════════ REAL LIVE DATA ══════════════════ */
async function fetchRealLiveData() {
  const listContainer = document.getElementById('real-matches-list');
  const sourceEl = document.getElementById('real-feed-source');
  const timeEl = document.getElementById('real-feed-time');
  
  if (!listContainer) return;
  
  listContainer.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px;"><div class="spinner" style="margin:auto; width:28px; height:28px; border-width:3px; border-top-color:var(--accent-2)"></div></div>';
  
  try {
    const res = await fetch('/api/real-live').then(r => r.json());
    
    // Set status details
    if (sourceEl) {
      let sourceText = 'Live Feed (API)';
      if (res.source === 'cache') sourceText = 'Live Feed (Cached)';
      else if (res.source === 'demo') sourceText = 'Demo Mode (Fallback)';
      else if (res.source === 'demo_empty') sourceText = 'Demo Mode (No matches today)';
      else if (res.source === 'demo_fallback') sourceText = 'Demo Mode (API error)';
      sourceEl.textContent = sourceText;
    }
    
    if (timeEl && res.refreshedAt) {
      const date = new Date(res.refreshedAt);
      timeEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    
    const fixtures = res.fixtures || [];
    if (fixtures.length === 0) {
      listContainer.innerHTML = '<div style="grid-column: 1/-1; color:var(--text-2); font-size:13px; padding:40px; text-align:center">No real-world matches scheduled for today</div>';
      return;
    }
    
    listContainer.innerHTML = fixtures.map(f => {
      // Determine status display and CSS class
      let statusClass = 'scheduled';
      let statusText = f.status || 'NS';
      let timeText = '';
      
      const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'INPROGRESS'];
      const finishedStatuses = ['FT', 'AET', 'PEN', 'FINISHED'];
      
      if (liveStatuses.includes(f.status?.toUpperCase()) || (typeof f.status === 'string' && f.status.match(/^\d+$/))) {
        statusClass = 'live';
        statusText = 'Live';
        timeText = f.time ? `${f.time}'` : '';
      } else if (finishedStatuses.includes(f.status?.toUpperCase())) {
        statusClass = 'finished';
        statusText = 'Finished';
      } else {
        // Scheduled or kickoff time
        statusClass = 'scheduled';
        statusText = 'Scheduled';
      }
      
      const kickoffStr = new Date(f.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      return `
        <div class="real-match-card">
          <div class="real-card-header">
            <span class="real-league-badge">
              ${f.logo ? `<img class="real-league-logo" src="${f.logo}" alt="">` : '⚽'}
              <span>${f.league || 'Unknown League'} (${f.country || 'International'})</span>
            </span>
            <span class="real-match-status ${statusClass}">
              ${statusText} ${timeText}
            </span>
          </div>
          <div class="real-card-body">
            <div class="real-team-row">
              <div class="real-team-info">
                ${f.home_logo ? `<img class="real-team-logo" src="${f.home_logo}" alt="">` : ''}
                <span class="real-team-name">${f.home}</span>
              </div>
              <span class="real-team-score ${statusClass === 'scheduled' ? 'scheduled' : ''}">
                ${statusClass === 'scheduled' ? '–' : (f.score?.home !== undefined ? f.score.home : 0)}
              </span>
            </div>
            <div class="real-team-row">
              <div class="real-team-info">
                ${f.away_logo ? `<img class="real-team-logo" src="${f.away_logo}" alt="">` : ''}
                <span class="real-team-name">${f.away}</span>
              </div>
              <span class="real-team-score ${statusClass === 'scheduled' ? 'scheduled' : ''}">
                ${statusClass === 'scheduled' ? '–' : (f.score?.away !== undefined ? f.score.away : 0)}
              </span>
            </div>
          </div>
          <div class="real-card-footer">
            <span class="real-kickoff-time">Kickoff: ${kickoffStr}</span>
            <span style="font-size: 9px; opacity: 0.7;">ID: #${f.id}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to fetch real live data:', err);
    listContainer.innerHTML = '<div style="grid-column: 1/-1; color:var(--red); font-size:13px; padding:40px; text-align:center">Error loading live feed data. Please try again.</div>';
  }
}

/* ══════════════════ AUCTION TIMERS & PITCH ══════════════════ */
function resetAuctionTimer() {
  if (_auctionTimer) clearInterval(_auctionTimer);
  _auctionSecondsLeft = 6;
  updateTimerUI();

  _auctionTimer = setInterval(() => {
    _auctionSecondsLeft -= 0.1;
    if (_auctionSecondsLeft <= 0) {
      _auctionSecondsLeft = 0;
      clearInterval(_auctionTimer);
      handleAuctionTimeout();
    }
    updateTimerUI();
  }, 100);
}

function updateTimerUI() {
  const bar = document.getElementById('auction-timer-bar');
  const text = document.getElementById('auction-timer-text');
  if (bar) {
    bar.style.width = Math.max(0, (_auctionSecondsLeft / 6) * 100) + '%';
    if (_auctionSecondsLeft < 2) {
      bar.style.background = 'var(--red)';
    } else if (_auctionSecondsLeft < 4) {
      bar.style.background = 'var(--orange)';
    } else {
      bar.style.background = 'linear-gradient(90deg, var(--accent-2), var(--accent-3))';
    }
  }
  if (text) {
    text.textContent = Math.ceil(_auctionSecondsLeft) + 's';
  }
}

function handleAuctionTimeout() {
  logBid(`⏰ Time expired!`, 'neutral');
  if (_curHolder === 'user') {
    awardPlayer('user');
  } else if (_curHolder === 'ai') {
    awardPlayer('ai');
  } else {
    logBid(`Nobody bid for ${_curPlayer.name} — drawing next...`, 'neutral');
    nextPlayer();
  }
}

function updatePitchView() {
  // Reset all slots
  const slots = document.querySelectorAll('#user-pitch .pitch-slot');
  slots.forEach(slot => {
    slot.classList.remove('filled');
    const nameEl = slot.querySelector('.slot-player-name');
    const cpEl = slot.querySelector('.slot-player-cp');
    if (nameEl) nameEl.textContent = '—';
    if (cpEl) cpEl.textContent = '';
  });

  _userSquad.forEach(p => {
    let targetSlot = p.position; // Specific position GK, LB, LCB, RCB, RB, CDM, CM, CAM, LW, RW, ST
    if (targetSlot === 'CDM') targetSlot = 'LCM';
    else if (targetSlot === 'CAM') targetSlot = 'RCM';

    const slotEl = document.querySelector(`[data-slot="${targetSlot}"]`);
    if (slotEl) {
      slotEl.classList.add('filled');
      const nameEl = slotEl.querySelector('.slot-player-name');
      const cpEl = slotEl.querySelector('.slot-player-cp');
      
      const shortName = p.name.split(' ').pop();
      const flag = getFlagUrl(p.team);
      if (nameEl) {
        nameEl.innerHTML = `${flag ? `<img src="${flag}" style="width:14px; height:9px; border-radius:1px; object-fit:cover; margin-right:4px; vertical-align:middle;">` : ''}${shortName} (${p.rating})`;
      }
      if (cpEl) cpEl.textContent = `${p.paid_cp} CP`;
    }
  });
}

/* ══════════════════ AI ASSISTANT CHATBOT ══════════════════ */
function initChatbot() {
  const sendBtn = document.getElementById('chat-send-btn');
  const inputEl = document.getElementById('chat-input');
  
  if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
  }
  if (inputEl) {
    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  // Suggestions chips click handling
  const chips = document.querySelectorAll('.chat-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const question = chip.dataset.question;
      if (inputEl) {
        inputEl.value = question;
        sendChatMessage();
      }
    });
  });
}

async function sendChatMessage() {
  const inputEl = document.getElementById('chat-input');
  const logEl = document.getElementById('chat-log');
  if (!inputEl || !logEl) return;
  
  const text = inputEl.value.trim();
  if (!text) return;
  
  // Clear input
  inputEl.value = '';
  
  // Append User message
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-msg user';
  userMsg.innerHTML = `<div class="chat-bubble user">${text}</div>`;
  logEl.appendChild(userMsg);
  logEl.scrollTop = logEl.scrollHeight;
  
  // Append Typing bubble
  const typingMsg = document.createElement('div');
  typingMsg.className = 'chat-msg assistant typing';
  typingMsg.id = 'chat-typing-temp';
  typingMsg.innerHTML = `<div class="chat-bubble assistant"><div class="spinner" style="border-top-color:var(--accent-2)"></div> Analyzing tactical transitions...</div>`;
  logEl.appendChild(typingMsg);
  logEl.scrollTop = logEl.scrollHeight;
  
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: text })
    }).then(r => r.json());
    
    // Remove typing indicator
    const temp = document.getElementById('chat-typing-temp');
    if (temp) temp.remove();
    
    // Append Assistant response
    const assistantMsg = document.createElement('div');
    assistantMsg.className = 'chat-msg assistant';
    assistantMsg.innerHTML = `<div class="chat-bubble assistant">${res.response || "No response received."}</div>`;
    logEl.appendChild(assistantMsg);
    logEl.scrollTop = logEl.scrollHeight;
  } catch (err) {
    console.error('Chat error:', err);
    const temp = document.getElementById('chat-typing-temp');
    if (temp) temp.remove();
    
    const errMsg = document.createElement('div');
    errMsg.className = 'chat-msg assistant';
    errMsg.innerHTML = `<div class="chat-bubble assistant" style="color:var(--red);">Error communicating with the AI. Please try again.</div>`;
    logEl.appendChild(errMsg);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

/* ══════════════════ DAILY TOP PERFORMERS ══════════════════ */
function renderDailyPerformers(fixtures) {
  const list = document.getElementById('daily-performers-list');
  if (!list) return;

  const scorers = [];
  fixtures.forEach(f => {
    if (f.scorers && f.scorers.length) {
      f.scorers.forEach(s => {
        scorers.push({ name: s.name, team: s.team === 'home' ? f.home : f.away, min: s.min });
      });
    }
  });

  if (scorers.length === 0) {
    list.innerHTML = '<span style="font-size:11px; color:var(--text-2)">No goals scored on this matchday yet.</span>';
    return;
  }

  const counts = {};
  scorers.forEach(s => {
    if (!counts[s.name]) {
      counts[s.name] = { name: s.name, team: s.team, goals: 0 };
    }
    counts[s.name].goals++;
  });

  const sorted = Object.values(counts).sort((a,b) => b.goals - a.goals);

  list.innerHTML = sorted.map(s => {
    const flag = getFlagUrl(s.team);
    return `
      <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:8px; font-size:11px;">
        ${flag ? `<img src="${flag}" style="width:14px; height:10px; border-radius:1px; object-fit:cover;">` : ''}
        <span style="font-weight:700; color:#fff;">${s.name.split(' ').pop()}</span>
        <span style="color:var(--accent-2); font-weight:800;">${s.goals}⚽</span>
      </div>
    `;
  }).join('');
}

/* ══════════════════ PHASE 3 CORE INITIALIZATION FUNCTIONS ══════════════════ */
function initThemes() {
  const dots = document.querySelectorAll('.theme-dot');
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const theme = dot.dataset.theme;
      dots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      
      document.body.classList.remove('theme-gold', 'theme-cyber', 'theme-samba', 'theme-frost');
      document.body.classList.add('theme-' + theme);
    });
  });
  document.body.classList.add('theme-gold');
}

function initMatchball() {
  const ball = document.getElementById('header-matchball');
  if (!ball) return;
  const classes = ['ball-gold', 'ball-rihla', 'ball-brazuca', 'ball-tango'];
  let currentIdx = 0;
  
  ball.addEventListener('click', () => {
    ball.classList.remove(...classes);
    currentIdx = (currentIdx + 1) % classes.length;
    ball.classList.add(classes[currentIdx]);
    
    ball.classList.add('bounce');
    setTimeout(() => ball.classList.remove('bounce'), 400);
    
    const msg = ["Golden Glory 2026", "Al Rihla 2022", "Brazuca 2014", "Tango 1978"][currentIdx];
    showBallNotification(msg);
  });
}

function showBallNotification(name) {
  let toast = document.getElementById('ball-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ball-toast';
    toast.style = 'position:fixed; bottom:20px; right:20px; background:rgba(0,0,0,0.85); color:#fff; border:1px solid var(--accent-2); padding:10px 16px; border-radius:30px; font-size:12px; font-weight:700; z-index:9999; pointer-events:none; transition:all 0.3s; opacity:0; transform:translateY(20px); box-shadow:0 4px 15px rgba(0,0,0,0.5); display:flex; align-items:center; gap:8px;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `⚽ Matchball switched to: <span style="color:var(--accent-2)">${name}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
  }, 2000);
}

function renderBracketMatch(roundLabel, roundData, teamName, defaultStadium, parentQualified = true) {
  if (parentQualified === false) {
    return `
      <div class="bracket-match locked">
        <div class="bm-round-title"><span>${roundLabel}</span> 🔒</div>
        <div style="font-size:11px; color:var(--text-2); text-align:center; padding:10px 0;">
          Locked (Eliminated)
        </div>
      </div>
    `;
  }
  if (!roundData) {
    return `
      <div class="bracket-match locked">
        <div class="bm-round-title"><span>${roundLabel}</span> ⏳</div>
        <div style="font-size:11px; color:var(--text-2); text-align:center; padding:10px 0;">
          TBD (Not reached)
        </div>
      </div>
    `;
  }

  const isWin = roundData.win;
  const oppName = roundData.opponent;
  const teamFlag = getFlagUrl(teamName);
  const oppFlag = getFlagUrl(oppName);
  const [teamScore, oppScore] = roundData.score ? roundData.score.split('-') : ['?', '?'];

  return `
    <div class="bracket-match active-path ${isWin ? '' : 'eliminated'}">
      <div class="bm-round-title">
        <span>${roundLabel}</span>
        <span style="font-size:8px; color:var(--accent-2); font-weight:bold;">${roundData.prob}% Prob</span>
      </div>
      <div class="bm-team ${isWin ? 'winner' : ''}">
        ${teamFlag ? `<img class="bm-team-flag" src="${teamFlag}">` : ''}
        <span class="bm-team-name">${teamName}</span>
        <span class="bm-team-score">${teamScore}</span>
      </div>
      <div class="bm-team ${!isWin ? 'winner' : ''}">
        ${oppFlag ? `<img class="bm-team-flag" src="${oppFlag}">` : ''}
        <span class="bm-team-name">${oppName}</span>
        <span class="bm-team-score">${oppScore}</span>
      </div>
      <div class="bm-meta">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:110px;">📍 ${defaultStadium.split(',')[0]}</span>
        <span style="color:${isWin?'var(--green)':'var(--red)'}; font-weight:bold;">${isWin?'WIN':'LOST'}</span>
      </div>
    </div>
  `;
}

function renderLiveBracketMatch(match, teamName) {
  const isSelectedTeam = (match.home === teamName || match.away === teamName);
  const homeFlag = getFlagUrl(match.home);
  const awayFlag = getFlagUrl(match.away);
  
  const resolved = match.resolved;
  const homeScore = resolved ? match.home_score : '?';
  const awayScore = resolved ? match.away_score : '?';
  
  let matchClass = "bracket-match";
  if (isSelectedTeam) matchClass += " active-path";
  if (resolved) {
    if (match.winner === teamName) {
      // Keep highlighted
    } else if (isSelectedTeam && match.winner !== teamName) {
      matchClass += " eliminated";
    }
  }

  const clickAttr = resolved ? `data-match-id="${match.id}" style="cursor: pointer;"` : '';

  return `
    <div class="${matchClass}" ${clickAttr}>
      <div class="bm-round-title">
        <span>${match.stage}</span>
        <span style="font-size:8px; color:var(--accent-2); font-weight:bold;">${match.prob}% Prob</span>
      </div>
      <div class="bm-team ${resolved && match.winner === match.home ? 'winner' : ''}">
        ${homeFlag ? `<img class="bm-team-flag" src="${homeFlag}">` : '⚽'}
        <span class="bm-team-name">${match.home || 'TBD'}</span>
        <span class="bm-team-score">${homeScore}</span>
      </div>
      <div class="bm-team ${resolved && match.winner === match.away ? 'winner' : ''}">
        ${awayFlag ? `<img class="bm-team-flag" src="${awayFlag}">` : '⚽'}
        <span class="bm-team-name">${match.away || 'TBD'}</span>
        <span class="bm-team-score">${awayScore}</span>
      </div>
      <div class="bm-meta">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:110px;">📍 ${match.stadium ? match.stadium.split(',')[0] : 'TBD'}</span>
        <span style="color:${resolved ? (match.winner === teamName ? 'var(--green)' : 'var(--red)') : 'var(--text-2)'}; font-weight:bold;">
          ${resolved ? (match.winner === teamName ? 'WIN' : 'LOST') : 'LIVE'}
        </span>
      </div>
    </div>
  `;
}

function playChampCelebration() {
  const overlay = document.createElement('div');
  overlay.style = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.4); pointer-events:none; z-index:9999; display:flex; justify-content:center; align-items:center; overflow:hidden;';
  document.body.appendChild(overlay);

  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.textContent = ['🏆','⚽','✨','🎉','🥇'][Math.floor(Math.random()*5)];
    el.style.position = 'absolute';
    el.style.fontSize = `${Math.random()*24 + 16}px`;
    el.style.left = `${Math.random()*100}vw`;
    el.style.top = '-50px';
    el.style.transition = `transform ${Math.random()*2 + 2}s linear`;
    overlay.appendChild(el);

    setTimeout(() => {
      el.style.transform = `translateY(110vh) rotate(${Math.random()*720 - 360}deg)`;
    }, 50);
  }

  setTimeout(() => overlay.remove(), 4000);
}

/* ══════════════════ TAB 7: MANUAL PREDICTOR ══════════════════ */
let manualGroupRankings = {}; 
let selectedThirds = [];
let bracketState = {}; 

function initPredictor() {
  const groupsGrid = document.getElementById('manual-groups-grid');
  if (!groupsGrid) return;
  
  const groupsMap = {};
  _teams.forEach(t => {
    if (!groupsMap[t.group]) groupsMap[t.group] = [];
    groupsMap[t.group].push(t.name);
  });
  
  const sortedGroups = Object.keys(groupsMap).sort();
  
  groupsGrid.innerHTML = sortedGroups.map(g => {
    const teams = groupsMap[g];
    return `
      <div class="panel" style="padding:10px;" data-group="${g}">
        <h4 style="margin:0 0 10px 0; color:var(--accent);">Group ${g}</h4>
        <div class="sortable-group" id="sort-group-${g}">
          ${teams.map((t, idx) => `
            <div class="team-rank-item" data-team="${t}" style="display:flex; justify-content:space-between; align-items:center; background:var(--surface-2); margin-bottom:5px; padding:5px 8px; border-radius:4px; border:1px solid var(--border);">
              <span>${idx+1}. ${t}</span>
              <div style="display:flex; flex-direction:column;">
                <button onclick="moveRank(this, -1)" style="background:none; border:none; color:var(--text-1); cursor:pointer; padding:0 5px; font-size:10px;">▲</button>
                <button onclick="moveRank(this, 1)" style="background:none; border:none; color:var(--text-1); cursor:pointer; padding:0 5px; font-size:10px;">▼</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
  
  window.moveRank = function(btn, dir) {
    const item = btn.closest('.team-rank-item');
    const container = item.parentElement;
    const items = Array.from(container.children);
    const idx = items.indexOf(item);
    if (idx + dir >= 0 && idx + dir < items.length) {
      if (dir === -1) {
        container.insertBefore(item, items[idx - 1]);
      } else {
        container.insertBefore(item, items[idx + 2] || null);
      }
      Array.from(container.children).forEach((child, i) => {
        child.querySelector('span').textContent = `${i+1}. ${child.dataset.team}`;
      });
    }
  };

  document.getElementById('lock-groups-btn').addEventListener('click', () => {
    manualGroupRankings = {};
    document.querySelectorAll('.sortable-group').forEach(group => {
      const gName = group.id.split('-')[2];
      manualGroupRankings[gName] = Array.from(group.children).map(c => c.dataset.team);
    });
    
    document.getElementById('predictor-phase-1').style.display = 'none';
    document.getElementById('predictor-phase-2').style.display = 'block';
    
    const thirdsGrid = document.getElementById('manual-third-grid');
    selectedThirds = [];
    const allThirds = sortedGroups.map(g => ({ group: g, team: manualGroupRankings[g][2] }));
    
    thirdsGrid.innerHTML = allThirds.map(t => `
      <div class="third-place-item panel" data-group="${t.group}" data-team="${t.team}" style="padding:10px; cursor:pointer; border:2px solid var(--border); width: 140px; text-align:center;">
        <div style="font-size:10px; color:var(--text-2);">Group ${t.group}</div>
        <div style="font-weight:bold;">${t.team}</div>
      </div>
    `).join('');
    
    document.querySelectorAll('.third-place-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.classList.contains('selected-third')) {
          item.classList.remove('selected-third');
          item.style.borderColor = 'var(--border)';
          selectedThirds = selectedThirds.filter(t => t !== item.dataset.team);
        } else {
          if (selectedThirds.length >= 8) {
            alert('You can only select 8 third-place teams!');
            return;
          }
          item.classList.add('selected-third');
          item.style.borderColor = 'var(--green)';
          selectedThirds.push(item.dataset.team);
        }
        document.getElementById('generate-bracket-btn').disabled = (selectedThirds.length !== 8);
      });
    });
  });

  document.getElementById('back-to-groups-btn').addEventListener('click', () => {
    document.getElementById('predictor-phase-2').style.display = 'none';
    document.getElementById('predictor-phase-1').style.display = 'block';
  });

  document.getElementById('generate-bracket-btn').addEventListener('click', () => {
    document.getElementById('predictor-phase-2').style.display = 'none';
    document.getElementById('predictor-phase-3').style.display = 'block';
    generateBracket();
  });
  
  document.getElementById('reset-bracket-btn').addEventListener('click', () => {
    document.getElementById('predictor-phase-3').style.display = 'none';
    document.getElementById('predictor-phase-1').style.display = 'block';
  });
}

function generateBracket() {
  const get1 = g => manualGroupRankings[g][0];
  const get2 = g => manualGroupRankings[g][1];
  
  const thirds = [...selectedThirds];
  
  bracketState = {
    r32: [
      { id: 'r32_1', home: get1('A'), away: thirds[0], winner: null },
      { id: 'r32_2', home: get1('B'), away: thirds[1], winner: null },
      { id: 'r32_3', home: get1('C'), away: get2('F'), winner: null },
      { id: 'r32_4', home: get1('D'), away: thirds[2], winner: null },
      { id: 'r32_5', home: get1('E'), away: thirds[3], winner: null },
      { id: 'r32_6', home: get1('F'), away: get2('C'), winner: null },
      { id: 'r32_7', home: get1('G'), away: thirds[4], winner: null },
      { id: 'r32_8', home: get1('H'), away: get2('J'), winner: null },
      { id: 'r32_9', home: get1('I'), away: thirds[5], winner: null },
      { id: 'r32_10', home: get1('J'), away: get2('H'), winner: null },
      { id: 'r32_11', home: get1('K'), away: thirds[6], winner: null },
      { id: 'r32_12', home: get1('L'), away: thirds[7], winner: null },
      { id: 'r32_13', home: get2('A'), away: get2('B'), winner: null },
      { id: 'r32_14', home: get2('D'), away: get2('G'), winner: null },
      { id: 'r32_15', home: get2('E'), away: get2('I'), winner: null },
      { id: 'r32_16', home: get2('K'), away: get2('L'), winner: null },
    ],
    r16: Array.from({length: 8}).map((_, i) => ({ id: `r16_${i+1}`, home: 'TBD', away: 'TBD', winner: null })),
    qf: Array.from({length: 4}).map((_, i) => ({ id: `qf_${i+1}`, home: 'TBD', away: 'TBD', winner: null })),
    sf: Array.from({length: 2}).map((_, i) => ({ id: `sf_${i+1}`, home: 'TBD', away: 'TBD', winner: null })),
    final: { id: 'final_1', home: 'TBD', away: 'TBD', winner: null }
  };

  renderBracket();
}

function renderBracket() {
  const drawRound = (matches, roundId, nextRoundKey) => {
    const el = document.getElementById(`bracket-${roundId}`);
    el.innerHTML = `<h4 style="text-align:center; border-bottom:1px solid var(--border); padding-bottom:10px;">${roundId.toUpperCase()}</h4>` +
      matches.map((m, idx) => `
        <div class="bracket-match panel" style="margin-bottom:10px; padding:8px; border: 1px solid ${m.winner ? 'var(--green)' : 'var(--border)'};">
          <div style="cursor:pointer; padding:5px; background: ${m.winner === m.home ? 'var(--surface-2)' : 'transparent'}; border-radius:4px; margin-bottom:2px;" 
               onclick="advanceTeam('${roundId}', ${idx}, 'home', '${nextRoundKey}')">
               ${getFlagUrl(m.home) ? `<img src="${getFlagUrl(m.home)}" style="width:14px; margin-right:4px;">` : ''} ${m.home}
          </div>
          <div style="cursor:pointer; padding:5px; background: ${m.winner === m.away ? 'var(--surface-2)' : 'transparent'}; border-radius:4px;" 
               onclick="advanceTeam('${roundId}', ${idx}, 'away', '${nextRoundKey}')">
               ${getFlagUrl(m.away) ? `<img src="${getFlagUrl(m.away)}" style="width:14px; margin-right:4px;">` : ''} ${m.away}
          </div>
        </div>
      `).join('');
  };

  drawRound(bracketState.r32, 'r32', 'r16');
  drawRound(bracketState.r16, 'r16', 'qf');
  drawRound(bracketState.qf, 'qf', 'sf');
  drawRound(bracketState.sf, 'sf', 'final');
  
  // Draw final
  const f = bracketState.final;
  const fEl = document.getElementById('bracket-final');
  fEl.innerHTML = `<h4 style="text-align:center; border-bottom:1px solid var(--border); padding-bottom:10px; color:var(--gold);">FINAL</h4>
    <div class="bracket-match panel" style="margin-bottom:10px; padding:12px; border: 2px solid ${f.winner ? 'var(--gold)' : 'var(--border)'}; background: rgba(212,175,55,0.05);">
      <div style="cursor:pointer; padding:8px; background: ${f.winner === f.home ? 'rgba(212,175,55,0.2)' : 'transparent'}; border-radius:4px; margin-bottom:5px; font-weight:bold;" 
           onclick="advanceTeam('final', 0, 'home', null)">
           ${getFlagUrl(f.home) ? `<img src="${getFlagUrl(f.home)}" style="width:18px; margin-right:6px;">` : ''} ${f.home}
      </div>
      <div style="cursor:pointer; padding:8px; background: ${f.winner === f.away ? 'rgba(212,175,55,0.2)' : 'transparent'}; border-radius:4px; font-weight:bold;" 
           onclick="advanceTeam('final', 0, 'away', null)">
           ${getFlagUrl(f.away) ? `<img src="${getFlagUrl(f.away)}" style="width:18px; margin-right:6px;">` : ''} ${f.away}
      </div>
    </div>
  `;
  
  if (f.winner) {
    if(!document.getElementById('champ-display')) {
      fEl.innerHTML += `<div id="champ-display" style="text-align:center; margin-top:20px; animation: pop 0.5s ease-out;"><h2 style="color:var(--gold); margin:0;">🏆 CHAMPION</h2><h1 style="color:var(--text-1);">${f.winner}</h1></div>`;
      playChampCelebration();
    }
  }
}

window.advanceTeam = function(round, matchIdx, side, nextRound) {
  let match;
  if (round === 'final') match = bracketState.final;
  else match = bracketState[round][matchIdx];
  
  if (match[side] === 'TBD') return;
  
  match.winner = match[side];
  
  if (nextRound) {
    const nextMatchIdx = Math.floor(matchIdx / 2);
    const nextSide = matchIdx % 2 === 0 ? 'home' : 'away';
    
    if (nextRound === 'final') {
      bracketState.final[nextSide] = match.winner;
      bracketState.final.winner = null; // reset if changed
    } else {
      bracketState[nextRound][nextMatchIdx][nextSide] = match.winner;
      bracketState[nextRound][nextMatchIdx].winner = null;
      
      // Cascade reset downstream
      let cr = nextRound;
      let ci = nextMatchIdx;
      while (cr !== 'final') {
        const nr = cr === 'r16' ? 'qf' : cr === 'qf' ? 'sf' : 'final';
        const ni = Math.floor(ci / 2);
        const ns = ci % 2 === 0 ? 'home' : 'away';
        if (nr === 'final') {
          bracketState.final[ns] = 'TBD';
          bracketState.final.winner = null;
        } else {
          bracketState[nr][ni][ns] = 'TBD';
          bracketState[nr][ni].winner = null;
        }
        cr = nr;
        ci = ni;
      }
    }
  }
  
  renderBracket();
};
