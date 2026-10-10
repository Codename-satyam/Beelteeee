(function () {
  'use strict';
  // Drives live.html (the scoreboard overlay). Element ids match live.html exactly.
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const fmt = (v) => { const n = Number(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(1); };
  let prev = null;
  let celebrationTimer = null;

  function currentMatch(state) {
    const requested = params.get('match');
    if (requested) { const m = state.matches.find((x) => x.id === requested); if (m) return m; }
    return Entity.activeMatch(state);
  }
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  function popup(side, amount) {
    const host = $('score-popups-' + side);
    if (!host || !(amount > 0)) return;
    const el = document.createElement('div');
    el.className = 'point-popup';
    el.textContent = '+' + fmt(amount);
    host.appendChild(el);
    window.setTimeout(() => el.remove(), 2600);
  }

  function celebrate(name) {
    const box = $('win-celebration'); if (!box) return;
    set('celebration-winner', String(name).toUpperCase());
    const particles = $('win-particles');
    if (particles) {
      particles.innerHTML = '';
      for (let i = 0; i < 36; i++) {
        const p = document.createElement('i');
        p.style.left = (Math.random() * 100) + '%';
        p.style.animationDelay = (Math.random() * 1.4) + 's';
        p.style.animationDuration = (2.2 + Math.random() * 2) + 's';
        particles.appendChild(p);
      }
    }
    box.hidden = false;
    window.clearTimeout(celebrationTimer);
    celebrationTimer = window.setTimeout(() => { box.hidden = true; }, 8000);
  }

  function renderEmpty(state) {
    set('round-label', 'AWAITING MATCH'); set('match-state', 'NOT STARTED'); set('match-number', 'MATCH —');
    set('team-a-name', state.teams.length ? 'Match not selected' : 'Waiting for teams');
    set('team-b-name', state.teams.length ? 'Match not selected' : 'Waiting for teams');
    set('team-a-score', '—'); set('team-b-score', '—');
    set('team-a-status', 'No active match'); set('team-b-status', 'No active match');
    set('selected-map', 'NOT SELECTED');
    set('winner-detail', 'WINNER · PENDING'); set('toss-winner-name', 'Awaiting toss');
    prev = null;
  }

  function render() {
    const state = Entity.load();
    const match = currentMatch(state);
    if (!match || !match.teamAId || !match.teamBId) { renderEmpty(state); return; }

    const nameA = Entity.teamName(state, match.teamAId);
    const nameB = Entity.teamName(state, match.teamBId);
    const live = match.status === 'in_progress';
    set('round-label', match.roundName);
    set('match-state', live ? 'LIVE NOW' : match.status === 'completed' ? 'MATCH COMPLETE' : 'UP NEXT');
    set('match-number', 'MATCH ' + String(match.matchNumber).padStart(2, '0'));
    set('team-a-name', nameA); set('team-b-name', nameB);
    const a = match.scoreA == null ? 0 : match.scoreA;
    const b = match.scoreB == null ? 0 : match.scoreB;
    set('team-a-score', fmt(a)); set('team-b-score', fmt(b));
    set('team-a-status', match.winnerId === match.teamAId ? 'MATCH WINNER' : live ? 'COMPETING' : 'READY');
    set('team-b-status', match.winnerId === match.teamBId ? 'MATCH WINNER' : live ? 'COMPETING' : 'READY');

    // Toss banner
    const tossWinner = match.toss && match.toss.winnerId;
    set('toss-winner-name', tossWinner ? Entity.teamName(state, tossWinner) : 'Awaiting toss');
    const banner = $('toss-banner'); if (banner) banner.style.visibility = tossWinner ? 'visible' : 'hidden';

    // Map-only pre-match information. No Killer voting or pick display.
    set('selected-map', ((match.mapVeto && match.mapVeto.finalMap) || 'NOT SELECTED').toUpperCase());
    set('winner-detail', match.winnerId ? 'WINNER · ' + Entity.teamName(state, match.winnerId).toUpperCase() : 'WINNER · PENDING');

    // Point popups + winner celebration (only for changes on the same match we were already showing)
    if (prev && prev.id === match.id) {
      popup('a', a - prev.a); popup('b', b - prev.b);
      if (prev.status !== 'completed' && match.status === 'completed' && match.winnerId) celebrate(Entity.teamName(state, match.winnerId));
    }
    prev = { id: match.id, a, b, status: match.status };
  }

  Entity.subscribe(render);
  render();
})();
