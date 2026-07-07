'use strict';
// Property-based tests: universally-quantified properties checked over
// many seeded random states. Each holds for ANY correct solver, so they
// catch regressions without hard-coding expected outputs.

const T = require('./harness.js');
const H = require('./helpers.js');
const suite = T.suite, test = T.test, assert = T.assert;
const E = H.E;

// Produce a reproducible mid-game snapshot: a state plus the next
// truthful (guess, feedback) the game would present.
function snapshot(seed) {
  return H.withSeed(seed, function () {
    const cfg = H.randomConfig();
    const secret = H.randomSecret(cfg);
    const rr = Math.random();
    const engine = rr < 0.34 ? E.ENGINE_STRATEGIC : rr < 0.67 ? E.ENGINE_HEURISTIC : E.ENGINE_MINIMAX;
    const K = cfg.codeLength;
    const vh = E.getValidHybrids(cfg.selectedPlants);
    let st = E.createSolverState(vh, K);
    let sug = E.generateSuggestion(st, vh, K, true, cfg.selectedPlants, engine);

    // advance a random 0..3 rounds, stopping before solved
    const pre = Math.floor(Math.random() * 4);
    for (let r = 0; r < pre; r++) {
      const g = H.buildGuess(st, sug, vh, K);
      const f = g.map(function (gg, i) { return H.oracleFeedback(gg, i, secret); });
      const next = E.applyFeedback(st, g, f);
      if (next.gameLocked.every(Boolean)) break;
      st = next;
      sug = E.generateSuggestion(st, vh, K, false, cfg.selectedPlants, engine);
    }

    const guess = H.buildGuess(st, sug, vh, K);
    const feedback = guess.map(function (g, i) { return H.oracleFeedback(g, i, secret); });
    return { cfg: cfg, secret: secret, engine: engine, K: K, vh: vh, st: st, sug: sug, guess: guess, feedback: feedback };
  });
}

suite('property: applyFeedback purity', function () {
  test('input state is never mutated (100 cases)', function () {
    for (let seed = 1; seed <= 100; seed++) {
      const s = snapshot(seed);
      const before = E.cloneState(s.st);
      E.applyFeedback(s.st, s.guess, s.feedback);
      assert.ok(H.stateEq(before, s.st), 'seed ' + seed + ': input mutated');
    }
  });
});

suite('property: possibility sets are monotonically non-increasing', function () {
  test('no slot gains possibilities across a round (100 cases)', function () {
    for (let seed = 1; seed <= 100; seed++) {
      const s = snapshot(seed);
      const after = E.applyFeedback(s.st, s.guess, s.feedback);
      for (let slot = 0; slot < s.K; slot++) {
        assert.ok(after.possible[slot].size <= s.st.possible[slot].size,
          'seed ' + seed + ' slot ' + slot + ': possibilities grew');
      }
    }
  });
});

suite('property: applyFeedback is idempotent', function () {
  test('applying the same (guess,feedback) twice equals applying once (100 cases)', function () {
    for (let seed = 1; seed <= 100; seed++) {
      const s = snapshot(seed);
      const once = E.applyFeedback(s.st, s.guess, s.feedback);
      const twice = E.applyFeedback(once, s.guess, s.feedback);
      assert.ok(H.stateEq(once, twice), 'seed ' + seed + ': not idempotent');
    }
  });
});

suite('property: suggestion determinism (non-first)', function () {
  test('generateSuggestion is deterministic for both engines (100 cases)', function () {
    for (let seed = 1; seed <= 100; seed++) {
      const s = snapshot(seed);
      for (const engine of [E.ENGINE_STRATEGIC, E.ENGINE_HEURISTIC, E.ENGINE_MINIMAX]) {
        const a = E.generateSuggestion(s.st, s.vh, s.K, false, s.cfg.selectedPlants, engine);
        const b = E.generateSuggestion(s.st, s.vh, s.K, false, s.cfg.selectedPlants, engine);
        assert.deepStrictEqual(a, b, 'seed ' + seed + ' engine ' + engine + ': non-deterministic');
      }
    }
  });
});

suite('property: confirmed/gameLocked are monotonic over a game', function () {
  test('once set, confirmed values never change and locks never clear (60 games)', function () {
    for (let seed = 2000; seed < 2060; seed++) {
      H.withSeed(seed, function () {
        const cfg = H.randomConfig();
        const secret = H.randomSecret(cfg);
        const rr = Math.random();
        const engine = rr < 0.34 ? E.ENGINE_STRATEGIC : rr < 0.67 ? E.ENGINE_HEURISTIC : E.ENGINE_MINIMAX;
        const K = cfg.codeLength;
        const vh = E.getValidHybrids(cfg.selectedPlants);
        let st = E.createSolverState(vh, K);
        let sug = E.generateSuggestion(st, vh, K, true, cfg.selectedPlants, engine);
        let prev = st;
        for (let r = 0; r < 40; r++) {
          const g = H.buildGuess(st, sug, vh, K);
          const f = g.map(function (gg, i) { return H.oracleFeedback(gg, i, secret); });
          st = E.applyFeedback(st, g, f);
          for (let s = 0; s < K; s++) {
            if (prev.confirmed[s] !== null) {
              assert.strictEqual(st.confirmed[s], prev.confirmed[s], 'confirmed changed at slot ' + s);
            }
            if (prev.gameLocked[s]) assert.strictEqual(st.gameLocked[s], true, 'lock cleared at slot ' + s);
          }
          if (st.gameLocked.every(Boolean)) break;
          prev = st;
          sug = E.generateSuggestion(st, vh, K, false, cfg.selectedPlants, engine);
        }
      });
    }
  });
});
