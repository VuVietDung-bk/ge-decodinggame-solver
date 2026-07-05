'use strict';
// Regression tests: freeze current behavior so future algorithm changes
// surface as explicit diffs.
//   - Fixed applyFeedback snapshots (RNG-independent).
//   - Golden self-play transcripts (test/golden.json), replayed with the
//     same seeds. Regenerate intentionally via: node test/generate-golden.js

const fs = require('fs');
const path = require('path');
const T = require('./harness.js');
const H = require('./helpers.js');
const S = require('./scenarios.js');
const suite = T.suite, test = T.test, assert = T.assert;
const E = H.E;

suite('regression: fixed applyFeedback snapshot', function () {
  const vh = E.getValidHybrids([0, 1, 2, 3, 4]);
  const guess = [{ p1: 0, p2: 1 }, { p1: 2, p2: 3 }, { p1: 0, p2: 4 }, { p1: 1, p2: 2 }];
  const st = E.applyFeedback(E.createSolverState(vh, 4), guess,
    ['correct', 'allwrong', 'partial', 'wrongslot']);

  test('possibility sizes match the frozen baseline', function () {
    assert.deepStrictEqual(st.possible.map(function (s) { return s.size; }), [1, 4, 7, 10]);
  });
  test('confirmed / locked / mustInclude / excluded match baseline', function () {
    assert.strictEqual(st.confirmed[0], '0_1');
    assert.strictEqual(st.gameLocked[0], true);
    assert.deepStrictEqual(Array.from(st.mustInclude), ['1_2']);
    assert.deepStrictEqual(Array.from(st.excluded), ['2_3', '0_4']);
  });
  test('deterministic non-first suggestions match baseline (all engines)', function () {
    const strat = E.generateSuggestion(st, vh, 4, false, [0, 1, 2, 3, 4], E.ENGINE_STRATEGIC);
    const heur = E.generateSuggestion(st, vh, 4, false, [0, 1, 2, 3, 4], E.ENGINE_HEURISTIC);
    // This fixture's feedback is inconsistent (mustInclude 1_2 is unplaceable),
    // so the optimal engine finds 0 consistent answers and falls back to strategic.
    const opt = E.generateSuggestion(st, vh, 4, false, [0, 1, 2, 3, 4], E.ENGINE_OPTIMAL);
    assert.deepStrictEqual(strat, ['0_1', '1_1', '4_4', '1_4']);
    assert.deepStrictEqual(heur, ['0_1', '1_4', '0_2', '0_3']);
    assert.deepStrictEqual(opt, ['0_1', '1_1', '4_4', '1_4']);
  });
});

suite('regression: golden self-play transcripts', function () {
  const goldenPath = path.join(__dirname, 'golden.json');

  test('golden.json exists (run: node test/generate-golden.js)', function () {
    assert.ok(fs.existsSync(goldenPath), 'missing test/golden.json');
  });

  if (fs.existsSync(goldenPath)) {
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    for (let i = 0; i < S.SCENARIOS.length; i++) {
      const sc = S.SCENARIOS[i];
      test('scenario ' + sc.id + ' matches golden transcript', function () {
        assert.ok(golden[sc.id], 'no golden entry for ' + sc.id + ' — regenerate golden.json');
        const actual = S.runScenario(sc);
        assert.deepStrictEqual(actual, golden[sc.id]);
      });
    }
  }
});
