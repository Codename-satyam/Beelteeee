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

  function calculateMatch(scorecardValue) {
    const scorecard = normalizeScorecard(scorecardValue);
    const game1 = calculateGame(scorecard.game1); // Team A = Killer, Team B = Survivor
    const game2 = calculateGame(scorecard.game2); // Team B = Killer, Team A = Survivor
    return {
      scorecard, game1, game2,
      teamA: game1.killerScore + game2.survivorScore,
      teamB: game1.survivorScore + game2.killerScore,
      bothConfirmed: scorecard.game1.confirmed && scorecard.game2.confirmed,
      game1Confirmed: scorecard.game1.confirmed,
      game2Confirmed: scorecard.game2.confirmed
    };
  }

  window.EntityScoring = { MAX_GENERATORS, MAX_ESCAPE_POINTS, MAX_UNHOOKS, MAX_KILLS, MAX_HOOKS, MAX_SURVIVOR_SCORE, MAX_KILLER_SCORE, HATCH_CLOSED_POINTS, blankGame, blankScorecard, normalizeGame, normalizeScorecard, calculateGame, calculateMatch };
})();
