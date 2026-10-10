(function () {
  'use strict';
  // Read-only full-screen bracket (stream share / OBS). Never writes tournament state.
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = (v) => { if (v == null) return '—'; const n = Number(v); return Number.isInteger(n) ? String(n) : n.toFixed(1); };
  if (new URLSearchParams(location.search).get('overlay') === '1') document.documentElement.classList.add('overlay-mode');

  function teamRow(state, match, side) {
    const id = side === 'a' ? match.teamAId : match.teamBId;
    const score = side === 'a' ? match.scoreA : match.scoreB;
    const done = match.status === 'completed';
    const cls = ['bs-team'];
    if (!id) cls.push('tbd');
    if (done && id && match.winnerId === id) cls.push('win');
    else if (done && id && match.winnerId) cls.push('lose');
    const label = id ? Entity.teamName(state, id) : 'TBD';
    const showScore = id && (done || match.status === 'in_progress') && score != null;
    return `<div class="${cls.join(' ')}"><span class="n">${esc(label)}</span>${showScore ? `<span class="s">${fmt(score)}</span>` : ''}</div>`;
  }

  function matchCard(state, match, isFinal) {
    const id = esc(match.id);
    if (match.status === 'bye') {
      const id1 = match.teamAId || match.teamBId;
      return `<article class="bs-match bye" data-id="${id}"><div class="bs-team"><span class="n">${esc(id1 ? Entity.teamName(state, id1) : 'TBD')}</span></div><div class="bs-bye">BYE · ADVANCES</div></article>`;
    }
    const cls = ['bs-match'];
    let tag = `MATCH ${match.matchNumber}`;
    if (match.status === 'in_progress') { cls.push('live'); tag = `● LIVE · MATCH ${match.matchNumber}`; }
    else if (match.status === 'completed') { cls.push('done'); if (isFinal) cls.push('final-done'); tag = `FINAL RESULT · M${match.matchNumber}`; }
    return `<article class="${cls.join(' ')}" data-id="${id}"><span class="bs-tag">${tag}</span>${teamRow(state, match, 'a')}${teamRow(state, match, 'b')}</article>`;
  }

  function drawLines(state) {
    const fit = $('bs-fit');
    const svg = fit.querySelector('.bs-lines'); if (!svg) return;
    const base = fit.getBoundingClientRect();
    const scale = base.width / fit.offsetWidth || 1;
    const pos = (el, edge) => {
      const r = el.getBoundingClientRect();
      return { x: ((edge === 'r' ? r.right : r.left) - base.left) / scale, y: (r.top + r.height / 2 - base.top) / scale };
    };
    svg.setAttribute('width', fit.offsetWidth); svg.setAttribute('height', fit.offsetHeight);
    let d = '';
    state.matches.forEach((m) => {
      if (!m.parentMatchId) return;
      const child = fit.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
      const parent = fit.querySelector(`[data-id="${CSS.escape(m.parentMatchId)}"]`);
      if (!child || !parent) return;
      const a = pos(child, 'r'), b = pos(parent, 'l'), mid = (a.x + b.x) / 2;
      const adv = (m.status === 'completed' || m.status === 'bye') && m.winnerId;
      d += `<path class="${adv ? 'adv' : ''}" d="M${a.x},${a.y} H${mid} V${b.y} H${b.x}"/>`;
    });
    svg.innerHTML = d;
  }

  function fitToScreen() {
    const stage = $('bs-stage'), fit = $('bs-fit');
    fit.style.transform = 'none';
    const s = Math.min(1, (stage.clientWidth - 8) / fit.offsetWidth, (stage.clientHeight - 8) / fit.offsetHeight);
    fit.style.transform = `scale(${s})`;
  }

  function render() {
    const state = Entity.load();
    const fit = $('bs-fit');
    const real = state.matches.filter((m) => m.status !== 'bye');
    if (!state.generated || !state.matches.length) {
      fit.innerHTML = '<div class="bs-empty"><h2>BRACKET NOT READY</h2>WAITING FOR THE TOURNAMENT TO BE GENERATED</div>';
      fit.style.transform = 'none';
      $('bs-live').textContent = '—'; $('bs-next').textContent = '—'; $('bs-alive').textContent = '—';
      $('bs-champion').classList.remove('on');
      return;
    }
    const rounds = [...new Set(state.matches.map((m) => m.roundIndex))].sort((a, b) => a - b);
    const lastRound = rounds[rounds.length - 1];
    fit.innerHTML = `<svg class="bs-lines"></svg><div class="bs-rounds">${rounds.map((r) => {
      const items = state.matches.filter((m) => m.roundIndex === r).sort((a, b) => a.matchNumber - b.matchNumber);
      const played = items.filter((m) => m.status === 'completed').length;
      const total = items.filter((m) => m.status !== 'bye').length;
      return `<div class="bs-round"><div class="bs-round-head">${esc(items[0].roundName)}<small>${played} / ${total} COMPLETE</small></div><div class="bs-col">${items.map((m) => matchCard(state, m, r === lastRound)).join('')}</div></div>`;
    }).join('')}</div>`;

    const final = state.matches.find((m) => !m.parentMatchId && m.status === 'completed' && m.winnerId);
    $('bs-champion').classList.toggle('on', Boolean(final));
    if (final) $('bs-champion-name').textContent = Entity.teamName(state, final.winnerId);

    const nm = (m) => `${Entity.teamName(state, m.teamAId)} vs ${Entity.teamName(state, m.teamBId)}`;
    const live = real.find((m) => m.status === 'in_progress' && m.teamAId && m.teamBId);
    const next = real.filter((m) => m.status === 'pending' && m.teamAId && m.teamBId)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.matchNumber - b.matchNumber)[0];
    $('bs-live').textContent = live ? nm(live) : (final ? 'TOURNAMENT COMPLETE' : 'NO MATCH LIVE');
    $('bs-next').textContent = next ? nm(next) : (final ? '—' : 'AWAITING RESULTS');
    const eliminated = real.filter((m) => m.status === 'completed').length;
    $('bs-alive').textContent = `${state.teams.length - eliminated} OF ${state.teams.length}`;

    fitToScreen();
    drawLines(state);
  }

  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };
  Entity.subscribe(schedule);
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  render();
})();
