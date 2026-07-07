'use strict';
// Propagation invariants: properties that must hold after any
// applyFeedback produced by truthful feedback. See helpers.assertInvariants.

const T = require('./harness.js');
const H = require('./helpers.js');
const suite = T.suite, test = T.test, assert = T.assert;
const E = H.E;

suite('invariants: targeted', function () {
  const vh = E.getValidHybrids([0, 1, 2, 3, 4]);
  const guess = [{ p1: 0, p2: 1 }, { p1: 2, p2: 3 }, { p1: 0, p2: 4 }, { p1: 1, p2: 2 }];

  test('excluded keys never remain in any possibility set (I1)', function () {
    const st = E.applyFeedback(E.createSolverState(vh, 4), guess,
      ['partial', 'allwrong', 'partial', 'wrongslot']);
    for (const key of st.excluded) {
      for (let s = 0; s < 4; s++) assert.ok(!st.possible[s].has(key));
    }
  });

  test('confirmed <=> singleton with matching element (I3)', function () {
    const st = E.applyFeedback(E.createSolverState(vh, 4), guess,
      ['correct', 'allwrong', 'partial', 'wrongslot']);
    for (let s = 0; s < 4; s++) {
      if (st.confirmed[s] !== null) {
        assert.strictEqual(st.possible[s].size, 1);
        assert.ok(st.possible[s].has(st.confirmed[s]));
      }
      if (st.possible[s].size === 1) {
        assert.strictEqual(st.confirmed[s], st.possible[s].values().next().value);
      }
    }
  });

  test('game-locked hybrid appears in no other slot (I4)', function () {
    const st = E.applyFeedback(E.createSolverState(vh, 4), guess,
      ['correct', 'allwrong', 'allwrong', 'allwrong']);
    const key = st.confirmed[0];
    assert.strictEqual(st.gameLocked[0], true);
    for (let j = 1; j < 4; j++) assert.ok(!st.possible[j].has(key));
  });

  test('assertInvariants passes on a seeded truthful sequence', function () {
    H.withSeed(12345, function () {
      const cfg = H.config(5, 4);
      const secret = H.randomSecret(cfg); // guaranteed to be valid hybrids
      let st = E.createSolverState(vh, 4);
      const fb = guess.map(function (g, i) { return H.oracleFeedback(g, i, secret); });
      st = E.applyFeedback(st, guess, fb);
      H.assertInvariants(st, 4, secret);
    });
  });
});

suite('invariants: randomized sweep (mid-game states)', function () {
  test('300 seeded partial games satisfy all invariants every round', function () {
    let checked = 0;
    for (let seed = 1000; seed < 1300; seed++) {
      H.withSeed(seed, function () {
        const cfg = H.randomConfig();
        const secret = H.randomSecret(cfg);
        const r = Math.random();
        const engine = r < 0.34 ? E.ENGINE_STRATEGIC : r < 0.67 ? E.ENGINE_HEURISTIC : E.ENGINE_MINIMAX;
        // playGame with check:true asserts invariants after every round
        H.playGame(cfg, secret, engine, 40, { check: true });
        checked++;
      });
    }
    assert.strictEqual(checked, 300);
  });
});
