# GE Decode Solver — Internal Documentation

Internal reference for the GE Decode Solver codebase, generated **before** any refactoring.
It describes the system exactly as it exists today; it does not propose or apply changes.

> Scope reminder: this project is a **deductive puzzle solver** (a Mastermind/Wordle-style
> constraint engine) for the PvZ Gardendless *Decode* mini-game. There is no binary file
> decoder — "decode" refers to the game.

## Contents

| Doc | Task | Summary |
|---|---|---|
| [architecture.md](architecture.md) | 1 | System layers, runtime model, file inventory, data flow |
| [modules.md](modules.md) | 2 | Every major module and its public surface |
| [call-graph.md](call-graph.md) | 3 | Function-level call graph (UI → engine, engine internals) |
| [solver-pipeline.md](solver-pipeline.md) | 4 | End-to-end pipeline from setup to solved |
| [feedback-propagation.md](feedback-propagation.md) | 5 | How each feedback type mutates constraints + propagation rules |
| [strategic-scoring.md](strategic-scoring.md) | 6 | Every strategic-engine scoring function, math and intent |
| [duplicated-logic.md](duplicated-logic.md) | 7 | Catalogue of duplicated logic across the codebase |
| [magic-constants.md](magic-constants.md) | 8 | Every magic constant, value, location, and meaning |
| [persistence-formats.md](persistence-formats.md) | 9 | localStorage schema, serialization, and data formats |
| [engine-improvements.md](engine-improvements.md) | — | Strategic v2 tactics + the new Optimal (information-gain) engine + benchmark results |
| [tech-debt-refactor-report.md](tech-debt-refactor-report.md) | — | Shared feedback helper, TUNING extraction, renames |

## Source map

```
server.js                Node static file server (health + MIME + path guard)
scripts/build.js         "build" = existence check of required public files
netlify.toml             Netlify: publish=public, command=npm run build
public/
  index.html             Loads React (CDN) → engine.js → app.js
  engine.js              STANDALONE solver: data + CSP + suggestion engines + persistence (UMD)
  app.js                 React UI; consumes window.DecodeEngine only
  styles.css             Hand-written CSS (~1327 lines)
GE Decode Sheet.xlsx     Source-of-truth spreadsheet (NOT read at runtime)
docs/                    This documentation
```

All line references in these docs point at `public/engine.js` and `public/app.js` as they
stand now (engine ≈ 848 lines, app ≈ 689 lines).
