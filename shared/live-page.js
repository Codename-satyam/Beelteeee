(function () {
  'use strict';
  // Drives live.html and Vision_live.html (the scoreboard overlays). Element ids match both pages.
  // Added here (no page markup needed, works in both overlays):
  //   - labeled point popups ("+1 HOOK", "+1 GENERATOR · 3/5", "+2 HATCH CLOSED")
  //   - a "what they need" line in the team status slot once Game 1 is confirmed
  //   - a progress strip under each card (generators / hooks / kills / escapes) and a GAME 1/2 · MAP chip
  //   - a recap card after the match (?recap=0 turns it off, ?recap=1 keeps it on screen for a finished match)
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const fmt = (v) => { const n = Number(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(1); };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = window.EntityScoring;
  const RECAP_MODE = params.get('recap');            // '0' = off, '1' = hold, anything else = auto
  const RECAP_DELAY_MS = 8600, RECAP_SHOW_MS = 14000; // after the 8 s winner celebration, for 14 s
  let prev = null;
  let celebrationTimer = null, recapTimer = null, recapHideTimer = null;
  let lastView = null;                               // what the strips / chip should show right now

  // Team logos are handled by the inline script in live.html / Vision_live.html.

  function currentMatch(state) {
    const requested = params.get('match');
    if (requested) { const m = state.matches.find((x) => x.id === requested); if (m) return m; }
    return Entity.activeMatch(state);
  }
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  // ---------- injected styles ----------
  (function injectStyles() {
    const st = document.createElement('style'); st.id = 'ov-extras-css';
    st.textContent = `
      .point-popup.labeled { display: flex; flex-direction: column; align-items: center; gap: .06em; animation-fill-mode: both; }
      .point-popup .pp-l { font: 800 clamp(.8rem, 1.9vh, 1.35rem)/1 var(--ov-mono, var(--mono, ui-monospace, monospace)); letter-spacing: .2em; color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.6), 0 0 14px rgba(0,0,0,.75); }
      body .live-team .team-status[data-outlook="clinched"] { color: rgb(95,224,160) !important; }
      body .live-team .team-status[data-outlook="need"], body .live-team .team-status[data-outlook="lead"] { color: #fff !important; }
      body .live-team .team-status[data-outlook="out"], body .live-team .team-status[data-outlook="tie"] { color: #8b8b99 !important; }
      #ov-extras { position: fixed; z-index: 35; pointer-events: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; column-gap: clamp(8px, 1vw, 16px); opacity: 0; transition: opacity .4s ease; }
      #ov-extras.on { opacity: 1; }
      .ovx-strip { display: grid; gap: clamp(3px, .5vh, 6px); padding: clamp(6px, .9vh, 10px) clamp(8px, 1vw, 14px); background: rgba(7,8,12,.88); border-top: 2px solid rgb(var(--sc, 164,165,182)); max-width: 100%; box-sizing: border-box; }
      .ovx-strip[data-slot="R"] { justify-self: end; } .ovx-strip[data-slot="L"] { justify-self: start; }
      .ovx-strip[data-role="killer"] { --sc: var(--ov-killer, 255,70,85); } .ovx-strip[data-role="survivor"] { --sc: var(--ov-survivor, 61,242,192); }
      .ovx-strip:empty { display: none; }
      .ovx-row { display: flex; align-items: center; gap: clamp(6px, .7vw, 10px); }
      .ovx-row small { min-width: 4.2em; font: 800 clamp(.5rem, .62vw, .66rem)/1 var(--ov-mono, var(--mono, ui-monospace, monospace)); letter-spacing: .16em; color: rgb(var(--ov-dim, 164,165,182)); }
      .ovx-pips { display: flex; gap: clamp(2px, .3vw, 4px); }
      .ovx-pip { width: clamp(8px, 1vw, 15px); height: clamp(7px, .9vh, 11px); background: rgba(255,255,255,.09); transform: skewX(-18deg); transition: background .3s ease, box-shadow .3s ease; }
      .ovx-pip.on { background: rgb(var(--sc)); box-shadow: 0 0 8px rgba(var(--sc), .7); }
      .ovx-pip.new { animation: ovx-pip .8s cubic-bezier(.2,1.4,.4,1); }
      @keyframes ovx-pip { 0% { transform: skewX(-18deg) scale(2.1); filter: brightness(2.4); } 100% { transform: skewX(-18deg) scale(1); filter: none; } }
      .ovx-chip { align-self: start; padding: clamp(5px, .8vh, 9px) clamp(12px, 1.3vw, 22px); background: rgba(7,8,12,.9); border: 1px solid rgba(255,255,255,.16); font: 800 clamp(.56rem, .78vw, .86rem)/1 var(--ov-mono, var(--mono, ui-monospace, monospace)); letter-spacing: .18em; color: #e9e9f0; white-space: nowrap; max-width: 38vw; overflow: hidden; text-overflow: ellipsis; }
      .ovx-chip b { color: rgb(var(--ov-gold, 244,201,93)); font-weight: 800; }
      #ov-recap { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center; pointer-events: none; background: radial-gradient(ellipse at center, rgba(0,0,0,.5), rgba(0,0,0,.82)); }
      #ov-recap.on { display: flex; animation: ovr-in .6s cubic-bezier(.2,.9,.25,1) both; }
      #ov-recap canvas { width: min(88vw, calc(88vh * 16 / 9)); height: auto; box-shadow: 0 0 80px rgba(0,0,0,.8); }
      @keyframes ovr-in { from { opacity: 0; scale: .94; } to { opacity: 1; scale: 1; } }
      @media (prefers-reduced-motion: reduce) { .ovx-pip.new, #ov-recap.on { animation: none; } }
    `;
    document.head.appendChild(st);
  })();

  // ---------- labeled popups ----------
  function popup(side, amount, label, index) {
    const host = $('score-popups-' + side);
    if (!host || !(amount > 0)) return;
    const el = document.createElement('div');
    el.className = 'point-popup' + (label ? ' labeled' : '');
    el.innerHTML = `<span class="pp-n">+${fmt(amount)}</span>${label ? `<span class="pp-l">${esc(label)}</span>` : ''}`;
    if (index) { el.style.marginTop = (index * 9) + 'vh'; el.style.animationDelay = (index * 0.22) + 's'; el.style.animationFillMode = 'both'; }
    host.appendChild(el);
    window.setTimeout(() => el.remove(), 2700 + (index || 0) * 220);
  }

  // What each team gained in one game, split by scorecard action. Only gains get a popup.
  function gameGains(before, after) {
    const killer = [], survivor = [];
    const dGen = after.generators - before.generators;
    if (after.generatorsSelected && dGen > 0) survivor.push({ pts: dGen, label: dGen === 1 && before.generatorsSelected ? `GENERATOR · ${after.generators}/5` : `${after.generators} GENERATORS DONE` });
    const dEsc = after.escapePoints - before.escapePoints;
    if (dEsc > 0) survivor.push({ pts: dEsc, label: after.hatchEscapes > before.hatchEscapes ? 'HATCH ESCAPE' : (dEsc > 1 ? 'ESCAPES' : 'ESCAPE') });
    const dUn = after.unhooks - before.unhooks;
    if (dUn > 0) survivor.push({ pts: dUn, label: dUn > 1 ? 'UNHOOKS' : 'UNHOOK' });
    const dLeft = after.remainingGenerators - before.remainingGenerators;
    if (dLeft > 0) killer.push({ pts: dLeft, label: dLeft > 1 ? 'GENS LEFT' : 'GEN LEFT' });
    const dKill = after.kills - before.kills;
    if (dKill > 0) killer.push({ pts: dKill, label: dKill > 1 ? 'KILLS' : 'KILL' });
    const dHook = after.hooks - before.hooks;
    if (dHook > 0) killer.push({ pts: dHook, label: dHook > 1 ? 'HOOKS' : 'HOOK' });
    const dHatch = after.hatchClosedPoints - before.hatchClosedPoints;
    if (dHatch > 0) killer.push({ pts: dHatch, label: 'HATCH CLOSED' });
    return { killer, survivor };
  }

  function labeledPopups(match, an, a, b) {
    const gains = { a: [], b: [] };
    [1, 2].forEach((n) => {
      const before = prev.bd[n], after = an.games[n].breakdown;
      const g = gameGains(before, after), roles = an.roles[n];
      const killerSide = roles.killerId === match.teamAId ? 'a' : 'b', survivorSide = killerSide === 'a' ? 'b' : 'a';
      g.killer.forEach((x) => gains[killerSide].push(x));
      g.survivor.forEach((x) => gains[survivorSide].push(x));
    });
    [['a', a - prev.a], ['b', b - prev.b]].forEach(([side, total]) => {
      if (!(total > 0)) return;
      const items = gains[side].slice();
      const labeled = items.reduce((sum, x) => sum + x.pts, 0);
      if (total - labeled > 0) items.push({ pts: total - labeled, label: '' });   // anything we could not label stays a plain +N
      items.forEach((x, i) => popup(side, x.pts, x.label, i));
    });
  }

  // ---------- analysis shared by popups / needs line / strips ----------
  function analyse(match) {
    const roles = { 1: Entity.rolesFor(match, 1), 2: Entity.rolesFor(match, 2) };
    const k1 = roles[1].killerId === match.teamAId;
    const res = S.calculateMatch(match.scorecard, k1);
    return { roles, res, k1, outlook: S.matchOutlook(match.scorecard, k1), games: { 1: res.game1, 2: res.game2 } };
  }

  // ---------- progress strips + game/map chip ----------
  function ensureExtras() {
    let box = $('ov-extras');
    if (box) return box;
    box = document.createElement('div'); box.id = 'ov-extras'; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="ovx-strip" data-slot="L"></div><div class="ovx-chip" id="ovx-chip"></div><div class="ovx-strip" data-slot="R"></div>';
    (document.querySelector('.live-shell') || document.body).appendChild(box);
    return box;
  }
  const pips = (n, total) => `<span class="ovx-pips" data-n="${n}">${Array.from({ length: total }, (_, i) => `<i class="ovx-pip${i < n ? ' on' : ''}"></i>`).join('')}</span>`;
  const row = (label, n, total) => `<div class="ovx-row" data-key="${label}"><small>${label}</small>${pips(n, total)}</div>`;
  function stripHtml(role, b) {
    if (role === 'killer') return row('HOOKS', b.hooks, 8) + row('KILLS', b.kills, 4);
    return row('GENS', b.generators, 5) + row('OUT', b.exitEscapes + b.hatchEscapes, 4);
  }

  function placeExtras() {
    const box = $('ov-extras');
    if (!box) return;
    const pa = $('team-a-panel'), pb = $('team-b-panel');
    if (!lastView || !pa || !pb) { box.classList.remove('on'); return; }
    const ra = pa.getBoundingClientRect(), rb = pb.getBoundingClientRect();
    if (ra.width < 20 || rb.width < 20) { box.classList.remove('on'); return; }
    const left = Math.min(ra.left, rb.left), right = Math.max(ra.right, rb.right), bottom = Math.max(ra.bottom, rb.bottom);
    box.style.left = left + 'px'; box.style.width = (right - left) + 'px'; box.style.top = (bottom + 8) + 'px';
    const leftIsA = ra.left <= rb.left;
    const slots = { L: box.querySelector('[data-slot="L"]'), R: box.querySelector('[data-slot="R"]') };
    const fill = (slot, view) => {
      const key = view.role + '|' + view.html;
      if (slot.dataset.key === key) return;
      // flag the pips that just lit up so they pop
      const oldRows = {};
      slot.querySelectorAll('.ovx-row').forEach((r) => { const p = r.querySelector('.ovx-pips'); oldRows[r.dataset.key] = p ? Number(p.dataset.n) : 0; });
      const sameRole = slot.dataset.role === view.role;
      slot.dataset.key = key; slot.dataset.role = view.role; slot.innerHTML = view.html;
      if (!sameRole) return;
      slot.querySelectorAll('.ovx-row').forEach((r) => {
        const was = oldRows[r.dataset.key]; if (was === undefined) return;
        r.querySelectorAll('.ovx-pip.on').forEach((p, i) => { if (i >= was) p.classList.add('new'); });
      });
    };
    fill(leftIsA ? slots.L : slots.R, lastView.a); fill(leftIsA ? slots.R : slots.L, lastView.b);
    $('ovx-chip').innerHTML = lastView.chip;
    box.classList.add('on');
  }

  // ---------- recap card ----------
  function ensureRecap() {
    let box = $('ov-recap');
    if (!box) { box = document.createElement('div'); box.id = 'ov-recap'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
    return box;
  }
  function showRecap(state, match, holdMs) {
    if (RECAP_MODE === '0' || !window.EntityRecap) return;
    const box = ensureRecap();
    box.innerHTML = ''; box.appendChild(window.EntityRecap.draw(state, match));
    box.classList.add('on');
    window.clearTimeout(recapHideTimer);
    if (holdMs) recapHideTimer = window.setTimeout(hideRecap, holdMs);
  }
  function hideRecap() { const box = $('ov-recap'); if (box) box.classList.remove('on'); window.clearTimeout(recapHideTimer); }

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
    ['team-a-status', 'team-b-status'].forEach((id) => { const el = $(id); if (el) el.dataset.outlook = ''; });
    set('selected-map', 'NOT SELECTED');
    set('winner-detail', 'WINNER · PENDING'); set('toss-winner-name', 'Awaiting toss');
    lastView = null; placeExtras();
    window.clearTimeout(recapTimer); hideRecap();
    prev = null;
  }

  function render() {
    const state = Entity.load();
    const match = currentMatch(state);
    if (!match || !match.teamAId || !match.teamBId) { renderEmpty(state); return; }

    const nameA = Entity.teamName(state, match.teamAId);
    const nameB = Entity.teamName(state, match.teamBId);
    const live = match.status === 'in_progress';
    const an = analyse(match);
    set('round-label', match.roundName);
    set('match-state', live ? 'LIVE NOW' : match.status === 'completed' ? 'MATCH COMPLETE' : 'UP NEXT');
    set('match-number', 'MATCH ' + String(match.matchNumber).padStart(2, '0'));
    set('team-a-name', nameA); set('team-b-name', nameB);

    const a = match.scoreA == null ? 0 : match.scoreA;
    const b = match.scoreB == null ? 0 : match.scoreB;
    set('team-a-score', fmt(a)); set('team-b-score', fmt(b));

    // Status slot: "what they need" once Game 1 is confirmed, otherwise the usual text.
    const outlook = live && an.outlook.applicable ? an.outlook : null;
    const statusFor = (id, side) => {
      if (match.winnerId === id) return { text: 'MATCH WINNER', state: '' };
      if (outlook) return { text: outlook[side].text, state: outlook[side].state };
      return { text: live ? 'COMPETING' : 'READY', state: '' };
    };
    [['team-a-status', match.teamAId, 'a'], ['team-b-status', match.teamBId, 'b']].forEach(([el, id, side]) => {
      const st = statusFor(id, side); set(el, st.text); const node = $(el); if (node) node.dataset.outlook = st.state;
    });

    // Toss banner
    const tossWinner = match.toss && match.toss.winnerId;
    set('toss-winner-name', tossWinner ? Entity.teamName(state, tossWinner) : 'Awaiting toss');
    const banner = $('toss-banner'); if (banner) banner.style.visibility = tossWinner ? 'visible' : 'hidden';

    // Map-only pre-match information. No Killer voting or pick display.
    const mapName = (match.mapVeto && match.mapVeto.finalMap) || '';
    set('selected-map', (mapName || 'NOT SELECTED').toUpperCase());
    set('winner-detail', match.winnerId ? 'WINNER · ' + Entity.teamName(state, match.winnerId).toUpperCase() : 'WINNER · PENDING');

    // Progress strips + GAME n/2 · MAP chip (visible while the match is live or finished)
    ensureExtras();
    const gameNo = an.res.game1Confirmed ? 2 : 1;
    if (live || match.status === 'completed') {
      const view = (id) => {
        const role = an.roles[gameNo].killerId === id ? 'killer' : 'survivor';
        return { role, html: stripHtml(role, an.games[gameNo].breakdown) };
      };
      lastView = { a: view(match.teamAId), b: view(match.teamBId), chip: `GAME <b>${gameNo}/2</b>${mapName ? ' · ' + esc(mapName.toUpperCase()) : ''}` };
    } else lastView = null;
    placeExtras();

    // Point popups + winner celebration + recap (only for changes on the same match we were already showing)
    const bd = { 1: an.games[1].breakdown, 2: an.games[2].breakdown };
    if (prev && prev.id === match.id) {
      labeledPopups(match, an, a, b);
      if (prev.status !== 'completed' && match.status === 'completed' && match.winnerId) {
        celebrate(Entity.teamName(state, match.winnerId));
        window.clearTimeout(recapTimer);
        if (RECAP_MODE !== '1') recapTimer = window.setTimeout(() => showRecap(Entity.load(), match, RECAP_SHOW_MS), RECAP_DELAY_MS);
      }
      if (prev.status === 'completed' && match.status !== 'completed') { window.clearTimeout(recapTimer); hideRecap(); }
    } else {
      window.clearTimeout(recapTimer); if (RECAP_MODE !== '1') hideRecap();
    }
    if (RECAP_MODE === '1') { if (match.status === 'completed') showRecap(state, match, 0); else hideRecap(); }
    prev = { id: match.id, a, b, status: match.status, bd };
  }

  Entity.subscribe(render);
  window.addEventListener('resize', placeExtras);
  window.setInterval(placeExtras, 500);   // cards animate in and swap sides; keep the strips lined up under them
  render();

  // ?preview=recap shows the recap for the latest finished match (handy for testing your OBS scene)
  if (params.get('preview') === 'recap') {
    window.setTimeout(() => {
      const state = Entity.load();
      const done = state.matches.slice().reverse().find((m) => m.status === 'completed' && m.teamAId && m.teamBId);
      if (done) showRecap(state, done, RECAP_SHOW_MS);
    }, 600);
  }
})();
