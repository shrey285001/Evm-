// Dynamically construct API URL based on current location
// Works with localhost, cloud domains, and any deployment URL
const API_URL = (() => {
  const protocol = window.location.protocol; // http: or https:
  const host = window.location.host; // includes hostname and port
  return `${protocol}//${host}/api`;
})();

// Dynamic quotes for voting theme
const VOTING_QUOTES = [
  "Every vote counts. Make your voice heard.",
  "Democracy begins with you. Vote with confidence.",
  "Your vote is your power. Exercise it wisely.",
  "One person, one vote. Together, we decide our future.",
  "Voting is your right. Use it to shape our school.",
  "In unity, we find strength. Vote for positive change.",
  "Your choice matters. Cast your vote today.",
  "Democracy is not a spectator sport. Vote now.",
  "Every voice deserves to be heard. Vote for change.",
  "Together, we make decisions that impact us all."
];

let currentQuoteIndex = 0;

function rotateQuote(){
  const quoteEl = document.getElementById('quoteText');
  if(quoteEl){
    quoteEl.style.opacity = '0';
    quoteEl.style.transition = 'opacity 0.4s ease-out';
    setTimeout(() => {
      currentQuoteIndex = (currentQuoteIndex + 1) % VOTING_QUOTES.length;
      quoteEl.textContent = VOTING_QUOTES[currentQuoteIndex];
      quoteEl.style.opacity = '1';
    }, 200);
  }
}

// Rotate quotes every 8 seconds
setInterval(rotateQuote, 8000);

async function loadConfig(){
  try {
    const response = await fetch(`${API_URL}/config`);
    CONFIG = await response.json();
    // migrate older configs that lack round/active fields
    if (CONFIG && CONFIG.positions) {
      CONFIG.positions.forEach(p => { if(!p.round) p.round = 1; if(p.active === undefined) p.active = true; });
    }
  } catch(e) {
    console.error('Failed to load config', e);
    alert('Could not load election data from server.');
  }
  applyBranding();
  return CONFIG;
}

async function saveConfig(){
  try {
    const response = await fetch(`${API_URL}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CONFIG)
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Save failed (${response.status}): ${errorBody}`);
    }
    return true;
  } catch(e) {
    console.error('Failed to save config', e);
    alert('Could not save election data to server.');
    return false;
  }
}
function applyBranding(){
  document.getElementById('topbarSchoolName').textContent = CONFIG.schoolName + " Election Commission";
  document.title = CONFIG.schoolName + " — EVM Voting";
}
function getPosition(id){ return CONFIG.positions.find(p => p.id === id); }

/* ===================== SOUND ===================== */
function beep(freq, dur, type){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type || 'square'; osc.frequency.value = freq || 880;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur||0.25));
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + (dur||0.25));
  }catch(e){}
}
function voteBeep(){ beep(1046, 0.35, 'square'); }
function clickBeep(){ beep(660, 0.08, 'sine'); }
function errorBeep(){ beep(220, 0.4, 'sawtooth'); }

/* ===================== ROUTER ===================== */
function go(hash){ window.location.hash = hash; }
window.addEventListener('hashchange', route);

function route(){
  const hash = window.location.hash || '#/';
  document.getElementById('homeStage').classList.add('hidden');
  document.getElementById('voteStage').classList.add('hidden');
  document.getElementById('adminLogin').classList.add('hidden');
  document.getElementById('adminStage').classList.add('hidden');
  document.getElementById('navHome').classList.remove('active');
  document.getElementById('navAdmin').classList.remove('active');

  if(hash.startsWith('#/vote/')){
    const posId = decodeURIComponent(hash.split('/')[2]);
    document.getElementById('voteStage').classList.remove('hidden');
    startVotePage(posId);
  } else if(hash === '#/admin'){
    document.getElementById('navAdmin').classList.add('active');
    if(adminUnlocked){ document.getElementById('adminStage').classList.remove('hidden'); renderAdmin(); }
    else { document.getElementById('adminLogin').classList.remove('hidden'); }
  } else {
    document.getElementById('navHome').classList.add('active');
    document.getElementById('homeStage').classList.remove('hidden');
    renderHome();
  }
}

document.getElementById('navHome').onclick = () => go('#/');
document.getElementById('navAdmin').onclick = () => go('#/admin');
document.getElementById('brandHome').onclick = () => go('#/');
document.getElementById('backToHome').onclick = () => go('#/');

