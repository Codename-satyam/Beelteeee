(function () {
  'use strict';
  // UPDATED POINT SYSTEM
  // Survivor (max 18): generators (1 each, max 5) + escapes (exit gate 1 / hatch 2, combined max 5) + successful unhooks (1 each, max 8)
  // Killer   (max 19): remaining generators (max 5) + kills (max 4) + hooks (1 each, max 8) + hatch closed (2)
  const MAX_GENERATORS = 5;
  const MAX_ESCAPE_POINTS = 5;
  const MAX_UNHOOKS = 8;
  const MAX_KILLS = 4;
  const MAX_HOOKS = 8;
  const MAX_SURVIVORS = 4;
  const MAX_HATCH_ESCAPES = 1; // the hatch only opens for the last survivor
  const HATCH_CLOSED_POINTS = 2;
  const EXIT_ESCAPE_POINTS = 1;
  const HATCH_ESCAPE_POINTS = 2;
  const MAX_SURVIVOR_SCORE = 18;
  const MAX_KILLER_SCORE = 19;

  function blankGame() {
    return { started: false, generatorsCompleted: null, exitEscapes: 0, hatchEscapes: 0, unhooks: 0, kills: 0, hooks: 0, hatchClosed: false, confirmed: false };
  }
  function normalizeGame(value) { return { ...blankGame(), ...(value || {}) }; }
  function blankScorecard() { return { game1: blankGame(), game2: blankGame() }; }
  function normalizeScorecard(value) {
    const card = value || {};
    return { game1: normalizeGame(card.game1), game2: normalizeGame(card.game2) };
  }

  function clampInt(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function calculateGame(value) {
    const game = normalizeGame(value);
    const generatorsSelected = game.generatorsCompleted != null;
    const generators = generatorsSelected ? clampInt(game.generatorsCompleted, 0, MAX_GENERATORS) : 0;
    const hatchEscapes = clampInt(game.hatchEscapes, 0, MAX_HATCH_ESCAPES);
    // Only four survivors can escape in total; hatch escapes take priority.
    const exitEscapes = Math.min(clampInt(game.exitEscapes, 0, MAX_SURVIVORS), MAX_SURVIVORS - hatchEscapes);
    const escapePoints = Math.min(MAX_ESCAPE_POINTS, exitEscapes * EXIT_ESCAPE_POINTS + hatchEscapes * HATCH_ESCAPE_POINTS);
    const unhooks = clampInt(game.unhooks, 0, MAX_UNHOOKS);
    const remainingGenerators = generatorsSelected ? MAX_GENERATORS - generators : 0;
    const kills = clampInt(game.kills, 0, MAX_KILLS);
    const hooks = clampInt(game.hooks, 0, MAX_HOOKS);
    const hatchClosedPoints = game.hatchClosed ? HATCH_CLOSED_POINTS : 0;

    const survivor = game.started ? generators + escapePoints + unhooks : 0;
    const killer = game.started ? remainingGenerators + kills + hooks + hatchClosedPoints : 0;

    return {
      survivorScore: survivor,
      killerScore: killer,
      breakdown: { generatorsSelected, generators, exitEscapes, hatchEscapes, escapePoints, unhooks, remainingGenerators, kills, hooks, hatchClosed: Boolean(game.hatchClosed), hatchClosedPoints },
      started: game.started,
      confirmed: game.confirmed,
      valid: generatorsSelected
    };
  }


  // ---------- Sanity checks ----------
  // Returns a list of { code, message } for entries that are possible to type but unlikely to be true.
  // These are warnings only: the scoring modal lets the admin override them.
  function validateGame(value) {
    const g = normalizeGame(value);
    const warnings = [];
    if (!g.started) return warnings;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const kills = num(g.kills), exits = num(g.exitEscapes), hatch = num(g.hatchEscapes);
    const hooks = num(g.hooks), unhooks = num(g.unhooks);
    const out = kills + exits + hatch;
    const gens = g.generatorsCompleted == null ? null : num(g.generatorsCompleted);
    const warn = (code, message) => warnings.push({ code, message });

    if (out > MAX_SURVIVORS) warn('survivors-over', `Kills + escapes add up to ${out}, but a game only has ${MAX_SURVIVORS} survivors.`);
    if (hatch > 0 && kills + exits < MAX_SURVIVORS - 1) warn('hatch-early', `A hatch escape needs the other 3 survivors already out (kills + gate escapes = 3). Right now that is ${kills + exits}.`);
    if (g.hatchClosed && out < MAX_SURVIVORS - 1) warn('hatch-closed-early', `The hatch only opens with one survivor left, so at least 3 should be out before it can be closed. Right now ${out} are.`);
    if (g.hatchClosed && hatch > 0) warn('hatch-both', 'Hatch closed and a hatch escape are both set. Your rules keep the closing points, but double-check that is what happened.');
    if (unhooks > hooks) warn('unhooks-over', `${unhooks} unhooks entered but only ${hooks} hooks, so more unhooks than hooks.`);
    if (kills > hooks) warn('kills-need-hooks', `${kills} kills entered with only ${hooks} hooks. A kill normally needs at least one hook.`);
    if (exits > 0 && gens != null && gens < MAX_GENERATORS) warn('gate-needs-gens', `Gate escapes are entered, but only ${gens} of ${MAX_GENERATORS} generators are done, so the exit gates would not be powered.`);
    return warnings;
  }

  // ---------- "What they need" line ----------
  // After Game 1 is confirmed, work out for each team: CLINCHED, OUT OF REACH, or what they still need.
  // Uses the role caps (Survivor 18 / Killer 19) for the points a team can still add in Game 2.
  function matchOutlook(scorecardValue, game1KillerIsA) {
    const r = calculateMatch(scorecardValue, game1KillerIsA);
    if (!r.game1Confirmed || r.bothConfirmed) return { applicable: false };
    const aKillsFirst = game1KillerIsA !== false;
    const g2 = r.game2;
    const g2Started = Boolean(r.scorecard.game2.started);
    // Game 2 swaps roles: if A was Killer in Game 1, A is Survivor in Game 2.
    const capA = aKillsFirst ? MAX_SURVIVOR_SCORE : MAX_KILLER_SCORE;
    const capB = aKillsFirst ? MAX_KILLER_SCORE : MAX_SURVIVOR_SCORE;
    const g2A = aKillsFirst ? g2.survivorScore : g2.killerScore;
    const g2B = aKillsFirst ? g2.killerScore : g2.survivorScore;
    const leftA = Math.max(0, capA - g2A), leftB = Math.max(0, capB - g2B);
    const side = (me, opp, myLeft, oppLeft) => {
      if (me - opp > oppLeft) return { state: 'clinched', text: 'CLINCHED' };
      if (me + myLeft < opp) return { state: 'out', text: 'OUT OF REACH' };
      if (me < opp) {
        const need = opp - me + 1;
        if (need > myLeft) return { state: 'tie', text: 'TIE AT BEST' };
        return { state: 'need', need, text: g2Started ? `NEEDS ${need}+ TO LEAD` : `NEEDS ${need}+ IN GAME 2` };
      }
      if (me > opp) return { state: 'lead', lead: me - opp, text: `LEADS BY ${me - opp}` };
      return { state: 'tied', text: 'TIED' };
    };
    return { applicable: true, a: side(r.teamA, r.teamB, leftA, leftB), b: side(r.teamB, r.teamA, leftB, leftA) };
  }

  function calculateMatch(scorecardValue, game1KillerIsA) {
    // game1KillerIsA: true (default / legacy) = Team A is Killer in Game 1; false = Team B is Killer in Game 1.
    const aKillsFirst = game1KillerIsA !== false;
    const scorecard = normalizeScorecard(scorecardValue);
    const game1 = calculateGame(scorecard.game1); // Game 1: the toss winner's chosen side
    const game2 = calculateGame(scorecard.game2); // Game 2: roles swapped
    return {
      scorecard, game1, game2,
      teamA: aKillsFirst ? game1.killerScore + game2.survivorScore : game1.survivorScore + game2.killerScore,
      teamB: aKillsFirst ? game1.survivorScore + game2.killerScore : game1.killerScore + game2.survivorScore,
      bothConfirmed: scorecard.game1.confirmed && scorecard.game2.confirmed,
      game1Confirmed: scorecard.game1.confirmed,
      game2Confirmed: scorecard.game2.confirmed
    };
  }

  window.EntityScoring = { MAX_GENERATORS, MAX_ESCAPE_POINTS, MAX_UNHOOKS, MAX_KILLS, MAX_HOOKS, MAX_SURVIVOR_SCORE, MAX_KILLER_SCORE, HATCH_CLOSED_POINTS, blankGame, blankScorecard, normalizeGame, normalizeScorecard, calculateGame, calculateMatch, validateGame, matchOutlook, MAX_SURVIVORS };
})();
