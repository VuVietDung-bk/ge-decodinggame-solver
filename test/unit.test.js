'use strict';
// Unit tests for the pure engine functions.

const T = require('./harness.js');
const H = require('./helpers.js');
const suite = T.suite, test = T.test, assert = T.assert;
const E = H.E;

function withMockStorage(fn) {
  const store = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  try { return fn(); } finally { delete global.localStorage; }
}

suite('unit: key utilities', function () {
  test('hKey canonicalizes unordered pairs', function () {
    assert.strictEqual(E.hKey(1, 3), '1_3');
    assert.strictEqual(E.hKey(3, 1), '1_3');
    assert.strictEqual(E.hKey(2, 2), '2_2');
  });
  test('parseKey inverts hKey', function () {
    assert.deepStrictEqual(E.parseKey('1_3'), [1, 3]);
    assert.deepStrictEqual(E.parseKey('2_2'), [2, 2]);
    const pk = E.parseKey(E.hKey(4, 0));
    assert.deepStrictEqual(pk, [0, 4]);
  });
  test('getHybridName reads the symmetric matrix; null for invalid', function () {
    assert.strictEqual(E.getHybridName(0, 1), 'Snow Pea');
    assert.strictEqual(E.getHybridName(1, 0), 'Snow Pea');
    assert.strictEqual(E.getHybridName(0, 0), 'Repeater');
    assert.strictEqual(E.getHybridName(0, 4), null); // invalid pairing
    assert.strictEqual(E.getHybridName(4, 0), null);
  });
});

