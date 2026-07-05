// ============================================================
// GE Decode Solver — ENGINE (standalone, pure logic module)
// ------------------------------------------------------------
// UMD wrapper: exposes `DecodeEngine` on the browser global and
// also supports `module.exports` (Node) for testing/reuse.
// Contains NO UI / React / DOM code — pure solver + data + persistence.
// ============================================================
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node / bundlers
  }
  if (root) {
    root.DecodeEngine = api; // browser global
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ============================================================
  // DATA — Plant combination matrix from Excel
  // ============================================================

  const BASE_PLANTS = [
    'Peashooter', 'Iceburg', 'Puff', 'Wallnut', 'Sunflower',
    'Cabbage', 'Potato', 'Spikeweed', 'Torchwood', 'Rotobaga'
  ];

  const BASE_SHORT = ['Pea', 'Ice', 'Puff', 'Wall', 'Sun', 'Cab', 'Pot', 'Spike', 'Torch', 'Roto'];

  const PLANT_COLORS = [
    '#4ade80', '#60a5fa', '#c084fc', '#f59e0b', '#fbbf24',
    '#22c55e', '#d97706', '#94a3b8', '#ef4444', '#e879f9'
  ];

  // COMBINATIONS[i][j] = hybrid name, null for invalid
  const COMBINATIONS = [
    ['Repeater', 'Snow Pea', 'Scaredy Shroom', 'Peanut', null, 'Sling Pea', 'Dandelion', 'Cactus', 'Fire Pea', 'Skyshooter'],
    ['Snow Pea', 'Icebloom', 'Ice Shroom', null, 'Solar Tomato', 'Snowdrop', 'Stallia', 'Iceweed', 'Ghost Pepper', 'Loquat'],
    ['Scaredy Shroom', 'Ice Shroom', 'Fume Shroom', 'Vamporcini', 'Sun Shroom', 'Spore Shroom', null, 'Bamboo Shoot', 'Fire Gourd', 'Gloom Shroom'],
    ['Peanut', null, 'Vamporcini', 'Tallnut', 'Sweet Potato', null, 'Explode O Nut', 'Endurian', 'Hot Date', 'Spinapple'],
    [null, 'Solar Tomato', 'Sun Shroom', 'Sweet Potato', 'Twin Sunflower', null, 'Moon Bean', 'Shine Vine', 'Plantern', 'Bulbkekengi'],
    ['Sling Pea', 'Snowdrop', 'Spore Shroom', null, null, 'Melon Pult', 'Stickybomb Rice', null, 'Pepper Pult', 'Apple Mortar'],
    ['Dandelion', 'Stallia', null, 'Explode O Nut', 'Moon Bean', 'Stickybomb Rice', 'Primal Mine', 'Lychee', 'Cherry Bomb', null],
    ['Cactus', 'Iceweed', 'Bamboo Shoot', 'Endurian', 'Shine Vine', null, 'Lychee', 'Spikerock', null, null],
    ['Fire Pea', 'Ghost Pepper', 'Fire Gourd', 'Hot Date', 'Plantern', 'Pepper Pult', 'Cherry Bomb', null, 'Inferno', null],
    ['Skyshooter', 'Loquat', 'Gloom Shroom', 'Spinapple', 'Bulbkekengi', 'Apple Mortar', null, null, null, 'Starfruit']
  ];

  const FEEDBACK_TYPES = [
    { id: 'correct', label: 'Correct', icon: '✓', shortLabel: 'Correct' },
    { id: 'wrongslot', label: 'Wrong Slot', icon: '↔', shortLabel: 'Slot' },
    { id: 'partial', label: 'Partial', icon: '◐', shortLabel: 'Part' },
    { id: 'allwrong', label: 'All Wrong', icon: '✕', shortLabel: 'Wrong' }
  ];

  const STORAGE_KEY = 'ge-decode-solver-v1';

  // ============================================================
  // TUNING — named constants for every heuristic / threshold knob.
  // Every value here is copied verbatim from a former inline literal;
  // only the names are new. Changing a value here changes behavior —
  // that is the point — but this refactor changes none of them.
  // ============================================================
  var TUNING = {
    // Constraint propagation
    MAX_PROPAGATION_ITERATIONS: 100, // fixpoint safety cap in propagate()

    // Shared scoring target
    SPLIT_TARGET_RATIO: 0.5,         // ideal overlap ratio — a guess that halves a candidate set

    // First guess (opening)
    FIRST_GUESS_HETERO_BONUS: 0.5,   // prefer pairs of two distinct base plants
    FIRST_GUESS_TIE_EPSILON: 0.001,  // float tolerance when collecting equally-scored openings

    // Feedback-probability estimates (estimateFbProbs)
    UNIFORM_FB_PROB: 0.25,           // fallback when a slot has no possibilities
    WRONGSLOT_BASE_PROB: 0.02,       // small fixed probability assigned to 'wrongslot'
    NON_WRONGSLOT_SCALE: 0.98,       // scale applied to partial/allwrong shares (= 1 - WRONGSLOT_BASE_PROB)

    // Expected-information-gain lookahead
    MIN_OUTCOME_PROB: 0.005,         // skip simulating outcomes below this probability
    LOOKAHEAD_CANDIDATES: 8,         // number of top-scored candidates re-ranked by lookahead
    LOOKAHEAD_MIN_UNKNOWN_SLOTS: 2,  // enable lookahead only with at least this many unknown slots
    LOOKAHEAD_MIN_CANDIDATES: 2,     // ...and at least this many scored candidates
    LOOKAHEAD_INFO_WEIGHT: 0.7,      // blend weight on expected info reduction
    LOOKAHEAD_QUALITY_WEIGHT: 0.3,   // blend weight on composite score

    // Adaptive placement thresholds (strategicSuggestion)
    PLACE_AVG_POSS_WITH_PROBES: 1.5, // with free probes, keep gathering info until avg possibilities <= this
    PLACE_AVG_POSS_NO_PROBES: 3,     // without probes, commit to placement sooner
    PLACE_MAX_POSS: 2,               // any single slot this small also triggers placement

    // Info-mode candidate modifiers
    PROBE_SHARED_BASE_PENALTY: 0.15, // penalize a probe sharing a base plant with the slot's known answer
    UNTESTED_PLANT_BONUS: 0.02,      // reward each not-yet-tested base plant in a probe
    POSSIBLE_AT_SLOT_BONUS: 0.01,    // slight bias toward candidates still possible at the slot
    HETERO_PAIR_BONUS: 0.005,        // prefer heterozygous (two distinct base) candidates

    // Strategic — fresh-plant preference (human tactic: probe unseen plants)
    KNOWN_WRONG_PENALTY: 0.20,       // at a KNOWN slot, penalize probing a hybrid already known absent (no new info)
    STRATEGIC_TIE_EPSILON: 0.02,     // scores within this are "equal info" -> break ties toward fresh plants
    ENDGAME_UNCERTAINTY: 8,          // totalUncertainty <= this => endgame: fresh probes pay off more
    ENDGAME_FRESH_MULT: 4,           // multiply the untested-plant reward in the endgame

    // Optimal engine — information-gain over the consistent-answer set
    OPTIMAL_ENUM_CAP: 2000,          // max joint-space estimate / #answers before falling back to strategic
    OPTIMAL_NODE_CAP: 200000,        // enumeration node budget before fallback
    OPTIMAL_GUESS_CAP: 400           // max candidate guesses scored per round
  };

  // ============================================================
  // SOLVER ENGINE
  // ============================================================

  function hKey(i, j) {
    return Math.min(i, j) + '_' + Math.max(i, j);
  }

  function parseKey(key) {
    const p = key.split('_');
    return [parseInt(p[0], 10), parseInt(p[1], 10)];
  }

  function getHybridName(i, j) {
    return COMBINATIONS[i] && COMBINATIONS[i][j] ? COMBINATIONS[i][j] : null;
  }

  function getValidHybrids(selectedIndices) {
    const sorted = selectedIndices.slice().sort((a, b) => a - b);
    const hybrids = [];
    for (let a = 0; a < sorted.length; a++) {
      for (let b = a; b < sorted.length; b++) {
        const i = sorted[a], j = sorted[b];
        const name = COMBINATIONS[i][j];
        if (name) {
          hybrids.push({ key: hKey(i, j), p1: i, p2: j, name: name });
        }
      }
    }
    return hybrids;
  }

  function createSolverState(validHybrids, codeLen) {
    var all = new Set(validHybrids.map(function (h) { return h.key; }));
    return {
      possible: Array.from({ length: codeLen }, function () { return new Set(all); }),
      mustInclude: new Set(),
      excluded: new Set(),
      confirmed: new Array(codeLen).fill(null),
      gameLocked: new Array(codeLen).fill(false)
    };
  }

  function cloneState(st) {
    return {
      possible: st.possible.map(function (s) { return new Set(s); }),
      mustInclude: new Set(st.mustInclude),
      excluded: new Set(st.excluded),
      confirmed: st.confirmed.slice(),
      gameLocked: st.gameLocked.slice()
    };
  }

  // Apply one feedback result to a single slot, mutating `ns` in place.
  // Single source of truth for the four feedback rules, shared by
  // applyFeedback (real submissions) and simulateFeedback1Slot
  // (hypothetical outcomes during lookahead).
  //
  // `lockOnCorrect` controls whether a 'correct' result also hard-locks
  // the slot via gameLocked: true for real feedback, false for
  // hypotheticals — reproducing the exact prior behavior of both callers.
  function applyFeedbackToSlot(ns, slot, p1, p2, fb, len, lockOnCorrect) {
    var key = hKey(p1, p2);

    if (fb === 'correct') {
      ns.possible[slot] = new Set([key]);
      ns.confirmed[slot] = key;
      if (lockOnCorrect) ns.gameLocked[slot] = true;
      for (var j = 0; j < len; j++) {
        if (j !== slot) ns.possible[j].delete(key);
      }
    } else if (fb === 'wrongslot') {
      ns.possible[slot].delete(key);
      ns.mustInclude.add(key);
    } else if (fb === 'partial') {
      // Hybrid H is not in the answer at all (Wrong Slot would have fired otherwise)
      for (var jp = 0; jp < len; jp++) ns.possible[jp].delete(key);
      ns.excluded.add(key);
      // One of p1, p2 is in the correct pair for this slot
      var kept = new Set();
      for (var k of ns.possible[slot]) {
        var pk = parseKey(k);
        if (pk[0] === p1 || pk[1] === p1 || pk[0] === p2 || pk[1] === p2) {
          kept.add(k);
        }
      }
      ns.possible[slot] = kept;
    } else if (fb === 'allwrong') {
      // Hybrid H is not in the answer at all
      for (var ja = 0; ja < len; ja++) ns.possible[ja].delete(key);
      ns.excluded.add(key);
      // Neither p1 nor p2 is in the correct pair for this slot
      var kept2 = new Set();
      for (var k2 of ns.possible[slot]) {
        var pk2 = parseKey(k2);
        if (pk2[0] !== p1 && pk2[1] !== p1 && pk2[0] !== p2 && pk2[1] !== p2) {
          kept2.add(k2);
        }
      }
      ns.possible[slot] = kept2;
    }
  }

  function applyFeedback(state, guess, feedback) {
    const ns = cloneState(state);
    const len = guess.length;

    for (let s = 0; s < len; s++) {
      applyFeedbackToSlot(ns, s, guess[s].p1, guess[s].p2, feedback[s], len, true);
    }

    propagate(ns, len);
    return ns;
  }

  function propagate(st, len) {
    let changed = true, iter = 0;
    while (changed && iter < TUNING.MAX_PROPAGATION_ITERATIONS) {
      changed = false;
      iter++;

      // Rule 1: single-possibility → confirm
      for (let s = 0; s < len; s++) {
        if (st.possible[s].size === 1 && !st.confirmed[s]) {
          const key = st.possible[s].values().next().value;
          st.confirmed[s] = key;
          for (let j = 0; j < len; j++) {
            if (j !== s && st.possible[j].has(key)) {
              st.possible[j].delete(key);
              changed = true;
            }
          }
        }
      }

      // Rule 2: mustInclude with single viable slot → lock
      for (const mKey of st.mustInclude) {
        const slots = [];
        for (let s = 0; s < len; s++) {
          if (st.possible[s].has(mKey)) slots.push(s);
        }
        if (slots.length === 1 && st.possible[slots[0]].size > 1) {
          st.possible[slots[0]] = new Set([mKey]);
          st.confirmed[slots[0]] = mKey;
          changed = true;
        }
      }
    }
  }

  // ---- Suggestion generation ----

  // Engine names for UI
  var ENGINE_HEURISTIC = 'heuristic';
  var ENGINE_STRATEGIC = 'strategic';

  function generateSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants, engine) {
    if (engine === ENGINE_OPTIMAL) {
      return optimalSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }
    if (engine === ENGINE_STRATEGIC) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }
    return heuristicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
  }

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

  // Count how many of a pair's base plants have not been tested yet.
  function untestedCount(cp, tested) {
    return (tested.has(cp[0]) ? 0 : 1) + (tested.has(cp[1]) ? 0 : 1);
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

  // First guess (shared by both engines): maximize base plant coverage
  // Adds controlled randomness by shuffling among equally-optimal candidates
  function firstGuess(validHybrids, codeLen) {
    var usedP = new Set(), usedH = new Set(), result = [];
    for (var s = 0; s < codeLen; s++) {
      // Find the best score first
      var bestScore = -1;
      for (var hi = 0; hi < validHybrids.length; hi++) {
        var h = validHybrids[hi];
        if (usedH.has(h.key)) continue;
        var nc = (usedP.has(h.p1) ? 0 : 1) + (usedP.has(h.p2) ? 0 : 1);
        var diff = h.p1 !== h.p2 ? TUNING.FIRST_GUESS_HETERO_BONUS : 0;
        var sc = nc + diff;
        if (sc > bestScore) bestScore = sc;
      }
      // Collect all candidates tied at bestScore
      var tied = [];
      for (var hi2 = 0; hi2 < validHybrids.length; hi2++) {
        var h2 = validHybrids[hi2];
        if (usedH.has(h2.key)) continue;
        var nc2 = (usedP.has(h2.p1) ? 0 : 1) + (usedP.has(h2.p2) ? 0 : 1);
        var diff2 = h2.p1 !== h2.p2 ? TUNING.FIRST_GUESS_HETERO_BONUS : 0;
        if (nc2 + diff2 >= bestScore - TUNING.FIRST_GUESS_TIE_EPSILON) tied.push(h2);
      }
      // Pick a random candidate from the tied set
      var bestH = tied.length > 0
        ? tied[Math.floor(Math.random() * tied.length)]
        : null;
      if (!bestH) {
        for (var hi3 = 0; hi3 < validHybrids.length; hi3++) {
          if (!usedH.has(validHybrids[hi3].key)) { bestH = validHybrids[hi3]; break; }
        }
      }
      if (bestH) {
        result.push(bestH.key);
        usedP.add(bestH.p1); usedP.add(bestH.p2);
        usedH.add(bestH.key);
      }
    }
    return result;
  }

  // ================================================================
  // ENGINE 3: Optimal (information-gain over the consistent-answer set)
  // ================================================================
  //
  // "Computer-thinking" solver. When the joint space of still-consistent
  // answers is small enough to enumerate, it evaluates candidate guesses by
  // partitioning that answer set by the feedback each guess would produce, and
  // picks the guess that MINIMIZES the expected number of remaining answers
  // (true information gain). Unlike the strategic engine's hand-tuned
  // probability model, the feedback distribution here is exact. For large
  // spaces (early game) it falls back to the strategic engine.

  var ENGINE_OPTIMAL = 'optimal';

  // Forward feedback oracle: the per-slot feedback signature a guess would get
  // against a hypothetical answer. Priority: correct > wrongslot > partial > allwrong.
  function feedbackSignature(guessKeys, answerKeys, answerSet, K) {
    var sig = '';
    for (var s = 0; s < K; s++) {
      var gk = guessKeys[s];
      if (gk === answerKeys[s]) { sig += 'C'; continue; }
      if (answerSet.has(gk)) { sig += 'W'; continue; }
      var gp = parseKey(gk), ap = parseKey(answerKeys[s]);
      if (gp[0] === ap[0] || gp[0] === ap[1] || gp[1] === ap[0] || gp[1] === ap[1]) sig += 'P';
      else sig += 'A';
    }
    return sig;
  }

  // Enumerate every full answer consistent with the current state:
  // one distinct hybrid per slot drawn from possible[], covering every
  // mustInclude hybrid. Returns null if it exceeds cap/node budget.
  function enumerateAnswers(state, K, cap, nodeCap) {
    var order = [];
    for (var s = 0; s < K; s++) order.push(s);
    order.sort(function (a, b) { return state.possible[a].size - state.possible[b].size; });

    var possArr = new Array(K);
    for (var i = 0; i < K; i++) possArr[i] = Array.from(state.possible[order[i]]);
    var must = Array.from(state.mustInclude);

    var answers = [];
    var used = new Set();
    var answer = new Array(K).fill(null);
    var nodes = 0;
    var aborted = false;

    function rec(idx) {
      if (aborted) return;
      if (++nodes > nodeCap) { aborted = true; return; }
      if (idx === K) {
        for (var m = 0; m < must.length; m++) if (!used.has(must[m])) return;
        answers.push(answer.slice());
        if (answers.length > cap) aborted = true;
        return;
      }
      // Coverage prune: unplaced mustInclude cannot exceed remaining slots.
      var need = 0;
      for (var mm = 0; mm < must.length; mm++) if (!used.has(must[mm])) need++;
      if (need > K - idx) return;

      var slot = order[idx];
      var opts = possArr[idx];
      for (var o = 0; o < opts.length; o++) {
        var key = opts[o];
        if (used.has(key)) continue;
        answer[slot] = key;
        used.add(key);
        rec(idx + 1);
        used.delete(key);
        if (aborted) return;
      }
      answer[slot] = null;
    }

    rec(0);
    return aborted ? null : answers;
  }

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

  function optimalSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    // Cheap upper bound on the joint answer count; if too large, defer to strategic.
    var estimate = 1;
    for (var s = 0; s < codeLen; s++) {
      var sz = state.confirmed[s] ? 1 : state.possible[s].size;
      estimate *= (sz > 0 ? sz : 1);
      if (estimate > TUNING.OPTIMAL_ENUM_CAP) break;
    }
    if (estimate > TUNING.OPTIMAL_ENUM_CAP) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }

    var A = enumerateAnswers(state, codeLen, TUNING.OPTIMAL_ENUM_CAP, TUNING.OPTIMAL_NODE_CAP);
    if (!A || A.length === 0) {
      return strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants);
    }
    if (A.length === 1) return A[0].slice();

    var answerSets = new Array(A.length);
    for (var ai = 0; ai < A.length; ai++) answerSets[ai] = new Set(A[ai]);

    // Candidate guesses: consistent answers (subsampled to a cap) + probes.
    var guesses = [];
    var step = A.length > TUNING.OPTIMAL_GUESS_CAP ? Math.ceil(A.length / TUNING.OPTIMAL_GUESS_CAP) : 1;
    for (var gi = 0; gi < A.length; gi += step) guesses.push(A[gi]);
    var consistentCount = guesses.length; // first `consistentCount` guesses are possible answers
    var probes = buildProbes(state, validHybrids, codeLen, A[0]);
    for (var pj = 0; pj < probes.length; pj++) guesses.push(probes[pj]);

    // Pick the guess minimizing expected remaining answers (Σ|bucket|² / N).
    // Tie-break: prefer a guess that could itself be the answer (chance to win),
    // then smaller worst-case bucket, then deterministic ordering.
    var N = A.length;
    var best = null, bestExp = Infinity, bestIsAns = false, bestMax = Infinity, bestKeyStr = null;
    for (var gj = 0; gj < guesses.length; gj++) {
      var G = guesses[gj];
      var buckets = Object.create(null);
      var maxBucket = 0;
      for (var k = 0; k < N; k++) {
        var sig = feedbackSignature(G, A[k], answerSets[k], codeLen);
        var cnt = (buckets[sig] || 0) + 1;
        buckets[sig] = cnt;
        if (cnt > maxBucket) maxBucket = cnt;
      }
      var exp = 0;
      for (var bk in buckets) exp += buckets[bk] * buckets[bk];
      exp = exp / N;
      var isAns = gj < consistentCount;
      var keyStr = G.join(',');

      var better = false;
      if (exp < bestExp - 1e-9) better = true;
      else if (exp <= bestExp + 1e-9) {
        if (isAns && !bestIsAns) better = true;
        else if (isAns === bestIsAns && maxBucket < bestMax) better = true;
        else if (isAns === bestIsAns && maxBucket === bestMax && (bestKeyStr === null || keyStr < bestKeyStr)) better = true;
      }
      if (better) { bestExp = exp; best = G; bestIsAns = isAns; bestMax = maxBucket; bestKeyStr = keyStr; }
    }

    return best.slice();
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================

  function serializeState(st) {
    return {
      possible: st.possible.map(function (s) { return Array.from(s); }),
      mustInclude: Array.from(st.mustInclude),
      excluded: Array.from(st.excluded),
      confirmed: st.confirmed,
      gameLocked: st.gameLocked
    };
  }

  function deserializeState(d) {
    var codeLen = d.possible.length;
    return {
      possible: d.possible.map(function (a) { return new Set(a); }),
      mustInclude: new Set(d.mustInclude),
      excluded: new Set(d.excluded),
      confirmed: d.confirmed,
      gameLocked: d.gameLocked || new Array(codeLen).fill(false)
    };
  }

  function saveGame(config, data, engine) {
    try {
      var obj = {
        v: 3,
        config: config,
        engine: engine || ENGINE_STRATEGIC,
        data: {
          validHybrids: data.validHybrids,
          solverState: serializeState(data.solverState),
          history: data.history,
          suggestion: data.suggestion
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (_) { /* ignore */ }
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || (obj.v !== 1 && obj.v !== 2 && obj.v !== 3)) return null;
      return {
        config: obj.config,
        engine: obj.engine || ENGINE_STRATEGIC,
        data: {
          validHybrids: obj.data.validHybrids,
          solverState: deserializeState(obj.data.solverState),
          history: obj.data.history,
          suggestion: obj.data.suggestion
        }
      };
    } catch (_) { return null; }
  }

  function clearGame() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  }

  // ============================================================
  // HELPER: build hybrid lookup
  // ============================================================

  function buildHybridLookup(validHybrids) {
    const map = new Map();
    for (const h of validHybrids) map.set(h.key, h);
    return map;
  }

  // ============================================================
  // PUBLIC API — every pure function + data constant is exported
  // ============================================================
  return {
    // Data / constants
    BASE_PLANTS: BASE_PLANTS,
    BASE_SHORT: BASE_SHORT,
    PLANT_COLORS: PLANT_COLORS,
    COMBINATIONS: COMBINATIONS,
    FEEDBACK_TYPES: FEEDBACK_TYPES,
    STORAGE_KEY: STORAGE_KEY,
    ENGINE_HEURISTIC: ENGINE_HEURISTIC,
    ENGINE_STRATEGIC: ENGINE_STRATEGIC,
    ENGINE_OPTIMAL: ENGINE_OPTIMAL,

    // Key / hybrid utilities
    hKey: hKey,
    parseKey: parseKey,
    getHybridName: getHybridName,
    getValidHybrids: getValidHybrids,
    buildHybridLookup: buildHybridLookup,

    // Solver state
    createSolverState: createSolverState,
    cloneState: cloneState,
    applyFeedback: applyFeedback,
    propagate: propagate,

    // Suggestion generation
    generateSuggestion: generateSuggestion,
    heuristicSuggestion: heuristicSuggestion,
    strategicSuggestion: strategicSuggestion,
    optimalSuggestion: optimalSuggestion,
    placementSuggestion: placementSuggestion,
    firstGuess: firstGuess,

    // Strategic engine internals
    compositeScore: compositeScore,
    simulateFeedback1Slot: simulateFeedback1Slot,
    totalUncertainty: totalUncertainty,
    estimateFbProbs: estimateFbProbs,
    lookaheadScore: lookaheadScore,

    // Optimal engine internals
    feedbackSignature: feedbackSignature,
    enumerateAnswers: enumerateAnswers,

    // Persistence
    serializeState: serializeState,
    deserializeState: deserializeState,
    saveGame: saveGame,
    loadGame: loadGame,
    clearGame: clearGame
  };
});
