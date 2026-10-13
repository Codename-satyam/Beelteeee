(function () {
  'use strict';
  // Match recap card. Drawn straight onto a canvas so the SAME picture is used for the stream overlay
  // (live-page.js shows it for a few seconds after a match) and for the "Recap card PNG" download.
  const W = 1600, H = 900;
  const pl = (n, word) => `${n} ${word}${n === 1 ? '' : 'S'}`;
  const fmt = (v) => { const n = Number(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(1); };

  function fonts() {
    const cs = getComputedStyle(document.documentElement);
    return {
      disp: (cs.getPropertyValue('--display') || '').trim() || '"Bebas Neue", Oswald, Impact, "Arial Narrow", sans-serif',
      mono: (cs.getPropertyValue('--mono') || '').trim() || 'ui-monospace, Menlo, Consolas, monospace'
    };
  }

  function summarize(state, match) {
    const S = window.EntityScoring, E = window.Entity;
    const k1 = E.rolesFor(match, 1).killerId === match.teamAId;
    const res = S.calculateMatch(match.scorecard, k1);
    const games = [1, 2].map((n) => {
      const roles = E.rolesFor(match, n), g = n === 1 ? res.game1 : res.game2, b = g.breakdown;
      const escapes = b.exitEscapes + b.hatchEscapes;
      return {
        n, confirmed: g.confirmed,
        killerName: E.teamName(state, roles.killerId), survivorName: E.teamName(state, roles.survivorId),
        killerScore: g.killerScore, survivorScore: g.survivorScore,
        killerParts: [`${pl(b.remainingGenerators, 'GEN')} LEFT`, pl(b.kills, 'KILL'), pl(b.hooks, 'HOOK')].concat(b.hatchClosed ? ['HATCH CLOSED +2'] : []),
        survivorParts: [pl(b.generators, 'GEN'), pl(escapes, 'ESCAPE') + (b.hatchEscapes ? ' (HATCH)' : ''), pl(b.unhooks, 'UNHOOK')]
      };
    });
    const tie = res.teamA === res.teamB;
    return {
      nameA: E.teamName(state, match.teamAId), nameB: E.teamName(state, match.teamBId),
      scoreA: res.teamA, scoreB: res.teamB, tie,
      winnerId: match.winnerId, winnerName: match.winnerId ? E.teamName(state, match.winnerId) : '',
      winnerIsA: match.winnerId === match.teamAId, winnerIsB: match.winnerId === match.teamBId,
      map: (match.mapVeto && match.mapVeto.finalMap) || '', round: match.roundName || '', number: match.matchNumber, games
    };
  }

  function draw(state, match) {
    const d = summarize(state, match), f = fonts();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const spacing = (px) => { if ('letterSpacing' in x) x.letterSpacing = px + 'px'; };
    const text = (str, px, py, font, color, align) => { x.font = font; x.fillStyle = color; x.textAlign = align || 'left'; x.textBaseline = 'alphabetic'; x.fillText(str, px, py); };
    const fit = (str, size, weight, maxW) => { let s = size; do { x.font = `${weight} ${s}px ${f.disp}`; if (x.measureText(str).width <= maxW || s <= 18) break; s -= 2; } while (true); return s; };
    const box = (px, py, w, h, fill, stroke) => { x.fillStyle = fill; x.fillRect(px, py, w, h); if (stroke) { x.strokeStyle = stroke; x.lineWidth = 2; x.strokeRect(px + 1, py + 1, w - 2, h - 2); } };

    // background + frame
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#171822'); bg.addColorStop(1, '#07080c');
    box(0, 0, W, H, bg, '#2a2b36');
    const glow = x.createRadialGradient(W / 2, 0, 40, W / 2, 0, 760); glow.addColorStop(0, 'rgba(225,29,46,.30)'); glow.addColorStop(1, 'rgba(225,29,46,0)');
    box(0, 0, W, H, glow);
    const bar = x.createLinearGradient(0, 0, W, 0); bar.addColorStop(0, 'transparent'); bar.addColorStop(.25, '#e11d2e'); bar.addColorStop(.5, '#ffffff'); bar.addColorStop(.75, '#e11d2e'); bar.addColorStop(1, 'transparent');
    box(0, 0, W, 6, bar);

    // header
    spacing(8); text('THE VNC TRIALS', 64, 72, `800 24px ${f.mono}`, '#ff4655');
    spacing(4); text(`${d.round}  ·  MATCH ${String(d.number).padStart(2, '0')}`, 64, 106, `700 20px ${f.mono}`, '#8b8b99');
    if (d.map) { spacing(6); text(`MAP · ${d.map.toUpperCase()}`, W - 64, 72, `800 24px ${f.mono}`, '#e9e9f0', 'right'); }

    // winner
    spacing(14); text(d.tie && d.winnerName ? 'WINNER · TIEBREAK' : 'MATCH WINNER', W / 2, 176, `800 26px ${f.mono}`, '#f4c95d', 'center');
    spacing(3);
    const wn = (d.winnerName || 'MATCH IN PROGRESS').toUpperCase();
    const ws = fit(wn, 124, 900, 1300); text(wn, W / 2, 176 + ws * .86, `900 ${ws}px ${f.disp}`, '#ffffff', 'center');

    // scores
    const cols = [{ cx: W * .25, name: d.nameA, score: d.scoreA, win: d.winnerIsA }, { cx: W * .75, name: d.nameB, score: d.scoreB, win: d.winnerIsB }];
    spacing(2);
    cols.forEach((col) => {
      const nm = col.name.toUpperCase(), ns = fit(nm, 54, 800, 620);
      text(nm, col.cx, 372, `800 ${ns}px ${f.disp}`, col.win ? '#ffffff' : '#a4a5b6', 'center');
      text(fmt(col.score), col.cx, 500, `900 150px ${f.disp}`, col.win ? '#5fe0a0' : '#c6c6d0', 'center');
    });
    spacing(10); text('VS', W / 2, 462, `800 34px ${f.mono}`, '#5d5d6a', 'center');

    // per-game panels
    const pw = 720, ph = 340, py = 524;
    d.games.forEach((g, i) => {
      const px = i === 0 ? 60 : W - 60 - pw;
      box(px, py, pw, ph, 'rgba(255,255,255,.035)', '#2b2b35');
      spacing(6); text(`GAME ${g.n}`, px + 28, py + 50, `800 30px ${f.disp}`, '#ffffff');
      if (!g.confirmed) { spacing(4); text('NOT CONFIRMED', px + pw - 28, py + 48, `700 16px ${f.mono}`, '#8b8b99', 'right'); }
      const row = (ry, role, color, name, score, parts) => {
        box(px + 28, ry, 4, 100, color);
        spacing(5); text(role, px + 48, ry + 20, `800 16px ${f.mono}`, color);
        spacing(1.5); const nm = name.toUpperCase(), ns = fit(nm, 42, 800, 430);
        text(nm, px + 48, ry + 62, `800 ${ns}px ${f.disp}`, '#ffffff');
        spacing(1); text(parts.join('  ·  '), px + 48, ry + 94, `600 16px ${f.mono}`, '#a4a5b6');
        spacing(0); text(fmt(score), px + pw - 28, ry + 70, `900 72px ${f.disp}`, color, 'right');
      };
      row(py + 74, 'KILLER', '#ff4655', g.killerName, g.killerScore, g.killerParts);
      row(py + 194, 'SURVIVOR', '#3df2c0', g.survivorName, g.survivorScore, g.survivorParts);
    });

    spacing(10); text('THE ENTITY HAS CHOSEN', W / 2, 888, `700 15px ${f.mono}`, '#5d5d6a', 'center');
    spacing(0);
    return c;
  }

  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function download(state, match) {
    const d = summarize(state, match), canvas = draw(state, match);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `vnc-recap-${slug(d.nameA)}-vs-${slug(d.nameB)}.png`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, 'image/png');
  }

  window.EntityRecap = { draw, download, summarize, WIDTH: W, HEIGHT: H };
})();
