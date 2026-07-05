'use strict';
// Randomized end-to-end self-play. For many seeded (config, secret,
// engine) combinations, the solver plays a full game against the
// feedback oracle. Asserts: soundness/invariants every round, and that
// the puzzle is always solved within a generous bound.
//
// Calibration (400 games/engine) showed worst-case 7 rounds; the bound
// of 40 leaves wide margin, so a failure means a real regression
// (e.g. the solver stalling or pruning the true answer).

const T = require('./harness.js');
const H = require('./helpers.js');
const suite = T.suite, test = T.test, assert = T.assert;
const E = H.E;

const SOLVE_BOUND = 40;

function sweep(engine, seedStart, count) {
  let solved = 0, maxRounds = 0, sumRounds = 0;
  for (let i = 0; i < count; i++) {
    const seed = seedStart + i;
    H.withSeed(seed, function () {
      const cfg = H.randomConfig();
      const secret = H.randomSecret(cfg);
      const r = H.playGame(cfg, secret, engine, SOLVE_BOUND, { check: true });
      assert.ok(r.solved, 'engine ' + engine + ' seed ' + seed +
        ' unsolved in ' + SOLVE_BOUND + ' rounds (K=' + cfg.codeLength +
        ', plants=' + cfg.selectedPlants.length + ')');
      solved++; sumRounds += r.rounds;
      if (r.rounds > maxRounds) maxRounds = r.rounds;
    });
  }
  return { solved: solved, maxRounds: maxRounds, avg: sumRounds / count };
}

suite('randomized: strategic engine self-play', function () {
  test('150 random games all solve within bound + invariants hold', function () {
    const r = sweep(E.ENGINE_STRATEGIC, 3000, 150);
    assert.strictEqual(r.solved, 150);
    assert.ok(r.maxRounds <= SOLVE_BOUND);
  });
});

suite('randomized: heuristic engine self-play', function () {
  test('150 random games all solve within bound + invariants hold', function () {
    const r = sweep(E.ENGINE_HEURISTIC, 5000, 150);
    assert.strictEqual(r.solved, 150);
    assert.ok(r.maxRounds <= SOLVE_BOUND);
  });
});

suite('randomized: optimal engine self-play', function () {
  test('120 random games all solve within bound + invariants hold', function () {
    const r = sweep(E.ENGINE_OPTIMAL, 6000, 120);
    assert.strictEqual(r.solved, 120);
    assert.ok(r.maxRounds <= SOLVE_BOUND);
  });
});

suite('randomized: edge configs', function () {
  test('minimum (3 plants, 3 slots) solves for both engines', function () {
    for (const engine of [E.ENGINE_STRATEGIC, E.ENGINE_HEURISTIC]) {
      for (let seed = 7000; seed < 7030; seed++) {
        H.withSeed(seed, function () {
          const cfg = H.config(3, 3);
          const secret = H.randomSecret(cfg);
          const r = H.playGame(cfg, secret, engine, SOLVE_BOUND, { check: true });
          assert.ok(r.solved, engine + ' failed min config at seed ' + seed);
        });
      }
    }
  });
  test('large (10 plants, 8 slots) solves for the strategic engine', function () {
    for (let seed = 8000; seed < 8010; seed++) {
      H.withSeed(seed, function () {
        const cfg = H.config(10, 8);
        const secret = H.randomSecret(cfg);
        const r = H.playGame(cfg, secret, E.ENGINE_STRATEGIC, SOLVE_BOUND, { check: true });
        assert.ok(r.solved, 'strategic failed large config at seed ' + seed);
      });
    }
  });
});
