// ============================================================
// GE Decode Solver — MINIMAX ENGINE (machine strategy)
// Worst-case / expected minimax over the consistent-answer set,
// with an exact single-slot endgame solver. Augments the core.
// ============================================================
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    require('./engine-strategic.js'); // registers core.strategicSuggestion (minimax falls back to it)
    module.exports = factory(require('./engine-core.js'));
  } else {
    factory(root.DecodeEngine);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (core) {
  'use strict';
  var TUNING = core.TUNING, parseKey = core.parseKey, firstGuess = core.firstGuess;
  var untestedCount = core.untestedCount, strategicSuggestion = core.strategicSuggestion;
  var hKey = core.hKey, getHybridName = core.getHybridName;
  var feedbackSignature = core.feedbackSignature, enumerateAnswers = core.enumerateAnswers;


  // Deliberately-wrong probes: at slots whose answer we already know but the
  // game has not locked, substitute the freshest (most-untested) unused hybrids.
  // Returns a small, bounded set of probe guesses (may be empty).
  function buildProbes(state, validHybrids, K, rep) {
    var freeSlots = [];
    for (var s = 0; s < K; s++) {
      if (state.confirmed[s] && !state.gameLocked[s]) freeSlots.push(s);
    }
    if (freeSlots.length === 0) return [];

    var tested = new Set();
    for (var ek of state.excluded) { var ep = parseKey(ek); tested.add(ep[0]); tested.add(ep[1]); }
    for (var c = 0; c < K; c++) { if (state.confirmed[c]) { var cp = parseKey(state.confirmed[c]); tested.add(cp[0]); tested.add(cp[1]); } }
    for (var mk of state.mustInclude) { var mp = parseKey(mk); tested.add(mp[0]); tested.add(mp[1]); }

    var repSet = new Set(rep);
    var fresh = [];
    for (var h = 0; h < validHybrids.length; h++) {
      var hb = validHybrids[h];
      if (repSet.has(hb.key) || state.excluded.has(hb.key)) continue;
      fresh.push({ key: hb.key, uc: untestedCount([hb.p1, hb.p2], tested), het: hb.p1 !== hb.p2 ? 1 : 0 });
    }
    fresh.sort(function (a, b) {
      if (b.uc !== a.uc) return b.uc - a.uc;
      if (b.het !== a.het) return b.het - a.het;
      return a.key < b.key ? -1 : 1;
    });
    if (fresh.length === 0) return [];

    var probe = rep.slice();
    var used = new Set(rep);
    var fi = 0;
    for (var fs = 0; fs < freeSlots.length; fs++) {
      while (fi < fresh.length && used.has(fresh[fi].key)) fi++;
      if (fi >= fresh.length) break;
      probe[freeSlots[fs]] = fresh[fi].key;
      used.add(fresh[fi].key);
      fi++;
    }
    return [probe];
  }

  // --- Exact single-slot endgame minimax (Knuth-style) ---------------------
  //
  // When one slot is unknown and every OTHER slot is game-locked (fixed by the
  // game, so it can only echo its solved value), the general search below draws
  // its guesses from the answer set. If the candidates share a common plant
  // (all `z_8`), every answer-guess is 1-vs-rest — true `z_8` → 'correct', the
  // rest → 'partial' — so it rules out one per round and linear-scans: the
  // source of the worst-case games.
  //
  // But the free slot may hold a NON-answer guess. For candidates {0_8,1_8,
  // 2_8,3_8}, guessing `0_1` there returns 'partial' iff the answer is 0_8/1_8
  // and 'allwrong' iff it is 2_8/3_8 — a 2-vs-2 split that rules out TWO per
  // round. Choosing, each round, the guess that minimizes the worst-case
  // number of surviving candidates (Knuth's minimax) solves m candidates in
  // ~m/2 rounds instead of m. This routine computes that exactly.

  // Feedback code for guess hybrid (gp) vs truth (tp) at the free slot, given
  // the locked hybrids elsewhere. 0=correct, 1=wrongslot, 2=partial, 3=allwrong.
  function slotFeedbackCode(gk, tk, gp, tp, lockedSet) {
    if (gk === tk) return 0;
    if (lockedSet[gk]) return 1; // equals another (locked) slot's answer
    if (gp[0] === tp[0] || gp[0] === tp[1] || gp[1] === tp[0] || gp[1] === tp[1]) return 2;
    return 3;
  }

  // Worst-case / expected rounds to identify AND lock the answer among the
  // candidate list `S` (indices into cand/plants), searching all guesses in
  // `pool`. Memoized by sorted candidate signature; `budget` caps expansion.
  function singleSlotCost(S, cand, plants, pool, lockedSet, memo, budget) {
    if (S.length === 1) return { w: 1, e: 1 };        // guess it -> 'correct'
    var key = S.join(',');
    if (memo[key]) return memo[key];
    if (budget.n <= 0) return { w: S.length, e: (S.length + 1) / 2 }; // pessimistic bail
    budget.n--;

    var best = { w: Infinity, e: Infinity };
    for (var gi = 0; gi < pool.length; gi++) {
      var g = pool[gi], gk = cand[g], gp = plants[g];
      var buckets = Object.create(null), maxBucket = 0, cCount = 0;
      for (var i = 0; i < S.length; i++) {
        var t = S[i];
        var code = slotFeedbackCode(gk, cand[t], gp, plants[t], lockedSet);
        if (code === 0) { cCount++; continue; }       // this guess solves that answer
        (buckets[code] || (buckets[code] = [])).push(t);
        if (buckets[code].length > maxBucket) maxBucket = buckets[code].length;
      }
      if (maxBucket === S.length) continue;            // no split -> no progress
      var w = 1, esum = cCount, feasible = true;
      for (var code2 in buckets) {
        var b = buckets[code2];
        var sub = singleSlotCost(b, cand, plants, pool, lockedSet, memo, budget);
        if (1 + sub.w > w) w = 1 + sub.w;
        esum += b.length * (1 + sub.e);
        if (w > best.w) { feasible = false; break; }   // branch & bound on worst-case
      }
      if (!feasible) continue;
      var e = esum / S.length;
      if (w < best.w || (w === best.w && e < best.e)) best = { w: w, e: e };
    }
    if (best.w === Infinity) best = { w: S.length, e: (S.length + 1) / 2 };
    memo[key] = best;
    return best;
  }

  // If exactly one slot is unconfirmed and every other slot is game-locked,
  // return a worst-case-minimax full-guess (Knuth minimax over ALL valid
  // hybrids at the free slot), else null. Gated to the all-locked case so it
  // only replaces the linear scan and never disturbs endgames where the
  // general search can still exploit unlocked slots.
  function endgameSingleSlot(state, validHybrids, K, A) {
    var slot = -1;
    for (var s = 0; s < K; s++) {
      if (!state.confirmed[s]) { if (slot !== -1) return null; slot = s; }
      else if (!state.gameLocked[s]) return null;      // an unlocked known slot: defer to general search
    }
    if (slot === -1) return null;

    var candKeys = [], seen = Object.create(null);
    for (var a = 0; a < A.length; a++) { var kk = A[a][slot]; if (!seen[kk]) { seen[kk] = true; candKeys.push(kk); } }
    if (candKeys.length < 3) return null;              // 1-2 candidates: linear scan is already minimax
    if (candKeys.length > TUNING.MINIMAX_ENDGAME_CAP) return null;

    var lockedSet = Object.create(null);
    for (var t = 0; t < K; t++) { if (t !== slot && state.confirmed[t]) lockedSet[state.confirmed[t]] = true; }

    // Guess pool: candidates + every valid hybrid sharing a plant with a
    // candidate (others read 'allwrong' for all candidates = no split), minus
    // the locked hybrids. A pairing guess like `0_1` lives here.
    var candPlant = Object.create(null);
    for (var c = 0; c < candKeys.length; c++) { var cp = parseKey(candKeys[c]); candPlant[cp[0]] = true; candPlant[cp[1]] = true; }
    var cand = [], plants = [], idxOf = Object.create(null);
    function add(k) { if (idxOf[k] !== undefined || lockedSet[k]) return; idxOf[k] = cand.length; cand.push(k); plants.push(parseKey(k)); }
    for (var ck = 0; ck < candKeys.length; ck++) add(candKeys[ck]);
    for (var h = 0; h < validHybrids.length; h++) { var vh = validHybrids[h]; if (candPlant[vh.p1] || candPlant[vh.p2]) add(vh.key); }
    var S = []; for (var sk = 0; sk < candKeys.length; sk++) S.push(idxOf[candKeys[sk]]);
    var pool = []; for (var p = 0; p < cand.length; p++) pool.push(p);
    var candMember = Object.create(null); for (var q = 0; q < S.length; q++) candMember[S[q]] = true;

    var memo = Object.create(null), budget = { n: TUNING.MINIMAX_NODE_BUDGET };
    var bestG = -1, bestW = Infinity, bestE = Infinity, bestIsCand = false;
    for (var gi = 0; gi < pool.length; gi++) {
      var g = pool[gi], gk = cand[g], gp = plants[g];
      var buckets = Object.create(null), maxBucket = 0, cCount = 0;
      for (var i = 0; i < S.length; i++) {
        var tt = S[i];
        var code = slotFeedbackCode(gk, cand[tt], gp, plants[tt], lockedSet);
        if (code === 0) { cCount++; continue; }
        (buckets[code] || (buckets[code] = [])).push(tt);
        if (buckets[code].length > maxBucket) maxBucket = buckets[code].length;
      }
      if (maxBucket === S.length) continue;            // no progress
      var w = 1, esum = cCount;
      for (var code3 in buckets) {
        var b = buckets[code3];
        var sub = singleSlotCost(b, cand, plants, pool, lockedSet, memo, budget);
        if (1 + sub.w > w) w = 1 + sub.w;
        esum += b.length * (1 + sub.e);
      }
      var e = esum / S.length, isCand = !!candMember[g];
      var better = w < bestW ||
        (w === bestW && (e < bestE - 1e-9 ||
          (Math.abs(e - bestE) <= 1e-9 && isCand && !bestIsCand)));
      if (better) { bestW = w; bestE = e; bestG = g; bestIsCand = isCand; }
    }
    if (bestG === -1) return null;
    // Only intervene when the minimax STRICTLY beats the answer-only linear scan
    // (which needs up to `m` rounds). For m<=3, W(m)=m, so pairing gains nothing
    // and would only trade lucky-fast games for no worst-case benefit.
    if (bestW >= candKeys.length) return null;

    var guess = new Array(K);
    for (var u = 0; u < K; u++) guess[u] = state.confirmed[u]; // locked values elsewhere
    guess[slot] = cand[bestG];
    return guess;
  }

  // Discriminating (pairing) non-answer guesses for the general minimax pool.
  // For each slot that varies across A, pair two DISTINGUISHING plants into a
  // valid hybrid (e.g. `2_5` when the slot's candidates are {2_8,5_8,...}); its
  // allwrong response rules out both at once. Reuses A[0] as the template for
  // the other slots. This extends the endgame's worst-case idea to every round.
  function buildDiscriminatingProbes(A, K, cap) {
    if (A.length < 3) return [];
    var template = A[0], probes = [], seen = Object.create(null);
    for (var s = 0; s < K && probes.length < cap; s++) {
      var keySet = Object.create(null), keys = [];
      for (var i = 0; i < A.length; i++) { var k = A[i][s]; if (!keySet[k]) { keySet[k] = true; keys.push(k); } }
      if (keys.length < 2) continue;
      var plantCount = Object.create(null);
      for (var ki = 0; ki < keys.length; ki++) { var pk = parseKey(keys[ki]); plantCount[pk[0]] = (plantCount[pk[0]] || 0) + 1; if (pk[1] !== pk[0]) plantCount[pk[1]] = (plantCount[pk[1]] || 0) + 1; }
      var dist = [];
      for (var pl in plantCount) if (plantCount[pl] < keys.length) dist.push(parseInt(pl, 10));
      if (dist.length < 2) continue;
      dist.sort(function (a, b) { return a - b; });
      for (var xi = 0; xi < dist.length && probes.length < cap; xi++) {
        for (var yj = xi + 1; yj < dist.length && probes.length < cap; yj++) {
          if (!getHybridName(dist[xi], dist[yj])) continue;
          var pkey = hKey(dist[xi], dist[yj]);
          var clash = false; for (var t = 0; t < K; t++) { if (t !== s && template[t] === pkey) { clash = true; break; } }
          if (clash) continue;
          var g = template.slice(); g[s] = pkey; var sig = g.join(',');
          if (seen[sig]) continue; seen[sig] = true; probes.push(g);
        }
      }
    }
    return probes;
  }

  // --- Minimax search over the consistent-answer set (worst-case rounds) ---

  // Partition answer indices `idx` by the feedback signature guess G produces.
  // Returns a map: signature -> array of answer indices (order preserved).
  function partitionBySig(G, idx, A, answerSets, K) {
    var map = Object.create(null);
    for (var i = 0; i < idx.length; i++) {
      var ai = idx[i];
      var sig = feedbackSignature(G, A[ai], answerSets[ai], K);
      if (!map[sig]) map[sig] = [];
      map[sig].push(ai);
    }
    return map;
  }

  // Rank candidate guesses for answer set `idx` by 1-ply Knuth minimax:
  // smallest worst-case (non-solved) bucket first, then smallest expected
  // remaining, preferring guesses that are themselves possible answers.
  // Candidates = a capped subsample of the answers in `idx` (+ optional probes).
  // Returns up to `beam` entries { keys, isAnswer, w, e }.
  function screenGuesses(idx, A, answerSets, K, allC, beam, guessCap, probes, byExpected) {
    var stepAmt = idx.length > guessCap ? Math.ceil(idx.length / guessCap) : 1;
    var scored = [];
    for (var i = 0; i < idx.length; i += stepAmt) {
      var map = partitionBySig(A[idx[i]], idx, A, answerSets, K);
      var w = 0, sq = 0;
      for (var sig in map) { var L = map[sig].length; sq += L * L; if (sig !== allC && L > w) w = L; }
      scored.push({ keys: A[idx[i]], isAnswer: true, w: w, e: sq });
    }
    if (probes) {
      for (var p = 0; p < probes.length; p++) {
        var mp = partitionBySig(probes[p], idx, A, answerSets, K);
        var wp = 0, sqp = 0;
        for (var s2 in mp) { var L2 = mp[s2].length; sqp += L2 * L2; if (s2 !== allC && L2 > wp) wp = L2; }
        scored.push({ keys: probes[p], isAnswer: false, w: wp, e: sqp });
      }
    }
    // byExpected: rank by expected remaining first (good for large sets / mean);
    // otherwise by worst-case bucket first (Knuth minimax, good for the tail).
    scored.sort(function (a, b) {
      if (byExpected) { if (a.e !== b.e) return a.e - b.e; if (a.w !== b.w) return a.w - b.w; }
      else { if (a.w !== b.w) return a.w - b.w; if (a.e !== b.e) return a.e - b.e; }
      if (a.isAnswer !== b.isAnswer) return a.isAnswer ? -1 : 1;
      return a.keys.join(',') < b.keys.join(',') ? -1 : 1;
    });
    return scored.slice(0, beam);
  }

  // Minimax rounds-to-solve for answer set `idx`, searching `depth` plies with
  // width `beam`. Returns { w: worst-case rounds, e: expected rounds }.
  // Memoized by (depth, sorted idx); branch-and-bound on the worst case;
  // `budget` caps the total number of expanded nodes.
  function costOfSet(idx, depth, A, answerSets, K, allC, beam, guessCap, memo, budget) {
    var N = idx.length;
    if (N === 1) return { w: 1, e: 1 };
    if (depth <= 0 || budget.n <= 0) return { w: 2, e: 1 + (N - 1) / N }; // optimistic leaf
    var key = depth + ':' + idx.join(',');
    var cached = memo[key];
    if (cached) return cached;
    budget.n--;

    var cands = screenGuesses(idx, A, answerSets, K, allC, beam, guessCap, null);
    var best = { w: Infinity, e: Infinity };
    for (var c = 0; c < cands.length; c++) {
      var map = partitionBySig(cands[c].keys, idx, A, answerSets, K);
      var w = 1, esum = 0, prune = false;
      for (var sig in map) {
        var b = map[sig];
        if (sig === allC) { esum += b.length; continue; } // solved by this guess
        var sub = costOfSet(b, depth - 1, A, answerSets, K, allC, beam, guessCap, memo, budget);
        if (1 + sub.w > w) w = 1 + sub.w;
        esum += b.length * (1 + sub.e);
        if (w > best.w) { prune = true; break; } // branch & bound (worst-case is primary)
      }
      if (prune) continue;
      var e = esum / N;
      if (w < best.w || (w === best.w && e < best.e)) best = { w: w, e: e };
    }
    memo[key] = best;
    return best;
  }

  // Minimax engine: minimize worst-case rounds via depth-bounded minimax
  // over the consistent-answer set, then expected rounds, then solve chance.
  function minimaxSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    // Cheap upper bound on the joint answer count; if too large, defer to strategic.
    var estimate = 1;
    for (var s = 0; s < codeLen; s++) {
      var sz = state.confirmed[s] ? 1 : state.possible[s].size;
      estimate *= (sz > 0 ? sz : 1);
      if (estimate > TUNING.MINIMAX_ENUM_CAP) break;
    }
    if (estimate > TUNING.MINIMAX_ENUM_CAP) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }

    var A = enumerateAnswers(state, codeLen, TUNING.MINIMAX_ENUM_CAP, TUNING.MINIMAX_NODE_CAP);
    if (!A || A.length === 0) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }
    if (A.length === 1) return A[0].slice();

    // All other slots game-locked, one slot unknown: solve it with exact
    // Knuth minimax (pairing guesses beat the answer-only linear scan).
    if (TUNING.MINIMAX_ENDGAME_SOLVER !== false) {
      var endgame = endgameSingleSlot(state, validHybrids, codeLen, A);
      if (endgame) return endgame;
    }

    var answerSets = new Array(A.length);
    for (var ai = 0; ai < A.length; ai++) answerSets[ai] = new Set(A[ai]);
    var allC = ''; for (var z = 0; z < codeLen; z++) allC += 'C';
    var allIdx = []; for (var i2 = 0; i2 < A.length; i2++) allIdx.push(i2);
    // Candidate non-answer guesses: fresh probes at known (confirmed) slots.
    // These respect game-locked slots, so progress is always guaranteed.
    var probes = buildProbes(state, validHybrids, codeLen, A[0]);
    // Experimental: apply the pairing worst-case idea at EVERY round by adding
    // discriminating probes to the general minimax pool (toggle for A/B).
    if (TUNING.MINIMAX_ALLSTEP_PROBES) {
      var dp = buildDiscriminatingProbes(A, codeLen, TUNING.MINIMAX_PAIR_CAP || 24);
      for (var pp = 0; pp < dp.length; pp++) probes.push(dp[pp]);
    }
    var beam = TUNING.MINIMAX_BEAM;
    var guessCap = TUNING.MINIMAX_GUESS_CAP;
    var depth = TUNING.MINIMAX_LOOKAHEAD_DEPTH;

    // Deep minimax only pays off (and is affordable) on a small endgame set.
    // For larger sets, defer to the tuned Strategic engine — this avoids
    // regressing big configs while still winning the tail on small ones.
    if (depth <= 1 || A.length > TUNING.MINIMAX_SEARCH_CAP) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }

    // Deep minimax over the top-`beam` root candidates.
    var memo = Object.create(null);
    var budget = { n: TUNING.MINIMAX_NODE_BUDGET };
    var rootCands = screenGuesses(allIdx, A, answerSets, codeLen, allC, beam, guessCap, probes);
    var bestG = null, bestW = Infinity, bestE = Infinity, bestIsAns = false, bestKey = null;
    for (var r = 0; r < rootCands.length; r++) {
      var G = rootCands[r].keys;
      var map = partitionBySig(G, allIdx, A, answerSets, codeLen);
      var w = 1, esum = 0, prune = false;
      for (var sig in map) {
        var b = map[sig];
        if (sig === allC) { esum += b.length; continue; }
        var sub = costOfSet(b, depth - 1, A, answerSets, codeLen, allC, beam, guessCap, memo, budget);
        if (1 + sub.w > w) w = 1 + sub.w;
        esum += b.length * (1 + sub.e);
        if (w > bestW) { prune = true; break; }
      }
      if (prune) continue;
      var e = esum / A.length;
      var isAns = rootCands[r].isAnswer;
      var keyStr = G.join(',');
      var better = false;
      if (w < bestW) better = true;
      else if (w === bestW) {
        if (e < bestE - 1e-9) better = true;
        else if (Math.abs(e - bestE) <= 1e-9) {
          if (isAns && !bestIsAns) better = true;
          else if (isAns === bestIsAns && (bestKey === null || keyStr < bestKey)) better = true;
        }
      }
      if (better) { bestW = w; bestE = e; bestG = G; bestIsAns = isAns; bestKey = keyStr; }
    }
    return (bestG || rootCands[0].keys).slice();
  }

  core.minimaxSuggestion = minimaxSuggestion;
  core.buildProbes = buildProbes;
  core._registerEngine(core.ENGINE_MINIMAX, minimaxSuggestion);
  return { minimaxSuggestion: minimaxSuggestion };
});
