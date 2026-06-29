/* ─────────────────────────────────────────────────────────────
   FIFA 2026 AI HUB — app.js
   Complete client-side logic: charts, auction (1CP start),
   journey simulator, team profiles, AI inference
───────────────────────────────────────────────────────────── */

const API = '';
let _teams = [], _groups = {}, _fixtures = [], _analytics = {}, _performers = {};

// ── WebSockets Client Integration ──────────────────────────────
let socket;
try {
  if (typeof io !== 'undefined') {
    socket = io();
    socket.on('connect', () => {
      console.log('Successfully connected to WebSockets server:', socket.id);
    });
    
    socket.on('match-update', (event) => {
      console.log('Real-time match event received via WebSocket:', event);
      
      // Update UI data
      triggerTimeRefresh(false);
      
      // Display a real-time toast notification
      showWebSocketToast(event);
    });
  }
} catch (e) {
  console.warn('WebSockets client initialization failed:', e.message);
}

function showWebSocketToast(event) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.background = 'rgba(15, 23, 42, 0.95)';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.border = '2px solid var(--accent)';
  toast.style.color = '#fff';
  toast.style.padding = '16px 20px';
  toast.style.borderRadius = '12px';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
  toast.style.zIndex = '99999';
  toast.style.fontFamily = 'Outfit, sans-serif';
  toast.style.fontWeight = '700';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '12px';
  toast.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(40px) scale(0.9)';
  
  let icon = '📢';
  let desc = 'Match update received!';
  
  if (event.event === 'goal') {
    icon = '⚽';
    desc = `<span style="color:var(--accent-2); font-weight:900;">GOAL!</span> ${event.scorer} (${event.min}') has scored! <br><span style="font-size:16px; color:#fff; font-weight:800;">Score: ${event.score}</span>`;
  } else if (event.event === 'card') {
    const isRed = event.cardType === 'red';
    icon = isRed ? '🟥' : '🟨';
    desc = `<span style="color:${isRed ? 'var(--red)' : 'var(--gold)'}; font-weight:900;">${isRed ? 'RED CARD' : 'YELLOW CARD'}</span><br>${event.player} booked (${event.min}').`;
  } else if (event.event === 'ft') {
    icon = '🏁';
    desc = `<span style="color:var(--green); font-weight:900;">FULL TIME</span><br>Match finished. Final Score: ${event.score}`;
  }
  
  toast.innerHTML = `<span style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${icon}</span> <div style="display:flex; flex-direction:column; gap:2px; line-height:1.3; font-size:13px;">${desc}</div>`;
  document.body.appendChild(toast);
  
  // Trigger animations
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  }, 100);
  
  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px) scale(0.95)';
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 6000);
}

// Chart instances (kept for destroy-on-redraw)
let chartGoalsGroup, chartRadar, chartBar, chartJourney, chartPrediction;

// Time Machine State — default to real-world "now" (actual current time)
const _defaultSimDate = new Date();
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
  initCanvasBackground();
  initTimeMachine();
  initThemes();
  initMatchball();
  await Promise.all([
    fetchTeams(), fetchGroups(), fetchPerformers()
  ]);
  initNav();
  await initOverview();
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
      try {
        if (btn.dataset.tab !== 'auction' && typeof _auctionTimer !== 'undefined' && _auctionTimer) {
          clearInterval(_auctionTimer);
          _auctionTimer = null;
        }
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = document.getElementById('tab-' + btn.dataset.tab);
        if (targetTab) {
          targetTab.classList.add('active');
        }
        
        await triggerTimeRefresh(true);
      } catch (err) {
        console.error('Tab switch error:', err);
      }
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
  const applyBtn = document.getElementById('apply-date-btn');

  const applyDateFilter = async () => {
    if (!dateInput) return;
    const selectedDate = dateInput.value;
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = selectedDate === todayStr;
    const nextDt = isToday ? new Date() : new Date(new Date(`${selectedDate}T23:59:00Z`).getTime() + 12 * 60 * 60 * 1000);
    
    _simulatedDate = nextDt;
    updateTimeMachineUI();
    await triggerTimeRefresh();
  };

  if (applyBtn) {
    applyBtn.addEventListener('click', applyDateFilter);
  } else if (dateInput) {
    dateInput.addEventListener('change', applyDateFilter);
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
      <button class="match-modal-tab" id="tab-momentum" onclick="switchMatchTab('momentum')">Momentum & Timeline</button>
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

    <div id="match-momentum-pane" style="display:none; position:relative; margin-top:20px; text-align:center;">
      <div style="font-size:12px; font-weight:800; color:#fff; margin-bottom:12px; display:flex; align-items:center; gap:6px; justify-content:center;">
        📈 Live Attack Momentum Timeline
      </div>
      <div style="height: 150px; position: relative; margin-bottom: 24px; border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: rgba(0,0,0,0.25);">
        <canvas id="chart-match-momentum"></canvas>
      </div>
      
      <div style="font-size:12px; font-weight:800; color:#fff; margin-bottom:12px; display:flex; align-items:center; gap:6px; justify-content:center;">
        ⏱️ Match Event Timeline
      </div>
      <div id="match-timeline-list" style="display:flex; flex-direction:column; gap:8px; align-items:center; max-height:220px; overflow-y:auto; padding:10px 0; border: 1px solid var(--border); border-radius: 8px; background: rgba(0,0,0,0.15);">
        <!-- Timeline items -->
      </div>
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

  // Render momentum and event timeline graphics
  setTimeout(() => {
    renderMatchMomentum(match, stats);
    renderMatchTimeline(match);
  }, 100);
}

window.switchMatchTab = async function(tab, matchId) {
  document.getElementById('tab-stats').classList.toggle('active', tab === 'stats');
  document.getElementById('tab-momentum').classList.toggle('active', tab === 'momentum');
  document.getElementById('tab-shotmap').classList.toggle('active', tab === 'shotmap');
  
  document.getElementById('match-stats-pane').style.display = tab === 'stats' ? 'grid' : 'none';
  document.getElementById('match-momentum-pane').style.display = tab === 'momentum' ? 'block' : 'none';
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
  if (typeof Chart === 'undefined') return;
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
    if (typeof Chart === 'undefined') return;
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
    if (typeof Chart === 'undefined') return;
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

  const renderPlayerStatsList = (p) => {
    const posCode = p.position === 'Goalkeeper' ? 'GK' : p.position === 'Defender' ? 'DEF' : p.position === 'Midfielder' ? 'MID' : 'FWD';
    return `
      <div class="cmp-player" style="background:var(--surface-2); border:1px solid var(--border); border-radius:12px; padding:16px;">
        <h4 style="font-size:16px; font-weight:800; color:#fff; margin-bottom:2px;">${p.name}</h4>
        <div class="team" style="font-size:12px; color:var(--text-2); margin-bottom:12px;">${p.team} · <span class="pos-badge pos-${posCode}">${posCode}</span></div>
        ${[['Age', p.age||'-'],['Club', p.club||'-'],['Goals', p.goals],['Assists', p.assists],
           ['Minutes', p.minutes],['Rating', p.rating],['Height', (p.height||'-')+'cm'],
           ['Value', '€'+(p.value_m||0)+'M']].map(([l,v])=>`
          <div class="cmp-stat" style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:12px;"><span class="label" style="color:var(--text-2);">${l}</span><span class="val" style="font-weight:700; color:#fff;">${v}</span></div>
        `).join('')}
      </div>`;
  };

  out.innerHTML = `
    <div class="compare-container" style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 20px; align-items: start; width: 100%;">
      ${renderPlayerStatsList(res.player1)}
      
      <!-- Visuals Card -->
      <div style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; min-height: 420px;">
        <div style="position: relative; width: 100%; height: 230px;">
          <canvas id="cmp-radar-chart"></canvas>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; margin-top: 10px;">
          <div style="text-align: center;">
            <div style="font-size: 11px; color: var(--accent-2); margin-bottom: 4px; font-weight: 800; font-family: Outfit, sans-serif; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${res.player1.name.split(' ').pop()} Heatmap</div>
            <canvas id="heatmap-p1" style="width: 100%; height: 110px; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);"></canvas>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 11px; color: var(--accent-3); margin-bottom: 4px; font-weight: 800; font-family: Outfit, sans-serif; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${res.player2.name.split(' ').pop()} Heatmap</div>
            <canvas id="heatmap-p2" style="width: 100%; height: 110px; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);"></canvas>
          </div>
        </div>
      </div>
      
      ${renderPlayerStatsList(res.player2)}
    </div>
  `;

  // Draw comparison graphics
  renderRadarChart(res.player1, res.player2);
  drawPlayerHeatmap('heatmap-p1', res.player1.position);
  drawPlayerHeatmap('heatmap-p2', res.player2.position);

  if (res.ai_comparison) {
    const aiDiv = document.createElement('div');
    aiDiv.style.gridColumn = '1 / -1';
    aiDiv.style.marginTop = '20px';
    aiDiv.style.padding = '16px';
    aiDiv.style.background = 'var(--surface-2)';
    aiDiv.style.border = '1px solid var(--border)';
    aiDiv.style.borderRadius = '8px';
    aiDiv.style.textAlign = 'left';
    aiDiv.innerHTML = `
      <h4 style="color: var(--accent); margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
        ✨ AI Tactical Comparison
      </h4>
      <p style="color: var(--text-1); font-size: 13px; line-height: 1.5; margin: 0;">${res.ai_comparison}</p>
    `;
    out.appendChild(aiDiv);
  }
}

