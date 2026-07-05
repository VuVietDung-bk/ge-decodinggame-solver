'use strict';
// Minimal zero-dependency test harness (Node 12+ compatible).
// Registers suites/tests, runs them synchronously, prints a summary,
// and returns the number of failures (used as the process exit code).

const assert = require('assert');

const suites = [];
let current = null;

function suite(name, fn) {
  const prev = current;
  current = { name: name, tests: [] };
  suites.push(current);
  fn();
  current = prev;
}

function test(name, fn) {
  if (!current) {
    current = { name: '(root)', tests: [] };
    suites.push(current);
  }
  current.tests.push({ name: name, fn: fn });
}

function run() {
  let pass = 0, fail = 0;
  const failures = [];
  const t0 = Date.now();

  for (let i = 0; i < suites.length; i++) {
    const s = suites[i];
    for (let j = 0; j < s.tests.length; j++) {
      const t = s.tests[j];
      try {
        t.fn();
        pass++;
      } catch (e) {
        fail++;
        failures.push({ suite: s.name, name: t.name, err: e });
      }
    }
  }

  const dt = Date.now() - t0;
  let total = 0;
  for (let i = 0; i < suites.length; i++) total += suites[i].tests.length;

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i];
    const msg = (f.err && f.err.message) ? String(f.err.message) : String(f.err);
    console.log('\n  x [' + f.suite + '] ' + f.name);
    console.log('    ' + msg.split('\n').join('\n    '));
  }

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' +
    fail + ' failed (' + total + ' tests, ' + dt + 'ms)');
  return fail;
}

module.exports = { suite: suite, test: test, run: run, assert: assert };
