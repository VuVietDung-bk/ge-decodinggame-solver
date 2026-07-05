'use strict';
// Benchmark framework: runs every engine over a grid of random valid games,
// records rounds + runtime, and aggregates statistics + solve-length
// distributions. Pure/reusable — returns a results object; reporting is
// handled separately (report.js).

const sim = require('./simulate.js');
const registry = require('./engines.js');
const stats = require('./stats.js');

// Default config grid: [plantCount, codeLength], small -> large.
const DEFAULT_CONFIGS = [
  [3, 3], [4, 3], [5, 4], [6, 4], [6, 5], [7, 5], [8, 6], [10, 4], [10, 8]
];

function configId(pc, k) { return pc + 'p_' + k + 'k'; }

// Aggregate raw per-game records grouped by the given key fields.
// Round stats are computed over SOLVED games; runtime over all games.
function aggregate(games, keys) {
  const groups = {};
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const k = keys.map(function (kk) { return g[kk]; }).join('|');
    if (!groups[k]) groups[k] = { key: {}, rounds: [], ms: [], count: 0, solved: 0, plantCount: g.plantCount, codeLength: g.codeLength };
    for (let j = 0; j < keys.length; j++) groups[k].key[keys[j]] = g[keys[j]];
    groups[k].count++;
    groups[k].ms.push(g.ms);
    if (g.solved) { groups[k].solved++; groups[k].rounds.push(g.rounds); }
  }
  const rows = [];
  for (const k in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, k)) continue;
    const gr = groups[k];
    const row = Object.assign({}, gr.key, {
      plantCount: gr.plantCount,
      codeLength: gr.codeLength,
      games: gr.count,
      solved: gr.solved,
      solveRate: gr.count ? gr.solved / gr.count : 0,
      avgRounds: stats.mean(gr.rounds),
      medianRounds: stats.median(gr.rounds),
      minRounds: stats.min(gr.rounds),
      maxRounds: stats.max(gr.rounds),
      stddevRounds: stats.stddev(gr.rounds),
      p90Rounds: stats.percentile(gr.rounds, 90),
      p95Rounds: stats.percentile(gr.rounds, 95),
      avgMs: stats.mean(gr.ms),
      totalMs: stats.sum(gr.ms),
      gamesPerSec: stats.mean(gr.ms) > 0 ? 1000 / stats.mean(gr.ms) : 0,
      dist: stats.distribution(gr.rounds)
    });
    rows.push(row);
  }
  return rows;
}

// Main entry. opts:
//   engines        array of {name, suggest}  (default: all registered)
//   configs        array of [plantCount, codeLength] (default: DEFAULT_CONFIGS)
//   gamesPerConfig number (default 100)
//   baseSeed       number (default 1)
//   bound          max rounds before "unsolved" (default 60)
//   onProgress     fn({configId, index, total})  optional
function runBenchmark(opts) {
  opts = opts || {};
  const engines = opts.engines || registry.ENGINES;
  const rawConfigs = opts.configs || DEFAULT_CONFIGS;
  const gamesPerConfig = opts.gamesPerConfig || 100;
  const baseSeed = opts.baseSeed || 1;
  const bound = opts.bound || 60;

  const configs = rawConfigs.map(function (c) {
    return { plantCount: c[0], codeLength: c[1], id: configId(c[0], c[1]) };
  });

  // Validate configs up front.
  for (let i = 0; i < configs.length; i++) {
    const cfg = sim.config(configs[i].plantCount, configs[i].codeLength);
    if (!sim.isValidConfig(cfg)) {
      throw new Error('Invalid config ' + configs[i].id + ': codeLength exceeds available hybrids');
    }
  }

  const games = [];
  const t0 = process.hrtime.bigint();

  for (let ci = 0; ci < configs.length; ci++) {
    const cd = configs[ci];
    const cfg = sim.config(cd.plantCount, cd.codeLength);
    for (let g = 0; g < gamesPerConfig; g++) {
      const seed = baseSeed + g;
      // Same secret + same opening RNG for every engine -> fair comparison.
      const secret = sim.withSeed(seed, function () { return sim.randomSecret(cfg); });
      for (let ei = 0; ei < engines.length; ei++) {
        const eng = engines[ei];
        const s0 = process.hrtime.bigint();
        const res = sim.withSeed(seed, function () { return sim.playGame(cfg, secret, eng.suggest, bound); });
        const s1 = process.hrtime.bigint();
        games.push({
          engine: eng.name,
          configId: cd.id,
          plantCount: cd.plantCount,
          codeLength: cd.codeLength,
          seed: seed,
          rounds: res.rounds,
          solved: res.solved,
          ms: Number(s1 - s0) / 1e6
        });
      }
    }
    if (opts.onProgress) opts.onProgress({ configId: cd.id, index: ci + 1, total: configs.length });
  }

  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;

  return {
    games: games,
    summary: aggregate(games, ['engine', 'configId']),
    overall: aggregate(games, ['engine']),
    meta: {
      gamesPerConfig: gamesPerConfig,
      baseSeed: baseSeed,
      bound: bound,
      totalGames: games.length,
      wallMs: wallMs,
      configs: configs,
      engines: engines.map(function (e) { return e.name; }),
      generatedAt: new Date().toISOString(),
      node: process.version
    }
  };
}

module.exports = { runBenchmark: runBenchmark, aggregate: aggregate, DEFAULT_CONFIGS: DEFAULT_CONFIGS, configId: configId };
