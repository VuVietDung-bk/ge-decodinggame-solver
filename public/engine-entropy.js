// ============================================================
// GE Decode Solver — ENTROPY ENGINE (information-theoretic)
// ------------------------------------------------------------
// "Wordle-bot" strategy. When the consistent-answer set A is small enough to
// enumerate, it scores each candidate guess by the SHANNON ENTROPY of the
// feedback-signature distribution that guess induces over A, and plays the
// guess that yields the most bits on average. Where Minimax defends the WORST
// bucket, Entropy minimizes AVERAGE uncertainty — so it optimizes expected
// (mean) rounds. For large answer spaces (early game) it defers to Strategic.
// Augments the shared core (engine-core.js).
// ============================================================
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    require('./engine-strategic.js'); // registers core.strategicSuggestion (entropy falls back to it)
    module.exports = factory(require('./engine-core.js'));
  } else {
    factory(root.DecodeEngine);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (core) {
  'use strict';
  var TUNING = core.TUNING, firstGuess = core.firstGuess;
  var enumerateAnswers = core.enumerateAnswers, feedbackSignature = core.feedbackSignature;
  var strategicSuggestion = core.strategicSuggestion;
  var ENGINE_ENTROPY = 'entropy';

  var LOG2 = Math.log(2);

  // Entropy engine: play the guess whose feedback splits the consistent-answer
  // set into the most even/numerous outcomes (maximum expected information).
  function entropySuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    // Cheap upper bound on the joint answer count; too large -> defer to Strategic.
    var estimate = 1;
    for (var s = 0; s < codeLen; s++) {
      var sz = state.confirmed[s] ? 1 : state.possible[s].size;
      estimate *= (sz > 0 ? sz : 1);
      if (estimate > TUNING.ENTROPY_ENUM_CAP) break;
    }
    if (estimate > TUNING.ENTROPY_ENUM_CAP) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }

    var A = enumerateAnswers(state, codeLen, TUNING.ENTROPY_ENUM_CAP, TUNING.ENTROPY_NODE_CAP);
    if (!A || A.length === 0) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }
    if (A.length === 1) return A[0].slice();

    var N = A.length;
    var answerSets = new Array(N);
    for (var ai = 0; ai < N; ai++) answerSets[ai] = new Set(A[ai]);

    // Candidate guesses = the consistent answers (a candidate that is itself the
    // answer can also end the game). Sample down to a cap for large sets.
    var step = N > TUNING.ENTROPY_GUESS_CAP ? Math.ceil(N / TUNING.ENTROPY_GUESS_CAP) : 1;

    // Score each guess against A, but sample the answer set when it is large:
    // an entropy estimate over a strided sample ranks guesses just as well at a
    // fraction of the cost (the inner loop dominates runtime).
    var scoreIdx, M;
    if (N > TUNING.ENTROPY_SCORE_CAP) {
      scoreIdx = [];
      var sstep = N / TUNING.ENTROPY_SCORE_CAP;
      for (var t = 0; t < TUNING.ENTROPY_SCORE_CAP; t++) scoreIdx.push(Math.floor(t * sstep));
      M = scoreIdx.length;
    } else {
      scoreIdx = null; M = N;
    }

    // Every candidate is itself a consistent answer, so all can end the game on
    // a correct hit — the tie-break is therefore just min worst-bucket, then key.
    var bestKeys = null, bestH = -1, bestWorst = Infinity, bestKeyStr = null;
    for (var gi = 0; gi < N; gi += step) {
      var G = A[gi];
      // Partition the (sampled) answer set by the feedback signature G produces.
      var counts = Object.create(null);
      for (var j = 0; j < M; j++) {
        var aj = scoreIdx ? scoreIdx[j] : j;
        var sig = feedbackSignature(G, A[aj], answerSets[aj], codeLen);
        counts[sig] = (counts[sig] || 0) + 1;
      }
      // Shannon entropy of the outcome distribution (bits), plus worst bucket.
      var H = 0, worst = 0;
      for (var key in counts) {
        var c = counts[key];
        if (c > worst) worst = c;
        var p = c / M;
        H -= p * (Math.log(p) / LOG2);
      }
      var keyStr = G.join(',');
      // Primary: max entropy. Tie-breaks: smaller worst bucket (mild
      // tail-awareness), then deterministic key.
      var better = false;
      if (H > bestH + 1e-9) better = true;
      else if (H > bestH - 1e-9) {
        if (worst < bestWorst) better = true;
        else if (worst === bestWorst && (bestKeyStr === null || keyStr < bestKeyStr)) better = true;
      }
      if (better) { bestH = H; bestWorst = worst; bestKeys = G; bestKeyStr = keyStr; }
    }
    return (bestKeys || A[0]).slice();
  }

  core.ENGINE_ENTROPY = ENGINE_ENTROPY;
  core.entropySuggestion = entropySuggestion;
  core._registerEngine(ENGINE_ENTROPY, entropySuggestion);
  return { entropySuggestion: entropySuggestion };
});
