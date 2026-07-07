// ============================================================
// GE Decode Solver — HEURISTIC ENGINE (greedy, placement-focused)
// Augments the shared DecodeEngine core (engine-core.js).
// ============================================================
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine-core.js'));
  } else {
    factory(root.DecodeEngine);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (core) {
  'use strict';
  var TUNING = core.TUNING, parseKey = core.parseKey, firstGuess = core.firstGuess;

  // ================================================================
  // ENGINE 1: Original Heuristic (greedy, placement-focused)
  // ================================================================

  function heuristicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    var result = new Array(codeLen).fill(null);
    var used = new Set();

    // Only skip game-locked slots (not just solver-confirmed)
    for (var s = 0; s < codeLen; s++) {
      if (state.gameLocked[s] && state.confirmed[s]) {
        result[s] = state.confirmed[s];
        used.add(state.confirmed[s]);
      }
    }

    var unc = [];
    for (var s2 = 0; s2 < codeLen; s2++) {
      if (!result[s2]) unc.push(s2);
    }
    unc.sort(function (a, b) { return state.possible[a].size - state.possible[b].size; });

    for (var u = 0; u < unc.length; u++) {
      var slot = unc[u];
      var candidates = [];
      for (var k of state.possible[slot]) {
        if (!used.has(k)) candidates.push(k);
      }
      if (!candidates.length) candidates = Array.from(state.possible[slot]);
      if (!candidates.length) {
        for (var h of validHybrids) {
          if (!used.has(h.key)) { candidates.push(h.key); break; }
        }
      }

      var best = candidates[0] || null;
      if (candidates.length > 1 && state.possible[slot].size > 1) {
        var bestBal = Infinity;
        for (var ci = 0; ci < candidates.length; ci++) {
          var cand = candidates[ci];
          var cp = parseKey(cand);
          var shared = 0, total = state.possible[slot].size;
          for (var other of state.possible[slot]) {
            if (other === cand) continue;
            var op = parseKey(other);
            if (op[0] === cp[0] || op[1] === cp[0] || op[0] === cp[1] || op[1] === cp[1]) shared++;
          }
          var bal = total > 1 ? Math.abs(shared / (total - 1) - TUNING.SPLIT_TARGET_RATIO) : 0;
          if (bal < bestBal) { bestBal = bal; best = cand; }
        }
      }
      result[slot] = best;
      if (best) used.add(best);
    }
    return result;
  }

  core.heuristicSuggestion = heuristicSuggestion;
  core._registerEngine(core.ENGINE_HEURISTIC, heuristicSuggestion);
  return { heuristicSuggestion: heuristicSuggestion };
});
