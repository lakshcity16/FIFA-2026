/* ─────────────────────────────────────────────────────────────
   FIFA 2026 AI HUB — app.js
   Complete client-side logic: charts, auction (1CP start),
   journey simulator, team profiles, AI inference
───────────────────────────────────────────────────────────── */

const API = '';
let _teams = [], _groups = {}, _fixtures = [], _analytics = {}, _performers = {};

// Chart instances (kept for destroy-on-redraw)
let chartGoalsGroup, chartRadar, chartBar, chartJourney, chartPrediction;

/* ══════════════════ INIT ══════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    fetchTeams(), fetchGroups(), fetchPerformers()
  ]);
  initNav();
  initOverview();
  initGroupsTab();
  initTeamsTab();
  initAI();
  initAuction();
  initJourney();
});

/* ── Fetch helpers ── */
const $get = url => fetch(API + url).then(r => r.json()).catch(() => ({}));
const $post = (url, body) => fetch(API + url, {
  method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
}).then(r => r.json()).catch(e => ({ error: e.message }));

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

/* ══════════════════ NAVIGATION ══════════════════ */
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ══════════════════ TAB 1: OVERVIEW ══════════════════ */
async function initOverview() {
  // Load played fixtures for KPIs
  const d = await $get('/api/fixtures?played=true');
  _fixtures = d.fixtures || [];

  // KPIs
  const totalGoals = _fixtures.reduce((s,f) => s + f.home_score + f.away_score, 0);
  const gpg = _fixtures.length ? (totalGoals / _fixtures.length).toFixed(2) : '-';

  document.getElementById('kpi-matches').textContent = _fixtures.length;
  document.getElementById('kpi-goals').textContent = totalGoals;
  document.getElementById('kpi-gpg').textContent = gpg;

  // Top scorer from performers
  if (_performers.goals?.length) {
    const ts = _performers.goals[0];
    document.getElementById('kpi-top-scorer').textContent = ts.player_name.split(' ').pop() + ' (' + ts.goals + '⚽)';
  }
  if (_performers.assists?.length) {
    const ta = _performers.assists[0];
    document.getElementById('kpi-top-asst').textContent = ta.player_name.split(' ').pop() + ' (' + ta.assists + '🎯)';
  }
  if (_performers.rating?.length) {
    const tr = _performers.rating[0];
    document.getElementById('kpi-top-rated').textContent = tr.player_name.split(' ').pop() + ' (' + tr.rating + '★)';
  }

  // Date-filtered fixtures
  const dateInput = document.getElementById('date-filter');
  const renderFixtures = async (date) => {
    const data = await $get('/api/fixtures?date=' + date);
    renderFixtureList(data.fixtures || [], document.getElementById('today-fixtures'));
  };
  dateInput.addEventListener('change', e => renderFixtures(e.target.value));
  await renderFixtures('2026-06-15');

  // Performers list
  renderPerformers('goals');
  document.querySelectorAll('.pill[data-perf]').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-perf]').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      renderPerformers(p.dataset.perf);
    });
  });

  // Goals by Group chart
  drawGoalsByGroupChart();
}

