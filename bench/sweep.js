'use strict';
// Parameter sweep: vary one engine TUNING knob over a set of values and
// report mean rounds AND the tail (p90/p95/max) + runtime. Games are seeded,
// so every value is measured on the SAME set of secrets (paired comparison).
//
//   node bench/sweep.js --engine minimax --param MINIMAX_WORSTCASE_WEIGHT \
//                       --values 0,0.1,0.25,0.5,1 --games 80 --configs 5x4,6x5,7x6,8x6,10x4

const E = require('../public/engine.js');
const framework = require('./framework.js');
const registry = require('./engines.js');

function parseArgs(argv) {
  const o = { games: 80, seed: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engine') o.engine = argv[++i];
    else if (a === '--param') o.param = argv[++i];
    else if (a === '--values') o.values = argv[++i].split(',').map(Number);
    else if (a === '--games') o.games = parseInt(argv[++i], 10);
    else if (a === '--seed') o.seed = parseInt(argv[++i], 10);
    else if (a === '--configs') o.configs = argv[++i].split(',').map(function (s) { return s.split('x').map(Number); });
  }
  return o;
}

function evalOnce(engineName, games, seed, configs) {
  const eng = registry.select([engineName]);
  const res = framework.runBenchmark({ engines: eng, gamesPerConfig: games, baseSeed: seed, configs: configs });
  const o = res.overall[0];
  return { mean: o.avgRounds, p90: o.p90Rounds, p95: o.p95Rounds, max: o.maxRounds, ms: o.avgMs };
}

function pad(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }

function main() {
  const a = parseArgs(process.argv);
  if (!a.engine || !a.param || !a.values) {
    console.error('usage: node bench/sweep.js --engine E --param NAME --values v1,v2,.. [--games N] [--configs 5x4,..]');
    process.exit(1);
  }
  const orig = E.TUNING[a.param];
  if (orig === undefined) { console.error('Unknown TUNING param: ' + a.param); process.exit(1); }

  console.log('Sweep ' + a.engine + '.' + a.param + ' (default ' + orig + ') · ' + a.games + ' games/config');
  console.log(pad('value', 10) + pad('mean', 9) + pad('p90', 6) + pad('p95', 6) + pad('max', 6) + pad('avgMs', 9));

  let bestVal = null, bestMean = Infinity;
  for (let i = 0; i < a.values.length; i++) {
    const v = a.values[i];
    E.TUNING[a.param] = v;
    const r = evalOnce(a.engine, a.games, a.seed, a.configs);
    console.log(pad(String(v), 10) + pad(r.mean.toFixed(4), 9) + pad(String(r.p90), 6) +
      pad(String(r.p95), 6) + pad(String(r.max), 6) + pad(r.ms.toFixed(2), 9));
    if (r.mean < bestMean - 1e-9) { bestMean = r.mean; bestVal = v; }
  }
  E.TUNING[a.param] = orig; // restore
  console.log('\nlowest mean at ' + a.param + ' = ' + bestVal + ' (mean ' + bestMean.toFixed(4) + ')  [default ' + orig + ']');
}

main();
