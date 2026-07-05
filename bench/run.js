'use strict';
// CLI entry point for the benchmark.
//
//   node bench/run.js [options]
//     --games N        games per config      (default 100)
//     --seed  N        base RNG seed         (default 1)
//     --bound N        max rounds before unsolved (default 60)
//     --out   DIR      output directory      (default bench/out)
//     --engines a,b    subset of engines     (default all)
//     --configs 3x3,5x4,10x8   config grid   (default built-in)
//     --help

const path = require('path');
const framework = require('./framework.js');
const report = require('./report.js');
const registry = require('./engines.js');

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') o.gamesPerConfig = parseInt(argv[++i], 10);
    else if (a === '--seed') o.baseSeed = parseInt(argv[++i], 10);
    else if (a === '--bound') o.bound = parseInt(argv[++i], 10);
    else if (a === '--out') o.outDir = argv[++i];
    else if (a === '--engines') o.engineNames = argv[++i].split(',');
    else if (a === '--configs') o.configs = argv[++i].split(',').map(function (s) { return s.split('x').map(Number); });
    else if (a === '--help' || a === '-h') o.help = true;
    else { console.error('Unknown option: ' + a); o.help = true; }
  }
  return o;
}

function help() {
  console.log([
    'Solver benchmark',
    '',
    'Usage: node bench/run.js [options]',
    '  --games N       games per config (default 100)',
    '  --seed N        base RNG seed (default 1)',
    '  --bound N       max rounds before unsolved (default 60)',
    '  --out DIR       output directory (default bench/out)',
    '  --engines a,b   subset of engines (default: ' + registry.ENGINES.map(function (e) { return e.name; }).join(', ') + ')',
    '  --configs g     grid like 3x3,5x4,10x8 (default built-in)',
    ''
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); return; }

  const outDir = args.outDir || path.join(__dirname, 'out');
  const engines = registry.select(args.engineNames);

  const opts = {
    engines: engines,
    gamesPerConfig: args.gamesPerConfig,
    baseSeed: args.baseSeed,
    bound: args.bound,
    configs: args.configs,
    onProgress: function (p) {
      process.stderr.write('  [' + p.index + '/' + p.total + '] ' + p.configId + ' done\n');
    }
  };

  process.stderr.write('Running benchmark (' + engines.map(function (e) { return e.name; }).join(', ') + ')...\n');
  const results = framework.runBenchmark(opts);
  const written = report.writeReports(results, outDir);

  // Console summary
  console.log('\n=== Overall ===');
  const overall = results.overall.slice().sort(function (a, b) { return a.avgRounds - b.avgRounds; });
  console.log(pad('engine', 12) + pad('games', 8) + pad('solve%', 8) + pad('avgR', 8) + pad('median', 8) + pad('p90', 6) + pad('max', 6) + pad('avgMs', 9));
  for (let i = 0; i < overall.length; i++) {
    const r = overall[i];
    console.log(pad(r.engine, 12) + pad(r.games, 8) + pad((r.solveRate * 100).toFixed(1), 8) +
      pad(r.avgRounds.toFixed(3), 8) + pad(r.medianRounds, 8) + pad(r.p90Rounds, 6) + pad(r.maxRounds, 6) + pad(r.avgMs.toFixed(3), 9));
  }
  console.log('\nTotal games: ' + results.meta.totalGames + ' · wall ' + results.meta.wallMs.toFixed(0) + ' ms');
  console.log('Reports written:');
  for (let i = 0; i < written.length; i++) console.log('  ' + written[i]);
}

function pad(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }

try {
  main();
} catch (e) {
  console.error('\nBenchmark failed: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
