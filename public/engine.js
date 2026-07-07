// ============================================================
// GE Decode Solver — ENGINE aggregator (Node / require entry point)
// ------------------------------------------------------------
// Loads the shared core plus every engine module and re-exports the
// fully-assembled DecodeEngine. Each engine module augments the same core
// object (require caches engine-core.js), so after loading them all the core
// carries every suggestion function and internal.
//
// Browsers do NOT use this file — index.html loads the parts directly via
// <script> tags (engine-core → heuristic → strategic → minimax). This module
// is the single entry point for Node consumers (tests, benchmarks): they can
// keep doing `require('.../public/engine.js')` unchanged.
// ============================================================
'use strict';
var core = require('./engine-core.js');
require('./engine-heuristic.js');
require('./engine-strategic.js');
require('./engine-minimax.js');
require('./engine-entropy.js');
require('./engine-genetic.js');
module.exports = core;
