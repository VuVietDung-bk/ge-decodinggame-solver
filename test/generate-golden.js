'use strict';
// Regenerate test/golden.json from the current engine behavior.
// Run intentionally (after a REVIEWED behavior change): node test/generate-golden.js
// The regression test then guards against unreviewed drift.

const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');

const out = {};
for (let i = 0; i < S.SCENARIOS.length; i++) {
  const sc = S.SCENARIOS[i];
  out[sc.id] = S.runScenario(sc);
}

fs.writeFileSync(path.join(__dirname, 'golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote golden.json with ' + Object.keys(out).length + ' scenarios');
