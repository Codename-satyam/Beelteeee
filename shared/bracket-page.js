
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const currentState = () => Entity.load();
  const playableMatches = (state) => state.matches.filter((m) => m.teamAId && m.teamBId && m.status !== 'bye');
  const getMatch = (state, id) => state.matches.find((m) => m.id === id) || null;
  const scoreEngine = window.EntityScoring;
  let selectedId = new URLSearchParams(window.location.search).get('match') || null;
  const openScoringOnLoad = new URLSearchParams(window.location.search).get('openScoring') === '1';
  let scoringOpen = false;
  let scoringGameNo = 1;
  const overrides = new Set(); // "matchId:gameNo" keys where the admin accepted the amber warnings

  const FIELD_LABELS = { generatorsCompleted: 'Generators', exitEscapes: 'Gate escapes', hatchEscapes: 'Hatch escapes', unhooks: 'Unhooks', kills: 'Kills', hooks: 'Hooks', hatchClosed: 'Hatch closed' };
  // Plain-English change text for the activity log, plus a "moment" tag editors can search the CSV for.
  function describeChange(field, oldV, newV) {
    const show = (v) => (v === null || v === undefined ? '–' : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v);
    const up = Number(newV) > Number(oldV == null ? -1 : oldV);
    let moment = '';
    if (field === 'generatorsCompleted' && up) moment = Number(newV) >= 5 ? 'ALL GENERATORS DONE' : `GENERATOR ${newV}`;
    else if (field === 'hatchClosed' && newV) moment = 'HATCH CLOSED';
    else if (field === 'hatchEscapes' && up) moment = 'HATCH ESCAPE';
    else if (field === 'exitEscapes' && up) moment = `ESCAPE ${newV}`;
    else if (field === 'kills' && up) moment = `KILL ${newV}`;
    else if (field === 'hooks' && up) moment = `HOOK ${newV}`;
    else if (field === 'unhooks' && up) moment = `UNHOOK ${newV}`;
    return { label: `${FIELD_LABELS[field] || field} ${show(oldV)} → ${show(newV)}`, moment };
  }

  function fmt(value) {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function showFeedback(message, bad) {
    $('feedback').textContent = message;
    $('feedback').style.color = bad ? '#ff8a95' : '#73e9ad';
  }

  function matchOptionLabel(state, match) {
    return `${match.roundName} · M${match.matchNumber} — ${Entity.teamName(state, match.teamAId)} vs ${Entity.teamName(state, match.teamBId)}`;
  }

  function ensureSelected(state) {
    const selected = getMatch(state, selectedId);
    if (!selected || !selected.teamAId || !selected.teamBId || selected.status === 'bye') {
      const active = Entity.activeMatch(state);
      selectedId = active && active.teamAId && active.teamBId && active.status !== 'bye'
        ? active.id : (playableMatches(state)[0]?.id || null);
    }
  }

  function getScoreResult(match) {
    return scoreEngine.calculateMatch(scoreEngine.normalizeScorecard(match && match.scorecard), Entity.rolesFor(match, 1).killerId === (match && match.teamAId));
  }

  function renderBracket(state) {
    const root = $('bracket-view');
    if (!state.generated || !state.matches.length) {
      root.innerHTML = '<div class="empty"><h3>NO BRACKET GENERATED</h3>Enter your participating teams on the left, then generate the bracket.</div>';
      $('bracket-status').textContent = 'Not generated';
      $('bracket-status').className = 'status pending';
      return;
    }
    const champion = state.matches.find((m) => !m.parentMatchId && m.status === 'completed' && m.winnerId);
    $('bracket-status').textContent = champion ? `Champion: ${Entity.teamName(state, champion.winnerId)}` : 'Bracket active';
    $('bracket-status').className = champion ? 'status completed' : 'status in_progress';
    const rounds = [...new Set(state.matches.map((m) => m.roundIndex))].sort((a, b) => a - b);
    root.innerHTML = `<div class="bracket-scroll"><div class="bracket-rounds">${rounds.map((round) => {
      const items = state.matches.filter((m) => m.roundIndex === round && m.status !== 'bye').sort((a,b) => a.matchNumber-b.matchNumber);
      const roundName = items[0]?.roundName || `ROUND ${round + 1}`;
      return `<div class="bracket-round"><div class="round-head">${esc(roundName)} <span class="muted mono" style="font-size:.55rem">// ${items.length} MATCH${items.length===1?'':'ES'}</span></div>${items.map((m) => {
        const isSelected = m.id === selectedId;
        const winnerA = m.winnerId && m.winnerId === m.teamAId;
        const winnerB = m.winnerId && m.winnerId === m.teamBId;
        const statusClass = m.status === 'in_progress' ? 'in_progress' : (m.status === 'completed' ? 'completed' : (m.status === 'bye' ? 'bye' : 'pending'));
        const statusLabel = m.status === 'in_progress' ? 'LIVE' : m.status.toUpperCase().replace('_',' ');
        const aScore = m.scoreA == null ? '—' : fmt(m.scoreA);
        const bScore = m.scoreB == null ? '—' : fmt(m.scoreB);
        const result = getScoreResult(m);
        const roundMeta = m.scorecard ? `<div class="hint scorecard-status">Game 1 ${result.game1.confirmed ? '✓' : '○'} · Game 2 ${result.game2.confirmed ? '✓' : '○'}</div>` : '';
        const setupSummary = m.setupComplete && m.mapVeto && m.mapVeto.finalMap ? `<div class="match-setup-info"><span>MAP · ${esc(m.mapVeto.finalMap)}</span></div>` : `<div class="hint scorecard-status">Map voting pending</div>`;
        const byeText = m.status === 'bye' ? '<div class="hint" style="margin-top:8px">BYE · advances automatically</div>' : '';
        return `<article class="match-card ${isSelected?'active':''}"><div class="match-top"><span class="match-number">MATCH ${m.matchNumber}</span><span class="status ${statusClass}">${statusLabel}</span></div>
          <div class="competitor ${winnerA?'winner':''}"><span class="name">${esc(Entity.teamName(state,m.teamAId))}</span><span class="points">${aScore}</span></div>
          <div class="competitor ${winnerB?'winner':''}"><span class="name">${esc(Entity.teamName(state,m.teamBId))}</span><span class="points">${bScore}</span></div>${roundMeta}${setupSummary}${byeText}
          ${m.status !== 'bye' && m.teamAId && m.teamBId ? `<div class="match-actions"><button class="button primary" data-action="start" data-match="${m.id}">Map vote → Score</button><button class="button" data-action="live" data-match="${m.id}">Set live</button></div>` : ''}
        </article>`;
      }).join('')}</div>`;
    }).join('')}</div></div>`;
  }

  function renderEditor(state) {
    const select = $('match-select');
    const matches = playableMatches(state);
    select.innerHTML = matches.length ? matches.map((m) => `<option value="${m.id}">${esc(matchOptionLabel(state,m))}</option>`).join('') : '<option value="">No playable matches yet</option>';
    if (selectedId && matches.some((m) => m.id === selectedId)) select.value = selectedId;
    else { selectedId = matches[0]?.id || null; if (selectedId) select.value = selectedId; }
    const match = getMatch(state, selectedId);
    const openButton = $('open-scoring-btn');
    const liveButton = $('set-live-btn');
    if (!match) {
      $('selected-match-info').textContent = 'Generate a bracket with at least two teams to start scoring.';
      $('score-a-preview').textContent = '0'; $('score-b-preview').textContent = '0';
      openButton.disabled = true; liveButton.disabled = true;
      return;
    }
    openButton.disabled = false; liveButton.disabled = false;
    const result = getScoreResult(match);
    const setupSummary = match.setupComplete && match.mapVeto && match.mapVeto.finalMap ? `<br><span class="muted">Selected map:</span> ${esc(match.mapVeto.finalMap)}` : '<br><span class="muted">Pre-match setup:</span> toss and map voting required';
    $('selected-match-info').innerHTML = `<strong>${esc(match.roundName)} · Match ${match.matchNumber}</strong><br><span class="muted">Teams:</span> ${esc(Entity.teamName(state,match.teamAId))} vs ${esc(Entity.teamName(state,match.teamBId))}<br><span class="muted">Status:</span> ${esc(match.status.replace('_',' '))}${match.winnerId?`<br><span class="muted">Winner:</span> ${esc(Entity.teamName(state,match.winnerId))}`:''}${setupSummary}<br><span class="muted">Scoring progress:</span> Game 1 ${result.game1.confirmed?'confirmed':'not confirmed'} · Game 2 ${result.game2.confirmed?'confirmed':'not confirmed'}`;
    $('score-a-preview').textContent = fmt(result.teamA);
    $('score-b-preview').textContent = fmt(result.teamB);
  }

  function render() {
    const state = currentState();
    if (document.activeElement !== $('team-list')) $('team-list').value = state.teams.map((t) => t.name).join('\n');
    $('stat-teams').textContent = state.teams.length;
    $('stat-completed').textContent = state.matches.filter((m) => m.status === 'completed').length;
    $('stat-remaining').textContent = state.matches.filter((m) => m.status !== 'completed' && m.status !== 'bye' && m.teamAId && m.teamBId).length;
    ensureSelected(state);
    renderEditor(state);
    renderBracket(state);
    renderActivity(state);
    if (scoringOpen) renderScoringModal();
  }

  function setLiveLogged(id) {
    Entity.update((state) => {
      Entity.audit.record(state, 'Set as live match', id, { kind: 'live', moment: 'MATCH LIVE' });
      Entity.setLive(state, id);
    });
  }

  function undoLast() {
    if (!Entity.audit.lastUndoable(currentState())) { showFeedback('Nothing to undo yet.', true); return; }
    let undone = null;
    try {
      Entity.update((draft) => { undone = Entity.audit.undo(draft); });
      if (undone) showFeedback(`Undid: ${undone.label}`, false);
      render();
    } catch (err) { showFeedback(err.message || 'Could not undo.', true); }
  }

  const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  function renderActivity(state) {
    const list = $('activity-log');
    if (!list) return;
    const log = Entity.audit.list(state).slice().reverse();
    const last = Entity.audit.lastUndoable(state);
    if ($('undo-btn')) { $('undo-btn').disabled = !last; $('undo-btn').title = last ? `Undo: ${last.label}` : 'Nothing to undo'; }
    if ($('log-csv-btn')) $('log-csv-btn').disabled = !log.length;
    const recap = $('recap-btn'), m = getMatch(state, selectedId);
    if (recap) recap.disabled = !(m && m.status === 'completed' && window.EntityRecap);
    list.innerHTML = log.length ? log.slice(0, 30).map((e) => `<li class="${e.kind === 'undo' ? 'is-undo' : ''} ${e.undone ? 'is-undone' : ''}"><time>${esc(clock(e.at))}</time><span class="log-main"><b>${e.game ? `G${e.game} · ` : ''}${esc(e.label)}</b><small>${esc(e.matchLabel || '')} · ${esc(String(e.who || '').split('@')[0])}</small></span></li>`).join('') : '<li class="empty-log">No changes recorded yet. Every scoring change shows up here and can be undone.</li>';
  }

  function chooseMatch(id) {
    selectedId = id;
    render();
    $('match-select').value = id;
    $('feedback').textContent = '';
  }

  function presetButtons(field, values, currentValue, labelFn, extraClass, selectionEnabled = true) {
    return `<div class="preset-grid ${extraClass || ''}">${values.map((value) => {
      const selected = selectionEnabled && Number(currentValue) === value && currentValue !== null && currentValue !== undefined;
      return `<button type="button" class="preset ${selected?'selected':''}" data-score-action="set" data-field="${field}" data-value="${value}" aria-pressed="${selected}">${labelFn(value)}</button>`;
    }).join('')}</div>`;
  }

  function togglePreset(field, active, title, pointsText, disabled) {
    return `<button type="button" class="score-toggle ${active?'selected':''}" data-score-action="toggle" data-field="${field}" aria-pressed="${active}" ${disabled?'disabled':''}><span class="toggle-light"></span><span><b>${title}</b><small>${pointsText}</small></span><strong>${active?'ON':'OFF'}</strong></button>`;
  }

  function renderScoringModal() {
    const backdrop = $('scoring-modal');
    if (!scoringOpen) { backdrop.hidden = true; return; }
    const state = currentState();
    const match = getMatch(state, selectedId);
    if (!match) { scoringOpen = false; backdrop.hidden = true; return; }
    const card = scoreEngine.normalizeScorecard(match.scorecard);
    if (scoringGameNo === 2 && !card.game1.confirmed) scoringGameNo = 1; // e.g. after an undo un-confirmed Game 1
    const gameKey = scoringGameNo === 1 ? 'game1' : 'game2';
    const game = card[gameKey];
    const result = scoreEngine.calculateMatch(card, Entity.rolesFor(match, 1).killerId === match.teamAId);
    const roundResult = scoringGameNo === 1 ? result.game1 : result.game2;

    // Game 1 roles come from the toss winner's side choice (see toss page); Game 2 swaps them.
    const roles = Entity.rolesFor(match, scoringGameNo);
    const g1 = Entity.rolesFor(match, 1), g2 = Entity.rolesFor(match, 2);

    const killerName = Entity.teamName(state, roles.killerId);
    const survivorName = Entity.teamName(state, roles.survivorId);
    const gameOneReady = card.game1.confirmed;
    const bothConfirmed = card.game1.confirmed && card.game2.confirmed;
    const isTied = result.teamA === result.teamB;
    const canComplete = bothConfirmed && (!isTied || (match.tiebreakWinnerId === match.teamAId || match.tiebreakWinnerId === match.teamBId));
    const generatorButtons = presetButtons('generatorsCompleted', [0,1,2,3,4,5], game.generatorsCompleted, (value) => {
      return `<b>${value} GEN${value===1?'':'S'}</b><small>Survivor +${value}<br>Killer +${5-value}</small>`;
    }, 'generators-preset');
    const ptLabel = (n) => `<b>${n}</b><small>+${n} PT${n===1?'':'S'}</small>`;
    const escapeButtons = presetButtons('exitEscapes', [0,1,2,3,4], game.exitEscapes, ptLabel, '', game.started);
    const hatchEscapeButtons = presetButtons('hatchEscapes', [0,1], game.hatchEscapes, (value) => `<b>${value}</b><small>+${value*2} PTS</small>`, '', game.started);
    const unhookButtons = presetButtons('unhooks', [0,1,2,3,4,5,6,7,8], game.unhooks, ptLabel, 'hooks-preset', game.started);
    const killButtons = presetButtons('kills', [0,1,2,3,4], game.kills, ptLabel, '', game.started);
    const hookButtons = presetButtons('hooks', [0,1,2,3,4,5,6,7,8], game.hooks, ptLabel, 'hooks-preset', game.started);
    const warnings = scoreEngine.validateGame(game);
    const warningsG1 = scoreEngine.validateGame(card.game1).length, warningsG2 = scoreEngine.validateGame(card.game2).length;
    const overridden = overrides.has(`${match.id}:${scoringGameNo}`);
    const warnHtml = warnings.length ? `<div class="score-warnings" role="alert"><div class="score-warnings-head">⚠ CHECK THESE ENTRIES</div><ul>${warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>${game.confirmed ? '<p class="hint" style="margin:6px 0 0">This game was confirmed with these warnings overridden.</p>' : `<label class="override-check"><input type="checkbox" id="score-override" ${overridden ? 'checked' : ''}> These are correct, let me confirm anyway</label>`}</div>` : '';
    const lastUndo = Entity.audit.lastUndoable(state);
    const killerGenValue = game.generatorsCompleted == null ? 'Choose gens' : `${5-game.generatorsCompleted} remaining · +${5-game.generatorsCompleted} pts`;

    $('scoring-modal-content').innerHTML = `
      <header class="scoring-modal-head">
        <div><div class="eyebrow">Match operations / Scoring terminal</div><h2 id="scoring-modal-title">${esc(match.roundName)} · MATCH ${match.matchNumber}</h2><p>${esc(Entity.teamName(state,match.teamAId))} <span class="muted">VS</span> ${esc(Entity.teamName(state,match.teamBId))}</p><p class="match-setup-summary">SELECTED MAP · ${esc(match.mapVeto?.finalMap || 'Not selected')}</p></div>
        <button type="button" class="modal-close" data-score-action="close" aria-label="Close scoring menu">×</button>
      </header>
      <div class="scoring-tabs">
        <button type="button" class="score-tab ${scoringGameNo===1?'active':''} ${card.game1.confirmed?'confirmed':''}" data-score-action="game" data-game="1"><b>GAME 1</b><small>${esc(Entity.teamName(state,g1.killerId))} Killer · ${esc(Entity.teamName(state,g1.survivorId))} Survivor</small><span>${card.game1.confirmed?'CONFIRMED':'INCOMPLETE'}${warningsG1?' · ⚠':''}</span></button>
        <button type="button" class="score-tab ${scoringGameNo===2?'active':''} ${card.game2.confirmed?'confirmed':''}" data-score-action="game" data-game="2" ${!gameOneReady?'disabled':''}><b>GAME 2</b><small>${esc(Entity.teamName(state,g2.killerId))} Killer · ${esc(Entity.teamName(state,g2.survivorId))} Survivor</small><span>${card.game2.confirmed?'CONFIRMED':gameOneReady?'INCOMPLETE':'LOCKED · FINISH GAME 1'}${warningsG2?' · ⚠':''}</span></button>
      </div>
      <div class="scoring-rule-strip"><span>SCORING IS ACTION-BASED</span><span>Survivor: max 18</span><span>Killer: max 19</span></div>
      <div class="scoring-role-heading"><span class="role-survivor">SURVIVOR</span><b>${esc(survivorName)}</b><span class="role-killer">KILLER</span><b>${esc(killerName)}</b></div>
      <div class="scoring-grid">
        <section class="scoring-side survivor-side">
          <div class="scoring-side-title"><span class="role-index">01</span><div><h3>Survivor points</h3><p>18-point system</p></div><strong class="side-total">${fmt(roundResult.survivorScore)}</strong></div>
          <div class="score-category"><div class="category-head"><b>Generators completed</b><span>1 PT EACH · MAX 5</span></div><p class="hint">Select the completed generator count. Killer remaining-generator points are calculated automatically from the same result.</p>${generatorButtons}</div>
          <div class="score-category"><div class="category-head"><b>Exit-gate escapes</b><span>1 PT EACH</span></div>${escapeButtons}</div>
          <div class="score-category"><div class="category-head"><b>Hatch escape</b><span>2 PTS EACH · ESCAPES CAP AT 5</span></div><p class="hint">Gate and hatch points share one Escape category (max 5 points).</p>${hatchEscapeButtons}</div>
          <div class="score-category"><div class="category-head"><b>Successful unhooks</b><span>1 PT EACH · MAX 8</span></div>${unhookButtons}</div>
        </section>
        <section class="scoring-side killer-side">
          <div class="scoring-side-title"><span class="role-index">02</span><div><h3>Killer points</h3><p>19-point system</p></div><strong class="side-total">${fmt(roundResult.killerScore)}</strong></div>
          <div class="score-category killer-gens"><div class="category-head"><b>Generators remaining</b><span>1 PT EACH · MAX 5</span></div><div class="derived-value">${esc(killerGenValue)}</div><p class="hint">Derived from completed generators above to prevent conflicting entries.</p></div>
          <div class="score-category"><div class="category-head"><b>Survivors killed</b><span>1 PT EACH · MAX 4</span></div>${killButtons}</div>
          <div class="score-category"><div class="category-head"><b>Hooks</b><span>1 PT PER HOOK EVENT · MAX 8</span></div>${hookButtons}</div>
          <div class="score-category"><div class="category-head"><b>Hatch closed</b><span>+2 PTS</span></div>${togglePreset('hatchClosed', game.hatchClosed, 'Killer closed the hatch', 'Kept even if a survivor later escapes through it')}</div>
        </section>
      </div>
      <section class="score-summary">
        <div class="summary-column"><small>THIS GAME · SURVIVOR</small><strong>${fmt(roundResult.survivorScore)}</strong><span>${roundResult.breakdown.generatorsSelected?`${roundResult.breakdown.generators} gens`:'Generators not selected'} · ${roundResult.breakdown.escapePoints} escape pts · ${roundResult.breakdown.unhooks} unhooks</span></div>
        <div class="summary-vs">VS</div>
        <div class="summary-column killer-summary"><small>THIS GAME · KILLER</small><strong>${fmt(roundResult.killerScore)}</strong><span>${roundResult.breakdown.generatorsSelected?`${roundResult.breakdown.remainingGenerators} gens left`:'Generators not selected'} · ${roundResult.breakdown.kills} kills · ${roundResult.breakdown.hooks} hooks${roundResult.breakdown.hatchClosed?' · hatch closed +2':''}</span></div>
        <div class="match-total-band"><span>MATCH TOTAL · ${esc(Entity.teamName(state,match.teamAId))}</span><b>${fmt(result.teamA)}</b><span>MATCH TOTAL · ${esc(Entity.teamName(state,match.teamBId))}</span><b>${fmt(result.teamB)}</b></div>
      </section>
      ${warnHtml}
      ${bothConfirmed && isTied ? `<div class="tie-break-panel"><label for="modal-tie-winner">Match total is tied. Select the tiebreak winner to advance.</label><select id="modal-tie-winner"><option value="">Choose tiebreak winner</option><option value="${match.teamAId}" ${match.tiebreakWinnerId===match.teamAId?'selected':''}>${esc(Entity.teamName(state,match.teamAId))}</option><option value="${match.teamBId}" ${match.tiebreakWinnerId===match.teamBId?'selected':''}>${esc(Entity.teamName(state,match.teamBId))}</option></select></div>` : ''}
      <footer class="scoring-modal-footer">
        <div class="scoring-feedback" id="modal-feedback" role="status" aria-live="polite">${game.confirmed?'This game is confirmed. Changing any action will require confirmation again.':'Choose the generator result, then set any other actions that occurred.'}</div>
        <div class="actions"><button type="button" class="button ghost" data-score-action="undo" ${lastUndo?'':'disabled'} title="${lastUndo?esc('Undo: '+lastUndo.label):'Nothing to undo'}">↶ Undo</button><button type="button" class="button ghost" data-score-action="close">Close</button><button type="button" class="button" data-score-action="confirm-game" ${(!roundResult.valid || game.confirmed || (scoringGameNo===2 && !gameOneReady) || (warnings.length && !overridden))?'disabled':''}>${game.confirmed?'Game confirmed ✓':`Confirm Game ${scoringGameNo}${scoringGameNo===1?' · Continue to Game 2':''}`}</button><button type="button" class="button primary" data-score-action="complete" ${!canComplete?'disabled':''}>Complete match & advance</button></div>
      </footer>`;
    backdrop.hidden = false;
  }

  function startMatchWorkflow(id) {
    const state = currentState();
    const match = getMatch(state, id);
    if (!match || !match.teamAId || !match.teamBId || match.status === 'bye') return;
    selectedId = id;
    if (match.setupComplete && match.mapVeto?.finalMap) {
      scoringOpen = true;
      const card = scoreEngine.normalizeScorecard(match.scorecard);
      scoringGameNo = card.game1.confirmed ? 2 : 1;
      render();
      $('scoring-modal').hidden = false;
      return;
    }
    try {
      Entity.update((draft) => {
        const current = getMatch(draft, id);
        if (current && current.status !== 'completed') Entity.setLive(draft, id);
        else if (current) draft.activeMatchId = id;
      });
      const url = new URL('./toss.html', window.location.href);
      url.searchParams.set('match', id);
      url.searchParams.set('next', 'scoring');
      Entity.flush().then(() => { window.location.href = url.href; });
    } catch (err) { showFeedback(err.message || 'Could not open match setup.', true); }
  }

  function openScoringMenu(id) {
    const state = currentState();
    const match = getMatch(state, id);
    if (!match || !match.teamAId || !match.teamBId) return;
    if (!match.setupComplete || !match.mapVeto?.finalMap) {
      startMatchWorkflow(id);
      return;
    }
    selectedId = id;
    scoringOpen = true;
    const card = scoreEngine.normalizeScorecard(match.scorecard);
    scoringGameNo = card.game1.confirmed ? 2 : 1;
    render();
    $('scoring-modal').hidden = false;
    const close = $('scoring-modal-content').querySelector('[data-score-action="close"]');
    if (close) close.focus();
  }

  function closeScoringMenu() {
    scoringOpen = false;
    $('scoring-modal').hidden = true;
  }

  function updateScoring(mutator, editedGameNo, invalidateOtherGame = true, audit = null) {
    if (audit && audit.clearOverride) overrides.delete(`${selectedId}:${editedGameNo}`);
    Entity.update((state) => {
      const match = getMatch(state, selectedId);
      if (!match) throw new Error('Select a playable match first.');
      if (audit) Entity.audit.record(state, audit.label, match.id, { game: editedGameNo, kind: audit.kind || 'score', moment: audit.moment || '' });
      match.scorecard = scoreEngine.normalizeScorecard(match.scorecard);
      mutator(match.scorecard, match);
      if (invalidateOtherGame && editedGameNo === 1) match.scorecard.game2.confirmed = false;
      match.tiebreakWinnerId = null;
      const result = scoreEngine.calculateMatch(match.scorecard, Entity.rolesFor(match, 1).killerId === match.teamAId);
      Entity.savePoints(state, match.id, result.teamA, result.teamB, false, null);
    });
    render();
  }

  function setScoreField(field, rawValue) {
    const val = Number(rawValue);
    if (!Number.isFinite(val)) return;
    const existingMatch = getMatch(currentState(), selectedId);
    const existingCard = scoreEngine.normalizeScorecard(existingMatch && existingMatch.scorecard);
    const existingGame = existingCard[scoringGameNo === 1 ? 'game1' : 'game2'];
    if (existingGame.started && existingGame[field] === val) return;
    const change = describeChange(field, existingGame[field], field === 'hatchClosed' ? Boolean(val) : val);
    updateScoring((card) => {
      const game = card[scoringGameNo === 1 ? 'game1' : 'game2'];
      const nextValue = field === 'hatchClosed' ? Boolean(val) : val;
      if (game[field] === nextValue && game.started) return;
      game[field] = nextValue;
      game.started = true;
      game.confirmed = false;
    }, scoringGameNo, true, { ...change, clearOverride: true });
  }

  function toggleScoreField(field) {
    const existingMatch = getMatch(currentState(), selectedId);
    const existingGame = scoreEngine.normalizeScorecard(existingMatch && existingMatch.scorecard)[scoringGameNo === 1 ? 'game1' : 'game2'];
    const change = describeChange(field, Boolean(existingGame[field]), !existingGame[field]);
    updateScoring((card) => {
      const game = card[scoringGameNo === 1 ? 'game1' : 'game2'];
      game[field] = !game[field];
      game.started = true;
      game.confirmed = false;
    }, scoringGameNo, true, { ...change, clearOverride: true });
  }

  function confirmGame() {
    const state = currentState();
    const match = getMatch(state, selectedId);
    if (!match) return;
    const card = scoreEngine.normalizeScorecard(match.scorecard);
    const gameKey = scoringGameNo === 1 ? 'game1' : 'game2';
    const game = card[gameKey];
    if (scoringGameNo === 2 && !card.game1.confirmed) {
      $('modal-feedback').textContent = 'Confirm Game 1 before confirming Game 2.';
      return;
    }
    if (game.generatorsCompleted == null) {
      $('modal-feedback').textContent = 'Select the number of completed generators first. This also determines killer points for generators remaining.';
      $('modal-feedback').classList.add('bad');
      return;
    }
    const warnings = scoreEngine.validateGame(game);
    if (warnings.length && !overrides.has(`${selectedId}:${scoringGameNo}`)) {
      $('modal-feedback').textContent = 'Some entries look wrong (see the amber box). Fix them, or tick the override to confirm anyway.';
      return;
    }
    game.started = true;
    game.confirmed = true;
    updateScoring((draft) => { draft[gameKey] = game; }, scoringGameNo, false, { label: `Confirmed${warnings.length ? ' (warnings overridden)' : ''}`, kind: 'confirm', moment: `GAME ${scoringGameNo} CONFIRMED` });
    showFeedback(`Game ${scoringGameNo} confirmed.`, false);
    if (scoringGameNo === 1) {
      scoringGameNo = 2;
      renderScoringModal();
    } else {
      renderScoringModal();
      const feedback = $('modal-feedback');
      if (feedback) feedback.textContent = 'Game 2 confirmed. Review both team totals, then complete the match to advance the winner.';
    }
  }

  function completeMatch() {
    const state = currentState();
    const match = getMatch(state, selectedId);
    if (!match) return;
    const result = getScoreResult(match);
    if (!result.bothConfirmed) {
      const feedback = $('modal-feedback');
      if (feedback) feedback.textContent = 'Confirm both Game 1 and Game 2 before completing this match.';
      return;
    }
    if (result.teamA === result.teamB && match.tiebreakWinnerId !== match.teamAId && match.tiebreakWinnerId !== match.teamBId) {
      const feedback = $('modal-feedback');
      if (feedback) feedback.textContent = 'The totals are tied. Choose the tiebreak winner first.';
      return;
    }
    try {
      Entity.update((draft) => {
        const current = getMatch(draft, selectedId);
        const freshResult = getScoreResult(current);
        Entity.audit.record(draft, `Match completed ${freshResult.teamA}–${freshResult.teamB}`, current.id, { kind: 'complete', moment: 'MATCH COMPLETE', withAncestors: true });
        Entity.savePoints(draft, current.id, freshResult.teamA, freshResult.teamB, true, current.tiebreakWinnerId || null);
      });
      closeScoringMenu();
      showFeedback('Match completed. The winner has advanced into the next round.', false);
      render();
    } catch (err) {
      const feedback = $('modal-feedback');
      if (feedback) feedback.textContent = err.message || 'Unable to complete match.';
    }
  }

  $('generate-btn').addEventListener('click', () => {
    const names = $('team-list').value.split(/\r?\n/);
    const state = currentState();
    if (state.generated && !window.confirm('Rebuilding will replace the current bracket, scores, and toss results. Continue?')) return;
    try {
      const fresh = Entity.buildBracket(names);
      Entity.save(fresh);
      selectedId = fresh.activeMatchId;
      showFeedback('Bracket generated. Run map voting, then award action-based points.', false);
      render();
    } catch (err) { showFeedback(err.message || 'Could not generate bracket.', true); }
  });

  $('demo-btn').addEventListener('click', () => {
    if (currentState().generated && !window.confirm('Replace the current tournament with demo teams?')) return;
    $('team-list').value = 'Fog Walkers\nThe Hooked Legends\nFinal Survivors\nEntity Hunters';
    try {
      const fresh = Entity.buildBracket($('team-list').value.split(/\r?\n/));
      Entity.save(fresh); selectedId = fresh.activeMatchId; showFeedback('Demo bracket loaded. Try the preset scoring buttons and live updates.', false); render();
    } catch (err) { showFeedback(err.message, true); }
  });

  $('export-btn').addEventListener('click', () => {
    try {
      const state = Entity.load();
      const payload = JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'entity-championship-state.json';
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      showFeedback('Tournament state exported as JSON.', false);
    } catch (err) { showFeedback('Unable to export tournament state.', true); }
  });

  const importButton = $('import-btn');
  const importFile = $('import-file');
  if (importButton && importFile) {
    importButton.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const candidateInput = parsed && parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed;
        if (!candidateInput || !Array.isArray(candidateInput.teams) || !Array.isArray(candidateInput.matches)) {
          throw new Error('This file is not a valid Entity Championship state JSON.');
        }
        if (!window.confirm('Importing replaces the tournament currently saved in this browser. Continue?')) return;
        const { exportedAt: ignoredExportDate, ...candidate } = candidateInput;
        candidate.version = Number(candidate.version) || 1;
        candidate.generated = Boolean(candidate.generated || candidate.matches.length);
        candidate.activeMatchId = candidate.activeMatchId || null;
        Entity.save(candidate);
        selectedId = candidate.activeMatchId || candidate.matches.find((m) => m.teamAId && m.teamBId && m.status !== 'bye')?.id || null;
        closeScoringMenu();
        showFeedback('Tournament state imported from JSON.', false);
        render();
      } catch (err) {
        showFeedback(err.message || 'Unable to import tournament state JSON.', true);
      } finally {
        importFile.value = '';
      }
    });
  }

  $('reset-btn').addEventListener('click', () => {
    if (!window.confirm('Delete all teams, matches, scores and toss data for this browser?')) return;
    const state = JSON.parse(JSON.stringify(currentState()));
    state.teams = []; state.matches = []; state.activeMatchId = null; state.generated = false; state.auditLog = [];
    Entity.save(state); selectedId = null; closeScoringMenu(); showFeedback('Tournament data reset.', false); render();
  });

  if ($('undo-btn')) $('undo-btn').addEventListener('click', undoLast);
  if ($('log-csv-btn')) $('log-csv-btn').addEventListener('click', () => {
    const blob = new Blob(['\ufeff' + Entity.audit.toCsv(currentState())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'vnc-trials-activity-log.csv';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showFeedback('Activity log exported as CSV.', false);
  });
  if ($('recap-btn')) $('recap-btn').addEventListener('click', () => {
    const state = currentState(), match = getMatch(state, selectedId);
    if (!match || match.status !== 'completed' || !window.EntityRecap) return;
    window.EntityRecap.download(state, match);
    showFeedback('Recap card downloaded as PNG.', false);
  });

  $('match-select').addEventListener('change', (event) => chooseMatch(event.target.value));
  $('open-scoring-btn').addEventListener('click', () => startMatchWorkflow(selectedId));
  $('set-live-btn').addEventListener('click', () => {
    try { setLiveLogged(selectedId); showFeedback('Selected match is now the live match.', false); render(); }
    catch (err) { showFeedback(err.message, true); }
  });

  $('bracket-view').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.match;
    if (button.dataset.action === 'start') startMatchWorkflow(id);
    if (button.dataset.action === 'live') {
      selectedId = id;
      try { setLiveLogged(id); showFeedback('Match set as live.', false); render(); }
      catch (err) { showFeedback(err.message, true); }
    }
  });

  $('scoring-modal').addEventListener('click', (event) => {
    if (event.target === $('scoring-modal')) { closeScoringMenu(); return; }
    const button = event.target.closest('[data-score-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.scoreAction;
    if (action === 'close') closeScoringMenu();
    if (action === 'game') {
      const next = Number(button.dataset.game);
      const state = currentState(); const match = getMatch(state, selectedId);
      const card = scoreEngine.normalizeScorecard(match && match.scorecard);
      if (next === 1 || card.game1.confirmed) { scoringGameNo = next; renderScoringModal(); }
    }
    if (action === 'set') setScoreField(button.dataset.field, button.dataset.value);
    if (action === 'toggle') toggleScoreField(button.dataset.field);
    if (action === 'confirm-game') confirmGame();
    if (action === 'complete') completeMatch();
    if (action === 'undo') undoLast();
  });

  $('scoring-modal').addEventListener('change', (event) => {
    if (event.target.id === 'score-override') {
      const key = `${selectedId}:${scoringGameNo}`;
      if (event.target.checked) overrides.add(key); else overrides.delete(key);
      renderScoringModal();
      return;
    }
    if (event.target.id === 'modal-tie-winner') {
      const value = event.target.value;
      Entity.update((state) => { const match = getMatch(state, selectedId); if (match) { Entity.audit.record(state, `Tiebreak winner → ${value ? Entity.teamName(state, value) : 'none'}`, match.id, { kind: 'tiebreak' }); match.tiebreakWinnerId = value || null; } });
      render();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && scoringOpen) closeScoringMenu();
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && scoringOpen && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) { event.preventDefault(); undoLast(); }
  });

  Entity.subscribe(render);
  render();
  if (openScoringOnLoad) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('openScoring');
    window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
    window.setTimeout(() => openScoringMenu(selectedId), 80);
  }
})();
