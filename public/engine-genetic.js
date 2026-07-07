// ============================================================
// GE Decode Solver — GENETIC ENGINE (evolutionary, Berghman-style)
// ------------------------------------------------------------
// Unlike Minimax/Entropy, which must ENUMERATE the consistent-answer set (and
// so fall back to Strategic when it is too large), the genetic engine EVOLVES a
// population of candidate codes toward consistency and never enumerates — so it
// runs its own algorithm at ANY game size, early game included. Each round it:
//   1. evolves a population (selection + crossover + mutation, distinctness
//      repaired) whose fitness rewards consistency with the current state;
//   2. harvests the "eligible" codes it finds (those fully consistent with the
//      state — i.e. plausible secrets);
//   3. plays the eligible code that, over that evolved pool, is expected to
//      leave the fewest plausible secrets next round (Berghman's selection).
// It is stochastic (uses Math.random, seeded by the harness for reproducibility).
// Augments the shared core (engine-core.js).
// ============================================================
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    require('./engine-strategic.js'); // registers core.strategicSuggestion (opening fallback)
    module.exports = factory(require('./engine-core.js'));
  } else {
    factory(root.DecodeEngine);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (core) {
  'use strict';
  var TUNING = core.TUNING, firstGuess = core.firstGuess, feedbackSignature = core.feedbackSignature;
  var strategicSuggestion = core.strategicSuggestion;
  var ENGINE_GENETIC = 'genetic';

  function randInt(n) { return (Math.random() * n) | 0; }

  function geneticSuggestion(state, validHybrids, K, isFirst, selectedPlants) {
    if (isFirst) return firstGuess(validHybrids, K);

    // Guessing a plausible (eligible) code is weak while the answer space is
    // still wide open — there, Strategic's information-gathering wins. So defer
    // the opening to Strategic and let the GA take over once the space narrows.
    // (Its threshold is well above Minimax/Entropy's enumeration cap, so the GA
    // still owns the mid regime those engines can't enumerate.)
    var estimate = 1;
    for (var es = 0; es < K; es++) {
      var esz = state.confirmed[es] ? 1 : state.possible[es].size;
      estimate *= (esz > 0 ? esz : 1);
      if (estimate > TUNING.GENETIC_ENUM_CAP) break;
    }
    if (estimate > TUNING.GENETIC_ENUM_CAP) {
      return strategicSuggestion(state, validHybrids, K, isFirst, selectedPlants);
    }

    // Split slots into fixed (confirmed) and free (to evolve).
    var fixed = new Array(K), free = [], usedFixed = new Set();
    for (var s = 0; s < K; s++) {
      if (state.confirmed[s]) { fixed[s] = state.confirmed[s]; usedFixed.add(state.confirmed[s]); }
      else { fixed[s] = null; free.push(s); }
    }
    if (free.length === 0) return fixed.slice(); // everything known

    // Per-free-slot gene pool = the slot's still-possible hybrids.
    var pool = Object.create(null);
    for (var fi = 0; fi < free.length; fi++) { var fs = free[fi]; pool[fs] = Array.from(state.possible[fs]); }
    var must = Array.from(state.mustInclude);

    // ---- helpers ----
    // Assign each free slot a hybrid from its pool, keeping the whole code's
    // hybrids distinct (repair by scanning the pool if a random draw collides).
    function repair(code, used) {
      for (var i = 0; i < free.length; i++) {
        var s = free[i], opts = pool[s], k = code[s];
        if (k === null || used.has(k)) {
          var pick = null;
          for (var t = 0; t < 6; t++) { var c = opts[randInt(opts.length)]; if (!used.has(c)) { pick = c; break; } }
          if (pick === null) { for (var a = 0; a < opts.length; a++) if (!used.has(opts[a])) { pick = opts[a]; break; } }
          if (pick === null) pick = opts[0]; // degenerate: allow a duplicate
          k = pick;
        }
        code[s] = k; used.add(k);
      }
      return code;
    }
    function randomCode() {
      var code = fixed.slice(); var used = new Set(usedFixed);
      for (var i = 0; i < free.length; i++) code[free[i]] = null;
      return repair(code, used);
    }
    // Fitness: reward per-slot consistency + mustInclude coverage, penalize
    // duplicates. (Genes are drawn from possible[], so per-slot consistency is
    // usually satisfied; the GA mainly resolves distinctness + coverage.)
    function fitness(code) {
      var used = new Set(), dup = 0, f = 0;
      for (var s = 0; s < K; s++) {
        if (used.has(code[s])) dup++; else used.add(code[s]);
        if (state.confirmed[s] || state.possible[s].has(code[s])) f++;
      }
      var cov = 0;
      for (var m = 0; m < must.length; m++) if (used.has(must[m])) cov++;
      return f + cov - 2 * dup;
    }
    function eligible(code) {
      var used = new Set();
      for (var s = 0; s < K; s++) {
        if (used.has(code[s])) return false; used.add(code[s]);
        if (!(state.confirmed[s] || state.possible[s].has(code[s]))) return false;
      }
      for (var m = 0; m < must.length; m++) if (!used.has(must[m])) return false;
      return true;
    }

    // ---- evolve ----
    var POP = TUNING.GENETIC_POP, ELITES = Math.max(2, (POP * TUNING.GENETIC_ELITE_FRAC) | 0);
    var pop = new Array(POP);
    for (var p = 0; p < POP; p++) pop[p] = randomCode();

    var eligibleSet = Object.create(null), eligibleList = [];
    function harvest(code) {
      if (!eligible(code)) return;
      var key = code.join(',');
      if (eligibleSet[key]) return;
      eligibleSet[key] = true; eligibleList.push(code.slice());
    }

    var gen = 0;
    for (; gen < TUNING.GENETIC_GENERATIONS && eligibleList.length < TUNING.GENETIC_MAX_ELIGIBLE; gen++) {
      // score + sort (descending fitness)
      var scored = new Array(POP);
      for (var i = 0; i < POP; i++) { scored[i] = { code: pop[i], f: fitness(pop[i]) }; harvest(pop[i]); }
      scored.sort(function (a, b) { return b.f - a.f; });

      var next = new Array(POP);
      for (var e = 0; e < ELITES; e++) next[e] = scored[e].code;
      for (var j = ELITES; j < POP; j++) {
        // tournament-select two parents from the fitter half
        var half = POP >> 1;
        var pa = scored[randInt(half)].code, pb = scored[randInt(half)].code;
        var child = fixed.slice(); var used = new Set(usedFixed);
        for (var f2 = 0; f2 < free.length; f2++) {
          var s2 = free[f2];
          var gene = (Math.random() < 0.5 ? pa[s2] : pb[s2]);            // crossover
          if (Math.random() < TUNING.GENETIC_MUTATION) gene = pool[s2][randInt(pool[s2].length)]; // mutation
          child[s2] = gene;
        }
        // clear free genes that collided, then repair distinctness
        var seen = new Set(usedFixed), fixup = fixed.slice();
        for (var f3 = 0; f3 < free.length; f3++) {
          var s3 = free[f3], g3 = child[s3];
          if (seen.has(g3)) fixup[s3] = null; else { fixup[s3] = g3; seen.add(g3); }
        }
        next[j] = repair(fixup, new Set(usedFixed));
      }
      pop = next;
    }
    // final harvest
    for (var q = 0; q < POP; q++) harvest(pop[q]);

    // ---- select the guess ----
    if (eligibleList.length === 0) {
      // GA found nothing fully consistent: play the fittest code anyway (still a
      // legal, informative guess).
      var best = pop[0], bestF = fitness(pop[0]);
      for (var r = 1; r < POP; r++) { var ff = fitness(pop[r]); if (ff > bestF) { bestF = ff; best = pop[r]; } }
      return best.slice();
    }
    if (eligibleList.length <= 2) return eligibleList[0].slice();

    // Berghman selection: over the evolved eligible pool, pick the code expected
    // to leave the fewest plausible secrets (min sum of squared partition sizes).
    var E = eligibleList;
    if (E.length > TUNING.GENETIC_SELECT_CAP) E = E.slice(0, TUNING.GENETIC_SELECT_CAP);
    var M = E.length, sets = new Array(M);
    for (var a2 = 0; a2 < M; a2++) sets[a2] = new Set(E[a2]);

    var pick = null, pickScore = Infinity, pickKey = null;
    for (var gi = 0; gi < M; gi++) {
      var G = E[gi], counts = Object.create(null), sq = 0;
      for (var t2 = 0; t2 < M; t2++) {
        var sig = feedbackSignature(G, E[t2], sets[t2], K);
        counts[sig] = (counts[sig] || 0) + 1;
      }
      for (var c2 in counts) sq += counts[c2] * counts[c2];
      var keyStr = G.join(',');
      if (sq < pickScore - 1e-9 || (Math.abs(sq - pickScore) <= 1e-9 && (pickKey === null || keyStr < pickKey))) {
        pickScore = sq; pick = G; pickKey = keyStr;
      }
    }
    return (pick || E[0]).slice();
  }

  core.ENGINE_GENETIC = ENGINE_GENETIC;
  core.geneticSuggestion = geneticSuggestion;
  core._registerEngine(ENGINE_GENETIC, geneticSuggestion);
  return { geneticSuggestion: geneticSuggestion };
});
