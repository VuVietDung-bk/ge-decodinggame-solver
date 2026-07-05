# Solver Benchmark Framework

Reusable, zero-dependency framework that generates random valid games, simulates the full
solve for **every engine**, and reports rounds + runtime + solve-length distribution.
Runs on any **Node ≥ 12**.

```bash
npm run bench                       # defaults: all engines, 100 games/config, built-in grid
node bench/run.js --games 500       # more games for tighter stats
node bench/run.js --engines strategic --configs 8x6,10x8 --out bench/out/strat
node bench/run.js --help
```

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--games N` | 100 | games per config |
| `--seed N` | 1 | base RNG seed (reproducible) |
| `--bound N` | 60 | max rounds before a game counts as "unsolved" |
| `--out DIR` | `bench/out` | report output directory |
| `--engines a,b` | all | subset of registered engines |
| `--configs g` | built-in grid | e.g. `3x3,5x4,10x8` (`plantsXslots`) |

## Outputs (in `--out`)

| File | Contents |
|---|---|
| `report.md` | human report: overall table, per-config breakdown, ASCII solve-length histograms |
| `summary.csv` | one row per (engine, config): games, solveRate, avg/median/min/max/stddev/p90/p95 rounds, avg/total ms, games/s |
| `games.csv` | raw per-game rows (engine, config, seed, rounds, solved, ms) for custom analysis |
| `distribution.csv` | `engine, scope, rounds, count` — solve-length histogram per config and overall (`scope=ALL`) |

## Metrics recorded

- **Average rounds** (and median, min, max, stddev, p90, p95) over *solved* games.
- **Runtime**: per-game wall time via `process.hrtime.bigint()`; reported as avg ms/game,
  total ms, and games/second throughput.
- **Distribution** of solve lengths (histogram of rounds → count).
- **Solve rate** (fraction solved within `--bound`).

## Fairness & reproducibility

For each `(config, gameIndex)` the framework generates **one** secret and runs **every** engine
against that same secret with the **same opening-RNG seed**. Engines are therefore compared on
identical games. Everything is seeded, so runs are reproducible (`--seed`).

## Adding a future algorithm (the reusability contract)

An "engine" is just a named suggestion policy:

```js
// suggest(state, validHybrids, K, isFirst, selectedPlants) -> string[]  (hybrid keys, one per slot)
```

Two ways to benchmark a new algorithm:

1. **Register it** in `bench/engines.js`:
   ```js
   const ENGINES = [
     { name: 'strategic', suggest: wrap(E.ENGINE_STRATEGIC) },
     { name: 'heuristic', suggest: wrap(E.ENGINE_HEURISTIC) },
     { name: 'entropy',   suggest: require('./algorithms/entropy.js') } // new
   ];
   ```
   Then `npm run bench` includes it automatically.

2. **Pass it programmatically** (no file edits):
   ```js
   const { runBenchmark } = require('./bench/framework.js');
   const { writeReports } = require('./bench/report.js');
   const results = runBenchmark({
     engines: [{ name: 'entropy', suggest: mySuggest }],
     gamesPerConfig: 300
   });
   writeReports(results, 'bench/out/entropy');
   ```

The algorithm need not live in `engine.js`; any function with the signature above works, so
new solvers drop in without touching the simulator, stats, or reporting.

## Module layout

| File | Role |
|---|---|
| `simulate.js` | seeded RNG, config/secret generators, feedback oracle, `playGame` (engine-agnostic) |
| `engines.js` | engine registry + `select(names)` |
| `stats.js` | mean / median / stddev / percentile / distribution |
| `framework.js` | `runBenchmark(opts)` → raw games + aggregated summary/overall + meta |
| `report.js` | CSV + Markdown writers |
| `run.js` | CLI |

> The simulator mirrors the feedback oracle validated by the test suite (`test/`); the two are
> kept independent so the benchmark has no test-framework dependency.
