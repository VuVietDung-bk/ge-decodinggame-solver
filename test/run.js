'use strict';
// Entry point: registers every suite, runs them, exits non-zero on failure.
// Runs on any Node >= 12 (no external deps, no node:test).
//   node test/run.js

const harness = require('./harness.js');

require('./unit.test.js');
require('./propagation-invariants.test.js');
require('./property.test.js');
require('./randomized.test.js');
require('./regression.test.js');

process.exit(harness.run());