function renderRadarChart(p1, p2) {
  const ctx = document.getElementById('cmp-radar-chart');
  if (!ctx) return;
  
  const calculateStats = (p) => {
    const isGK = p.position === 'Goalkeeper';
    const isDEF = p.position === 'Defender';
    const isMID = p.position === 'Midfielder';
    const isFWD = p.position === 'Forward' || p.position === 'Winger' || p.position === 'Striker';
    
    const att = Math.min(100, Math.round((p.goals * 18) + (p.assists * 10) + (isFWD ? 50 : isMID ? 30 : 10)));
    const pas = Math.min(100, Math.round((p.assists * 25) + (isMID ? 55 : isFWD ? 40 : 20)));
    const def = Math.min(100, Math.round((isDEF ? 75 : isGK ? 85 : 30) + (p.rating * 1.5)));
    const phy = Math.min(100, Math.round(((p.height || 180) - 150) * 1.5 + (p.age ? (35 - p.age) * 2 : 50)));
    const pac = Math.min(100, Math.round(85 - (p.age ? (p.age - 20) * 1.5 : 0) + (isFWD ? 15 : 0)));
    
    return [att, pas, def, phy, pac];
  };
  
  const stats1 = calculateStats(p1);
  const stats2 = calculateStats(p2);
  
  if (chartRadar) chartRadar.destroy();
  
  chartRadar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Attacking', 'Passing', 'Defending', 'Physicality', 'Pace'],
      datasets: [
        {
          label: p1.name.split(' ').pop(),
          data: stats1,
          backgroundColor: 'rgba(34, 211, 238, 0.2)',
          borderColor: 'var(--accent-2)',
          borderWidth: 2,
          pointBackgroundColor: 'var(--accent-2)'
        },
        {
          label: p2.name.split(' ').pop(),
          data: stats2,
          backgroundColor: 'rgba(167, 139, 250, 0.2)',
          borderColor: 'var(--accent-3)',
          borderWidth: 2,
          pointBackgroundColor: 'var(--accent-3)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#fff', font: { family: 'Outfit', size: 10 } }
        }
      },
      scales: {
        r: {
          angleLines: { color: 'rgba(255,255,255,0.08)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
          pointLabels: { color: 'var(--text-2)', font: { family: 'Outfit', size: 9 } },
          ticks: { display: false },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function drawPlayerHeatmap(canvasId, position) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  canvas.width = 160;
  canvas.height = 120;
  
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  
  ctx.beginPath();
  ctx.moveTo(w / 2, 5);
  ctx.lineTo(w / 2, h - 5);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 15, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.strokeRect(5, h / 2 - 25, 20, 50);
  ctx.strokeRect(w - 25, h / 2 - 25, 20, 50);
  
  const hotZones = [];
  const addZone = (x, y, r, intensity) => hotZones.push({ x, y, r, intensity });
  
  if (position === 'Goalkeeper') {
    addZone(15, h / 2, 18, 0.9);
    addZone(22, h / 2 - 10, 12, 0.6);
    addZone(22, h / 2 + 10, 12, 0.6);
  } else if (position === 'Defender') {
    addZone(30, h / 2, 22, 0.85);
    addZone(45, h / 4, 18, 0.5);
    addZone(45, (3 * h) / 4, 18, 0.5);
    addZone(60, h / 2, 20, 0.4);
  } else if (position === 'Midfielder') {
    addZone(w / 2, h / 2, 25, 0.9);
    addZone(w / 2 - 20, h / 2 - 15, 18, 0.6);
    addZone(w / 2 + 20, h / 2 + 15, 18, 0.6);
    addZone(w / 2 + 30, h / 2 - 10, 15, 0.55);
  } else {
    addZone(w - 20, h / 2, 20, 0.9);
    addZone(w - 35, h / 4, 16, 0.7);
    addZone(w - 35, (3 * h) / 4, 16, 0.7);
    addZone(w / 2 + 20, h / 2, 20, 0.5);
  }
  
  hotZones.forEach(z => {
    ctx.beginPath();
    const grad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
    grad.addColorStop(0, `rgba(239, 68, 68, ${z.intensity * 0.75})`);
    grad.addColorStop(0.5, `rgba(245, 158, 11, ${z.intensity * 0.4})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ══════════════════ TAB 5: DRAFT & SQUAD BUILDER ══════════════════ */
let _pool = [];
let _auctionTimer = null;
let _auctionSecondsLeft = 0;
let _userDrafted = [];
let _aiDrafted = [];
let _userFormation = '4-3-3';
let _aiFormation = '4-3-3';
let _userStarters = {}; // key: slotId, value: player
let _userSubs = [null, null, null, null]; // 4 subs
let _draftTurn = 'user'; // 'user' or 'ai'
let _draftSearchQuery = '';
let _draftPosFilter = 'ALL';
let _selectedCardIndex = null;
let _simulatingMatchActive = false;

const FORMATIONS = {
  '4-4-2': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LB', label: 'LB', bottom: '22%', left: '15%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '38%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '62%', type: 'Defender' },
    { id: 'RB', label: 'RB', bottom: '22%', left: '85%', type: 'Defender' },
    { id: 'LM', label: 'LM', bottom: '50%', left: '15%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '48%', left: '38%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '48%', left: '62%', type: 'Midfielder' },
    { id: 'RM', label: 'RM', bottom: '50%', left: '85%', type: 'Midfielder' },
    { id: 'LS', label: 'LS', bottom: '78%', left: '35%', type: 'Forward' },
    { id: 'RS', label: 'RS', bottom: '78%', left: '65%', type: 'Forward' }
  ],
  '4-3-3': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LB', label: 'LB', bottom: '22%', left: '15%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '38%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '62%', type: 'Defender' },
    { id: 'RB', label: 'RB', bottom: '22%', left: '85%', type: 'Defender' },
    { id: 'LCM', label: 'LCM', bottom: '48%', left: '25%', type: 'Midfielder' },
    { id: 'CM', label: 'CM', bottom: '45%', left: '50%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '48%', left: '75%', type: 'Midfielder' },
    { id: 'LW', label: 'LW', bottom: '78%', left: '18%', type: 'Forward' },
    { id: 'ST', label: 'ST', bottom: '82%', left: '50%', type: 'Forward' },
    { id: 'RW', label: 'RW', bottom: '78%', left: '82%', type: 'Forward' }
  ],
  '3-5-2': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '25%', type: 'Defender' },
    { id: 'CB', label: 'CB', bottom: '18%', left: '50%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '75%', type: 'Defender' },
    { id: 'LWB', label: 'LWB', bottom: '48%', left: '12%', type: 'Midfielder' },
    { id: 'RWB', label: 'RWB', bottom: '48%', left: '88%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '44%', left: '32%', type: 'Midfielder' },
    { id: 'CM', label: 'CM', bottom: '46%', left: '50%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '44%', left: '68%', type: 'Midfielder' },
    { id: 'LS', label: 'LS', bottom: '78%', left: '35%', type: 'Forward' },
    { id: 'RS', label: 'RS', bottom: '78%', left: '65%', type: 'Forward' }
  ],
  '5-3-2': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LWB', label: 'LWB', bottom: '24%', left: '12%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '31%', type: 'Defender' },
    { id: 'CB', label: 'CB', bottom: '18%', left: '50%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '69%', type: 'Defender' },
    { id: 'RWB', label: 'RWB', bottom: '24%', left: '88%', type: 'Defender' },
    { id: 'LCM', label: 'LCM', bottom: '48%', left: '30%', type: 'Midfielder' },
    { id: 'CM', label: 'CM', bottom: '45%', left: '50%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '48%', left: '70%', type: 'Midfielder' },
    { id: 'LS', label: 'LS', bottom: '78%', left: '35%', type: 'Forward' },
    { id: 'RS', label: 'RS', bottom: '78%', left: '65%', type: 'Forward' }
  ],
  '4-2-3-1': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LB', label: 'LB', bottom: '22%', left: '15%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '38%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '62%', type: 'Defender' },
    { id: 'RB', label: 'RB', bottom: '22%', left: '85%', type: 'Defender' },
    { id: 'LDM', label: 'LDM', bottom: '42%', left: '35%', type: 'Midfielder' },
    { id: 'RDM', label: 'RDM', bottom: '42%', left: '65%', type: 'Midfielder' },
    { id: 'LAM', label: 'LAM', bottom: '65%', left: '20%', type: 'Midfielder' },
    { id: 'CAM', label: 'CAM', bottom: '60%', left: '50%', type: 'Midfielder' },
    { id: 'RAM', label: 'RAM', bottom: '65%', left: '80%', type: 'Midfielder' },
    { id: 'ST', label: 'ST', bottom: '82%', left: '50%', type: 'Forward' }
  ],
  '3-4-3': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '25%', type: 'Defender' },
    { id: 'CB', label: 'CB', bottom: '18%', left: '50%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '75%', type: 'Defender' },
    { id: 'LWB', label: 'LWB', bottom: '48%', left: '12%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '44%', left: '35%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '44%', left: '65%', type: 'Midfielder' },
    { id: 'RWB', label: 'RWB', bottom: '48%', left: '88%', type: 'Midfielder' },
    { id: 'LW', label: 'LW', bottom: '78%', left: '18%', type: 'Forward' },
    { id: 'ST', label: 'ST', bottom: '82%', left: '50%', type: 'Forward' },
    { id: 'RW', label: 'RW', bottom: '78%', left: '82%', type: 'Forward' }
  ],
  '4-1-4-1': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LB', label: 'LB', bottom: '22%', left: '15%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '38%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '62%', type: 'Defender' },
    { id: 'RB', label: 'RB', bottom: '22%', left: '85%', type: 'Defender' },
    { id: 'CDM', label: 'CDM', bottom: '38%', left: '50%', type: 'Midfielder' },
    { id: 'LM', label: 'LM', bottom: '58%', left: '15%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '55%', left: '38%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '55%', left: '62%', type: 'Midfielder' },
    { id: 'RM', label: 'RM', bottom: '58%', left: '85%', type: 'Midfielder' },
    { id: 'ST', label: 'ST', bottom: '82%', left: '50%', type: 'Forward' }
  ],
  '4-5-1': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LB', label: 'LB', bottom: '22%', left: '15%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '38%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '62%', type: 'Defender' },
    { id: 'RB', label: 'RB', bottom: '22%', left: '85%', type: 'Defender' },
    { id: 'LM', label: 'LM', bottom: '48%', left: '12%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '46%', left: '32%', type: 'Midfielder' },
    { id: 'CM', label: 'CM', bottom: '44%', left: '50%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '46%', left: '68%', type: 'Midfielder' },
    { id: 'RM', label: 'RM', bottom: '48%', left: '88%', type: 'Midfielder' },
    { id: 'ST', label: 'ST', bottom: '82%', left: '50%', type: 'Forward' }
  ],
  '3-4-1-2': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '25%', type: 'Defender' },
    { id: 'CB', label: 'CB', bottom: '18%', left: '50%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '75%', type: 'Defender' },
    { id: 'LWB', label: 'LWB', bottom: '46%', left: '12%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '42%', left: '35%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '42%', left: '65%', type: 'Midfielder' },
    { id: 'RWB', label: 'RWB', bottom: '46%', left: '88%', type: 'Midfielder' },
    { id: 'CAM', label: 'CAM', bottom: '62%', left: '50%', type: 'Midfielder' },
    { id: 'LS', label: 'LS', bottom: '80%', left: '35%', type: 'Forward' },
    { id: 'RS', label: 'RS', bottom: '80%', left: '65%', type: 'Forward' }
  ],
  '5-4-1': [
    { id: 'GK', label: 'GK', bottom: '5%', left: '50%', type: 'Goalkeeper' },
    { id: 'LWB', label: 'LWB', bottom: '24%', left: '10%', type: 'Defender' },
    { id: 'LCB', label: 'LCB', bottom: '20%', left: '28%', type: 'Defender' },
    { id: 'CB', label: 'CB', bottom: '18%', left: '50%', type: 'Defender' },
    { id: 'RCB', label: 'RCB', bottom: '20%', left: '72%', type: 'Defender' },
    { id: 'RWB', label: 'RWB', bottom: '24%', left: '90%', type: 'Defender' },
    { id: 'LM', label: 'LM', bottom: '48%', left: '18%', type: 'Midfielder' },
    { id: 'LCM', label: 'LCM', bottom: '46%', left: '38%', type: 'Midfielder' },
    { id: 'RCM', label: 'RCM', bottom: '46%', left: '62%', type: 'Midfielder' },
    { id: 'RM', label: 'RM', bottom: '48%', left: '82%', type: 'Midfielder' },
    { id: 'ST', label: 'ST', bottom: '80%', left: '50%', type: 'Forward' }
  ]
};

function initAuction() {
  document.getElementById('start-auction-btn').addEventListener('click', startDraftAuction);
  document.getElementById('auction-search-apply').addEventListener('click', () => {
    _draftSearchQuery = document.getElementById('draft-search').value;
    renderDraftPool();
  });
  document.getElementById('draft-position-filter').addEventListener('change', (e) => {
    _draftPosFilter = e.target.value;
    renderDraftPool();
  });
  document.getElementById('simulate-btn').addEventListener('click', simulateDraftMatch);
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('sim-modal').style.display = 'none';
  });
}

async function startDraftAuction() {
  _userFormation = document.getElementById('user-formation-select').value;
  const forms = ['4-4-2', '4-3-3', '3-5-2', '5-3-2', '4-2-3-1'];
  _aiFormation = forms[Math.floor(Math.random() * forms.length)];

  const res = await $get('/api/auction/pool');
  _pool = res.players || [];
  
  _userDrafted = [];
  _aiDrafted = [];
  _userStarters = {};
  _userSubs = [null, null, null, null];
  _draftTurn = 'user';
  _draftSearchQuery = '';
  _draftPosFilter = 'ALL';
  _selectedCardIndex = null;

  document.getElementById('draft-search').value = '';
  document.getElementById('draft-position-filter').value = 'ALL';

  document.getElementById('auction-setup').style.display = 'none';
  document.getElementById('auction-board').style.display = 'grid';
  document.getElementById('squad-builder-board').style.display = 'none';
  document.getElementById('sim-ready').style.display = 'none';

  updateDraftRosterLists();
  renderDraftPool();
  updateDraftTurnIndicator();
}

function updateDraftRosterLists() {
  document.getElementById('user-draft-count').textContent = _userDrafted.length;
  const userList = document.getElementById('user-draft-list');
  userList.innerHTML = '';
  _userDrafted.forEach((p) => {
    const groupPos = ['GK'].includes(p.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(p.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(p.position) ? 'MID' : 'FWD';
    const flag = getFlagUrl(p.team);
    const div = document.createElement('div');
    div.className = 'roster-item';
    div.style.background = 'rgba(255,255,255,0.02)';
    div.style.border = '1px solid var(--border)';
    div.style.padding = '8px 12px';
    div.style.borderRadius = '6px';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '8px';
    div.innerHTML = `
      <span class="pos-badge pos-${groupPos}" style="font-size:9px; padding:2px 4px; border-radius:4px;">${p.position}</span>
      ${flag ? `<img src="${flag}" style="width:14px; height:10px; object-fit:cover; border-radius:1px;">` : ''}
      <span style="font-size:12px; font-weight:700; color:#fff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</span>
      <span style="font-size:11px; font-weight:800; color:var(--accent-2);">${p.rating}</span>
    `;
    userList.appendChild(div);
  });

  document.getElementById('ai-draft-count').textContent = _aiDrafted.length;
  const aiList = document.getElementById('ai-draft-list');
  aiList.innerHTML = '';
  _aiDrafted.forEach((p) => {
    const groupPos = ['GK'].includes(p.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(p.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(p.position) ? 'MID' : 'FWD';
    const flag = getFlagUrl(p.team);
    const div = document.createElement('div');
    div.className = 'roster-item';
    div.style.background = 'rgba(255,255,255,0.02)';
    div.style.border = '1px solid var(--border)';
    div.style.padding = '8px 12px';
    div.style.borderRadius = '6px';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '8px';
    div.innerHTML = `
      <span class="pos-badge pos-${groupPos}" style="font-size:9px; padding:2px 4px; border-radius:4px;">${p.position}</span>
      ${flag ? `<img src="${flag}" style="width:14px; height:10px; object-fit:cover; border-radius:1px;">` : ''}
      <span style="font-size:12px; font-weight:700; color:#fff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</span>
      <span style="font-size:11px; font-weight:800; color:var(--accent);">${p.rating}</span>
    `;
    aiList.appendChild(div);
  });
}

function isPositionFull(who, position) {
  const roster = who === 'user' ? _userDrafted : _aiDrafted;
  
  const isGK = position === 'GK';
  const isDEF = ['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(position);
  const isMID = ['CDM', 'CM', 'CAM'].includes(position);
  const isFWD = ['LW', 'RW', 'ST'].includes(position);
  
  if (isGK) {
    return roster.filter(p => p.position === 'GK').length >= 2;
  }
  if (isDEF) {
    return roster.filter(p => ['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(p.position)).length >= 5;
  }
  if (isMID) {
    return roster.filter(p => ['CDM', 'CM', 'CAM'].includes(p.position)).length >= 4;
  }
  if (isFWD) {
    return roster.filter(p => ['LW', 'RW', 'ST'].includes(p.position)).length >= 4;
  }
  return false;
}

function renderDraftPool() {
  const grid = document.getElementById('draft-pool-grid');
  grid.innerHTML = '';

  // NLP helper: normalize diacritics & lowercase
  const nlpNormalize = (str) => {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  };

  // Position alias map for natural language queries
  const POS_ALIASES = {
    'keeper': ['GK'], 'goalkeeper': ['GK'], 'goalie': ['GK'],
    'defender': ['LB','LCB','RCB','RB','CB','LWB','RWB'], 'back': ['LB','LCB','RCB','RB','CB','LWB','RWB'],
    'fullback': ['LB','RB','LWB','RWB'], 'centerback': ['LCB','RCB','CB'], 'cb': ['LCB','RCB','CB'],
    'midfielder': ['CDM','CM','CAM','LM','RM','LCM','RCM','LDM','RDM','LAM','RAM'],
    'mid': ['CDM','CM','CAM','LM','RM','LCM','RCM'], 'playmaker': ['CAM','CM'],
    'forward': ['LW','RW','ST','LS','RS'], 'attacker': ['LW','RW','ST','LS','RS'],
    'striker': ['ST','LS','RS'], 'winger': ['LW','RW','LM','RM'],
    'wing': ['LW','RW','LM','RM'], 'centre': ['CM','CDM','CAM','CB','LCB','RCB'],
    'defensive': ['CDM','LDM','RDM','CB','LCB','RCB'],
    'brazilian': [], 'french': [], 'german': [], 'english': [], 'spanish': [], 'argentine': [], 'portuguese': []
  };

  const filtered = _pool.filter(p => {
    const isDrafted = _userDrafted.some(x => x.name === p.name) || _aiDrafted.some(x => x.name === p.name);
    if (isDrafted) return false;

    // NLP search
    if (_draftSearchQuery && _draftSearchQuery.trim() !== '') {
      const queryNorm = nlpNormalize(_draftSearchQuery);
      const tokens = queryNorm.split(/\s+/).filter(Boolean);
      const pName = nlpNormalize(p.name);
      const pTeam = nlpNormalize(p.team);
      const pClub = nlpNormalize(p.club || '');
      const pPos = nlpNormalize(p.position);
      const searchable = `${pName} ${pTeam} ${pClub} ${pPos}`;

      const match = tokens.every(token => {
        // Check if token is a position alias
        if (POS_ALIASES[token] && POS_ALIASES[token].length > 0) {
          return POS_ALIASES[token].some(alias => p.position === alias);
        }
        // Substring match against name, team, club, position
        return searchable.includes(token);
      });
      if (!match) return false;
    }

    if (_draftPosFilter !== 'ALL') {
      const isGK = p.position === 'GK';
      const isDEF = ['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(p.position);
      const isMID = ['CDM', 'CM', 'CAM'].includes(p.position);
      const isFWD = ['LW', 'RW', 'ST'].includes(p.position);

      if (_draftPosFilter === 'GK' && !isGK) return false;
      if (_draftPosFilter === 'DEF' && !isDEF) return false;
      if (_draftPosFilter === 'MID' && !isMID) return false;
      if (_draftPosFilter === 'FWD' && !isFWD) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-2);">No available players found</div>';
    return;
  }

  filtered.sort((a, b) => b.rating - a.rating);

  filtered.forEach(p => {
    const groupPos = ['GK'].includes(p.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(p.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(p.position) ? 'MID' : 'FWD';
    const flag = getFlagUrl(p.team);
    
    const posFull = isPositionFull('user', p.position);
    const isUserTurn = _draftTurn === 'user';
    const btnDisabled = (!isUserTurn || posFull);
    const btnText = posFull ? 'Position Full' : 'Draft Player';
    const btnClass = posFull ? 'btn-secondary' : 'btn-primary';

    const card = document.createElement('div');
    card.className = 'panel player-card-draft';
    card.style.background = 'rgba(255,255,255,0.01)';
    card.style.border = '1px solid var(--border)';
    card.style.borderRadius = '8px';
    card.style.padding = '10px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '6px';
    card.style.position = 'relative';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="pos-badge pos-${groupPos}" style="font-size:9px; padding:2px 6px; border-radius:4px;">${p.position}</span>
        <span style="font-size:12px; font-weight:800; color:var(--gold);">${p.rating} ⭐</span>
      </div>
      <div style="font-size:13px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
        ${flag ? `<img src="${flag}" style="width:16px; height:11px; object-fit:cover; border-radius:1px;">` : ''}
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</span>
      </div>
      <div style="font-size:11px; color:var(--text-2); display:flex; justify-content:space-between;">
        <span>Goals: ${p.goals || 0}</span>
        <span>Assists: ${p.assists || 0}</span>
      </div>
      <button class="${btnClass}" style="padding:6px; font-size:11px; margin-top:4px;" ${btnDisabled ? 'disabled' : ''}>${btnText}</button>
    `;

    const btn = card.querySelector('button');
    btn.addEventListener('click', () => {
      if (_draftTurn !== 'user' || posFull) return;
      draftPlayer('user', p);
    });

    grid.appendChild(card);
  });
}

function draftPlayer(who, player) {
  if (isPositionFull(who, player.position)) {
    return;
  }

  if (who === 'user') {
    _userDrafted.push(player);
    updateDraftRosterLists();
    
    if (_userDrafted.length >= 15 && _aiDrafted.length >= 15) {
      endDraft();
      return;
    }

    _draftTurn = 'ai';
    updateDraftTurnIndicator();
    renderDraftPool();
    
    setTimeout(aiDraftTurn, 1000);
  } else {
    _aiDrafted.push(player);
    updateDraftRosterLists();

    if (_userDrafted.length >= 15 && _aiDrafted.length >= 15) {
      endDraft();
      return;
    }

    _draftTurn = 'user';
    updateDraftTurnIndicator();
    renderDraftPool();
  }
}

function aiDraftTurn() {
  if (_aiDrafted.length >= 15) return;

  const available = _pool.filter(p => {
    return !_userDrafted.some(x => x.name === p.name) && !_aiDrafted.some(x => x.name === p.name);
  });

  if (available.length === 0) return;

  // AI drafts any position that is NOT full
  let candidates = available.filter(p => !isPositionFull('ai', p.position));

  if (candidates.length === 0) {
    candidates = [...available];
  }

  candidates.sort((a, b) => b.rating - a.rating);
  const picked = candidates[0];
  
  draftPlayer('ai', picked);
}

function updateDraftTurnIndicator() {
  const indicator = document.getElementById('draft-turn-indicator');
  if (_draftTurn === 'user') {
    indicator.textContent = 'YOUR TURN: Pick a player from the pool';
    indicator.style.background = 'rgba(34, 211, 238, 0.08)';
    indicator.style.borderColor = 'rgba(34, 211, 238, 0.2)';
    indicator.style.color = 'var(--accent-2)';
  } else {
    indicator.textContent = 'AI MANAGER IS THINKING...';
    indicator.style.background = 'rgba(239, 68, 68, 0.08)';
    indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    indicator.style.color = 'var(--red)';
  }
}

function endDraft() {
  document.getElementById('auction-board').style.display = 'none';
  document.getElementById('squad-builder-board').style.display = 'grid';
  document.getElementById('formation-label-text').textContent = _userFormation;
  
  _userStarters = {};
  _userSubs = [null, null, null, null];

  renderSquadBuilder();
}

function renderSquadBuilder() {
  const dock = document.getElementById('draggable-players-dock');
  dock.innerHTML = '';

  const placedNames = new Set();
  Object.values(_userStarters).forEach(p => { if (p) placedNames.add(p.name); });
  _userSubs.forEach(p => { if (p) placedNames.add(p.name); });

  const unplaced = _userDrafted.filter(p => !placedNames.has(p.name));

  unplaced.forEach((p, idx) => {
    const groupPos = ['GK'].includes(p.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(p.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(p.position) ? 'MID' : 'FWD';
    const flag = getFlagUrl(p.team);
    
    const card = document.createElement('div');
    card.className = 'panel player-builder-card';
    if (_selectedCardIndex === idx) card.className += ' selected-card';
    
    card.setAttribute('draggable', 'true');
    card.dataset.playerIndex = idx;
    
    card.style.background = 'rgba(255,255,255,0.02)';
    card.style.border = _selectedCardIndex === idx ? '2px solid var(--accent-2)' : '1px solid var(--border)';
    card.style.borderRadius = '6px';
    card.style.padding = '8px';
    card.style.width = 'calc(50% - 6px)';
    card.style.cursor = 'grab';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '4px';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:10px;">
        <span class="pos-badge pos-${groupPos}">${p.position}</span>
        <span style="color:var(--gold); font-weight:800;">${p.rating}</span>
      </div>
      <div style="font-size:11px; font-weight:800; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:4px;">
        ${flag ? `<img src="${flag}" style="width:12px; height:8px; object-fit:cover;">` : ''}
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name.split(' ').pop()}</span>
      </div>
    `;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', idx);
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.4';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
    });

    card.addEventListener('click', () => {
      if (_selectedCardIndex === idx) {
        _selectedCardIndex = null;
      } else {
        _selectedCardIndex = idx;
      }
      renderSquadBuilder();
    });

    dock.appendChild(card);
  });

  if (unplaced.length === 0 && placedNames.size < 15) {
    dock.innerHTML = '<div style="font-size:12px; color:var(--text-2); padding:10px;">All players placed!</div>';
  } else if (unplaced.length === 0) {
    dock.innerHTML = '<div style="font-size:12px; color:var(--green); font-weight:800; padding:10px;">Lineup complete! Click simulate below.</div>';
  }

  const pitch = document.getElementById('builder-pitch');
  const oldSlots = pitch.querySelectorAll('.pitch-slot');
  oldSlots.forEach(s => s.remove());

  const slotsData = FORMATIONS[_userFormation] || FORMATIONS['4-3-3'];
  slotsData.forEach(slot => {
    const placedPlayer = _userStarters[slot.id];
    
    const div = document.createElement('div');
    div.className = 'pitch-slot';
    if (placedPlayer) div.className += ' filled';
    div.style.bottom = slot.bottom;
    div.style.left = slot.left;
    div.dataset.slotId = slot.id;

    if (placedPlayer) {
      const groupPos = ['GK'].includes(placedPlayer.position) ? 'GK' : ['LB', 'LCB', 'RCB', 'RB'].includes(placedPlayer.position) ? 'DEF' : ['CDM', 'CM', 'CAM'].includes(placedPlayer.position) ? 'MID' : 'FWD';
      const isMismatch = (slot.type === 'Goalkeeper' && placedPlayer.position !== 'GK') ||
                         (slot.type === 'Defender' && !['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(placedPlayer.position)) ||
                         (slot.type === 'Midfielder' && !['CDM', 'CM', 'CAM'].includes(placedPlayer.position)) ||
                         (slot.type === 'Forward' && !['LW', 'RW', 'ST'].includes(placedPlayer.position));
      
      div.innerHTML = `
        <span class="slot-pos-label" style="color:${isMismatch ? 'var(--red)' : 'var(--text-2)'}">${slot.label}${isMismatch ? ' ⚠️' : ''}</span>
        <span class="slot-player-name" style="font-size:8px; color:#fff;">${placedPlayer.name.split(' ').pop()}</span>
        <span class="slot-player-cp" style="font-size:7px; color:var(--accent-2);">${placedPlayer.rating}</span>
      `;
    } else {
      div.innerHTML = `
        <span class="slot-pos-label">${slot.label}</span>
        <span class="slot-player-name" style="color:rgba(255,255,255,0.2);">—</span>
        <span class="slot-player-cp"></span>
      `;
    }

    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      div.style.borderColor = 'var(--accent-2)';
      div.style.background = 'rgba(34, 211, 238, 0.05)';
    });
    div.addEventListener('dragleave', () => {
      div.style.borderColor = placedPlayer ? 'var(--accent-2)' : 'rgba(255,255,255,0.15)';
      div.style.background = '';
    });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      const playerIdx = parseInt(e.dataTransfer.getData('text/plain'));
      placePlayerInStarter(playerIdx, slot.id);
    });

    div.addEventListener('click', () => {
      if (_selectedCardIndex !== null) {
        placePlayerInStarter(_selectedCardIndex, slot.id);
      } else if (placedPlayer) {
        delete _userStarters[slot.id];
        _selectedCardIndex = null;
        renderSquadBuilder();
      }
    });

    pitch.appendChild(div);
  });

  const benchContainer = document.getElementById('bench-slots-container');
  benchContainer.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const placedPlayer = _userSubs[i];
    
    const div = document.createElement('div');
    div.className = 'pitch-slot';
    if (placedPlayer) div.className += ' filled';
    div.style.position = 'relative';
    div.style.transform = 'none';
    div.style.left = 'auto';
    div.style.bottom = 'auto';
    div.dataset.subIndex = i;

    if (placedPlayer) {
      div.innerHTML = `
        <span class="slot-pos-label">SUB ${i+1}</span>
        <span class="slot-player-name" style="font-size:8px; color:#fff;">${placedPlayer.name.split(' ').pop()}</span>
        <span class="slot-player-cp" style="font-size:7px; color:var(--accent-2);">${placedPlayer.rating}</span>
      `;
    } else {
      div.innerHTML = `
        <span class="slot-pos-label">SUB ${i+1}</span>
        <span class="slot-player-name" style="color:rgba(255,255,255,0.2);">—</span>
        <span class="slot-player-cp"></span>
      `;
    }

    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      div.style.borderColor = 'var(--accent-2)';
      div.style.background = 'rgba(34, 211, 238, 0.05)';
    });
    div.addEventListener('dragleave', () => {
      div.style.borderColor = placedPlayer ? 'var(--accent-2)' : 'rgba(255,255,255,0.15)';
      div.style.background = '';
    });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      const playerIdx = parseInt(e.dataTransfer.getData('text/plain'));
      placePlayerInSub(playerIdx, i);
    });

    div.addEventListener('click', () => {
      if (_selectedCardIndex !== null) {
        placePlayerInSub(_selectedCardIndex, i);
      } else if (placedPlayer) {
        _userSubs[i] = null;
        _selectedCardIndex = null;
        renderSquadBuilder();
      }
    });

    benchContainer.appendChild(div);
  }

  const filledStartersCount = Object.keys(_userStarters).length;
  const filledSubsCount = _userSubs.filter(Boolean).length;

  if (filledStartersCount === 11 && filledSubsCount === 4) {
    document.getElementById('sim-ready').style.display = 'block';
  } else {
    document.getElementById('sim-ready').style.display = 'none';
  }
}

function placePlayerInStarter(playerIdx, slotId) {
  const placedNames = new Set();
  Object.values(_userStarters).forEach(p => { if (p) placedNames.add(p.name); });
  _userSubs.forEach(p => { if (p) placedNames.add(p.name); });
  const unplaced = _userDrafted.filter(p => !placedNames.has(p.name));

  const player = unplaced[playerIdx];
  if (!player) return;

  _userStarters[slotId] = { ...player, slottedPosition: slotId };
  _selectedCardIndex = null;
  renderSquadBuilder();
}

function placePlayerInSub(playerIdx, subIdx) {
  const placedNames = new Set();
  Object.values(_userStarters).forEach(p => { if (p) placedNames.add(p.name); });
  _userSubs.forEach(p => { if (p) placedNames.add(p.name); });
  const unplaced = _userDrafted.filter(p => !placedNames.has(p.name));

  const player = unplaced[playerIdx];
  if (!player) return;

  _userSubs[subIdx] = { ...player, slottedPosition: 'SUB' };
  _selectedCardIndex = null;
  renderSquadBuilder();
}

async function simulateDraftMatch() {
  if (_simulatingMatchActive) return;
  _simulatingMatchActive = true;

  const aiStarters = [];
  const aiSubs = [];

  const aiFormationSlots = FORMATIONS[_aiFormation] || FORMATIONS['4-3-3'];
  const remainingAI = [..._aiDrafted];

  aiFormationSlots.forEach(slot => {
    let pIdx = remainingAI.findIndex(p => {
      const nat = p.position;
      const slotType = slot.type;
      if (slotType === 'Goalkeeper' && nat === 'GK') return true;
      if (slotType === 'Defender' && ['LB', 'LCB', 'RCB', 'RB', 'CB', 'LWB', 'RWB'].includes(nat)) return true;
      if (slotType === 'Midfielder' && ['CDM', 'CM', 'CAM'].includes(nat)) return true;
      if (slotType === 'Forward' && ['LW', 'RW', 'ST'].includes(nat)) return true;
      return false;
    });

    if (pIdx === -1) {
      pIdx = 0;
    }

    if (remainingAI.length > 0) {
      const p = remainingAI.splice(pIdx, 1)[0];
      aiStarters.push({ ...p, slottedPosition: slot.id });
    }
  });

  remainingAI.forEach(p => {
    aiSubs.push({ ...p, slottedPosition: 'SUB' });
  });

  const userStartersList = Object.values(_userStarters);
  const userSubsList = _userSubs.filter(Boolean);

  const res = await $post('/api/auction/simulate', {
    userStarters: userStartersList,
    userSubs: userSubsList,
    aiStarters: aiStarters,
    aiSubs: aiSubs
  });

  if (res.error) {
    alert(res.error);
    _simulatingMatchActive = false;
    return;
  }

  document.getElementById('sb-user').textContent = '0';
  document.getElementById('sb-ai').textContent = '0';
  document.getElementById('sb-upow').textContent = 'Avg Rating: ' + res.userPower;
  document.getElementById('sb-apow').textContent = 'Avg Rating: ' + res.aiPower;
  document.getElementById('match-feed').innerHTML = '';

  document.getElementById('stat-u-pos').textContent = '50%';
  document.getElementById('stat-a-pos').textContent = '50%';
  document.getElementById('stat-u-shots').textContent = '0 (0)';
  document.getElementById('stat-a-shots').textContent = '0 (0)';
  document.getElementById('stat-u-fouls').textContent = '0 (0)';
  document.getElementById('stat-a-fouls').textContent = '0 (0)';

  const userFlags = [...new Set(userStartersList.map(p => getFlagUrl(p.team)).filter(Boolean))].slice(0, 3).map(f => `<img src="${f}" style="width:14px; height:9px; border-radius:1px; margin-right:2px; vertical-align:middle;">`).join('');
  const aiFlags = [...new Set(aiStarters.map(p => getFlagUrl(p.team)).filter(Boolean))].slice(0, 3).map(f => `<img src="${f}" style="width:14px; height:9px; border-radius:1px; margin-left:2px; vertical-align:middle;">`).join('');

  document.querySelector('#sim-modal .sb-team:first-child .sb-name').innerHTML = `<span style="display:flex; align-items:center; justify-content:center; gap:6px;">⭐ User Dream Team ${userFlags}</span>`;
  document.querySelector('#sim-modal .sb-team:last-child .sb-name').innerHTML = `<span style="display:flex; align-items:center; justify-content:center; gap:6px;">${aiFlags} AI Elite Manager 🤖</span>`;

  const modal = document.getElementById('sim-modal');
  modal.style.display = 'flex';

  let delay = 0;
  res.events.forEach((ev, idx) => {
    delay += 1800;
    setTimeout(() => {
      if (ev.type === 'GOAL') {
        const [u, a] = ev.score.split('-');
        document.getElementById('sb-user').textContent = u;
        document.getElementById('sb-ai').textContent = a;
      }

      if (ev.stats) {
        document.getElementById('stat-u-pos').textContent = res.userPos + '%';
        document.getElementById('stat-a-pos').textContent = res.aiPos + '%';
        document.getElementById('stat-u-shots').textContent = `${ev.stats.uShots} (${ev.stats.uSot})`;
        document.getElementById('stat-a-shots').textContent = `${ev.stats.aShots} (${ev.stats.aSot})`;
        document.getElementById('stat-u-fouls').textContent = `${ev.stats.uFouls} (${ev.stats.uYellows})`;
        document.getElementById('stat-a-fouls').textContent = `${ev.stats.aFouls} (${ev.stats.aYellows})`;
      }

      const div = document.createElement('div');
      div.className = 'mf-event ' + ev.type;
      div.style.padding = '8px';
      div.style.borderRadius = '6px';
      div.style.fontSize = '12px';
      div.style.display = 'flex';
      div.style.gap = '8px';
      div.style.alignItems = 'center';
      
      let badgeColor = 'rgba(255,255,255,0.1)';
      if (ev.type === 'GOAL') badgeColor = 'rgba(34, 211, 238, 0.2)';
      else if (ev.type === 'CARD') badgeColor = 'rgba(234, 179, 8, 0.2)';
      else if (ev.type === 'SAVE') badgeColor = 'rgba(16, 185, 129, 0.2)';

      div.innerHTML = `
        <span style="font-weight: 800; color: var(--accent-2); background: ${badgeColor}; padding: 2px 6px; border-radius: 4px; font-size:11px;">${ev.min}'</span>
        <span style="flex:1; color:#fff;">${ev.desc}</span>
        <span style="font-weight: 800; color: var(--accent);">${ev.score}</span>
      `;

      const feed = document.getElementById('match-feed');
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;

      if (idx === res.events.length - 1) {
        _simulatingMatchActive = false;
      }
    }, delay);
  });
}

function logBid(msg, type) {
  // Adapted to draft logs
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
    if (typeof Chart === 'undefined') return;
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
let activeTheme = 'gold';
function initCanvasBackground() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;
  
  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });
  
  const mouse = { x: null, y: null, radius: 150 };
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mouseleave', () => {
    mouse.x = null;
    mouse.y = null;
  });
  
  const themesColors = {
    gold: ['rgba(217, 119, 6, 0.15)', 'rgba(245, 158, 11, 0.05)', 'rgba(251, 191, 36, 0.03)'],
    cyber: ['rgba(236, 72, 153, 0.15)', 'rgba(6, 182, 212, 0.15)', 'rgba(167, 139, 250, 0.05)'],
    samba: ['rgba(34, 197, 94, 0.15)', 'rgba(234, 179, 8, 0.12)', 'rgba(29, 78, 216, 0.08)'],
    frost: ['rgba(14, 165, 233, 0.15)', 'rgba(255, 255, 255, 0.08)', 'rgba(56, 189, 248, 0.04)']
  };
  
  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.radius = Math.random() * 80 + 40;
      this.vx = (Math.random() - 0.5) * 0.8;
      this.vy = (Math.random() - 0.5) * 0.8;
      this.colorIndex = Math.floor(Math.random() * 3);
    }
    
    update() {
      this.x += this.vx;
      this.y += this.vy;
      
      if (this.x - this.radius > width) this.x = -this.radius;
      if (this.x + this.radius < 0) this.x = width + this.radius;
      if (this.y - this.radius > height) this.y = -this.radius;
      if (this.y + this.radius < 0) this.y = height + this.radius;
      
      if (mouse.x !== null && mouse.y !== null) {
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < mouse.radius) {
          const force = (mouse.radius - dist) / mouse.radius;
          const angle = Math.atan2(dy, dx);
          this.x += Math.cos(angle) * force * 3;
          this.y += Math.sin(angle) * force * 3;
        }
      }
    }
    
    draw() {
      const colors = themesColors[activeTheme] || themesColors.gold;
      const baseColor = colors[this.colorIndex];
      
      ctx.beginPath();
      const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
      grad.addColorStop(0, baseColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  const particles = Array.from({ length: 15 }, () => new Particle());
  
  function animate() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach(p => {
      p.update();
      p.draw();
    });
    requestAnimationFrame(animate);
  }
  
  animate();
}

function initThemes() {
  const dots = document.querySelectorAll('.theme-dot');
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const theme = dot.dataset.theme;
      dots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      
      document.body.classList.remove('theme-gold', 'theme-cyber', 'theme-samba', 'theme-frost');
      document.body.classList.add('theme-' + theme);
      activeTheme = theme;
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

  const downloadBtn = document.getElementById('download-bracket-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const container = document.querySelector('.bracket-container');
      if (!container) return;
      
      const originalOverflowX = container.style.overflowX;
      container.style.overflowX = 'visible';
      
      html2canvas(container, {
        backgroundColor: '#0d1526',
        scale: 2,
        logging: false,
        useCORS: true
      }).then(canvas => {
        container.style.overflowX = originalOverflowX;
        
        const link = document.createElement('a');
        link.download = 'fifa-2026-bracket.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      }).catch(err => {
        console.error('Bracket download error:', err);
        alert('Failed to generate bracket image. Please try again.');
        container.style.overflowX = originalOverflowX;
      });
    });
  }

  const mcBtn = document.getElementById('run-monte-carlo-btn');
  if (mcBtn) {
    mcBtn.addEventListener('click', runMonteCarlo);
  }
}

let chartMonteCarlo = null;
async function runMonteCarlo() {
  const btn = document.getElementById('run-monte-carlo-btn');
  const progressWrap = document.getElementById('monte-carlo-progress-wrap');
  const progressBar = document.getElementById('mc-progress-bar');
  const progressText = document.getElementById('mc-progress-text');
  const progressPercent = document.getElementById('mc-progress-percent');
  const resultsDiv = document.getElementById('monte-carlo-results');
  const statsDiv = document.getElementById('monte-carlo-stats');
  
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Simulating...';
  progressWrap.style.display = 'block';
  resultsDiv.style.display = 'none';
  
  if (Object.keys(_analytics).length === 0) {
    try {
      const res = await fetch('/data_analytics.json').then(r => r.json());
      _analytics = res || {};
    } catch(e) {
      console.error('Failed to load data_analytics.json', e);
      btn.disabled = false;
      btn.textContent = '⚡ Run 10,000 Runs';
      alert('Failed to load team analytics data.');
      return;
    }
  }
  
  const teamsList = _teams.map(t => t.name);
  const getPower = (team) => {
    const a = _analytics[team];
    if (!a) return 0.5;
    return (a.offense*0.3 + a.defense*0.25 + a.passing*0.2 + a.possession*0.15 + a.creativity*0.1) / 100;
  };
  
  const stats = {};
  teamsList.forEach(t => {
    stats[t] = { r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
  });
  
  const totalRuns = 10000;
  let currentRun = 0;
  
  const groupsMap = {};
  _teams.forEach(t => {
    if (!groupsMap[t.group]) groupsMap[t.group] = [];
    groupsMap[t.group].push(t.name);
  });
  
  const groupNames = Object.keys(groupsMap);
  
  function simulateSingleTournament() {
    const groupStandings = {};
    
    groupNames.forEach(g => {
      const teams = groupsMap[g];
      const pts = {};
      const gd = {};
      const gf = {};
      teams.forEach(t => { pts[t] = 0; gd[t] = 0; gf[t] = 0; });
      
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const tA = teams[i];
          const tB = teams[j];
          const pA = getPower(tA);
          const pB = getPower(tB);
          
          const gA = Math.max(0, Math.round(Math.random() * 2.5 + (pA - pB) * 1.5));
          const gB = Math.max(0, Math.round(Math.random() * 2.5 + (pB - pA) * 1.5));
          
          gf[tA] += gA;
          gf[tB] += gB;
          gd[tA] += (gA - gB);
          gd[tB] += (gB - gA);
          
          if (gA > gB) {
            pts[tA] += 3;
          } else if (gB > gA) {
            pts[tB] += 3;
          } else {
            pts[tA] += 1;
            pts[tB] += 1;
          }
        }
      }
      
      const sorted = [...teams].sort((a, b) => {
        return pts[b] - pts[a] || gd[b] - gd[a] || gf[b] - gf[a];
      });
      
      groupStandings[g] = sorted;
    });
    
    const advancing = [];
    const thirdPlaces = [];
    
    groupNames.forEach(g => {
      const standings = groupStandings[g];
      advancing.push(standings[0]);
      advancing.push(standings[1]);
      thirdPlaces.push({ team: standings[2], pts: standings[2] ? 3 : 0, gd: 0, gf: 0 });
    });
    
    thirdPlaces.sort((a, b) => getPower(b.team) - getPower(a.team));
    for (let i = 0; i < 8; i++) {
      if (thirdPlaces[i]) advancing.push(thirdPlaces[i].team);
    }
    
    let r32Teams = advancing.filter(Boolean);
    while (r32Teams.length < 32) {
      r32Teams.push(teamsList[Math.floor(Math.random() * teamsList.length)]);
    }
    
    r32Teams = r32Teams.sort(() => Math.random() - 0.5);
    r32Teams.forEach(t => { if (stats[t]) stats[t].r32++; });
    
    let r16Teams = [];
    for (let i = 0; i < 32; i += 2) {
      const winner = simulateMatchWinner(r32Teams[i], r32Teams[i+1]);
      r16Teams.push(winner);
      if (stats[winner]) stats[winner].r16++;
    }
    
    let qfTeams = [];
    for (let i = 0; i < 16; i += 2) {
      const winner = simulateMatchWinner(r16Teams[i], r16Teams[i+1]);
      qfTeams.push(winner);
      if (stats[winner]) stats[winner].qf++;
    }
    
    let sfTeams = [];
    for (let i = 0; i < 8; i += 2) {
      const winner = simulateMatchWinner(qfTeams[i], qfTeams[i+1]);
      sfTeams.push(winner);
      if (stats[winner]) stats[winner].sf++;
    }
    
    let finalTeams = [];
    for (let i = 0; i < 4; i += 2) {
      const winner = simulateMatchWinner(sfTeams[i], sfTeams[i+1]);
      finalTeams.push(winner);
      if (stats[winner]) stats[winner].final++;
    }
    
    const champion = simulateMatchWinner(finalTeams[0], finalTeams[1]);
    if (stats[champion]) stats[champion].champion++;
  }
  
  function simulateMatchWinner(tA, tB) {
    const pA = getPower(tA);
    const pB = getPower(tB);
    const total = pA + pB || 1;
    return Math.random() < (pA / total) ? tA : tB;
  }
  
  const chunkSize = 500;
  function runChunk() {
    const end = Math.min(totalRuns, currentRun + chunkSize);
    for (let i = currentRun; i < end; i++) {
      simulateSingleTournament();
    }
    currentRun = end;
    
    const pct = Math.round((currentRun / totalRuns) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent = `Simulating: ${currentRun.toLocaleString()} / 10,000 runs`;
    progressPercent.textContent = pct + '%';
    
    if (currentRun < totalRuns) {
      setTimeout(runChunk, 10);
    } else {
      finishSimulation();
    }
  }
  
  function finishSimulation() {
    btn.disabled = false;
    btn.textContent = '⚡ Run 10,000 Runs';
    progressWrap.style.display = 'none';
    resultsDiv.style.display = 'grid';
    
    const sortedTeams = Object.keys(stats).map(t => ({
      name: t,
      ...stats[t],
      champProb: (stats[t].champion / totalRuns) * 100,
      finalProb: (stats[t].final / totalRuns) * 100,
      sfProb: (stats[t].sf / totalRuns) * 100
    })).sort((a, b) => b.champion - a.champion);
    
    statsDiv.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:12px; color:var(--text-1);">
        <thead>
          <tr style="border-bottom:1px solid var(--border); text-align:left; color:var(--text-2); font-size:10px; text-transform:uppercase;">
            <th style="padding:6px 0;">Team</th>
            <th style="padding:6px 0; text-align:center;">Semi Final</th>
            <th style="padding:6px 0; text-align:center;">Final</th>
            <th style="padding:6px 0; text-align:right; color:var(--gold);">Winner</th>
          </tr>
        </thead>
        <tbody>
          ${sortedTeams.slice(0, 8).map(t => {
            const flag = getFlagUrl(t.name);
            return `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                <td style="padding:8px 0; font-weight:700; display:flex; align-items:center; gap:6px;">
                  ${flag ? `<img src="${flag}" style="width:16px; height:11px; object-fit:cover; border-radius:1px;">` : ''}
                  ${t.name}
                </td>
                <td style="padding:8px 0; text-align:center;">${t.sfProb.toFixed(1)}%</td>
                <td style="padding:8px 0; text-align:center;">${t.finalProb.toFixed(1)}%</td>
                <td style="padding:8px 0; text-align:right; font-weight:800; color:var(--gold);">${t.champProb.toFixed(1)}%</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    
    const canvas = document.getElementById('chart-monte-carlo');
    const chartCtx = canvas.getContext('2d');
    const chartData = sortedTeams.slice(0, 8);
    
    if (chartMonteCarlo) chartMonteCarlo.destroy();
    
    chartMonteCarlo = new Chart(chartCtx, {
      type: 'bar',
      data: {
        labels: chartData.map(t => t.name),
        datasets: [{
          label: 'Championship Win Probability (%)',
          data: chartData.map(t => t.champProb),
          backgroundColor: 'rgba(245, 158, 11, 0.4)',
          borderColor: 'var(--gold)',
          borderWidth: 2,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: 'var(--text-2)', font: { family: 'Outfit', size: 9 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: 'var(--text-2)', font: { family: 'Outfit', size: 9 } }
          }
        }
      }
    });
  }
  
  runChunk();
}

function generateBracket() {
  const get1 = g => manualGroupRankings[g][0];
  const get2 = g => manualGroupRankings[g][1];
  
  const thirds = [...selectedThirds];
  
  bracketState = {
    r32: [
      { id: 'r32_1', home: get1('E'), away: thirds[0], winner: null }, // Match 1
      { id: 'r32_2', home: get1('I'), away: thirds[1], winner: null }, // Match 2
      { id: 'r32_3', home: get2('A'), away: get2('B'), winner: null }, // Match 3
      { id: 'r32_4', home: get1('F'), away: get2('C'), winner: null }, // Match 4
      { id: 'r32_5', home: get2('K'), away: get2('L'), winner: null }, // Match 5
      { id: 'r32_6', home: get1('H'), away: get2('J'), winner: null }, // Match 6
      { id: 'r32_7', home: get1('D'), away: thirds[2], winner: null }, // Match 7
      { id: 'r32_8', home: get1('G'), away: thirds[3], winner: null }, // Match 8
      { id: 'r32_9', home: get1('C'), away: get2('F'), winner: null }, // Match 9
      { id: 'r32_10', home: get2('E'), away: get2('I'), winner: null }, // Match 10
      { id: 'r32_11', home: get1('A'), away: thirds[4], winner: null }, // Match 11
      { id: 'r32_12', home: get1('L'), away: thirds[5], winner: null }, // Match 12
      { id: 'r32_13', home: get1('J'), away: get2('H'), winner: null }, // Match 13
      { id: 'r32_14', home: get2('D'), away: get2('G'), winner: null }, // Match 14
      { id: 'r32_15', home: get1('B'), away: thirds[6], winner: null }, // Match 15
      { id: 'r32_16', home: get1('K'), away: thirds[7], winner: null }  // Match 16
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
    let nextMatchIdx, nextSide;
    if (round === 'r32') {
      nextMatchIdx = Math.floor(matchIdx / 2);
      nextSide = matchIdx % 2 === 0 ? 'home' : 'away';
    } else if (round === 'r16') {
      if (matchIdx === 0 || matchIdx === 1) {
        nextMatchIdx = 0; // QF_1
        nextSide = matchIdx === 1 ? 'home' : 'away';
      } else if (matchIdx === 2 || matchIdx === 3) {
        nextMatchIdx = 2; // QF_3
        nextSide = matchIdx === 2 ? 'home' : 'away';
      } else if (matchIdx === 4 || matchIdx === 5) {
        nextMatchIdx = 1; // QF_2
        nextSide = matchIdx === 5 ? 'home' : 'away';
      } else if (matchIdx === 6 || matchIdx === 7) {
        nextMatchIdx = 3; // QF_4
        nextSide = matchIdx === 6 ? 'home' : 'away';
      }
    } else if (round === 'qf') {
      if (matchIdx === 0 || matchIdx === 1) {
        nextMatchIdx = 0; // SF_1
        nextSide = matchIdx === 0 ? 'home' : 'away';
      } else if (matchIdx === 2 || matchIdx === 3) {
        nextMatchIdx = 1; // SF_2
        nextSide = matchIdx === 2 ? 'home' : 'away';
      }
    } else if (round === 'sf') {
      nextMatchIdx = 0; // Final
      nextSide = matchIdx === 0 ? 'home' : 'away';
    }
    
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
        let ni, ns;
        if (cr === 'r16') {
          if (ci === 0 || ci === 1) { ni = 0; ns = ci === 1 ? 'home' : 'away'; }
          else if (ci === 2 || ci === 3) { ni = 2; ns = ci === 2 ? 'home' : 'away'; }
          else if (ci === 4 || ci === 5) { ni = 1; ns = ci === 5 ? 'home' : 'away'; }
          else if (ci === 6 || ci === 7) { ni = 3; ns = ci === 6 ? 'home' : 'away'; }
        } else if (cr === 'qf') {
          if (ci === 0 || ci === 1) { ni = 0; ns = ci === 0 ? 'home' : 'away'; }
          else if (ci === 2 || ci === 3) { ni = 1; ns = ci === 2 ? 'home' : 'away'; }
        } else if (cr === 'sf') {
          ni = 0; ns = ci === 0 ? 'home' : 'away';
        }
        
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

let chartMatchMomentum = null;
function renderMatchMomentum(match, stats) {
  const canvas = document.getElementById('chart-match-momentum');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const labels = Array.from({ length: 90 }, (_, i) => i + 1);
  const data = [];
  let currentVal = 0;
  
  const homeGoalMins = match.scorers.filter(s => s.team === 'home').map(s => s.min);
  const awayGoalMins = match.scorers.filter(s => s.team === 'away').map(s => s.min);
  
  for (let m = 1; m <= 90; m++) {
    if (homeGoalMins.includes(m)) {
      currentVal = 85;
    } else if (awayGoalMins.includes(m)) {
      currentVal = -85;
    } else {
      const bias = (stats.possession.home - stats.possession.away) * 0.4;
      currentVal = currentVal * 0.7 + (Math.random() - 0.5) * 25 + bias * 0.3;
      currentVal = Math.max(-50, Math.min(50, currentVal));
    }
    data.push(Math.round(currentVal));
  }
  
  if (chartMatchMomentum) chartMatchMomentum.destroy();
  
  chartMatchMomentum = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Match Momentum',
        data: data,
        borderColor: 'var(--accent-2)',
        borderWidth: 2,
        fill: true,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: chartCtx, chartArea } = chart;
          if (!chartArea) return null;
          
          const gradient = chartCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(34, 211, 238, 0.25)');
          gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
          gradient.addColorStop(1, 'rgba(167, 139, 250, 0.25)');
          return gradient;
        },
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: -100,
          max: 100,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            callback: (val) => val === 75 ? 'Home Attack' : val === -75 ? 'Away Attack' : '',
            color: 'var(--text-2)',
            font: { family: 'Outfit', size: 9, weight: 'bold' }
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            callback: (val) => val % 15 === 0 ? val + '\'' : '',
            color: 'var(--text-2)',
            font: { family: 'Outfit', size: 9 }
          }
        }
      }
    }
  });
}

