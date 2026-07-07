// ============================================================
// GE Decode Solver — STRATEGIC ENGINE (info-gathering + lookahead)
// Models a pro human player. Augments the shared core (engine-core.js).
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
  var untestedCount = core.untestedCount, cloneState = core.cloneState;
  var applyFeedbackToSlot = core.applyFeedbackToSlot, propagate = core.propagate;

  // ================================================================
  // ENGINE 2: Strategic (info-gathering with lookahead)
  // ================================================================
  //
  // Key principles:
  // 1. gameLocked slots are truly locked by the game → auto-fill
  // 2. confirmed-but-not-locked slots are "free probes"
  // 3. Multi-slot composite scoring (#1): score across ALL unknown slots
  // 4. AllWrong base-plant elimination (#5): enhanced propagation
  // 5. Adaptive placement threshold (#6): probe-aware mode switching
  // 6. Expected-info-gain lookahead (#4): probability-weighted 1-ply simulation of feedback outcomes

  // --- Proposal #1: Composite scoring across all unknown slots ---
  function compositeScore(candKey, unknownSlots, state) {
    var cp = parseKey(candKey);
    var totalScore = 0;
    var totalWeight = 0;

    for (var i = 0; i < unknownSlots.length; i++) {
      var slot = unknownSlots[i];
      var possSize = state.possible[slot].size;
      if (possSize <= 1) continue;

      var overlap = 0;
      for (var pk of state.possible[slot]) {
        var pp = parseKey(pk);
        if (pp[0] === cp[0] || pp[1] === cp[0] ||
          pp[0] === cp[1] || pp[1] === cp[1]) {
          overlap++;
        }
      }

      var ratio = overlap / possSize;
      var slotScore = -Math.abs(ratio - TUNING.SPLIT_TARGET_RATIO); // 0 = perfect split
      var weight = possSize; // weight by uncertainty

      totalScore += slotScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }



  // --- Expected-information-gain lookahead (1-ply) ---
  // Produce the hypothetical next state if guessing (p1,p2) at `slot`
  // returned feedback `fb`. Uses the shared per-slot rules; passes
  // lockOnCorrect=false so hypotheticals never hard-lock a slot
  // (matches the original behavior — this state is used only for scoring).
  function simulateFeedback1Slot(state, slot, p1, p2, fb, codeLen) {
    var ns = cloneState(state);
    applyFeedbackToSlot(ns, slot, p1, p2, fb, codeLen, false);
    propagate(ns, codeLen);
    return ns;
  }

  function totalUncertainty(state, codeLen) {
    var total = 0;
    for (var s = 0; s < codeLen; s++) {
      if (!state.confirmed[s]) total += state.possible[s].size;
    }
    return total;
  }

  // Estimate feedback probabilities for a candidate at a slot
  function estimateFbProbs(candKey, slot, state, isProbe) {
    var cp = parseKey(candKey);
    var possSize = state.possible[slot].size;
    if (possSize === 0) return [TUNING.UNIFORM_FB_PROB, TUNING.UNIFORM_FB_PROB, TUNING.UNIFORM_FB_PROB, TUNING.UNIFORM_FB_PROB]; // [correct, ws, partial, allwrong]

    var inPossible = state.possible[slot].has(candKey);
    var partialCount = 0, neitherCount = 0;

    for (var pk of state.possible[slot]) {
      if (pk === candKey) continue;
      var pp = parseKey(pk);
      if (pp[0] === cp[0] || pp[1] === cp[0] ||
        pp[0] === cp[1] || pp[1] === cp[1]) {
        partialCount++;
      } else {
        neitherCount++;
      }
    }

    var others = partialCount + neitherCount;
    if (isProbe) {
      // We know slot's answer ≠ candidate. Correct is impossible.
      // WrongSlot unlikely (candidate excluded from knownInAnswer).
      var pPartial = others > 0 ? partialCount / others : 0.5;
      var pAllWrong = others > 0 ? neitherCount / others : 0.5;
      return [0, TUNING.WRONGSLOT_BASE_PROB, pPartial * TUNING.NON_WRONGSLOT_SCALE, pAllWrong * TUNING.NON_WRONGSLOT_SCALE];
    }

    // Normal slot: uniform prior over possible set
    var pCorrect = inPossible ? 1 / possSize : 0;
    var pRemain = 1 - pCorrect;
    var pPartial2 = others > 0 ? (partialCount / others) * pRemain : 0;
    var pAllWrong2 = others > 0 ? (neitherCount / others) * pRemain : 0;
    // Small wrongslot chance if in possible elsewhere
    return [pCorrect, TUNING.WRONGSLOT_BASE_PROB * pRemain, pPartial2 * TUNING.NON_WRONGSLOT_SCALE, pAllWrong2 * TUNING.NON_WRONGSLOT_SCALE];
  }

  function lookaheadScore(candKey, slot, state, codeLen, isProbe) {
    var cp = parseKey(candKey);
    var probs = estimateFbProbs(candKey, slot, state, isProbe);
    var fbTypes = ['correct', 'wrongslot', 'partial', 'allwrong'];
    var currentUnc = totalUncertainty(state, codeLen);
    var expectedReduction = 0;

    for (var fi = 0; fi < fbTypes.length; fi++) {
      if (probs[fi] < TUNING.MIN_OUTCOME_PROB) continue;
      var simState = simulateFeedback1Slot(state, slot, cp[0], cp[1], fbTypes[fi], codeLen);
      var afterUnc = totalUncertainty(simState, codeLen);
      expectedReduction += probs[fi] * (currentUnc - afterUnc);
    }

    return expectedReduction;
  }

  // Among scored candidates, keep those whose score is within an epsilon of the
  // top ("equal information"), then pick the one that probes the most UNTESTED
  // plants (then heterozygous, then deterministic key). This is the human tactic:
  // when two guesses gather equal info, prefer the one using unseen plants.
  function pickBestFresh(scoredList, topScore, tested) {
    var best = null, bestU = -1, bestHet = -1;
    for (var i = 0; i < scoredList.length; i++) {
      var it = scoredList[i];
      if (it.score < topScore - TUNING.STRATEGIC_TIE_EPSILON) continue;
      var p = parseKey(it.key);
      var u = untestedCount(p, tested);
      var het = p[0] !== p[1] ? 1 : 0;
      if (u > bestU ||
        (u === bestU && het > bestHet) ||
        (u === bestU && het === bestHet && (best === null || it.key < best))) {
        best = it.key; bestU = u; bestHet = het;
      }
    }
    return best !== null ? best : (scoredList[0] ? scoredList[0].key : null);
  }

  // --- Main strategic suggestion ---
  function strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    var result = new Array(codeLen).fill(null);
    var used = new Set();

    // Step 1: Fill game-locked slots
    for (var s = 0; s < codeLen; s++) {
      if (state.gameLocked[s] && state.confirmed[s]) {
        result[s] = state.confirmed[s];
        used.add(state.confirmed[s]);
      }
    }

    // Step 2: Classify slots
    var probeSlots = [];
    var unknownSlots = [];
    for (var s2 = 0; s2 < codeLen; s2++) {
      if (state.gameLocked[s2]) continue;
      if (state.confirmed[s2]) {
        probeSlots.push(s2);
      } else {
        unknownSlots.push(s2);
      }
    }

    if (unknownSlots.length === 0 && probeSlots.length === 0) return result;

    // Collect known-in-answer hybrids
    var knownInAnswer = new Set(state.mustInclude);
    for (var s3 = 0; s3 < codeLen; s3++) {
      if (state.confirmed[s3]) knownInAnswer.add(state.confirmed[s3]);
    }

    // Step 3: Proposal #6 — Adaptive placement threshold
    var totalPoss = 0, readyCount = 0, maxPoss = 0;
    for (var i2 = 0; i2 < unknownSlots.length; i2++) {
      var ps = state.possible[unknownSlots[i2]].size;
      totalPoss += ps;
      if (ps <= 1) readyCount++;
      if (ps > maxPoss) maxPoss = ps;
    }
    var avgPoss = unknownSlots.length > 0 ? totalPoss / unknownSlots.length : 0;

    var shouldPlace;
    if (unknownSlots.length === 0) {
      shouldPlace = true;
    } else if (readyCount === unknownSlots.length) {
      shouldPlace = true;
    } else if (probeSlots.length > 0) {
      // With free probes: stay in info mode longer
      shouldPlace = avgPoss <= TUNING.PLACE_AVG_POSS_WITH_PROBES || maxPoss <= TUNING.PLACE_MAX_POSS;
    } else {
      // No probes: place sooner
      shouldPlace = avgPoss <= TUNING.PLACE_AVG_POSS_NO_PROBES || maxPoss <= TUNING.PLACE_MAX_POSS;
    }

    // Also place if WS hybrids fill most remaining slots
    if (!shouldPlace) {
      var allActive = probeSlots.length + unknownSlots.length;
      var unplacedWS = 0;
      for (var mKey of state.mustInclude) {
        var placed = false;
        for (var s4 = 0; s4 < codeLen; s4++) {
          if (state.gameLocked[s4] && state.confirmed[s4] === mKey) { placed = true; break; }
        }
        if (!placed) unplacedWS++;
      }
      if (unplacedWS > 0 && unplacedWS >= allActive - 1) shouldPlace = true;
    }

    if (shouldPlace) {
      for (var pi = 0; pi < probeSlots.length; pi++) {
        result[probeSlots[pi]] = state.confirmed[probeSlots[pi]];
        used.add(state.confirmed[probeSlots[pi]]);
      }
      return placementSuggestion(state, validHybrids, codeLen, unknownSlots.slice(), result, used);
    }

    // --- Info-gathering mode ---
    var allInfoSlots = probeSlots.concat(unknownSlots);
    allInfoSlots.sort(function (a, b) {
      var aP = state.confirmed[a] && !state.gameLocked[a] ? 1 : 0;
      var bP = state.confirmed[b] && !state.gameLocked[b] ? 1 : 0;
      if (aP !== bP) return bP - aP;
      return state.possible[b].size - state.possible[a].size;
    });

    // Pre-compute tested plants for probe modifiers
    var testedPlants = new Set();
    for (var ek of state.excluded) {
      var ep = parseKey(ek);
      testedPlants.add(ep[0]); testedPlants.add(ep[1]);
    }
    for (var ck = 0; ck < codeLen; ck++) {
      if (state.confirmed[ck]) {
        var ckp = parseKey(state.confirmed[ck]);
        testedPlants.add(ckp[0]); testedPlants.add(ckp[1]);
      }
    }
    for (var mk2 of state.mustInclude) {
      var mp2 = parseKey(mk2);
      testedPlants.add(mp2[0]); testedPlants.add(mp2[1]);
    }

    // Endgame: few possibilities left overall -> a fresh (untested) probe
    // yields more information than reusing an already-known hybrid.
    var isEndgame = totalUncertainty(state, codeLen) <= TUNING.ENDGAME_UNCERTAINTY;
    var freshMult = isEndgame ? TUNING.ENDGAME_FRESH_MULT : 1;

    for (var si = 0; si < allInfoSlots.length; si++) {
      var slot = allInfoSlots[si];
      var isProbe = state.confirmed[slot] && !state.gameLocked[slot];

      // Single-possibility unknowns: just place
      if (!isProbe && state.possible[slot].size <= 1) {
        if (state.possible[slot].size === 1) {
          var onlyKey = state.possible[slot].values().next().value;
          result[slot] = onlyKey;
          used.add(onlyKey);
        }
        continue;
      }

      // Build candidate pool (exclude used + known-in-answer)
      var infoCandidates = [];
      for (var hi = 0; hi < validHybrids.length; hi++) {
        var hk = validHybrids[hi].key;
        if (used.has(hk)) continue;
        if (knownInAnswer.has(hk)) continue;
        infoCandidates.push(hk);
      }
      if (infoCandidates.length === 0) {
        for (var hi2 = 0; hi2 < validHybrids.length; hi2++) {
          if (!used.has(validHybrids[hi2].key)) infoCandidates.push(validHybrids[hi2].key);
        }
      }
      if (infoCandidates.length === 0) {
        if (isProbe) { result[slot] = state.confirmed[slot]; used.add(state.confirmed[slot]); }
        continue;
      }

      // --- Phase 1: Composite scoring (#1) + probe modifiers ---
      var scored = [];
      for (var ci = 0; ci < infoCandidates.length; ci++) {
        var cand = infoCandidates[ci];
        var cp = parseKey(cand);
        var cs = compositeScore(cand, unknownSlots, state);

        if (isProbe) {
          var knownKey = state.confirmed[slot];
          var kp = parseKey(knownKey);
          if (cp[0] === kp[0] || cp[0] === kp[1] || cp[1] === kp[0] || cp[1] === kp[1]) {
            cs -= TUNING.PROBE_SHARED_BASE_PENALTY; // penalty: shares base with known answer
          }
          // At a KNOWN slot, a hybrid already known absent gives no new info.
          if (state.excluded.has(cand)) cs -= TUNING.KNOWN_WRONG_PENALTY;
        } else {
          if (state.possible[slot].has(cand)) cs += TUNING.POSSIBLE_AT_SLOT_BONUS;
        }
        // Reward probing unseen plants (scaled up in the endgame).
        cs += untestedCount(cp, testedPlants) * TUNING.UNTESTED_PLANT_BONUS * freshMult;
        if (cp[0] !== cp[1]) cs += TUNING.HETERO_PAIR_BONUS; // prefer heterozygous

        scored.push({ key: cand, score: cs });
      }

      scored.sort(function (a, b) { return b.score - a.score; });

      // --- Phase 2: Expected-info-gain lookahead on top candidates ---
      var useLookahead = unknownSlots.length >= TUNING.LOOKAHEAD_MIN_UNKNOWN_SLOTS && scored.length >= TUNING.LOOKAHEAD_MIN_CANDIDATES;
      var chosen;

      if (useLookahead) {
        var topN = Math.min(TUNING.LOOKAHEAD_CANDIDATES, scored.length);
        var blended = [];
        var bestBlend = -Infinity;
        for (var li = 0; li < topN; li++) {
          var lk = scored[li].key;
          var laScore = lookaheadScore(lk, slot, state, codeLen, isProbe);
          // Blend expected info reduction with composite quality
          var blend = laScore * TUNING.LOOKAHEAD_INFO_WEIGHT + scored[li].score * TUNING.LOOKAHEAD_QUALITY_WEIGHT;
          blended.push({ key: lk, score: blend });
          if (blend > bestBlend) bestBlend = blend;
        }
        // Among equally-informative top candidates, prefer fresh (untested) plants.
        chosen = pickBestFresh(blended, bestBlend, testedPlants);
      } else {
        chosen = pickBestFresh(scored, scored[0].score, testedPlants);
      }

      result[slot] = chosen;
      used.add(chosen);
    }

    return result;
  }

  // Placement mode: place known answers + best remaining guesses
  function placementSuggestion(state, validHybrids, codeLen, activeSlots, result, used) {
    // First, place Wrong Slot hybrids where they fit
    var wsToPlace = [];
    for (var mKey of state.mustInclude) {
      var placed = false;
      for (var s = 0; s < codeLen; s++) {
        if (state.gameLocked[s] && state.confirmed[s] === mKey) { placed = true; break; }
        if (result[s] === mKey) { placed = true; break; }
      }
      if (!placed) wsToPlace.push(mKey);
    }

    // Wrong-Slot confidence: place the most-constrained hybrid first (the one
    // with the fewest viable slots is the one we can place most confidently).
    function wsViableSlots(mKey) {
      var c = 0;
      for (var s = 0; s < codeLen; s++) {
        if (state.gameLocked[s] || result[s]) continue;
        if (state.possible[s].has(mKey)) c++;
      }
      return c;
    }
    wsToPlace.sort(function (a, b) { return wsViableSlots(a) - wsViableSlots(b); });

    // Sort active slots by fewest remaining
    var sortedActive = activeSlots.slice().sort(function (a, b) {
      return state.possible[a].size - state.possible[b].size;
    });

    for (var si = 0; si < sortedActive.length; si++) {
      var slot = sortedActive[si];
      if (result[slot]) continue;

      // Try to place a Wrong Slot hybrid here if it fits
      var wsPlaced = false;
      for (var wi = 0; wi < wsToPlace.length; wi++) {
        var wsKey = wsToPlace[wi];
        if (!used.has(wsKey) && state.possible[slot].has(wsKey)) {
          result[slot] = wsKey;
          used.add(wsKey);
          wsToPlace.splice(wi, 1);
          wsPlaced = true;
          break;
        }
      }
      if (wsPlaced) continue;

      // Pick from remaining possibilities
      var candidates = [];
      for (var k of state.possible[slot]) {
        if (!used.has(k)) candidates.push(k);
      }
      if (!candidates.length) {
        for (var h of validHybrids) {
          if (!used.has(h.key)) { candidates.push(h.key); break; }
        }
      }
      if (candidates.length > 0) {
        // Pick by balanced overlap (same as heuristic)
        var best = candidates[0];
        if (candidates.length > 1 && state.possible[slot].size > 1) {
          var bestBal = Infinity;
          for (var ci = 0; ci < candidates.length; ci++) {
            var c = candidates[ci];
            var cp = parseKey(c);
            var shared = 0;
            for (var other of state.possible[slot]) {
              if (other === c) continue;
              var op = parseKey(other);
              if (op[0] === cp[0] || op[1] === cp[0] || op[0] === cp[1] || op[1] === cp[1]) shared++;
            }
            var tot = state.possible[slot].size - 1;
            var bal = tot > 0 ? Math.abs(shared / tot - TUNING.SPLIT_TARGET_RATIO) : 0;
            if (bal < bestBal) { bestBal = bal; best = c; }
          }
        }
        result[slot] = best;
        used.add(best);
      }
    }
    return result;
  }

  core.strategicSuggestion = strategicSuggestion;
  core.placementSuggestion = placementSuggestion;
  core.compositeScore = compositeScore;
  core.simulateFeedback1Slot = simulateFeedback1Slot;
  core.totalUncertainty = totalUncertainty;
  core.estimateFbProbs = estimateFbProbs;
  core.lookaheadScore = lookaheadScore;
  core._registerEngine(core.ENGINE_STRATEGIC, strategicSuggestion);
  return { strategicSuggestion: strategicSuggestion };
});
