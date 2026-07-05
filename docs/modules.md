# 2. Module Documentation

Four source modules carry logic: `engine.js`, `app.js`, `server.js`, `build.js`.
`index.html`, `styles.css`, and `netlify.toml` are delivery/config assets.

---

## 2.1 `public/engine.js` — Solver engine (UMD)

Pure logic; **no DOM, no React**. UMD wrapper (`engine.js:8-19`) assigns the API to
`root.DecodeEngine` (browser) and `module.exports` (Node). Everything below is returned from
the factory's export object (`engine.js:~803`).

### Data / constants
| Symbol | Line | Meaning |
|---|---|---|
| `BASE_PLANTS` | 26 | 10 full plant names, index 0–9 |
| `BASE_SHORT` | 32 | 10 short labels for UI |
| `PLANT_COLORS` | 34 | 10 chip gradient colors |
| `COMBINATIONS` | 41 | 10×10 **symmetric** hybrid-name matrix; `null` = invalid pair |
| `FEEDBACK_TYPES` | 51 | 4 feedback descriptors `{id,label,icon,shortLabel}` |
| `STORAGE_KEY` | 57 | `'ge-decode-solver-v1'` localStorage key |
| `ENGINE_HEURISTIC` / `ENGINE_STRATEGIC` | 202/203 | engine id strings |

### Key / hybrid utilities
| Function | Line | Contract |
|---|---|---|
| `hKey(i,j)` | 63 | canonical unordered-pair key `"min_max"` |
| `parseKey(key)` | 67 | `"i_j"` → `[i,j]` (ints) |
| `getHybridName(i,j)` | 72 | matrix lookup → name or `null` |
| `getValidHybrids(idxs)` | 76 | all valid `{key,p1,p2,name}` over selected plants (upper triangle incl. diagonal) |
| `buildHybridLookup(vh)` | 794 | `Map<key, hybrid>` |

### CSP core
| Function | Line | Contract |
|---|---|---|
| `createSolverState(vh,len)` | 91 | fresh state: `possible[]` (Set per slot), `mustInclude`, `excluded`, `confirmed[]`, `gameLocked[]` |
| `cloneState(st)` | 102 | deep copy (Sets + arrays duplicated) |
| `applyFeedback(state,guess,feedback)` | 112 | **pure**: clone → apply per-slot rules → `propagate` → return |
| `propagate(st,len)` | 164 | in-place fixpoint (naked single + hidden single), ≤100 iterations |

### Suggestion engines
| Function | Line | Contract |
|---|---|---|
| `generateSuggestion(state,vh,len,isFirst,plants,engine)` | 205 | dispatch → strategic or heuristic |
| `heuristicSuggestion(…)` | 216 | greedy placement, balanced-overlap tie-break |
| `strategicSuggestion(…)` | 422 | adaptive info/placement mode + 1-ply lookahead |
| `placementSuggestion(state,vh,len,active,result,used)` | 612 | fill slots with known/WS/best-overlap picks |
| `firstGuess(vh,len)` | 685 | opening guess maximizing base coverage (randomized ties) |

### Strategic scoring internals
| Function | Line | Contract |
|---|---|---|
| `compositeScore(cand,unknownSlots,state)` | 284 | cross-slot split quality (higher = better splitter) |
| `simulateFeedback1Slot(state,slot,p1,p2,fb,len)` | 317 | hypothetical state for one feedback outcome |
| `totalUncertainty(state,len)` | 358 | Σ possible sizes over unconfirmed slots |
| `estimateFbProbs(cand,slot,state,isProbe)` | 367 | `[correct,wrongslot,partial,allwrong]` probability estimate |
| `lookaheadScore(cand,slot,state,len,isProbe)` | 404 | expected uncertainty reduction |

### Persistence
| Function | Line | Contract |
|---|---|---|
| `serializeState(st)` | 729 | Sets → Arrays |
| `deserializeState(d)` | 739 | Arrays → Sets; defaults missing `gameLocked` |
| `saveGame(config,data,engine)` | 750 | write `v:3` blob (silent no-op if unavailable) |
| `loadGame()` | 767 | read + validate (`v` ∈ {1,2,3}) → `{config,engine,data}` or `null` |
| `clearGame()` | 786 | remove blob |

---

## 2.2 `public/app.js` — React UI

IIFE. Binds engine APIs to local names at the top (`app.js:11-32`) so component bodies use
short names (`parseKey`, `applyFeedback`, …). Contains **no solver logic**.

| Component / helper | Line | Responsibility |
|---|---|---|
| `App()` | 43 | root; owns `screen/config/data/engine`; wires `loadGame`, `handleStart`, `handleUpdate`, `handleReset`, `handleEngineChange`; renders Setup or Solver |
| `SetupScreen({onStart})` | 95 | plant-count / code-length pickers; uses first N plants; calls `getValidHybrids` for validation |
| `SolverScreen({config,data,…})` | 207 | per-round guess + feedback entry; `handleSubmit` → `applyFeedback` + `generateSuggestion`; engine switcher; auto-fills game-locked slots |
| `getLegendDesc(id)` | 525 | feedback legend text (UI-only) |
| `suggestionToGuess(sug,lookup)` | 535 | maps suggestion keys → `{p1,p2}` (uses `parseKey`) |
| `SuggestionPanel(…)` | 547 | renders suggested/answer slots |
| `AnalysisPanel(…)` | 586 | per-slot remaining-possibility view |
| `HistoryPanel(…)` | 650 | past rounds with feedback icons |

UI state notes: `guess` and `feedback` are `SolverScreen` local state; game-locked slots are
re-locked on round change and before submit via repeated "keep locked" loops
(see [duplicated-logic.md](duplicated-logic.md)).

---

## 2.3 `server.js` — Static server

| Element | Line | Notes |
|---|---|---|
| `MIME` map | 9 | ext → content type |
| request handler | 22 | `/api/health`, `/` + `/index.html`, else file under `PUBLIC_DIR` |
| path guard | 37 | `candidate.startsWith(PUBLIC_DIR)` + `isFile()` |
| `sendJson(res,data)` | 53 | JSON + `no-store` |
| `serveFile(res,path)` | 62 | streams file; `Cache-Control` by type |

`PORT` from env or `5500`. Exports `{}`; only listens when run as main module.

---

## 2.4 `scripts/build.js` — Existence check

Ensures `public/` exists, then verifies `index.html`, `engine.js`, `app.js`, `styles.css`
are present; logs ✓/✗ and exits non-zero on any missing file. No compilation/bundling.

---

## 2.5 Delivery assets

- **`index.html`** — meta, Inter font link, React + ReactDOM CDN scripts, then
  `<script src="/engine.js">` and `<script src="/app.js">`, mounting into `#root`.
- **`styles.css`** — ~1327 lines, hand-written, CSS custom properties (`--accent`, etc.).
- **`netlify.toml`** — build/publish config.