function renderMatchTimeline(match) {
  const container = document.getElementById('match-timeline-list');
  if (!container) return;
  
  const events = [];
  match.scorers.forEach(s => {
    events.push({
      min: s.min,
      team: s.team,
      type: 'goal',
      title: 'Goal!',
      desc: `<strong>${s.name}</strong>${s.assist ? ` (assist: ${s.assist})` : ''}`
    });
  });
  
  const homeCards = Math.floor(Math.random() * 3);
  const awayCards = Math.floor(Math.random() * 3);
  
  for(let i=0; i<homeCards; i++) {
    events.push({
      min: Math.floor(Math.random() * 80 + 10),
      team: 'home',
      type: 'card',
      title: 'Yellow Card',
      desc: 'Booking for defensive foul'
    });
  }
  for(let i=0; i<awayCards; i++) {
    events.push({
      min: Math.floor(Math.random() * 80 + 10),
      team: 'away',
      type: 'card',
      title: 'Yellow Card',
      desc: 'Booking for late tackle'
    });
  }
  
  events.sort((a, b) => a.min - b.min);
  
  if (events.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:var(--text-2);">No match events recorded.</span>';
    return;
  }
  
  container.innerHTML = events.map(ev => {
    const isHome = ev.team === 'home';
    const alignStyle = isHome ? 'flex-direction:row;' : 'flex-direction:row-reverse;';
    const textStyle = isHome ? 'text-align:left;' : 'text-align:right;';
    const icon = ev.type === 'goal' ? '⚽' : '🟨';
    
    return `
      <div style="display:flex; width:100%; max-width:480px; align-items:center; gap:16px; font-size:12px; ${alignStyle}">
        <div style="width: 40px; font-weight:800; color:var(--accent-2); text-align:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px;">${ev.min}'</div>
        <div style="font-size:14px;">${icon}</div>
        <div style="flex:1; ${textStyle}">
          <div style="font-weight:700; color:#fff;">${ev.title}</div>
          <div style="color:var(--text-2); font-size:11px;">${ev.desc}</div>
        </div>
      </div>
    `;
  }).join('<div style="width:2px; height:12px; background:var(--border);"></div>');
}
