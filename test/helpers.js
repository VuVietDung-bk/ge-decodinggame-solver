'use strict';
// Shared test utilities: engine loader, seeded RNG, a feedback oracle,
// self-play driver, state comparison, and the propagation-invariant checker.

const assert = require('assert');
const E = require('../public/engine.js');

// ------------------------------------------------------------------
// Seeded RNG — deterministic reproduction of anything using Math.random
// (notably firstGuess, which shuffles tied openings).
// ------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Run `fn` with Math.random replaced by a seeded generator, then restore.
function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = orig; }
}

// ------------------------------------------------------------------
// Config helpers
// ------------------------------------------------------------------
function config(plantCount, codeLength) {
  const selected = [];
  for (let i = 0; i < plantCount; i++) selected.push(i);
  return { selectedPlants: selected, codeLength: codeLength };
}

// Pick a random valid config using the current Math.random.
function randomConfig() {
  const plantCount = 3 + Math.floor(Math.random() * 5); // 3..7
  const vh = E.getValidHybrids(config(plantCount, 3).selectedPlants);
  const maxK = Math.min(6, vh.length);
  const codeLength = 3 + Math.floor(Math.random() * (maxK - 2)); // 3..maxK
  return config(plantCount, codeLength);
}

// A random secret answer: codeLength DISTINCT valid hybrid keys.
// (The engine assumes hybrids do not repeat within an answer — the
// 'correct' rule removes a matched hybrid from every other slot.)
function randomSecret(cfg) {
  const vh = E.getValidHybrids(cfg.selectedPlants);
  const keys = vh.map(function (h) { return h.key; });
  // Fisher-Yates using Math.random
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  return keys.slice(0, cfg.codeLength);
}

// ------------------------------------------------------------------
// Feedback oracle — the ground-truth game response for (guess, secret).
// Priority order (matches the engine's deductions and README):
//   correct > wrongslot > partial > allwrong
// ------------------------------------------------------------------
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

// Turn a suggestion (array of keys/null) into a complete, valid guess:
// game-locked slots use the confirmed hybrid; null/used slots fall back
// to any unused valid hybrid. Guarantees a valid pair in every slot.
function buildGuess(st, suggestion, vh, K) {
  const used = new Set();
  const guess = new Array(K).fill(null);

  for (let s = 0; s < K; s++) {
    if (st.gameLocked[s] && st.confirmed[s]) {
      const pk = E.parseKey(st.confirmed[s]);
      guess[s] = { p1: pk[0], p2: pk[1] };
      used.add(st.confirmed[s]);
    }
  }
  for (let s = 0; s < K; s++) {
    if (guess[s]) continue;
    const key = suggestion[s];
    if (key && !used.has(key)) {
      const pk = E.parseKey(key);
      guess[s] = { p1: pk[0], p2: pk[1] };
      used.add(key);
    }
  }
  for (let s = 0; s < K; s++) {
    if (guess[s]) continue;
    for (let h = 0; h < vh.length; h++) {
      if (!used.has(vh[h].key)) {
        guess[s] = { p1: vh[h].p1, p2: vh[h].p2 };
        used.add(vh[h].key);
        break;
      }
    }
  }
  return guess;
}

// Drive a full game with the solver's own suggestions against `secret`.
// opts.check → run assertInvariants after every round.
// Returns { solved, rounds, transcript, state }.
function playGame(cfg, secret, engine, maxRounds, opts) {
  const K = cfg.codeLength;
  const vh = E.getValidHybrids(cfg.selectedPlants);
  let st = E.createSolverState(vh, K);
  let sug = E.generateSuggestion(st, vh, K, true, cfg.selectedPlants, engine);
  const transcript = [];

  for (let round = 0; round < maxRounds; round++) {
    const guess = buildGuess(st, sug, vh, K);
    const feedback = guess.map(function (g, i) { return oracleFeedback(g, i, secret); });
    transcript.push({
      guess: guess.map(function (g) { return E.hKey(g.p1, g.p2); }),
      feedback: feedback.slice()
    });

    st = E.applyFeedback(st, guess, feedback);
    if (opts && opts.check) assertInvariants(st, K, secret);

    if (st.gameLocked.every(Boolean)) {
      return { solved: true, rounds: round + 1, transcript: transcript, state: st };
    }
    sug = E.generateSuggestion(st, vh, K, false, cfg.selectedPlants, engine);
  }
  return { solved: false, rounds: maxRounds, transcript: transcript, state: st };
}

