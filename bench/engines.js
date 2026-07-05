'use strict';
// Engine registry. An "engine" is a named suggestion policy:
//   suggest(state, validHybrids, K, isFirst, selectedPlants) -> suggestion[]
//
// To benchmark a FUTURE algorithm, add a descriptor here (or pass a custom
// `engines` array to runBenchmark). The algorithm need not live in engine.js —
// any function with the signature above works, so new solvers can be dropped in
// without touching the framework.

const E = require('../public/engine.js');

// Wrap a built-in engine id ('strategic' | 'heuristic') as a suggest function.
function wrap(engineId) {
  return function (state, vh, K, isFirst, plants) {
    return E.generateSuggestion(state, vh, K, isFirst, plants, engineId);
  };
}

const ENGINES = [
  { name: 'strategic', suggest: wrap(E.ENGINE_STRATEGIC) },
  { name: 'heuristic', suggest: wrap(E.ENGINE_HEURISTIC) },
  { name: 'optimal', suggest: wrap(E.ENGINE_OPTIMAL) }

  // Example — plug a future algorithm in like this:
  // { name: 'entropy', suggest: require('./algorithms/entropy.js') }
];

// Select engines by name (case-insensitive); throws on unknown names.
function select(names) {
  if (!names || !names.length) return ENGINES.slice();
  return names.map(function (n) {
    const found = ENGINES.filter(function (e) { return e.name.toLowerCase() === String(n).toLowerCase(); })[0];
    if (!found) throw new Error('Unknown engine: ' + n + ' (known: ' + ENGINES.map(function (e) { return e.name; }).join(', ') + ')');
    return found;
  });
}

module.exports = { ENGINES: ENGINES, wrap: wrap, select: select };