/* ===================== HOME HUB ===================== */
function renderHome(){
  const grid = document.getElementById('posGrid');
  grid.innerHTML = '';
  CONFIG.positions.forEach(pos => {
    const card = document.createElement('div');
    card.className = 'pos-card ' + (pos.active ? 'open' : 'closed');
    card.innerHTML = `
      <span class="status">${pos.active ? 'Open · Round ' + pos.round : 'Closed'}</span>
      <h3>${pos.title}</h3>
      <div class="meta">${pos.candidates.length} candidates</div>
      <button class="btn ${pos.active ? '' : 'ghost'}">${pos.active ? 'Enter Voting Booth →' : 'Voting Closed'}</button>
    `;
    card.querySelector('button').onclick = () => { if(pos.active) go('#/vote/' + pos.id); };
    grid.appendChild(card);
  });
}

/* ===================== VOTE STAGE (single position) ===================== */
const voterScreen = document.getElementById('voterScreen');
let voteCtx = { posId: null, selectedCandidate: null };

function startVotePage(posId){
  const pos = getPosition(posId);
  if(!pos){ voterScreen.innerHTML = `<div class="reject-box"><div class="display">POSITION NOT FOUND</div></div>`; return; }
  voteCtx = { posId: posId, selectedCandidate: null };
  document.getElementById('kioskTag').textContent = pos.title.toUpperCase() + ' · ROUND ' + pos.round;
  if(!pos.active){
    voterScreen.innerHTML = `
      <div class="reject-box">
        <div class="display">VOTING CLOSED</div>
        <p class="subtext">Voting for <b>${pos.title}</b> is not currently open.</p>
      </div>`;
    return;
  }
  screenReady();
}

function screenReady(){
  const pos = getPosition(voteCtx.posId);
  // ensure any previous ballot key handlers are removed
  detachBallotKeyHandlers();

  voterScreen.innerHTML = `
    <div class="id-entry">
      <div class="display">READY TO VOTE</div>
      <p class="subtext">${pos ? pos.title : ''} · Round ${pos ? pos.round : ''}</p>
      <p class="subtext">Presiding staff: confirm the voter, then press below to unlock the candidate list for this one voter.</p>
      <button class="btn" id="startBtn">Unlock Ballot →</button>
    </div>`;
  document.getElementById('startBtn').onclick = () => { clickBeep(); renderBallot(); };
}