// ------------------------------------------------------------------
// State equality (order-independent for Sets)
// ------------------------------------------------------------------
function setEq(x, y) {
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}
function arrEq(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
function stateEq(a, b) {
  if (a.possible.length !== b.possible.length) return false;
  for (let i = 0; i < a.possible.length; i++) {
    if (!setEq(a.possible[i], b.possible[i])) return false;
  }
  return setEq(a.mustInclude, b.mustInclude) &&
    setEq(a.excluded, b.excluded) &&
    arrEq(a.confirmed, b.confirmed) &&
    arrEq(a.gameLocked, b.gameLocked);
}

// ------------------------------------------------------------------
// Propagation invariants — must hold after any applyFeedback produced
// by TRUTHFUL feedback. These are the core regression net.
// ------------------------------------------------------------------
function assertInvariants(st, K, secret) {
  // I1: no excluded key remains in any slot's possibility set
  for (const key of st.excluded) {
    for (let s = 0; s < K; s++) {
      assert.ok(!st.possible[s].has(key), 'I1 excluded key ' + key + ' still in possible[' + s + ']');
    }
  }
  // I2: a key cannot be both required (mustInclude) and excluded
  for (const key of st.mustInclude) {
    assert.ok(!st.excluded.has(key), 'I2 key ' + key + ' both mustInclude and excluded');
  }
  // I3: confirmed <=> singleton possibility with the matching element
  for (let s = 0; s < K; s++) {
    if (st.confirmed[s] !== null) {
      assert.strictEqual(st.possible[s].size, 1, 'I3 confirmed slot ' + s + ' not singleton');
      assert.ok(st.possible[s].has(st.confirmed[s]), 'I3 confirmed slot ' + s + ' missing its key');
    }
    if (st.possible[s].size === 1) {
      const only = st.possible[s].values().next().value;
      assert.strictEqual(st.confirmed[s], only, 'I3 singleton slot ' + s + ' not confirmed to its element');
    }
  }
  // I4: a game-locked hybrid appears in no other slot's possibility set
  for (let s = 0; s < K; s++) {
    if (st.gameLocked[s]) {
      assert.ok(st.confirmed[s] !== null, 'I4 locked slot ' + s + ' not confirmed');
      const key = st.confirmed[s];
      for (let j = 0; j < K; j++) {
        if (j !== s) assert.ok(!st.possible[j].has(key), 'I4 locked key ' + key + ' leaked into slot ' + j);
      }
    }
  }
  // I5: truthful feedback never empties a slot
  for (let s = 0; s < K; s++) {
    assert.ok(st.possible[s].size >= 1, 'I5 slot ' + s + ' has zero possibilities under truthful play');
  }
  // I6: SOUNDNESS — the true answer is never eliminated
  if (secret) {
    for (let s = 0; s < K; s++) {
      const ans = secret[s];
      if (st.confirmed[s] !== null) {
        assert.strictEqual(st.confirmed[s], ans, 'I6 slot ' + s + ' confirmed to ' + st.confirmed[s] + ' but answer is ' + ans);
      } else {
        assert.ok(st.possible[s].has(ans), 'I6 answer ' + ans + ' pruned from possible[' + s + ']');
      }
    }
  }
}

module.exports = {
  E: E,
  mulberry32: mulberry32,
  withSeed: withSeed,
  config: config,
  randomConfig: randomConfig,
  randomSecret: randomSecret,
  oracleFeedback: oracleFeedback,
  buildGuess: buildGuess,
  playGame: playGame,
  setEq: setEq,
  arrEq: arrEq,
  stateEq: stateEq,
  assertInvariants: assertInvariants
};