suite('unit: getValidHybrids', function () {
  test('enumerates valid pairs (incl. diagonal) among selected plants', function () {
    const vh = E.getValidHybrids([0, 1, 2]);
    const keys = vh.map(function (h) { return h.key; }).sort();
    assert.deepStrictEqual(keys, ['0_0', '0_1', '0_2', '1_1', '1_2', '2_2']);
    for (let i = 0; i < vh.length; i++) {
      assert.ok(vh[i].name, 'hybrid has a name');
      assert.ok(vh[i].p1 <= vh[i].p2, 'p1<=p2 canonical');
    }
  });
  test('skips invalid pairings', function () {
    const vh = E.getValidHybrids([0, 4]); // (0,4) is invalid
    const keys = vh.map(function (h) { return h.key; }).sort();
    assert.deepStrictEqual(keys, ['0_0', '4_4']);
  });
  test('full 10-plant set yields 45 hybrids', function () {
    const vh = E.getValidHybrids([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.strictEqual(vh.length, 45);
  });
});

suite('unit: state construction & clone', function () {
  test('createSolverState shape', function () {
    const vh = E.getValidHybrids([0, 1, 2]);
    const st = E.createSolverState(vh, 3);
    assert.strictEqual(st.possible.length, 3);
    for (let s = 0; s < 3; s++) assert.strictEqual(st.possible[s].size, vh.length);
    assert.deepStrictEqual(st.confirmed, [null, null, null]);
    assert.deepStrictEqual(st.gameLocked, [false, false, false]);
    assert.strictEqual(st.mustInclude.size, 0);
    assert.strictEqual(st.excluded.size, 0);
  });
  test('cloneState is independent', function () {
    const vh = E.getValidHybrids([0, 1, 2]);
    const st = E.createSolverState(vh, 3);
    const c = E.cloneState(st);
    c.possible[0].add('9_9');
    c.mustInclude.add('0_0');
    c.confirmed[0] = '0_0';
    c.gameLocked[0] = true;
    assert.ok(!st.possible[0].has('9_9'));
    assert.strictEqual(st.mustInclude.size, 0);
    assert.strictEqual(st.confirmed[0], null);
    assert.strictEqual(st.gameLocked[0], false);
  });
});

suite('unit: applyFeedback single rules', function () {
  const vh = E.getValidHybrids([0, 1, 2, 3, 4]);
  function fresh() { return E.createSolverState(vh, 4); }
  const guess = [{ p1: 0, p2: 1 }, { p1: 2, p2: 3 }, { p1: 0, p2: 4 }, { p1: 1, p2: 2 }];

  test('correct locks the slot and removes the hybrid elsewhere', function () {
    const st = E.applyFeedback(fresh(), guess, ['correct', 'allwrong', 'allwrong', 'allwrong']);
    assert.strictEqual(st.confirmed[0], '0_1');
    assert.strictEqual(st.gameLocked[0], true);
    assert.strictEqual(st.possible[0].size, 1);
    for (let j = 1; j < 4; j++) assert.ok(!st.possible[j].has('0_1'));
  });
  test('wrongslot records mustInclude and drops the key at that slot', function () {
    const st = E.applyFeedback(fresh(), guess, ['wrongslot', 'allwrong', 'allwrong', 'allwrong']);
    assert.ok(st.mustInclude.has('0_1'));
    assert.ok(!st.possible[0].has('0_1'));
  });
  test('partial excludes the hybrid globally and keeps base-sharing candidates', function () {
    const st = E.applyFeedback(fresh(), guess, ['partial', 'allwrong', 'allwrong', 'allwrong']);
    assert.ok(st.excluded.has('0_1'));
    for (let j = 0; j < 4; j++) assert.ok(!st.possible[j].has('0_1'));
    // every surviving candidate at slot 0 shares base 0 or 1
    for (const k of st.possible[0]) {
      const pk = E.parseKey(k);
      assert.ok(pk[0] === 0 || pk[1] === 0 || pk[0] === 1 || pk[1] === 1, 'shares base with (0,1)');
    }
  });
  test('allwrong excludes the hybrid and keeps only non-base-sharing candidates', function () {
    const st = E.applyFeedback(fresh(), guess, ['allwrong', 'allwrong', 'allwrong', 'allwrong']);
    assert.ok(st.excluded.has('0_1'));
    for (const k of st.possible[0]) {
      const pk = E.parseKey(k);
      assert.ok(pk[0] !== 0 && pk[1] !== 0 && pk[0] !== 1 && pk[1] !== 1, 'shares no base with (0,1)');
    }
  });
  test('applyFeedback does not mutate the input state', function () {
    const st = fresh();
    const before = E.cloneState(st);
    E.applyFeedback(st, guess, ['correct', 'partial', 'allwrong', 'wrongslot']);
    assert.ok(H.stateEq(before, st), 'input state unchanged');
  });
});

suite('unit: propagate rules', function () {
  const vh = E.getValidHybrids([0, 1, 2]); // 6 hybrids
  test('naked single: a singleton slot becomes confirmed & cleared elsewhere', function () {
    const st = E.createSolverState(vh, 3);
    st.possible[0] = new Set(['0_1']);
    E.propagate(st, 3);
    assert.strictEqual(st.confirmed[0], '0_1');
    assert.ok(!st.possible[1].has('0_1'));
    assert.ok(!st.possible[2].has('0_1'));
  });
  test('hidden single: a mustInclude with one viable slot gets locked there', function () {
    const st = E.createSolverState(vh, 3);
    st.mustInclude.add('0_1');
    st.possible[1].delete('0_1');
    st.possible[2].delete('0_1');
    E.propagate(st, 3);
    assert.strictEqual(st.confirmed[0], '0_1');
    assert.strictEqual(st.possible[0].size, 1);
  });
});

suite('unit: suggestion generation', function () {
  const cfg = H.config(5, 4);
  const vh = E.getValidHybrids(cfg.selectedPlants);
  test('firstGuess returns K distinct valid hybrids', function () {
    const g = E.firstGuess(vh, 4);
    assert.strictEqual(g.length, 4);
    assert.strictEqual(new Set(g).size, 4, 'all distinct');
    const valid = new Set(vh.map(function (h) { return h.key; }));
    for (let i = 0; i < g.length; i++) assert.ok(valid.has(g[i]), 'valid hybrid');
  });
  test('generateSuggestion dispatches to both engines and returns length K', function () {
    const st = E.createSolverState(vh, 4);
    const s1 = E.generateSuggestion(st, vh, 4, false, cfg.selectedPlants, E.ENGINE_STRATEGIC);
    const s2 = E.generateSuggestion(st, vh, 4, false, cfg.selectedPlants, E.ENGINE_HEURISTIC);
    assert.strictEqual(s1.length, 4);
    assert.strictEqual(s2.length, 4);
  });
});

suite('unit: strategic scoring helpers', function () {
  const vh = E.getValidHybrids([0, 1, 2, 3, 4]);
  const st = E.createSolverState(vh, 4);
  test('totalUncertainty sums possibilities of unconfirmed slots', function () {
    const expected = 4 * vh.length;
    assert.strictEqual(E.totalUncertainty(st, 4), expected);
  });
  test('estimateFbProbs returns 4 entries; uniform on empty slot', function () {
    const p = E.estimateFbProbs('0_1', 0, st, false);
    assert.strictEqual(p.length, 4);
    const empty = E.cloneState(st); empty.possible[0] = new Set();
    assert.deepStrictEqual(E.estimateFbProbs('0_1', 0, empty, false), [0.25, 0.25, 0.25, 0.25]);
  });
  test('compositeScore is non-positive (0 = perfect split)', function () {
    const cs = E.compositeScore('0_1', [0, 1, 2, 3], st);
    assert.ok(cs <= 0.0000001, 'composite score <= 0');
  });
  test('lookaheadScore is a finite number', function () {
    const ls = E.lookaheadScore('0_1', 0, st, 4, false);
    assert.ok(typeof ls === 'number' && isFinite(ls));
  });
});

suite('unit: optimal engine core', function () {
  const vh = E.getValidHybrids([0, 1, 2, 3, 4]);

  test('enumerateAnswers lists all consistent answers of a fresh state', function () {
    // Fresh 2-slot state over plants {0,1}: hybrids 0_0,0_1,1_1 -> distinct ordered pairs
    const vh2 = E.getValidHybrids([0, 1]);
    const st = E.createSolverState(vh2, 2);
    const A = E.enumerateAnswers(st, 2, 2000, 200000);
    // permutations of 3 hybrids taken 2 at a time = 6
    assert.strictEqual(A.length, 6);
    for (let i = 0; i < A.length; i++) {
      assert.strictEqual(A[i].length, 2);
      assert.notStrictEqual(A[i][0], A[i][1], 'answer slots are distinct');
    }
  });

  test('enumerateAnswers respects confirmed slots and mustInclude', function () {
    // Build a guaranteed-consistent state: guess against a real secret.
    // secret = [0_1, 2_3, 1_2, 3_4]; guess = [0_1, 1_2, 2_3, 4_4]
    //  -> feedback [correct, wrongslot, wrongslot, partial]
    let st = E.createSolverState(vh, 4);
    st = E.applyFeedback(st, [{ p1: 0, p2: 1 }, { p1: 1, p2: 2 }, { p1: 2, p2: 3 }, { p1: 4, p2: 4 }],
      ['correct', 'wrongslot', 'wrongslot', 'partial']);
    const A = E.enumerateAnswers(st, 4, 2000, 200000);
    assert.ok(A && A.length > 0, 'has consistent answers');
    let sawSecret = false;
    for (let i = 0; i < A.length; i++) {
      assert.strictEqual(A[i][0], '0_1', 'confirmed slot 0 fixed');
      assert.ok(A[i].indexOf('1_2') !== -1, 'mustInclude 1_2 present');
      assert.ok(A[i].indexOf('2_3') !== -1, 'mustInclude 2_3 present');
      assert.strictEqual(new Set(A[i]).size, 4, 'distinct hybrids');
      if (A[i].join(',') === '0_1,2_3,1_2,3_4') sawSecret = true;
    }
    assert.ok(sawSecret, 'the true secret is among the enumerated answers');
  });

  test('enumerateAnswers returns null when it exceeds the cap', function () {
    const st = E.createSolverState(vh, 4); // huge space
    assert.strictEqual(E.enumerateAnswers(st, 4, 50, 200000), null);
  });

  test('feedbackSignature matches the game feedback rules', function () {
    const answer = ['0_1', '2_3', '0_2', '3_4'];
    const aset = new Set(answer);
    // exact
    assert.strictEqual(E.feedbackSignature(['0_1', '2_3', '0_2', '3_4'], answer, aset, 4), 'CCCC');
    // slot0 guesses 2_3 which is elsewhere -> W; others correct
    assert.strictEqual(E.feedbackSignature(['2_3', '2_3', '0_2', '3_4'], answer, aset, 4)[0], 'W');
    // slot0 guesses 0_4: shares base 0 with answer 0_1 -> P (0_4 not in answer)
    assert.strictEqual(E.feedbackSignature(['0_4', '2_3', '0_2', '3_4'], answer, aset, 4)[0], 'P');
    // slot0 guesses 4_4: shares no base with 0_1, not in answer -> A
    assert.strictEqual(E.feedbackSignature(['4_4', '2_3', '0_2', '3_4'], answer, aset, 4)[0], 'A');
  });

  test('optimalSuggestion returns a complete valid guess', function () {
    let st = E.createSolverState(vh, 4);
    st = E.applyFeedback(st, [{ p1: 0, p2: 1 }, { p1: 2, p2: 3 }, { p1: 0, p2: 2 }, { p1: 1, p2: 3 }],
      ['correct', 'wrongslot', 'partial', 'allwrong']);
    const sug = E.generateSuggestion(st, vh, 4, false, [0, 1, 2, 3, 4], E.ENGINE_OPTIMAL);
    assert.strictEqual(sug.length, 4);
    for (let s = 0; s < 4; s++) {
      const pk = E.parseKey(sug[s]);
      assert.ok(E.getHybridName(pk[0], pk[1]) !== null, 'slot ' + s + ' is a valid hybrid');
    }
  });
});

suite('unit: persistence', function () {
  test('serialize/deserialize round-trips a mid-game state', function () {
    const vh = E.getValidHybrids([0, 1, 2, 3, 4]);
    let st = E.createSolverState(vh, 4);
    st = E.applyFeedback(st, [{ p1: 0, p2: 1 }, { p1: 2, p2: 3 }, { p1: 0, p2: 4 }, { p1: 1, p2: 2 }],
      ['correct', 'allwrong', 'partial', 'wrongslot']);
    const round = E.deserializeState(E.serializeState(st));
    assert.ok(H.stateEq(st, round), 'round-trip preserves state');
  });
  test('saveGame/loadGame round-trip via mock localStorage', function () {
    withMockStorage(function () {
      const cfg = H.config(5, 4);
      const vh = E.getValidHybrids(cfg.selectedPlants);
      const st = E.createSolverState(vh, 4);
      const data = { validHybrids: vh, solverState: st, history: [], suggestion: ['0_1', null, null, null] };
      E.saveGame(cfg, data, E.ENGINE_STRATEGIC);
      const loaded = E.loadGame();
      assert.ok(loaded, 'loaded non-null');
      assert.deepStrictEqual(loaded.config, cfg);
      assert.strictEqual(loaded.engine, E.ENGINE_STRATEGIC);
      assert.ok(H.stateEq(loaded.data.solverState, st), 'state survives save/load');
    });
  });
  test('loadGame returns null when storage is unavailable', function () {
    assert.strictEqual(E.loadGame(), null);
  });
  test('buildHybridLookup maps key -> hybrid', function () {
    const vh = E.getValidHybrids([0, 1, 2]);
    const m = E.buildHybridLookup(vh);
    assert.strictEqual(m.size, vh.length);
    assert.strictEqual(m.get('0_1').name, 'Snow Pea');
  });
});
