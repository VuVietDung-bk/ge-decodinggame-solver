(function () {
  'use strict';

  const e = React.createElement;
  const { useState, useMemo, useCallback, useEffect, useRef, Fragment } = React;

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
    ['Repeater',       'Snow Pea',     'Scaredy Shroom', 'Peanut',        null,              'Sling Pea',       'Dandelion',       'Cactus',      'Fire Pea',      'Skyshooter'],
    ['Snow Pea',       'Icebloom',     'Ice Shroom',     null,            'Solar Tomato',    'Snowdrop',        'Stallia',         'Iceweed',     'Ghost Pepper',  'Loquat'],
    ['Scaredy Shroom', 'Ice Shroom',   'Fume Shroom',    'Vamporcini',    'Sun Shroom',      'Spore Shroom',    null,              'Bamboo Shoot','Fire Gourd',    'Gloom Shroom'],
    ['Peanut',         null,           'Vamporcini',     'Tallnut',       'Sweet Potato',    null,              'Explode O Nut',   'Endurian',    'Hot Date',      'Spinapple'],
    [null,             'Solar Tomato', 'Sun Shroom',     'Sweet Potato',  'Twin Sunflower',  null,              'Moon Bean',       'Shine Vine',  'Plantern',      'Bulbkekengi'],
    ['Sling Pea',      'Snowdrop',     'Spore Shroom',   null,            null,              'Melon Pult',      'Stickybomb Rice', null,          'Pepper Pult',   'Apple Mortar'],
    ['Dandelion',      'Stallia',      null,             'Explode O Nut', 'Moon Bean',       'Stickybomb Rice', 'Primal Mine',     'Lychee',      'Cherry Bomb',   null],
    ['Cactus',         'Iceweed',      'Bamboo Shoot',   'Endurian',      'Shine Vine',      null,              'Lychee',          'Spikerock',   null,            null],
    ['Fire Pea',       'Ghost Pepper', 'Fire Gourd',     'Hot Date',      'Plantern',        'Pepper Pult',     'Cherry Bomb',     null,          'Inferno',       null],
    ['Skyshooter',     'Loquat',       'Gloom Shroom',   'Spinapple',     'Bulbkekengi',     'Apple Mortar',    null,              null,          null,            'Starfruit']
  ];

  const FEEDBACK_TYPES = [
    { id: 'correct',   label: 'Correct',    icon: '✓', shortLabel: 'Correct' },
    { id: 'wrongslot', label: 'Wrong Slot', icon: '↔', shortLabel: 'Slot' },
    { id: 'partial',   label: 'Partial',    icon: '◐', shortLabel: 'Part' },
    { id: 'allwrong',  label: 'All Wrong',  icon: '✕', shortLabel: 'Wrong' }
  ];

  const STORAGE_KEY = 'ge-decode-solver-v1';

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

  function applyFeedback(state, guess, feedback) {
    const ns = cloneState(state);
    const len = guess.length;

    for (let s = 0; s < len; s++) {
      const p1 = guess[s].p1, p2 = guess[s].p2;
      const key = hKey(p1, p2);
      const fb = feedback[s];

      if (fb === 'correct') {
        ns.possible[s] = new Set([key]);
        ns.confirmed[s] = key;
        ns.gameLocked[s] = true;
        for (var j = 0; j < len; j++) {
          if (j !== s) ns.possible[j].delete(key);
        }
      } else if (fb === 'wrongslot') {
        ns.possible[s].delete(key);
        ns.mustInclude.add(key);
      } else if (fb === 'partial') {
        // Hybrid H not in answer at all (Wrong Slot would have fired otherwise)
        for (let j = 0; j < len; j++) ns.possible[j].delete(key);
        ns.excluded.add(key);
        // One of p1, p2 is in correct pair for slot s
        const kept = new Set();
        for (const k of ns.possible[s]) {
          const pk = parseKey(k);
          if (pk[0] === p1 || pk[1] === p1 || pk[0] === p2 || pk[1] === p2) {
            kept.add(k);
          }
        }
        ns.possible[s] = kept;
      } else if (fb === 'allwrong') {
        // Hybrid H not in answer at all
        for (let j = 0; j < len; j++) ns.possible[j].delete(key);
        ns.excluded.add(key);
        // Neither p1 nor p2 in correct pair for slot s
        const kept2 = new Set();
        for (const k of ns.possible[s]) {
          const pk = parseKey(k);
          if (pk[0] !== p1 && pk[1] !== p1 && pk[0] !== p2 && pk[1] !== p2) {
            kept2.add(k);
          }
        }
        ns.possible[s] = kept2;
      }
    }

    propagate(ns, len);
    return ns;
  }

  function propagate(st, len) {
    let changed = true, iter = 0;
    while (changed && iter < 100) {
      changed = false;
      iter++;

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
          var bal = total > 1 ? Math.abs(shared / (total - 1) - 0.5) : 0;
          if (bal < bestBal) { bestBal = bal; best = cand; }
        }
      }
      result[slot] = best;
      if (best) used.add(best);
    }
    return result;
  }

  // ================================================================
  // ENGINE 2: Strategic (info-gathering, avoids placing known answers)
  // ================================================================
  //
  // Key principles:
  // 1. gameLocked slots are truly locked by the game → auto-fill
  // 2. confirmed-but-not-locked slots are "free probes" — we know
  //    the answer but the game still requires input, so we can
  //    test other hybrids there for info
  // 3. Avoid guessing hybrids known to be in the answer (Wrong Slot)
  //    until enough info to place everything confidently
  // 4. Maximize information per guess: pick hybrids whose base plants
  //    split remaining possibilities ~50/50
  // 5. Consider ALL valid hybrids as probes
  // 6. Place Wrong Slot hybrids strategically when remaining
  //    unknowns are few enough that exploration would waste turns

  function strategicSuggestion(state, validHybrids, codeLen, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, codeLen);

    var result = new Array(codeLen).fill(null);
    var used = new Set();

    // Step 1: Fill ONLY game-locked slots (not solver-confirmed)
    for (var s = 0; s < codeLen; s++) {
      if (state.gameLocked[s] && state.confirmed[s]) {
        result[s] = state.confirmed[s];
        used.add(state.confirmed[s]);
      }
    }

    // Step 2: Classify slots
    // - lockedSlots: game has locked them (skip)
    // - probeSlots: solver knows answer, game hasn't locked → free probe
    // - unknownSlots: solver doesn't know yet → need info
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

    // If everything is game-locked or solved, just place known answers
    if (unknownSlots.length === 0 && probeSlots.length === 0) return result;

    // Collect known-in-answer hybrids (Wrong Slot + confirmed)
    var knownInAnswer = new Set(state.mustInclude);
    for (var s3 = 0; s3 < codeLen; s3++) {
      if (state.confirmed[s3]) knownInAnswer.add(state.confirmed[s3]);
    }

    // Count truly unknown slots that have few remaining possibilities
    var totalPoss = 0;
    var readyCount = 0;
    for (var i2 = 0; i2 < unknownSlots.length; i2++) {
      var ps = state.possible[unknownSlots[i2]].size;
      totalPoss += ps;
      if (ps <= 1) readyCount++;
    }
    var avgPoss = unknownSlots.length > 0 ? totalPoss / unknownSlots.length : 0;

    // Decide: info-gathering or final placement?
    var shouldPlace = unknownSlots.length === 0
      || avgPoss <= 2
      || readyCount === unknownSlots.length;

    // Also place if Wrong Slot hybrids account for most unknowns
    if (!shouldPlace) {
      var allActive = probeSlots.length + unknownSlots.length;
      var unplacedWS = 0;
      for (var mKey of state.mustInclude) {
        var isPlaced = false;
        for (var s4 = 0; s4 < codeLen; s4++) {
          if (state.gameLocked[s4] && state.confirmed[s4] === mKey) { isPlaced = true; break; }
        }
        if (!isPlaced) unplacedWS++;
      }
      if (unplacedWS > 0 && unplacedWS >= allActive - 1) {
        shouldPlace = true;
      }
    }

    if (shouldPlace) {
      // Place known answers for probe slots + best guesses for unknown slots
      for (var pi = 0; pi < probeSlots.length; pi++) {
        var pSlot = probeSlots[pi];
        result[pSlot] = state.confirmed[pSlot];
        used.add(state.confirmed[pSlot]);
      }
      var activeForPlacement = unknownSlots.slice();
      return placementSuggestion(state, validHybrids, codeLen, activeForPlacement, result, used);
    }

    // --- Info-gathering mode ---
    // Combine probe slots + unknown slots as info targets
    // Probe slots are valuable: we KNOW the answer so any feedback
    // from testing a different hybrid is "free" info
    var allInfoSlots = probeSlots.concat(unknownSlots);

    // Sort: probe slots first (free info), then unknown by most possibilities
    allInfoSlots.sort(function (a, b) {
      var aIsProbe = state.confirmed[a] && !state.gameLocked[a] ? 1 : 0;
      var bIsProbe = state.confirmed[b] && !state.gameLocked[b] ? 1 : 0;
      if (aIsProbe !== bIsProbe) return bIsProbe - aIsProbe;
      return state.possible[b].size - state.possible[a].size;
    });

    for (var si = 0; si < allInfoSlots.length; si++) {
      var slot = allInfoSlots[si];
      var isProbe = state.confirmed[slot] && !state.gameLocked[slot];

      // For unknown slots with exactly 1 possibility, just place it
      if (!isProbe && state.possible[slot].size <= 1) {
        if (state.possible[slot].size === 1) {
          var onlyKey = state.possible[slot].values().next().value;
          result[slot] = onlyKey;
          used.add(onlyKey);
        }
        continue;
      }

      // For probe slots: pick a hybrid that gives info about OTHER
      // unknown slots (the slot's own answer is already known)
      // For unknown slots: pick a hybrid that splits this slot's remaining
      // possibilities ~50/50

      // Build candidate pool excluding used and known-in-answer
      var infoCandidates = [];
      for (var hi = 0; hi < validHybrids.length; hi++) {
        var hk = validHybrids[hi].key;
        if (used.has(hk)) continue;
        if (knownInAnswer.has(hk)) continue;
        infoCandidates.push(hk);
      }

      if (infoCandidates.length === 0) {
        for (var hi2 = 0; hi2 < validHybrids.length; hi2++) {
          if (!used.has(validHybrids[hi2].key)) {
            infoCandidates.push(validHybrids[hi2].key);
          }
        }
      }

      if (infoCandidates.length === 0) {
        // Fallback: place known answer if probe slot
        if (isProbe) {
          result[slot] = state.confirmed[slot];
          used.add(state.confirmed[slot]);
        }
        continue;
      }

      var bestCand = infoCandidates[0];
      var bestScore = -Infinity;

      if (isProbe) {
        // Score by how well this probe splits the MOST-uncertain
        // unknown slot's remaining possibilities
        var targetSlot = -1;
        var targetSize = 0;
        for (var ti = 0; ti < unknownSlots.length; ti++) {
          var ts = unknownSlots[ti];
          if (state.possible[ts].size > targetSize) {
            targetSize = state.possible[ts].size;
            targetSlot = ts;
          }
        }
        if (targetSlot >= 0 && targetSize > 1) {
          for (var ci = 0; ci < infoCandidates.length; ci++) {
            var cand = infoCandidates[ci];
            var cp = parseKey(cand);
            var overlap = 0;
            for (var tpk of state.possible[targetSlot]) {
              var ppk = parseKey(tpk);
              if (ppk[0] === cp[0] || ppk[1] === cp[0] ||
                  ppk[0] === cp[1] || ppk[1] === cp[1]) {
                overlap++;
              }
            }
            var ratio = overlap / targetSize;
            var score = -Math.abs(ratio - 0.5);
            var diff = cp[0] !== cp[1] ? 0.005 : 0;
            score += diff;
            if (score > bestScore) { bestScore = score; bestCand = cand; }
          }
        }
      } else {
        // Score by how well this splits THIS slot's possibilities
        var possSize = state.possible[slot].size;
        for (var ci2 = 0; ci2 < infoCandidates.length; ci2++) {
          var cand2 = infoCandidates[ci2];
          var cp2 = parseKey(cand2);
          var overlap2 = 0;
          for (var pk2 of state.possible[slot]) {
            var ppk2 = parseKey(pk2);
            if (ppk2[0] === cp2[0] || ppk2[1] === cp2[0] ||
                ppk2[0] === cp2[1] || ppk2[1] === cp2[1]) {
              overlap2++;
            }
          }
          var ratio2 = overlap2 / possSize;
          var balance2 = -Math.abs(ratio2 - 0.5);
          var inSet2 = state.possible[slot].has(cand2) ? 0.01 : 0;
          var diff2 = cp2[0] !== cp2[1] ? 0.005 : 0;
          var score2 = balance2 + inSet2 + diff2;
          if (score2 > bestScore) { bestScore = score2; bestCand = cand2; }
        }
      }

      result[slot] = bestCand;
      used.add(bestCand);
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
            var bal = tot > 0 ? Math.abs(shared / tot - 0.5) : 0;
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
  function firstGuess(validHybrids, codeLen) {
    var usedP = new Set(), usedH = new Set(), result = [];
    for (var s = 0; s < codeLen; s++) {
      var bestH = null, bestScore = -1;
      for (var hi = 0; hi < validHybrids.length; hi++) {
        var h = validHybrids[hi];
        if (usedH.has(h.key)) continue;
        var nc = (usedP.has(h.p1) ? 0 : 1) + (usedP.has(h.p2) ? 0 : 1);
        var diff = h.p1 !== h.p2 ? 0.5 : 0;
        var sc = nc + diff;
        if (sc > bestScore) { bestScore = sc; bestH = h; }
      }
      if (!bestH) {
        for (var hi2 = 0; hi2 < validHybrids.length; hi2++) {
          if (!usedH.has(validHybrids[hi2].key)) { bestH = validHybrids[hi2]; break; }
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
  // COMPONENTS
  // ============================================================

  // ---- App (root) ----

  function App() {
    var saved = useMemo(function () { return loadGame(); }, []);
    var [screen, setScreen] = useState(saved ? 'solver' : 'setup');
    var [config, setConfig] = useState(saved ? saved.config : null);
    var [data, setData] = useState(saved ? saved.data : null);
    var [engine, setEngine] = useState(saved ? saved.engine : ENGINE_STRATEGIC);

    var handleStart = useCallback(function (cfg) {
      var vh = getValidHybrids(cfg.selectedPlants);
      var st = createSolverState(vh, cfg.codeLength);
      var sug = generateSuggestion(st, vh, cfg.codeLength, true, cfg.selectedPlants, engine);
      var d = { validHybrids: vh, solverState: st, history: [], suggestion: sug };
      setConfig(cfg);
      setData(d);
      setScreen('solver');
      saveGame(cfg, d, engine);
    }, [engine]);

    var handleReset = useCallback(function () {
      setScreen('setup');
      setConfig(null);
      setData(null);
      clearGame();
    }, []);

    var handleUpdate = useCallback(function (newData) {
      setData(newData);
      saveGame(config, newData, engine);
    }, [config, engine]);

    var handleEngineChange = useCallback(function (newEngine) {
      setEngine(newEngine);
      if (data) {
        var newSug = generateSuggestion(data.solverState, data.validHybrids, config.codeLength, data.history.length === 0, config.selectedPlants, newEngine);
        var nd = Object.assign({}, data, { suggestion: newSug });
        setData(nd);
        saveGame(config, nd, newEngine);
      }
    }, [config, data]);

    if (screen === 'setup' || !config || !data) {
      return e(SetupScreen, { onStart: handleStart });
    }

    return e(SolverScreen, {
      config: config, data: data, onUpdate: handleUpdate,
      onReset: handleReset, engine: engine, onEngineChange: handleEngineChange
    });
  }

  // ---- SetupScreen (simplified: first N plants auto-selected) ----

  function SetupScreen({ onStart }) {
    var [plantCount, setPlantCount] = useState(5);
    var [codeLength, setCodeLength] = useState(4);

    // Always use the first N base plants
    var selectedPlants = useMemo(function () {
      var arr = [];
      for (var i = 0; i < plantCount; i++) arr.push(i);
      return arr;
    }, [plantCount]);

    var validHybrids = useMemo(function () {
      return getValidHybrids(selectedPlants);
    }, [selectedPlants]);

    var canStart = plantCount >= 3 && codeLength >= 3 && codeLength <= validHybrids.length;

    function handleStart() {
      if (!canStart) return;
      onStart({ selectedPlants: selectedPlants, codeLength: codeLength });
    }

    return e('div', { className: 'setup-screen' },
      e('div', { className: 'setup-panel' },

        e('div', { className: 'setup-header' },
          e('div', { className: 'setup-icon' }, '🧬'),
          e('h1', null, 'GE Decode Solver'),
          e('p', null, 'Intelligent puzzle assistant for the Decode game')
        ),

        // Difficulty: Plant count
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Plant Count'),
          e('div', { className: 'setup-row' },
            e('label', null, 'Number of base plants (3–10)'),
            e('input', {
              className: 'setup-input',
              type: 'range', min: 3, max: 10,
              value: plantCount,
              onChange: function (ev) {
                setPlantCount(parseInt(ev.target.value) || 3);
              }
            }),
            e('span', { className: 'setup-range-value' }, plantCount)
          )
        ),

        // Show which plants are selected
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Base Plants'),
          e('div', { className: 'plant-grid' },
            BASE_PLANTS.map(function (name, idx) {
              var sel = idx < plantCount;
              return e('div', {
                key: idx,
                className: 'plant-chip' + (sel ? ' selected' : ' disabled')
              },
                e('span', { className: 'plant-chip-index' }, idx + 1),
                e('div', {
                  className: 'plant-avatar',
                  style: { background: sel
                    ? 'linear-gradient(135deg, ' + PLANT_COLORS[idx] + ', ' + PLANT_COLORS[idx] + '88)'
                    : 'rgba(255,255,255,0.06)' }
                }, BASE_SHORT[idx].charAt(0)),
                e('span', { className: 'plant-chip-name' }, BASE_SHORT[idx])
              );
            })
          )
        ),

        // Code length
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Code Length'),
          e('div', { className: 'setup-row' },
            e('label', null, 'Number of slots to decode (3–10)'),
            e('input', {
              className: 'setup-input',
              type: 'range', min: 3, max: 10,
              value: codeLength,
              onChange: function (ev) {
                setCodeLength(parseInt(ev.target.value) || 3);
              }
            }),
            e('span', { className: 'setup-range-value' }, codeLength)
          )
        ),

        // Info
        e('div', { className: 'setup-info' },
          e('span', { className: 'info-pill accent' }, plantCount + ' plants'),
          e('span', { className: 'info-pill' }, validHybrids.length + ' hybrids'),
          e('span', { className: 'info-pill' }, codeLength + ' slots'),
          codeLength > validHybrids.length
            ? e('span', { className: 'info-pill warning' }, '⚠ Code too long for available hybrids')
            : null
        ),

        // Start
        e('button', {
          className: 'start-btn',
          onClick: handleStart,
          disabled: !canStart
        }, 'Start Solving')
      )
    );
  }

  // ---- SolverScreen ----

  function SolverScreen({ config, data, onUpdate, onReset, engine, onEngineChange }) {
    var codeLen = config.codeLength;
    var lookup = useMemo(function () { return buildHybridLookup(data.validHybrids); }, [data.validHybrids]);
    var roundNum = data.history.length;

    var [guess, setGuess] = useState(function () {
      return suggestionToGuess(data.suggestion, lookup);
    });
    var [feedback, setFeedback] = useState(function () {
      return new Array(codeLen).fill(null);
    });

    // Auto-fill game-locked slots in guess + feedback
    useEffect(function () {
      setGuess(function (prev) {
        var next = prev.slice();
        for (var s = 0; s < codeLen; s++) {
          if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
            var pk = parseKey(data.solverState.confirmed[s]);
            next[s] = { p1: pk[0], p2: pk[1] };
          }
        }
        return next;
      });
    }, [data.solverState.gameLocked]);

    // Reset guess when round changes
    useEffect(function () {
      var newGuess = suggestionToGuess(data.suggestion, lookup);
      // Keep game-locked slots locked
      for (var s = 0; s < codeLen; s++) {
        if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
          var pk = parseKey(data.solverState.confirmed[s]);
          newGuess[s] = { p1: pk[0], p2: pk[1] };
        }
      }
      setGuess(newGuess);
      // Auto-fill feedback for game-locked slots
      var newFb = new Array(codeLen).fill(null);
      for (var s2 = 0; s2 < codeLen; s2++) {
        if (data.solverState.gameLocked[s2]) newFb[s2] = 'correct';
      }
      setFeedback(newFb);
    }, [roundNum, codeLen]);

    // Puzzle is solved only when ALL slots are game-locked
    var isSolved = data.solverState.gameLocked.every(function (l) { return l; });
    var hasContradiction = data.solverState.possible.some(function (s) { return s.size === 0; });

    // For submit validation: only check NON-GAME-LOCKED slots
    var activeSlots = [];
    for (var s = 0; s < codeLen; s++) {
      if (!data.solverState.gameLocked[s]) activeSlots.push(s);
    }

    var allActiveFbSet = activeSlots.every(function (s) { return feedback[s] !== null; });
    var allActiveGuessValid = activeSlots.every(function (s) {
      var g = guess[s];
      return g && g.p1 !== null && g.p2 !== null && getHybridName(g.p1, g.p2) !== null;
    });
    var canSubmit = allActiveFbSet && allActiveGuessValid && !isSolved && activeSlots.length > 0;

    function handleUseSuggestion() {
      var newGuess = suggestionToGuess(data.suggestion, lookup);
      for (var s = 0; s < codeLen; s++) {
        if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
          var pk = parseKey(data.solverState.confirmed[s]);
          newGuess[s] = { p1: pk[0], p2: pk[1] };
        }
      }
      setGuess(newGuess);
    }

    function handlePlantChange(slot, which, val) {
      if (data.solverState.gameLocked[slot]) return; // locked by game
      setGuess(function (prev) {
        var next = prev.slice();
        next[slot] = Object.assign({}, next[slot]);
        next[slot][which] = val;
        return next;
      });
    }

    function handleFeedbackChange(slot, fb) {
      if (data.solverState.gameLocked[slot]) return; // locked by game
      setFeedback(function (prev) {
        var next = prev.slice();
        next[slot] = prev[slot] === fb ? null : fb;
        return next;
      });
    }

    function handleSubmit() {
      if (!canSubmit) return;
      // Build full guess/feedback arrays (game-locked slots auto-filled)
      var fullGuess = guess.map(function (g, i) {
        if (data.solverState.gameLocked[i] && data.solverState.confirmed[i]) {
          var pk = parseKey(data.solverState.confirmed[i]);
          return { p1: pk[0], p2: pk[1] };
        }
        return { p1: g.p1, p2: g.p2 };
      });
      var fullFeedback = feedback.map(function (fb, i) {
        return data.solverState.gameLocked[i] ? 'correct' : fb;
      });
      var newState = applyFeedback(data.solverState, fullGuess, fullFeedback);
      var newHistory = data.history.concat([{ guess: fullGuess, feedback: fullFeedback }]);
      var newSug = generateSuggestion(newState, data.validHybrids, codeLen, false, config.selectedPlants, engine);
      onUpdate({
        validHybrids: data.validHybrids,
        solverState: newState,
        history: newHistory,
        suggestion: newSug
      });
    }

    function handleNewGame() { onReset(); }

    function handleRestartSameConfig() {
      var vh = data.validHybrids;
      var st = createSolverState(vh, codeLen);
      var sug = generateSuggestion(st, vh, codeLen, true, config.selectedPlants, engine);
      onUpdate({ validHybrids: vh, solverState: st, history: [], suggestion: sug });
    }

    var lockedCount = data.solverState.gameLocked.filter(function (l) { return l; }).length;
    var deducedCount = data.solverState.confirmed.filter(function (c, i) { return c !== null && !data.solverState.gameLocked[i]; }).length;

    return e('div', { className: 'solver-screen' },

      // Header
      e('header', { className: 'solver-header' },
        e('div', { className: 'solver-brand' },
          e('div', { className: 'solver-logo' }, '🧬'),
          e('div', null,
            e('h1', null, 'Decode Solver'),
            e('p', null, config.selectedPlants.length + ' plants · ' + codeLen + ' slots · Round ' + (roundNum + 1) +
              (lockedCount > 0 ? ' · ' + lockedCount + ' 🔒' : '') +
              (deducedCount > 0 ? ' · ' + deducedCount + ' 💡' : ''))
          )
        ),
        e('div', { className: 'solver-actions' },
          e('button', { className: 'header-btn', onClick: handleRestartSameConfig }, '↻ Restart'),
          e('button', { className: 'header-btn danger', onClick: handleNewGame }, 'New Game')
        )
      ),

      // Solved banner
      isSolved ? e('div', { className: 'solved-banner' },
        e('span', { className: 'solved-icon' }, '🎉'),
        e('div', { className: 'solved-text' },
          e('h3', null, 'Puzzle Solved!'),
          e('p', null, 'Cracked in ' + roundNum + ' round' + (roundNum !== 1 ? 's' : '') + '.')
        )
      ) : null,

      // Contradiction warning
      hasContradiction && !isSolved ? e('div', { className: 'warning-banner' },
        e('span', { className: 'warning-icon' }, '⚠'),
        e('span', null, 'Some slots have 0 possibilities. Double-check your feedback entries.')
      ) : null,

      // Suggestion panel
      e(SuggestionPanel, {
        suggestion: data.suggestion, solverState: data.solverState,
        lookup: lookup, codeLen: codeLen, isSolved: isSolved,
        onUseSuggestion: handleUseSuggestion
      }),

      // Guess input panel (horizontal, only if not solved)
      !isSolved ? e('div', { className: 'solver-panel' },
        e('div', { className: 'panel-title-bar' },
          e('div', { className: 'panel-title' },
            e('span', { className: 'panel-title-icon' }, '✏️'),
            e('h2', null, 'Your Guess & Feedback')
          ),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            e('span', { className: 'panel-title-badge' }, 'Round ' + (roundNum + 1)),
            e('div', { className: 'engine-switcher' },
              e('button', {
                className: 'engine-opt' + (engine === ENGINE_STRATEGIC ? ' active' : ''),
                onClick: function () { onEngineChange(ENGINE_STRATEGIC); },
                title: 'Strategic: maximizes information, avoids placing known answers prematurely'
              }, '🧠 Strategic'),
              e('button', {
                className: 'engine-opt' + (engine === ENGINE_HEURISTIC ? ' active' : ''),
                onClick: function () { onEngineChange(ENGINE_HEURISTIC); },
                title: 'Heuristic: greedy placement-focused approach'
              }, '⚡ Heuristic')
            )
          )
        ),

        // Engine description
        e('div', { className: 'engine-note' },
          engine === ENGINE_STRATEGIC
            ? '💡 Strategic mode: gathers info first, avoids placing known answers until confident. Correctly-solved slots are locked by the game.'
            : '⚡ Heuristic mode: greedily picks from remaining possibilities for each slot.'
        ),

        // Horizontal guess columns
        e('div', { className: 'guess-horizontal-scroll' },
          e('div', { className: 'guess-horizontal' },
            Array.from({ length: codeLen }).map(function (_, idx) {
              var isGameLocked = data.solverState.gameLocked[idx];
              var isSolverKnown = !isGameLocked && data.solverState.confirmed[idx] !== null;
              var g = guess[idx] || { p1: null, p2: null };
              var hybridName = (g.p1 !== null && g.p2 !== null) ? getHybridName(g.p1, g.p2) : null;

              if (isGameLocked) {
                var confKey = data.solverState.confirmed[idx];
                var confH = lookup.get(confKey);
                var confPk = parseKey(confKey);
                var confName = confH ? confH.name : getHybridName(confPk[0], confPk[1]) || '?';
                return e('div', { key: idx, className: 'guess-column locked' },
                  e('div', { className: 'guess-col-header' },
                    e('div', { className: 'guess-col-number' }, '✓'),
                    e('span', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Slot ' + (idx + 1))
                  ),
                  e('div', { className: 'guess-col-result locked-name' }, confName),
                  e('div', { className: 'guess-col-pair' }, BASE_SHORT[confPk[0]] + ' + ' + BASE_SHORT[confPk[1]])
                );
              }

              return e('div', { key: idx, className: 'guess-column' + (isSolverKnown ? ' solver-known' : '') },
                e('div', { className: 'guess-col-header' },
                  e('div', { className: 'guess-col-number' + (isSolverKnown ? ' known' : '') }, isSolverKnown ? '💡' : idx + 1),
                  e('span', { style: { fontSize: '11px', fontWeight: 600, color: isSolverKnown ? 'var(--accent-light)' : 'var(--text-secondary)' } }, 'Slot ' + (idx + 1))
                ),
                // Plant A
                e('div', { className: 'col-select-wrapper' },
                  e('select', {
                    className: 'plant-select-col',
                    value: g.p1 !== null ? g.p1 : '',
                    onChange: function (ev) {
                      handlePlantChange(idx, 'p1', ev.target.value === '' ? null : parseInt(ev.target.value));
                    }
                  },
                    e('option', { value: '' }, '— Plant A —'),
                    config.selectedPlants.map(function (pi) {
                      return e('option', { key: pi, value: pi }, BASE_PLANTS[pi]);
                    })
                  )
                ),
                e('div', { className: 'col-plus' }, '+'),
                // Plant B
                e('div', { className: 'col-select-wrapper' },
                  e('select', {
                    className: 'plant-select-col',
                    value: g.p2 !== null ? g.p2 : '',
                    onChange: function (ev) {
                      handlePlantChange(idx, 'p2', ev.target.value === '' ? null : parseInt(ev.target.value));
                    }
                  },
                    e('option', { value: '' }, '— Plant B —'),
                    config.selectedPlants.map(function (pi) {
                      return e('option', { key: pi, value: pi }, BASE_PLANTS[pi]);
                    })
                  )
                ),
                // Result
                hybridName
                  ? e('div', { className: 'guess-col-result valid' }, hybridName)
                  : e('div', { className: 'guess-col-result invalid' },
                      g.p1 !== null && g.p2 !== null ? 'Invalid' : '...'),
                // Feedback 2×2 grid
                e('div', { className: 'fb-grid' },
                  FEEDBACK_TYPES.map(function (ft) {
                    var active = feedback[idx] === ft.id;
                    return e('button', {
                      key: ft.id,
                      className: 'fb-btn ' + ft.id + (active ? ' active' : ''),
                      onClick: function () { handleFeedbackChange(idx, ft.id); },
                      title: ft.label
                    },
                      e('span', { className: 'fb-icon' }, ft.icon),
                      e('span', null, ft.shortLabel)
                    );
                  })
                )
              );
            })
          )
        ),

        // Submit bar
        e('div', { className: 'submit-bar' },
          e('span', { className: 'submit-helper' },
            !allActiveGuessValid ? 'Select valid plant pairs for active slots'
              : !allActiveFbSet ? 'Set feedback for active slots'
              : 'Ready to submit'
          ),
          e('button', {
            className: 'submit-btn',
            disabled: !canSubmit,
            onClick: handleSubmit
          }, 'Submit Feedback')
        ),

        // Legend
        e('div', { className: 'legend-bar' },
          FEEDBACK_TYPES.map(function (ft) {
            return e('div', { key: ft.id, className: 'legend-item' },
              e('span', { className: 'legend-dot ' + ft.id }),
              e('span', null, ft.label + ': ' + getLegendDesc(ft.id))
            );
          })
        )
      ) : null,

      // Analysis panel
      e(AnalysisPanel, { solverState: data.solverState, lookup: lookup, codeLen: codeLen }),

      // History panel
      e(HistoryPanel, { history: data.history, lookup: lookup, codeLen: codeLen })
    );
  }

  function getLegendDesc(id) {
    switch (id) {
      case 'correct': return 'Exact match for this slot';
      case 'wrongslot': return 'Exists in answer, wrong position';
      case 'partial': return 'One base plant matches this slot';
      case 'allwrong': return 'Neither base plant matches';
      default: return '';
    }
  }

  function suggestionToGuess(suggestion, lookup) {
    return suggestion.map(function (key) {
      if (!key) return { p1: null, p2: null };
      var h = lookup.get(key);
      if (h) return { p1: h.p1, p2: h.p2 };
      var pk = parseKey(key);
      return { p1: pk[0], p2: pk[1] };
    });
  }

  // ---- SuggestionPanel ----

  function SuggestionPanel({ suggestion, solverState, lookup, codeLen, isSolved, onUseSuggestion }) {
    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '💡'),
          e('h2', null, isSolved ? 'Answer' : 'Suggested Guess')
        )
      ),
      e('div', { className: 'panel-body' },
        e('div', { className: 'suggestion-slots' },
          suggestion.map(function (key, idx) {
            if (!key) return e('div', { key: idx, className: 'suggestion-slot' },
              e('div', { className: 'slot-number' }, idx + 1),
              e('div', null, e('div', { className: 'slot-hybrid-name' }, '—'))
            );
            var h = lookup.get(key);
            var isLocked = solverState.gameLocked[idx];
            var isKnown = !isLocked && solverState.confirmed[idx] !== null;
            var pk = parseKey(key);
            var name = h ? h.name : getHybridName(pk[0], pk[1]) || '?';
            var slotClass = 'suggestion-slot' + (isLocked ? ' confirmed' : '') + (isKnown ? ' known' : '');
            return e('div', { key: idx, className: slotClass },
              e('div', { className: 'slot-number' }, isLocked ? '🔒' : isKnown ? '💡' : idx + 1),
              e('div', null,
                e('div', { className: 'slot-hybrid-name' }, name),
                e('div', { className: 'slot-pair' }, BASE_SHORT[pk[0]] + ' + ' + BASE_SHORT[pk[1]])
              )
            );
          })
        ),
        !isSolved ? e('div', { className: 'suggestion-actions' },
          e('button', { className: 'use-suggestion-btn', onClick: onUseSuggestion }, 'Use This Suggestion')
        ) : null
      )
    );
  }

  // ---- AnalysisPanel ----

  function AnalysisPanel({ solverState, lookup, codeLen }) {
    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '📊'),
          e('h2', null, 'Analysis')
        )
      ),
      e('div', { className: 'panel-body' },
        e('div', { className: 'analysis-grid' },
          Array.from({ length: codeLen }).map(function (_, idx) {
            var poss = solverState.possible[idx];
            var confirmed = solverState.confirmed[idx];
            var isLocked = solverState.gameLocked[idx];
            var isKnown = confirmed !== null && !isLocked;
            var count = poss.size;
            var isConfirmed = confirmed !== null;
            var isImpossible = count === 0 && !isConfirmed;

            var valueName = '';
            if (isConfirmed) {
              var h = lookup.get(confirmed);
              valueName = h ? h.name : '?';
            }

            // Show up to 5 remaining possibilities
            var remaining = [];
            var i = 0;
            for (var k of poss) {
              if (i >= 5) break;
              var h2 = lookup.get(k);
              remaining.push(h2 ? h2.name : k);
              i++;
            }
            var moreCount = count - remaining.length;

            var slotClass = 'analysis-slot'
              + (isLocked ? ' confirmed' : '')
              + (isKnown ? ' known' : '')
              + (isImpossible ? ' impossible' : '');

            return e('div', { key: idx, className: slotClass },
              e('div', { className: 'analysis-slot-header' },
                e('span', { className: 'analysis-slot-label' }, 'Slot ' + (idx + 1)),
                e('span', { className: 'analysis-slot-count' },
                  isLocked ? '🔒' : isKnown ? '💡' : isImpossible ? '✕' : count
                )
              ),
              isConfirmed
                ? e('div', { className: 'analysis-slot-value' }, valueName + (isKnown ? ' (deduced)' : ''))
                : isImpossible
                  ? e('div', { className: 'analysis-slot-value', style: { color: 'var(--allwrong)' } }, 'No possibilities')
                  : e('div', { className: 'analysis-remaining-list' },
                      remaining.join(', ') + (moreCount > 0 ? ' +' + moreCount + ' more' : '')
                    )
            );
          })
        )
      )
    );
  }

  // ---- HistoryPanel ----

  function HistoryPanel({ history, lookup, codeLen }) {
    const fbIcons = { correct: '✓', wrongslot: '↔', partial: '◐', allwrong: '✕' };

    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '📜'),
          e('h2', null, 'History')
        ),
        e('span', { className: 'panel-title-badge' }, history.length + ' round' + (history.length !== 1 ? 's' : ''))
      ),
      history.length === 0
        ? e('div', { className: 'history-empty' }, 'No guesses yet. Submit your first guess above.')
        : e('div', null,
            history.map(function (round, rIdx) {
              return e('div', { key: rIdx, className: 'history-round' },
                e('div', { className: 'history-round-title' }, 'Round ' + (rIdx + 1)),
                e('div', { className: 'history-slots' },
                  round.guess.map(function (g, sIdx) {
                    const fb = round.feedback[sIdx];
                    const name = getHybridName(g.p1, g.p2) || '?';
                    const icon = fbIcons[fb] || '?';
                    return e('span', { key: sIdx, className: 'history-chip ' + fb },
                      e('span', null, name),
                      e('span', { className: 'history-fb-icon' }, icon)
                    );
                  })
                )
              );
            }).reverse()
          )
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  ReactDOM.createRoot(document.getElementById('root')).render(e(App));
})();
