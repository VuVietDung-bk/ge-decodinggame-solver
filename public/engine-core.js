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
    LOOKAHEAD_INFO_WEIGHT: 0.5,      // blend weight on expected info reduction
    LOOKAHEAD_QUALITY_WEIGHT: 0.3,   // blend weight on composite score

    // Adaptive placement thresholds (strategicSuggestion)
    PLACE_AVG_POSS_WITH_PROBES: 1.5, // with free probes, keep gathering info until avg possibilities <= this
    PLACE_AVG_POSS_NO_PROBES: 4,     // without probes, commit to placement sooner
    PLACE_MAX_POSS: 2,               // any single slot this small also triggers placement

    // Info-mode candidate modifiers
    PROBE_SHARED_BASE_PENALTY: 0.15, // penalize a probe sharing a base plant with the slot's known answer
    UNTESTED_PLANT_BONUS: 0.02,      // reward each not-yet-tested base plant in a probe
    POSSIBLE_AT_SLOT_BONUS: 0.4,     // strongly prefer candidates still possible at the slot (chance of `correct`/collapse)
    HETERO_PAIR_BONUS: 0.005,        // prefer heterozygous (two distinct base) candidates

    // Strategic — fresh-plant preference (human tactic: probe unseen plants)
    KNOWN_WRONG_PENALTY: 0.20,       // at a KNOWN slot, penalize probing a hybrid already known absent (no new info)
    STRATEGIC_TIE_EPSILON: 0.02,     // scores within this are "equal info" -> break ties toward fresh plants
    ENDGAME_UNCERTAINTY: 8,          // totalUncertainty <= this => endgame: fresh probes pay off more
    ENDGAME_FRESH_MULT: 4,           // multiply the untested-plant reward in the endgame

    // Minimax engine — information-gain over the consistent-answer set
    MINIMAX_ENUM_CAP: 2000,          // max joint-space estimate / #answers before falling back to strategic
    MINIMAX_NODE_CAP: 200000,        // enumeration node budget before fallback
    MINIMAX_GUESS_CAP: 400,          // max candidate guesses screened per search node
    MINIMAX_LOOKAHEAD_DEPTH: 2,      // minimax search depth (1 = Knuth 1-ply minimax)
    MINIMAX_BEAM: 8,                 // candidate guesses carried forward at each search node
    MINIMAX_SEARCH_CAP: 120,         // max |A| for deep search; above it, fast 1-ply minimax
    MINIMAX_NODE_BUDGET: 20000,      // search-node budget (safety cap on the game-tree size)
    MINIMAX_ENDGAME_CAP: 46,         // max candidates for the exact single-slot endgame minimax
    MINIMAX_ENDGAME_SOLVER: true,    // all-locked single-slot: exact Knuth minimax (pairing beats linear scan)
    MINIMAX_ALLSTEP_PROBES: true,    // every round: add pairing probes to the minimax pool (lowers the mean)
    MINIMAX_PAIR_CAP: 24,            // max pairing probes added per round

    // Entropy engine — maximize expected information (Shannon) of the feedback
    ENTROPY_ENUM_CAP: 2000,          // max #answers to enumerate before falling back to strategic
    ENTROPY_NODE_CAP: 200000,        // enumeration node budget before fallback
    ENTROPY_GUESS_CAP: 500,          // max candidate guesses scored per round
    ENTROPY_SCORE_CAP: 300,          // max answers sampled to estimate each guess's entropy

    // Genetic engine — evolve a population toward consistent (eligible) codes
    GENETIC_POP: 160,                // population size
    GENETIC_GENERATIONS: 60,         // max generations per round
    GENETIC_ELITE_FRAC: 0.25,        // fraction of the population carried over as elites
    GENETIC_MUTATION: 0.2,           // per-free-slot mutation probability
    GENETIC_MAX_ELIGIBLE: 60,        // stop early once this many distinct eligible codes are found
    GENETIC_SELECT_CAP: 60,          // max eligible codes scored when choosing the guess
    GENETIC_ENUM_CAP: 8000          // if the space is wider than this, defer the opening to Strategic
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

  // Engine registry: each engine module (engine-heuristic/strategic/minimax.js)
  // registers its suggestion function here via _registerEngine. This keeps the
  // engines in separate files while the core stays their single dispatch point.
  var _engines = {};
  function _registerEngine(name, fn) { _engines[name] = fn; }

  function generateSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants, engine) {
    var fn = _engines[engine] || _engines[ENGINE_HEURISTIC];
    return fn(state, validHybrids, codeLen, isFirst, selectedPlants);
  }



  // Count how many of a pair's base plants have not been tested yet.
  function untestedCount(cp, tested) {
    return (tested.has(cp[0]) ? 0 : 1) + (tested.has(cp[1]) ? 0 : 1);
  }

  // First guess (shared by both engines): maximize base plant coverage
  // Adds controlled randomness by shuffling among equally-minimax candidates
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

  var ENGINE_MINIMAX = 'minimax';

  // ============================================================
  // SHARED SEARCH PRIMITIVES (used by any answer-set engine:
  // minimax, entropy, ...). Kept in the core so engines don't
  // depend on one another for these.
  // ============================================================

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
    ENGINE_MINIMAX: ENGINE_MINIMAX,

    // Tuning knobs (exposed so a benchmark can search for good values)
    TUNING: TUNING,

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
    applyFeedbackToSlot: applyFeedbackToSlot,
    propagate: propagate,

    // Suggestion generation + engine registry.
    // The per-engine suggestion functions (heuristicSuggestion,
    // strategicSuggestion, minimaxSuggestion, ...) and their internals are
    // attached here by the engine modules when they load.
    generateSuggestion: generateSuggestion,
    _registerEngine: _registerEngine,
    _engines: _engines,
    firstGuess: firstGuess,
    untestedCount: untestedCount,
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
