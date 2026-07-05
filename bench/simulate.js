'use strict';
// Engine-agnostic game simulator: the reusable core of the benchmark.
// Generates random valid games and drives a full solve using ANY
// suggestion function `suggest(state, validHybrids, K, isFirst, plants)`.
// No dependency on the test suite or any specific engine.

const E = require('../public/engine.js');

// ---- seeded RNG (reproducible games; also makes firstGuess deterministic) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = orig; }
}

// ---- config / secret generation ----
function config(plantCount, codeLength) {
  const selected = [];
  for (let i = 0; i < plantCount; i++) selected.push(i);
  return { selectedPlants: selected, codeLength: codeLength };
}

// A valid secret: codeLength DISTINCT valid hybrids (the engine assumes
// no repeated hybrid within an answer). Uses the current Math.random.
function randomSecret(cfg) {
  const vh = E.getValidHybrids(cfg.selectedPlants);
  const keys = vh.map(function (h) { return h.key; });
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  return keys.slice(0, cfg.codeLength);
}

// Is this config solvable at all (enough valid hybrids for K distinct slots)?
function isValidConfig(cfg) {
  const vh = E.getValidHybrids(cfg.selectedPlants);
  return cfg.codeLength >= 1 && cfg.codeLength <= vh.length;
}

// ---- feedback oracle: ground-truth game response ----
// Priority order: correct > wrongslot > partial > allwrong.
function oracleFeedback(pair, slot, secretKeys) {
  const gKey = E.hKey(pair.p1, pair.p2);
  if (gKey === secretKeys[slot]) return 'correct';
  for (let j = 0; j < secretKeys.length; j++) {
    if (j !== slot && secretKeys[j] === gKey) return 'wrongslot';
  }
  const sp = E.parseKey(secretKeys[slot]);
  if (pair.p1 === sp[0] || pair.p1 === sp[1] || pair.p2 === sp[0] || pair.p2 === sp[1]) {
    return 'partial';
  }
  return 'allwrong';
}

// Turn a suggestion (keys/null) into a complete valid guess.
function buildGuess(st, suggestion, vh, K) {
  const used = new Set();
  const guess = new Array(K).fill(null);
  for (let s = 0; s < K; s++) {
    if (st.gameLocked[s] && st.confirmed[s]) {
      const pk = E.parseKey(st.confirmed[s]);
      guess[s] = { p1: pk[0], p2: pk[1] }; used.add(st.confirmed[s]);
    }
  }
  for (let s = 0; s < K; s++) {
    if (guess[s]) continue;
    const key = suggestion[s];
    if (key && !used.has(key)) { const pk = E.parseKey(key); guess[s] = { p1: pk[0], p2: pk[1] }; used.add(key); }
  }
  for (let s = 0; s < K; s++) {
    if (guess[s]) continue;
    for (let h = 0; h < vh.length; h++) {
      if (!used.has(vh[h].key)) { guess[s] = { p1: vh[h].p1, p2: vh[h].p2 }; used.add(vh[h].key); break; }
    }
  }
  return guess;
}

// Play one full game with `suggest` against `secret`.
// Returns { solved, rounds }.
function playGame(cfg, secret, suggest, maxRounds) {
  const K = cfg.codeLength;
  const vh = E.getValidHybrids(cfg.selectedPlants);
  let st = E.createSolverState(vh, K);
  let sug = suggest(st, vh, K, true, cfg.selectedPlants);
  for (let round = 0; round < maxRounds; round++) {
    const guess = buildGuess(st, sug, vh, K);
    const feedback = guess.map(function (g, i) { return oracleFeedback(g, i, secret); });
    st = E.applyFeedback(st, guess, feedback);
    if (st.gameLocked.every(Boolean)) return { solved: true, rounds: round + 1 };
    sug = suggest(st, vh, K, false, cfg.selectedPlants);
  }
  return { solved: false, rounds: maxRounds };
}

module.exports = {
  E: E,
  mulberry32: mulberry32,
  withSeed: withSeed,
  config: config,
  randomSecret: randomSecret,
  isValidConfig: isValidConfig,
  oracleFeedback: oracleFeedback,
  buildGuess: buildGuess,
  playGame: playGame
};