function renderBallot(){
  const pos = getPosition(voteCtx.posId);
  voteCtx.selectedCandidate = null;
  let rows = pos.candidates.map((c, idx) => `
    <div class="candidate-row" data-cid="${c.id}" data-idx="${idx}">
      <div class="num-badge">${idx+1}</div>
      <div class="candidate-avatar">${c.avatar ? `<img src="${c.avatar}" alt="${c.name}">` : (c.symbol || '🗳️')}</div>
      <div class="candidate-info"><div class="cname">${c.name}</div>${c.house ? `<div class="chouse">${c.house}</div>` : ''}</div>
      <div class="evm-button"><div class="led"></div></div>
    </div>`).join('');
  voterScreen.innerHTML = `
    <div class="ballot">
      <span class="position-tag">${pos.title.toUpperCase()} · ROUND ${pos.round}</span>
      <h3 class="ballot-title">Cast Your Vote</h3>
      <div class="cand-container">${rows}</div>
      <div class="ballot-actions"><button class="btn" id="castBtn" disabled>Cast Vote</button></div>
      <div class="hint mono" style="margin-top:8px;font-size:13px;color:var(--ink-soft)">Press numbers <b>1-${pos.candidates.length}</b> to select, <b>Enter</b> to confirm, <b>Esc</b> to cancel.</div>
    </div>`;
  document.querySelectorAll('.candidate-row').forEach(row => {
    row.onclick = () => {
      clickBeep();
      document.querySelectorAll('.candidate-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      voteCtx.selectedCandidate = row.getAttribute('data-cid');
      document.getElementById('castBtn').disabled = false;
    };
  });
  document.getElementById('castBtn').onclick = showConfirm;

  // attach keyboard handlers for quick selection
  attachBallotKeyHandlers();
}

// Keyboard handlers for ballot selection
function attachBallotKeyHandlers(){
  detachBallotKeyHandlers();
  window._ballotKeyHandler = function(e){
    try{
      const pos = getPosition(voteCtx.posId);
      if(!pos) return;
      const max = pos.candidates.length;
      if(e.key >= '1' && e.key <= String(max)){
        const idx = Number(e.key) - 1;
        const row = document.querySelector(`.candidate-row[data-idx="${idx}"]`);
        if(row) row.click();
      } else if(e.key === 'Enter'){
        const castBtn = document.getElementById('castBtn');
        if(castBtn && !castBtn.disabled){ castBtn.click(); }
        else if(voteCtx.selectedCandidate){ showConfirm(); }
      } else if(e.key === 'Escape'){
        // cancel back to ready screen
        screenReady();
      }
    }catch(err){ console.error('Ballot key handler error', err); }
  };
  window.addEventListener('keydown', window._ballotKeyHandler);
}

function detachBallotKeyHandlers(){
  if(window._ballotKeyHandler){ window.removeEventListener('keydown', window._ballotKeyHandler); window._ballotKeyHandler = null; }
}

function showConfirm(){
  const pos = getPosition(voteCtx.posId);
  const cand = pos.candidates.find(c => c.id === voteCtx.selectedCandidate);
  voterScreen.innerHTML = `
    <div class="confirm-box">
      <div class="display">CONFIRM YOUR VOTE</div>
      <p class="subtext">${pos.title}</p>
      <div class="csymbol">${cand.avatar ? `<img src="${cand.avatar}" alt="${cand.name}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:4px solid var(--gold);">` : (cand.symbol || '🗳️')}</div>
      <div class="cname" style="font-size:19px;font-weight:700;">${cand.name}</div>
      <div class="confirm-actions">
        <button class="btn ghost" id="cancelBtn">Change</button>
        <button class="btn" id="confirmBtn">Confirm Vote</button>
      </div>
    </div>`;
  document.getElementById('cancelBtn').onclick = renderBallot;
  document.getElementById('confirmBtn').onclick = castVote;
}

async function castVote(){
  voterScreen.innerHTML = `<div class="id-entry"><div class="display">RECORDING…</div></div>`;
  const pos = getPosition(voteCtx.posId);
  try {
    await fetch(`${API_URL}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positionId: pos.id,
        round: pos.round,
        candidateId: voteCtx.selectedCandidate,
      })
    });
    voteBeep();
    voterScreen.innerHTML = `
      <div class="recorded-box">
        <div class="big-led">✓</div>
        <div class="display">VOTE RECORDED</div>
        <p class="subtext">Your vote for ${pos.title} has been securely recorded.</p>
      </div>`;
    setTimeout(startLock, 1100);
  } catch (e) {
    console.error('Failed to cast vote', e);
    voterScreen.innerHTML = `<div class="reject-box"><div class="display">VOTE FAILED</div></div>`;
    setTimeout(screenReady, 2000);
  }
}

function startLock(){
  let secs = 15;
  voterScreen.innerHTML = `
    <div class="lock-box">
      <div class="ring" id="ringEl" style="--pct:100"><div class="num" id="ringNum">15</div></div>
      <div class="display">BALLOT LOCKED</div>
      <p class="subtext">Machine unlocking for the next voter in a moment…</p>
    </div>`;
  const ringEl = document.getElementById('ringEl'); const ringNum = document.getElementById('ringNum');
  const timer = setInterval(() => {
    secs -= 1; ringNum.textContent = secs; ringEl.style.setProperty('--pct', Math.round((secs/15)*100));
    if(secs <= 0){ clearInterval(timer); screenReady(); }
  }, 1000);
}

/* ===================== ADMIN ===================== */
let adminUnlocked = false;

document.getElementById('adminLoginBtn').onclick = () => {
  const val = document.getElementById('adminPassInput').value;
  if(val === CONFIG.adminPassword){ adminUnlocked = true; route(); }
  else { document.getElementById('adminLoginMsg').textContent = 'Incorrect password.'; document.getElementById('adminLoginMsg').style.color = 'var(--danger)'; }
};

document.querySelectorAll('.admin-tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['results','setup','danger'].forEach(t => document.getElementById('tab-'+t).classList.toggle('hidden', t !== btn.dataset.tab));
    if(btn.dataset.tab === 'results') refreshResults();
    if(btn.dataset.tab === 'setup') renderSetupTab();
  };
});

function renderAdmin(){ renderSetupTab(); refreshResults(); }

/* ---------- SETUP TAB ---------- */
function renderSetupTab(){
  document.getElementById('cfgSchoolName').value = CONFIG.schoolName;
  document.getElementById('cfgAdminPass').value = CONFIG.adminPassword;

  const editor = document.getElementById('positionsEditor');
  editor.innerHTML = '';
  CONFIG.positions.forEach((pos, pIdx) => {
    const card = document.createElement('div');
    card.className = 'position-card';
    card.innerHTML = `
      <div class="position-card-head">
        <input type="text" value="${pos.title}" data-role="postitle" data-pidx="${pIdx}" style="font-family:'Teko';font-size:19px;font-weight:600;border:none;background:transparent;padding:2px;width:auto;flex:1;">
        <div class="pc-controls">
          <span class="round-badge">ROUND ${pos.round}</span>
          <span class="status-pill ${pos.active ? 'open':'closed'}">${pos.active ? 'Open' : 'Closed'}</span>
          <a href="#/vote/${pos.id}" class="btn small ghost" target="_blank" rel="noopener">Open Page ↗</a>
          ${pos.active
            ? `<button class="btn small danger" data-role="closepos" data-pidx="${pIdx}">Close Voting</button>`
            : `<button class="btn small gold" data-role="reopenpos" data-pidx="${pIdx}">Reopen — New Round</button>`}
          <button class="tiny-x" data-role="delpos" data-pidx="${pIdx}" title="Remove position">✕</button>
        </div>
      </div>
      <div class="cand-list" data-role="candlist" data-pidx="${pIdx}"></div>
      <button class="btn small ghost" data-role="addcand" data-pidx="${pIdx}">+ Add Candidate</button>
    `;
    editor.appendChild(card);
    const clist = card.querySelector('[data-role=candlist]');
    pos.candidates.forEach((c, cIdx) => {
      const row = document.createElement('div');
      row.className = 'cand-item';
      row.innerHTML = `
        <input type="text" class="sym-input" value="${c.symbol||''}" placeholder="🗳️" data-role="csym" data-pidx="${pIdx}" data-cidx="${cIdx}">
        <input type="text" value="${c.name}" placeholder="Candidate name" data-role="cname" data-pidx="${pIdx}" data-cidx="${cIdx}">
        <input type="text" value="${c.house||''}" placeholder="House / note (optional)" data-role="chouse" data-pidx="${pIdx}" data-cidx="${cIdx}">
        <button class="tiny-x" data-role="delcand" data-pidx="${pIdx}" data-cidx="${cIdx}">✕</button>
      `;
      clist.appendChild(row);
    });
  });

  editor.querySelectorAll('[data-role=postitle]').forEach(i => i.onchange = e => { CONFIG.positions[+e.target.dataset.pidx].title = e.target.value; saveConfig(); });
  editor.querySelectorAll('[data-role=cname]').forEach(i => i.onchange = e => { CONFIG.positions[+e.target.dataset.pidx].candidates[+e.target.dataset.cidx].name = e.target.value; saveConfig(); });
  editor.querySelectorAll('[data-role=csym]').forEach(i => i.onchange = e => { CONFIG.positions[+e.target.dataset.pidx].candidates[+e.target.dataset.cidx].symbol = e.target.value; saveConfig(); });
  editor.querySelectorAll('[data-role=chouse]').forEach(i => i.onchange = e => { CONFIG.positions[+e.target.dataset.pidx].candidates[+e.target.dataset.cidx].house = e.target.value; saveConfig(); });
  editor.querySelectorAll('[data-role=delpos]').forEach(b => b.onclick = e => {
    if(CONFIG.positions.length <= 1){ alert('At least one position is required.'); return; }
    if(!confirm('Remove this position and all its candidates? Its recorded votes stay in storage but will no longer be shown.')) return;
    CONFIG.positions.splice(+e.target.dataset.pidx, 1); saveConfig(); renderSetupTab();
  });
  editor.querySelectorAll('[data-role=delcand]').forEach(b => b.onclick = e => {
    const pIdx = +e.target.dataset.pidx, cIdx = +e.target.dataset.cidx;
    if(CONFIG.positions[pIdx].candidates.length <= 2){ alert('At least two candidates are required per position.'); return; }
    CONFIG.positions[pIdx].candidates.splice(cIdx, 1); saveConfig(); renderSetupTab();
  });
  editor.querySelectorAll('[data-role=addcand]').forEach(b => b.onclick = e => {
    CONFIG.positions[+e.target.dataset.pidx].candidates.push({ id: 'new-cand-' + Date.now(), name: '', symbol: '🗳️', house: '' });
    saveConfig(); renderSetupTab();
  });
  editor.querySelectorAll('[data-role=closepos]').forEach(b => b.onclick = e => {
    CONFIG.positions[+e.target.dataset.pidx].active = false; saveConfig(); renderSetupTab();
  });
  editor.querySelectorAll('[data-role=reopenpos]').forEach(b => b.onclick = e => {
    const pIdx = +e.target.dataset.pidx;
    if(!confirm('Start a brand-new round for "' + CONFIG.positions[pIdx].title + '"? Every voter will be able to vote again — previous round results stay saved separately.')) return;
    CONFIG.positions[pIdx].round += 1;
    CONFIG.positions[pIdx].active = true;
    saveConfig(); renderSetupTab();
  });
}

document.getElementById('addPositionBtn').onclick = async () => {
  if(CONFIG.positions.length >= 12){ alert('Maximum of 12 simultaneous positions supported.'); return; }
  CONFIG.positions.push({ id: 'new-pos-' + Date.now(), title: 'New Position', round: 1, active: true, candidates: [
    { id: 'new-cand-' + Date.now() + '-1', name: '', symbol: '🗳️', house: '' }, { id: 'new-cand-' + Date.now() + '-2', name: '', symbol: '🗳️', house: '' }
  ]});
  await saveConfig(); renderSetupTab();
};

document.getElementById('savePositionsBtn').onclick = async () => {
  const saved = await saveConfig();
  if (saved) {
    alert('Positions saved to the database.');
  }
};

document.getElementById('saveBrandingBtn').onclick = async () => {
  CONFIG.schoolName = document.getElementById('cfgSchoolName').value.trim() || CONFIG.schoolName;
  CONFIG.adminPassword = document.getElementById('cfgAdminPass').value.trim() || CONFIG.adminPassword;
  const saved = await saveConfig();
  if (saved) {
    applyBranding();
    alert('Saved.');
  }
};

/* ---------- RESULTS TAB ---------- */
async function refreshResults(){
  document.getElementById('resultsContainer').innerHTML = '<p class="subtext">Loading…</p>';
  
  try {
    const response = await fetch(`${API_URL}/results`);
    const results = await response.json();

    document.getElementById('statStrip').innerHTML = `
      <div class="stat-box"><div class="num">${results.totalVoters}</div><div class="lbl">Ballots Recorded</div></div>
      <div class="stat-box"><div class="num">${results.positionsConfigured}</div><div class="lbl">Positions Configured</div></div>
      <div class="stat-box"><div class="num">${results.totalVotesCast}</div><div class="lbl">Total Votes Counted</div></div>
    `;

    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';
    results.perPosition.forEach(({ pos, counts, tv }) => {
      const rowsData = pos.candidates.map(c => ({ ...c, count: counts[c.id] || 0 }));
      const max = Math.max(1, ...rowsData.map(c=>c.count));
      const sorted = [...rowsData].sort((a,b)=>b.count-a.count);
      let rows = sorted.map((c,idx) => `
        <tr class="${idx===0 && c.count>0 ? 'leader':''}">
          <td>${c.symbol||''} ${c.name || '<i>(unnamed)</i>'}</td>
          <td style="width:44%;"><div class="bar-track"><div class="bar-fill" style="width:${(c.count/max*100)||0}%"></div></div></td>
          <td class="mono" style="text-align:right;">${c.count}</td>
        </tr>`).join('');
      const block = document.createElement('div');
      block.style.marginBottom = '22px';
      block.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
          <h3 style="font-family:'Teko';font-size:22px;margin:0;">${pos.title} <span class="round-badge">ROUND ${pos.round}</span> <span class="status-pill ${pos.active?'open':'closed'}">${pos.active?'Open':'Closed'}</span></h3>
          <span class="footer-note">${tv} votes cast</span>
        </div>
        <table class="results"><tbody>${rows}</tbody></table>`;
      container.appendChild(block);
    });

    document.getElementById('lastRefreshed').textContent = 'Last updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Failed to refresh results', e);
    document.getElementById('resultsContainer').innerHTML = '<p class="subtext" style="color:var(--danger);">Could not load results.</p>';
  }
}
document.getElementById('refreshResultsBtn').onclick = refreshResults;

/* ---------- EXPORT ---------- */
document.getElementById('exportBtn').onclick = async () => {
  try {
    const response = await fetch(`${API_URL}/results`);
    const results = await response.json();
    let csv = 'Position,Round,Candidate,House/Note,Votes\n';
    results.perPosition.forEach(({ pos, counts }) => {
      pos.candidates.forEach(c => { csv += `"${pos.title}",${pos.round},"${c.name}","${c.house||''}",${counts[c.id]||0}\n`; });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'election-results.csv'; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Failed to export results', e);
    alert('Could not export results.');
  }
};

/* ===================== INIT ===================== */
(async function init(){
  await loadConfig();
  route();
})();
