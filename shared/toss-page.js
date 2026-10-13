(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const query = new URLSearchParams(window.location.search);
  let selectedId = query.get('match') || null;
  let mapPool = [];
  let flipping = false;
  let poolError = '';
  // Built-in fallback so map voting never dead-ends if data/maps.json is missing from the deployed site. Edit to your real pool.
  const DEFAULT_MAPS = ['The MacMillan Estate','Autohaven Wreckers','Coldwind Farm','Crotus Prenn Asylum','Haddonfield','Backwater Swamp',"Léry's Memorial Institute",'Red Forest','Springwood','Yamaoka Estate','Ormond','Grave of Glenvale','Silent Hill','Raccoon City','Forsaken Boneyard','Withered Isle'];

  const sample = (items, count) => Entity.shuffle([...new Set(items.map((value) => String(value).trim()).filter(Boolean))]).slice(0, count);
  const otherTeam = (match, id) => id === match.teamAId ? match.teamBId : match.teamAId;
  const findMatch = (state, id) => state.matches.find((match) => match.id === id) || null;
  const playable = (state) => state.matches.filter((match) => match.teamAId && match.teamBId && match.status !== 'bye');
  const remainingMaps = (veto) => veto.pool.filter((name) => !veto.bans.some((ban) => ban.map === name));
  const teamNames = (state, match) => ({ a: Entity.teamName(state, match.teamAId), b: Entity.teamName(state, match.teamBId) });

  async function loadMapPool() {
    try {
      const response = await fetch('../data/maps.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load data/maps.json (${response.status}).`);
      const maps = await response.json();
      if (!Array.isArray(maps)) throw new Error('data/maps.json must contain a JSON array of map names.');
      mapPool = [...new Set(maps.map((value) => typeof value === 'string' ? value.trim() : String(value && (value.name || value.title) || '').trim()).filter(Boolean))];
      if (mapPool.length < 5) throw new Error(`data/maps.json must contain at least 5 unique map names; found ${mapPool.length}.`);
    } catch (error) {
      console.warn('Using the built-in map pool:', error.message);
      mapPool = DEFAULT_MAPS.slice();
    }
    poolError = '';
  }

  function teamOrder(match) {
    const first = match.toss && match.toss.winnerId;
    return first === match.teamAId || first === match.teamBId ? [first, otherTeam(match, first)] : [match.teamAId, match.teamBId];
  }

  function stageFor(match) {
    if (!match.toss) return 'toss';
    if (match.mapVeto && match.mapVeto.finalMap) return 'done';
    if (!match.roles) return 'side';   // toss winner must choose Killer / Survivor first
    return 'maps';
  }

  function setActiveMarker(stage) {
    const order = { toss: 0, side: 1, maps: 2, done: 3 };
    document.querySelectorAll('[data-step-marker]').forEach((element) => {
      const key = element.dataset.stepMarker;
      element.classList.toggle('active', key === stage);
      element.classList.toggle('finished', order[key] < order[stage]);
    });
  }

  function currentMatchAndState() {
    const state = Entity.load();
    const matches = playable(state);
    let match = findMatch(state, selectedId);
    if (!match || !match.teamAId || !match.teamBId || match.status === 'bye') {
      match = matches.find((item) => item.id === state.activeMatchId) || matches.find((item) => item.status === 'in_progress') || matches.find((item) => item.status === 'pending') || matches[0] || null;
      selectedId = match ? match.id : null;
    }
    return { state, matches, match };
  }

  function renderTossBanner(state, match) {
    const toss = match.toss || {};
    return `<div class="toss-result-line"><span>COIN · ${esc(toss.side || '—')}</span><strong>${esc(Entity.teamName(state, toss.winnerId))}</strong><small>${esc(Entity.teamName(state, toss.callerId))} called ${esc(toss.calledSide || '—')} · first map ban</small></div>${renderSideLine(state, match)}`;
  }

  function renderSideLine(state, match) {
    if (!match.roles) return '';
    const g1 = Entity.rolesFor(match, 1);
    return `<div class="toss-result-line"><span>GAME 1 SIDES</span><strong>${esc(Entity.teamName(state, match.roles.chooserId))} chose ${esc(String(match.roles.choice).toUpperCase())}</strong><small>${esc(Entity.teamName(state, g1.killerId))} Killer · ${esc(Entity.teamName(state, g1.survivorId))} Survivor · sides swap in Game 2</small></div>`;
  }

  function renderBanHistory(state, match) {
    const bans = match.mapVeto && match.mapVeto.bans || [];
    if (!bans.length) return '<div class="hint">No maps have been banned yet.</div>';
    return `<div class="locked-picks"><div class="eyebrow">Ban history</div>${bans.map((ban, index) => `<div class="ban-row"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(Entity.teamName(state, ban.teamId))}</strong><small>${esc(ban.map)}</small></div>`).join('')}</div>`;
  }

  function render() {
    const { state, matches, match } = currentMatchAndState();
    const select = $('match-select');
    select.innerHTML = matches.length
      ? matches.map((item) => `<option value="${esc(item.id)}">${esc(item.roundName)} · M${item.matchNumber} — ${esc(Entity.teamName(state, item.teamAId))} vs ${esc(Entity.teamName(state, item.teamBId))}</option>`).join('')
      : '<option value="">No playable matches yet</option>';
    if (selectedId) select.value = selectedId;
    select.disabled = flipping;

    if (!match) {
      $('match-summary').innerHTML = '<strong>No playable match.</strong><br>Open Bracket Control, enter the team names and generate the bracket first.';
      $('toss-status').textContent = 'Awaiting bracket'; $('toss-status').className = 'status pending';
      setActiveMarker('toss');
      $('wizard').innerHTML = '<section class="panel ceremony-empty"><div class="eyebrow">No match selected</div><h3>THE BRACKET IS EMPTY</h3><p>Create a bracket before starting map voting.</p><a class="button primary" href="./bracket.html">Open bracket control →</a></section>';
      return;
    }

    // Compatibility migration: a persisted map result from an older version remains valid.
    if (match.mapVeto && match.mapVeto.finalMap && !match.setupComplete) {
      Entity.update((draft) => {
        const current = findMatch(draft, match.id);
        if (current) current.setupComplete = true;
      });
      return;
    }

    const teams = teamNames(state, match);
    $('match-summary').innerHTML = `<strong>${esc(match.roundName)} · Match ${match.matchNumber}</strong><br><span class="muted">${esc(teams.a)} vs ${esc(teams.b)}</span><br><span class="muted">Status:</span> ${esc(match.status.replace('_', ' '))}`;
    const stage = stageFor(match);
    if (poolError && stage !== 'done') {
      $('toss-status').textContent = 'Map pool error'; $('toss-status').className = 'status pending';
      setActiveMarker(stage);
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">Local JSON configuration</div><h3>CAN'T START MAP VOTING</h3><p>${esc(poolError)}</p><p class="hint">Check <code>data/maps.json</code>. It must contain at least five unique map names.</p></section>`;
      return;
    }

    setActiveMarker(stage);
    if (match.status === 'completed') {
      $('toss-status').textContent = 'Match completed'; $('toss-status').className = 'status completed';
      $('wizard').innerHTML = `<section class="panel setup-complete-panel"><div class="eyebrow">Result locked</div><h3>THIS MATCH HAS BEEN COMPLETED</h3><div class="notice">${esc(Entity.teamName(state, match.winnerId))} won this match. Its result has already advanced through the bracket.</div>${match.mapVeto && match.mapVeto.finalMap ? `<div class="final-map-tile"><span>SELECTED MAP</span><strong>${esc(match.mapVeto.finalMap)}</strong></div>` : ''}<div class="actions"><a class="button primary" href="./bracket.html?match=${encodeURIComponent(match.id)}">Return to bracket →</a></div></section>`;
      return;
    }

    $('toss-status').textContent = stage === 'done' ? 'Map locked' : stage === 'toss' ? 'Awaiting toss' : stage === 'side' ? 'Choose side' : 'Map voting';
    $('toss-status').className = stage === 'done' ? 'status completed' : (stage === 'toss' || stage === 'side') ? 'status pending' : 'status in_progress';
    if (stage === 'toss') renderTossStage(state, match, teams);
    else if (stage === 'side') renderSideStage(state, match, teams);
    else if (stage === 'maps') renderMapStage(state, match, teams);
    else renderDoneStage(state, match, teams);
  }

  function renderTossStage(state, match, teams) {
    $('wizard').innerHTML = `
      <section class="ceremony-grid">
        <article class="panel ceremony-instructions"><div class="eyebrow">Stage 01 / Coin toss</div><h3>WHO CLAIMS FIRST BAN?</h3><p>The toss winner chooses the first map to ban. Both teams then alternate map bans until one map remains.</p>
          <div class="field"><label for="caller-select">Team calling the toss</label><select id="caller-select"><option value="a">${esc(teams.a)}</option><option value="b">${esc(teams.b)}</option></select></div>
          <div class="field"><label for="call-select">Call</label><select id="call-select"><option value="Heads">Heads</option><option value="Tails">Tails</option></select></div>
          <button class="button primary ceremony-main-action" data-action="flip" ${flipping ? 'disabled' : ''}>${flipping ? 'The Entity is deciding…' : 'Flip the coin'}</button>
          <p class="hint">The coin result and map-ban order are saved in this browser. Re-running a toss requires restarting match setup.</p>
        </article>
        <article class="panel coin-panel"><div class="eyebrow">Fate protocol // ${esc(match.roundName)} · M${match.matchNumber}</div><div class="coin-stage"><div class="coin ${flipping ? 'flipping' : ''}" id="ceremony-coin"><div class="coin-inner"><span>${flipping ? '…' : 'ENTITY'}<small>${flipping ? 'FATE IS TURNING' : 'FLIP TO BEGIN'}</small></span></div></div><div><div class="eyebrow">${esc(teams.a)} <span class="muted">vs</span> ${esc(teams.b)}</div><h3 class="panel-title" style="font-size:2rem;margin:8px 0">${flipping ? 'THE ENTITY IS DECIDING' : 'The next match awaits'}</h3><p class="hint">Call heads or tails, then reveal the toss and map pool.</p></div></div></article>
      </section>`;
  }

  function renderSideStage(state, match, teams) {
    const winnerId = match.toss && match.toss.winnerId;
    const winnerName = Entity.teamName(state, winnerId);
    const otherName = Entity.teamName(state, otherTeam(match, winnerId));
    $('wizard').innerHTML = `<section class="panel setup-complete-panel side-choice-panel">
      <div class="eyebrow">Stage 02 / Choose side</div>
      <h3>${esc(winnerName.toUpperCase())} — CHOOSE YOUR SIDE</h3>
      <p>${esc(winnerName)} won the toss and decides what to play in Game 1. ${esc(otherName)} takes the other side, and the sides swap in Game 2.</p>
      ${renderTossBanner(state, match)}
      <div class="draft-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <button class="draft-card" type="button" data-action="choose-side" data-role="killer"><span class="draft-index">GAME 1</span><strong>PLAY KILLER</strong><small>${esc(winnerName)} Killer · ${esc(otherName)} Survivor</small></button>
        <button class="draft-card" type="button" data-action="choose-side" data-role="survivor"><span class="draft-index">GAME 1</span><strong>PLAY SURVIVOR</strong><small>${esc(winnerName)} Survivor · ${esc(otherName)} Killer</small></button>
      </div>
      <div class="actions"><button class="button danger" data-action="restart-setup" ${match.status === 'completed' ? 'disabled' : ''}>Restart match setup</button></div>
    </section>`;
  }

  function chooseSide(role) {
    if (!selectedId) return;
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || match.status === 'completed' || !match.toss || !match.toss.winnerId) return;
      Entity.setSideChoice(state, match.id, match.toss.winnerId, role);
    });
  }

  function renderMapStage(state, match, teams) {
    if (!match.mapVeto || !Array.isArray(match.mapVeto.pool)) {
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">Stage 02 / Map veto</div><h3>MAP POOL NOT INITIALIZED</h3><p>Choose a random pool of five maps to begin voting.</p><button class="button primary" data-action="init-map-pool">Reveal 5 maps →</button></section>`;
      return;
    }
    const veto = match.mapVeto;
    const remain = remainingMaps(veto);
    const order = teamOrder(match);
    const nextTeamId = order[veto.bans.length % 2];
    const nextTeamName = Entity.teamName(state, nextTeamId);
    $('wizard').innerHTML = `<section class="panel map-veto-panel">
      <div class="veto-head"><div><div class="eyebrow">Stage 02 / Map veto · Ban ${veto.bans.length + 1} of 4</div><h3>${esc(nextTeamName.toUpperCase())} — BAN ONE MAP</h3><p>The team that won the toss bans first. Turns alternate until only one map remains.</p></div><div class="veto-counter"><strong>${remain.length}</strong><span>MAPS LEFT</span></div></div>
      ${renderTossBanner(state, match)}
      <div class="draft-grid map-grid">${veto.pool.map((name, index) => {
        const ban = veto.bans.find((item) => item.map === name);
        const canSelect = !ban && !veto.finalMap;
        return `<button class="draft-card map-card ${ban ? 'taken' : ''}" type="button" data-action="ban-map" data-map="${esc(name)}" ${canSelect ? '' : 'disabled'}><span class="draft-index">REALM ${String(index + 1).padStart(2, '0')}</span><strong>${esc(name)}</strong><small>${ban ? `BANNED BY ${esc(Entity.teamName(state, ban.teamId).toUpperCase())}` : 'SELECT TO BAN'}</small></button>`;
      }).join('')}</div>
      ${renderBanHistory(state, match)}
      <div class="actions"><button class="button" data-action="reroll-maps" ${veto.bans.length || match.status === 'completed' ? 'disabled title="Map pool is locked after the first ban"' : ''}>Reroll 5 maps</button><button class="button danger" data-action="restart-setup" ${match.status === 'completed' ? 'disabled' : ''}>Restart match setup</button></div>
    </section>`;
  }

  function renderDoneStage(state, match, teams) {
    const finalMap = match.mapVeto && match.mapVeto.finalMap || 'Not selected';
    $('wizard').innerHTML = `<section class="panel setup-complete-panel"><div class="eyebrow">Pre-match setup complete</div><h3>THE REALM IS LOCKED</h3><div class="final-map-tile"><span>SELECTED MAP</span><strong>${esc(finalMap)}</strong></div>
      ${renderTossBanner(state, match)}${renderBanHistory(state, match)}
      <p class="hint">Map voting is complete. Continue to the points menu when the match is ready to be scored.</p>
      <div class="actions"><button class="button primary" data-action="continue-scoring">Continue to points menu →</button><button class="button danger" data-action="restart-setup" ${match.status === 'completed' ? 'disabled' : ''}>Restart match setup</button><a class="button" href="./bracket.html?match=${encodeURIComponent(match.id)}">Back to bracket</a></div></section>`;
  }

  function startScoringRedirect() {
    const url = new URL('./bracket.html', window.location.href);
    url.searchParams.set('match', selectedId);
    url.searchParams.set('openScoring', '1');
    Entity.flush().then(() => { window.location.href = url.href; });
  }

  function initializeMapVeto() {
    if (!selectedId || poolError) return;
    const pool = sample(mapPool, 5);
    if (pool.length !== 5) {
      poolError = `The map pool needs at least five unique names; found ${pool.length}.`;
      render();
      return;
    }
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || !match.toss) return;
      match.mapVeto = { pool, bans: [], finalMap: null, confirmed: false };
      match.setupComplete = false;
    });
  }

  function flipToss() {
    if (flipping || !selectedId || poolError) return;
    const { match } = currentMatchAndState();
    if (!match || match.status === 'completed') return;
    if (match.toss && !window.confirm('This match already has a toss. Restart match setup to rerun it?')) return;
    const callerId = $('caller-select').value === 'b' ? match.teamBId : match.teamAId;
    const calledSide = $('call-select').value;
    const side = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const winnerId = side === calledSide ? callerId : otherTeam(match, callerId);
    const mapOptions = sample(mapPool, 5);
    if (mapOptions.length !== 5) {
      poolError = 'The map pool must contain at least five unique names.';
      render();
      return;
    }
    flipping = true;
    render();
    window.setTimeout(() => {
      Entity.update((draft) => {
        const current = findMatch(draft, selectedId);
        if (!current) return;
        current.toss = { winnerId, side, callerId, calledSide, choice: 'First map ban', savedAt: new Date().toISOString() };
        current.roles = null;
        current.mapVeto = { pool: mapOptions, bans: [], finalMap: null, confirmed: false };
        current.setupComplete = false;
        draft.activeMatchId = selectedId;
        if (current.status !== 'completed') Entity.setLive(draft, selectedId);
      });
      flipping = false;
      render();
    }, 1250);
  }

  function banMap(mapName) {
    if (!selectedId) return;
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || match.status === 'completed' || !match.mapVeto || match.mapVeto.finalMap) return;
      const veto = match.mapVeto;
      if (!remainingMaps(veto).includes(mapName)) return;
      const order = teamOrder(match);
      const teamId = order[veto.bans.length % 2];
      veto.bans.push({ map: mapName, teamId, at: new Date().toISOString() });
      const remain = remainingMaps(veto);
      if (remain.length === 1) {
        veto.finalMap = remain[0];
        veto.confirmed = true;
        match.setupComplete = true;
        if (match.status !== 'completed') Entity.setLive(state, match.id);
        else state.activeMatchId = match.id;
      }
    });
  }

  function restartSetup() {
    const existing = findMatch(Entity.load(), selectedId);
    if (!existing) return;
    if (existing.status === 'completed') {
      window.alert('This match is completed. Correct the result in bracket control or rebuild the bracket before restarting setup.');
      return;
    }
    if (!window.confirm('Restarting setup clears this match’s toss, map bans and scoring card. Continue?')) return;
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match) return;
      match.toss = null;
      match.roles = null;
      match.mapVeto = null;
      match.setupComplete = false;
      match.scorecard = null;
      match.scoreA = null;
      match.scoreB = null;
      match.winnerId = null;
      match.tiebreakWinnerId = null;
      if (match.status !== 'bye') match.status = 'pending';
      state.activeMatchId = match.id;
    });
  }

  $('match-select').addEventListener('change', (event) => {
    selectedId = event.target.value || null;
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('match', selectedId); else url.searchParams.delete('match');
    window.history.replaceState({}, '', url.pathname + url.search);
    render();
  });

  $('wizard').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'flip') flipToss();
    if (action === 'init-map-pool') initializeMapVeto();
    if (action === 'ban-map') banMap(button.dataset.map);
    if (action === 'choose-side') chooseSide(button.dataset.role);
    if (action === 'reroll-maps') {
      const match = findMatch(Entity.load(), selectedId);
      if (match && match.mapVeto && !match.mapVeto.bans.length) initializeMapVeto();
    }
    if (action === 'restart-setup') restartSetup();
    if (action === 'continue-scoring') startScoringRedirect();
  });

  Entity.subscribe(() => { if (!flipping) render(); });
  loadMapPool().then(() => render());
})();