function renderFixtureList(fixtures, container) {
  if (!fixtures.length) {
    container.innerHTML = '<div style="color:var(--text-2);font-size:13px;padding:20px;text-align:center">No matches on this date</div>';
    return;
  }
  container.innerHTML = fixtures.map(f => {
    const hFlag = getFlagUrl(f.home);
    const aFlag = getFlagUrl(f.away);
    const scoreHtml = f.is_played
      ? `<div class="fix-score">${f.home_score} – ${f.away_score}</div>`
      : `<div class="fix-score upcoming">vs</div>`;
    const scorers = f.scorers?.length
      ? `<div style="font-size:10px;color:var(--text-2);margin-top:4px">${f.scorers.map(s=>`${s.player_name} ${s.goals}⚽`).join(', ')}</div>`
      : '';
    return `
      <div class="fixture-item">
        <div>
          <div class="fix-stage">${f.stage}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">${f.stadium || ''}</div>
        </div>
        <div class="fix-teams">
          <div class="fix-team">${f.home}</div>
          ${hFlag ? `<img class="fix-flag" src="${hFlag}" alt="" onerror="this.style.display='none'">` : ''}
          ${scoreHtml}
          ${aFlag ? `<img class="fix-flag" src="${aFlag}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="fix-team away">${f.away}</div>
        </div>
        <div class="fix-meta">${f.city || ''}</div>
      </div>
      ${scorers ? `<div style="padding:0 8px 6px;font-size:10px;color:var(--text-2)">${f.scorers?.map(s=>`${s.player_name} ×${s.goals}`).join(' · ')}</div>` : ''}
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
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border);font-size:12px">
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

  updateBudgetDisplays();
  nextPlayer();
}

function nextPlayer() {
  const totalNeeded = 15;
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
  const posCode = _curPlayer.position === 'Goalkeeper' ? 'GK' : _curPlayer.position === 'Defender' ? 'DEF' : _curPlayer.position === 'Midfielder' ? 'MID' : 'FWD';
  document.getElementById('cur-pos').textContent = posCode;
  document.getElementById('cur-pos').className = 'cur-pos pos-badge pos-' + posCode;
  document.getElementById('cur-tier').textContent = _curPlayer.tier || '';
  document.getElementById('cur-name').textContent = _curPlayer.name;
  document.getElementById('cur-team').textContent = _curPlayer.team;
  document.getElementById('cur-rating').textContent = _curPlayer.rating;
  document.getElementById('cur-goals').textContent = _curPlayer.goals;
  document.getElementById('cur-assists').textContent = _curPlayer.assists;
  document.getElementById('cur-age').textContent = _curPlayer.age;
  updateBidDisplay();
  clearBidLog();
  logBid(`Player drawn: ${_curPlayer.name} (${_curPlayer.team}) · Start: 1 CP`, 'neutral');

  // Enable buttons
  document.getElementById('btn-raise').disabled = false;
  document.getElementById('btn-pass').disabled = false;

  // AI auto-bids after short delay if it wants this player
  setTimeout(aiDecide, 800);
}

function aiDecide() {
  if (_aiSquad.length >= 15) return;
  const aiNeedPos = getNeededPositions(_aiSquad);
  const wantsPlayer = aiNeedPos.includes(_curPlayer.position) && _aiBudget > _curBid;
  const rating = _curPlayer.rating || 7;

  if (wantsPlayer) {
    // AI bids only if it can afford and player is good enough
    const maxAIBid = Math.min(_aiBudget - (15 - _aiSquad.length - 1), Math.round((rating - 5) * 4 + 2));
    if (_curHolder !== 'ai' && _curBid <= maxAIBid) {
      _curBid += 1;
      _curHolder = 'ai';
      _aiBudget -= 0; // Deducted only on win
      updateBidDisplay();
      logBid(`AI bids ${_curBid} CP`, 'ai');
    }
  }
}

function userRaise() {
  if (_userBudget <= _curBid) {
    logBid('Not enough budget!', 'neutral'); return;
  }
  if (_userSquad.length >= 15) {
    logBid('Your squad is full!', 'neutral'); return;
  }
  _curBid += 1;
  _curHolder = 'user';
  updateBidDisplay();
  logBid(`You bid ${_curBid} CP`, 'user');

  // AI counter after delay
  setTimeout(() => {
    if (_aiSquad.length >= 15) return;
    const aiNeedPos = getNeededPositions(_aiSquad);
    const wantsPlayer = aiNeedPos.includes(_curPlayer.position);
    const maxAIBid = Math.min(_aiBudget - (15 - _aiSquad.length - 1), Math.round((_curPlayer.rating - 5) * 4 + 3));
    if (wantsPlayer && _curBid < maxAIBid && _aiBudget > _curBid) {
      _curBid += 1;
      _curHolder = 'ai';
      updateBidDisplay();
      logBid(`AI raises to ${_curBid} CP`, 'ai');
    }
  }, 700);
}

function userPass() {
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
  logBid('Player skipped — drawing next...', 'neutral');
  nextPlayer();
}

function awardPlayer(winner) {
  const price = _curBid;
  const p = { ..._curPlayer, paid_cp: price };

  if (winner === 'user') {
    _userBudget -= price;
    _userSquad.push(p);
    logBid(`✅ You win ${_curPlayer.name} for ${price} CP!`, 'user');
    addToRoster('user-roster', p);
  } else {
    _aiBudget -= price;
    _aiSquad.push(p);
    logBid(`🤖 AI wins ${_curPlayer.name} for ${price} CP`, 'ai');
    addToRoster('ai-roster', p);
  }

  updateBudgetDisplays();

  const userDone = _userSquad.length >= 15;
  const aiDone   = _aiSquad.length >= 15;
  if (userDone && aiDone) { endAuction(); return; }

  setTimeout(nextPlayer, 1200);
}

function addToRoster(id, p) {
  const posCode = p.position === 'Goalkeeper' ? 'GK' : p.position === 'Defender' ? 'DEF' : p.position === 'Midfielder' ? 'MID' : 'FWD';
  const div = document.createElement('div');
  div.className = 'roster-item';
  div.innerHTML = `
    <span class="ri-pos pos-badge pos-${posCode}">${posCode}</span>
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
  const groupMatchesHtml = data.group_matches.map(m => `
    <div class="jrn-match">
      <span style="color:var(--text-2);font-size:11px;min-width:80px">${m.date}</span>
      <span style="flex:1">vs <strong>${m.opponent}</strong></span>
      ${m.is_played
        ? `<span class="jrn-result-badge ${m.result}">${m.result}</span>
           <span style="font-weight:700">${m.team_score}–${m.opp_score}</span>`
        : `<span class="jrn-result-badge TBD">TBD</span>`
      }
    </div>`).join('');

  // Knockout path
  const rounds = [
    { key: 'r32', label: 'Round of 32' },
    { key: 'r16', label: 'Round of 16' },
    { key: 'qf',  label: 'Quarter Final' },
    { key: 'sf',  label: 'Semi Final' },
    { key: 'fin', label: 'Final' },
  ];
  const koHtml = rounds.map(r => {
    const rd = ko[r.key];
    if (!rd) return `<div class="ko-round tbd"><span class="ko-label">${r.label}</span><span class="ko-result" style="color:var(--text-2)">Did not qualify</span></div>`;
    const cls = rd.win ? 'win' : 'lose';
    return `
      <div class="ko-round ${cls}">
        <span class="ko-label">${r.label}</span>
        <span class="ko-result" style="color:${rd.win?'var(--green)':'var(--red)'}">
          ${rd.win ? '✓ Win' : '✗ Eliminated'} vs ${rd.opponent} (${rd.score})
        </span>
        <span class="ko-prob">${rd.prob}% win prob</span>
      </div>`;
  }).join('');

  const champBanner = ko.champion === teamName
    ? `<div class="champion-banner"><div class="crown">🏆</div><h3>${teamName} WIN THE WORLD CUP!</h3></div>`
    : `<div class="champion-banner" style="border-color:var(--text-2);background:rgba(255,255,255,.04)">
         <div class="crown" style="font-size:28px">📅</div>
         <h3 style="color:var(--text-2);font-size:16px">Predicted Champion: ${ko.champion || '?'}</h3>
       </div>`;

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      ${flag ? `<img style="width:48px;height:32px;border-radius:4px;object-fit:cover" src="${flag}" alt="">` : ''}
      <h3 style="font-size:18px;font-weight:800">${teamName} — Tournament Journey</h3>
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Group ${data.group} Matches</div>
      <div class="jrn-group-matches">${groupMatchesHtml || '<p style="color:var(--text-2)">No group matches found</p>'}</div>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Simulated Knockout Path</div>
    <div class="ko-bracket">${koHtml}</div>
    ${champBanner}`;

  // Journey chart
  const stages = ['R32','R16','QF','SF','Final','🏆'];
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
        labels: stages,
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
}

/* ══════════════════ UTILITIES ══════════════════ */
function getFlagUrl(teamName) {
  const iso2Map = {
    'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be',
    'Brazil':'br','Cameroon':'cm','Canada':'ca','Chile':'cl','Colombia':'co',
    'Costa Rica':'cr','Croatia':'hr','Denmark':'dk','Ecuador':'ec','Egypt':'eg',
    'England':'gb-eng','France':'fr','Germany':'de','Ghana':'gh','Iran':'ir',
    'Iraq':'iq','Italy':'it','Jamaica':'jm','Japan':'jp','Mexico':'mx',
    'Morocco':'ma','Netherlands':'nl','Nigeria':'ng','Panama':'pa','Peru':'pe',
    'Poland':'pl','Portugal':'pt','Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct',
    'Senegal':'sn','Serbia':'rs','South Africa':'za','South Korea':'kr','Spain':'es',
    'Sweden':'se','Switzerland':'ch','Tunisia':'tn','Turkey':'tr','Ukraine':'ua',
    'United States':'us','Uruguay':'uy','Uzbekistan':'uz'
  };
  const iso = iso2Map[teamName];
  return iso ? `https://flagcdn.com/w40/${iso}.png` : null;
}
