# Technical Review: GE Decode Game Solver

> A critical architecture + engine review of the GE Decode solver web app.
> **Scope note:** the assignment brief is written for a *binary game-file decoder*
> (headers, offsets, pointers, compression). This project contains none of that.
> Each section below is mapped onto what actually exists, and gaps are stated
> plainly rather than invented.

---

## 1. Executive Summary

**What this project actually is:** a single-page web app that acts as a **deductive solver**
(a Mastermind/Wordle-style constraint engine) for the *PvZ Gardendless "Decode"* puzzle.
The word "decode" refers to the **game**, not to binary decoding. There is **no file-format
decoder, no binary parser, no headers/offsets/pointers/compression** anywhere in the codebase.

| Assignment concept | Closest real analog in this repo | Exists? |
|---|---|---|
| "File format being decoded" | The secret plant *code* (inferred via feedback) + the `COMBINATIONS` matrix (transcribed from `GE Decode Sheet.xlsx`) + the `localStorage` save schema | Partially |
| "Decoding pipeline" | Feedback → constraint propagation → suggestion generation | ✅ (the real engine) |
| "Header parsing / offsets / pointers" | — | ❌ none |
| "Compression / encryption / checksums" | — | ❌ none |

The genuinely interesting engineering is the **constraint-propagation solver** and the **two
suggestion engines** (`heuristic` and `strategic`) in `public/app.js`. The rest (server, build,
deploy) is boilerplate. This review therefore concentrates there.

**Overall verdict:** A competent, working, single-file React app with a genuinely clever solver
core, but with **no tests, heavy code duplication, a wall of unexplained magic constants, a fake
build step, stale documentation, and a probability model that is hand-tuned rather than derived.**
It is a good hobby tool; it is not yet a maintainable or verifiable one.

---

## 2. Decoder Overview

### 2.1 The domain model

- **10 base plants** (`app.js:11`), indexed 0–9.
- **`COMBINATIONS[i][j]`** (`app.js:24-35`) — a **10×10 symmetric matrix**; each cell is a hybrid
  name or `null` (invalid pairing). A "hybrid" is an unordered pair `{i, j}` (including `i == j`,
  a "pure" combo on the diagonal).
- The **secret answer** is a length-`L` sequence of hybrids (`L` = code length, 3–10).
- Each guess assigns a hybrid to every slot; the game returns **per-slot feedback** in a strict
  priority order: `correct` > `wrongslot` > `partial` > `allwrong`.

**Confirmed facts** (from code + spot-check):
- Matrix is symmetric (verified on multiple pairs); pairs are canonicalized via
  `hKey(i,j) = min_max` (`app.js:50`).
- Full 10-plant set yields **45 valid hybrids** (upper triangle incl. diagonal), 10 invalid pairs.

### 2.2 What "decoding" means here

The solver *decodes the secret code* by maintaining, per slot, a **set of still-possible hybrids**
and shrinking it as feedback arrives. Pipeline:

```
Setup (plant count L, code length)
        ↓
getValidHybrids()  ──────────────►  build candidate universe (Sets)
        ↓
createSolverState()  ────────────►  possible[slot] = full set; confirmed/locked empty
        ↓
┌───────────── per round ─────────────┐
│  user enters guess + per-slot feedback │
│        ↓                               │
│  applyFeedback()  ── per-slot rules ── │  (correct/wrongslot/partial/allwrong)
│        ↓                               │
│  propagate()  ── fixpoint loop ──────  │  (singletons, must-include locking)
│        ↓                               │
│  generateSuggestion(engine)            │  heuristic OR strategic
│        ↓                               │
│  render Suggestion / Analysis / History│
│        ↓                               │
│  saveGame() → localStorage (v3)        │
└────────────────────────────────────────┘
        ↓
all slots gameLocked  →  "Puzzle Solved"
```

There is **no header parsing, offset handling, or pointer resolution** to describe — those stages
simply don't exist. The one "format" worth analyzing is the persistence schema (§5.2).

---

## 3. Architecture Analysis

### 3.1 High-level structure

```
server.js         static file server (health check + MIME + path-prefix guard)
scripts/build.js  "build" = existence check of 3 files (no bundling/transpile)
netlify.toml      publish=public, command=npm run build
public/
  index.html      React 18 + ReactDOM from unpkg CDN; loads app.js
  app.js          EVERYTHING: data, engine, persistence, all React components
  styles.css      1327 lines of hand-written CSS
GE Decode Sheet.xlsx   source-of-truth spreadsheet (not read at runtime)
```

Everything of substance lives in **one 1440-line IIFE**. There is no module system, no bundler,
no separation between the pure engine and the UI.

### 3.2 Modularity — weak

- **No separation of concerns.** The pure, testable solver (lines ~50–710) and the React UI
  (~790–1439) share one file scope. The engine has no exports, so it cannot be unit-tested or
  reused without copy-paste.
- **Data is hardcoded inline**, not loaded from JSON. `DEPLOY.md` claims the server serves
  `/api/bootstrap` from `PlantProps.json` + `PlantFeatures.json` — **those files and that endpoint
  do not exist** (`server.js` has only `/api/health`). The docs describe a different (earlier?)
  architecture. Stale docs are a maintainability liability.
- **Positive:** within the engine, responsibilities are at least *named* well — `applyFeedback`,
  `propagate`, `compositeScore`, `lookaheadScore`, `firstGuess` are cohesive functions.

### 3.3 Maintainability — mixed

**Strengths**
- Readable naming, consistent style, good sectioning comments.
- Versioned persistence with graceful `try/catch` fallbacks.

**Weaknesses**
- **Severe duplication.** `simulateFeedback1Slot` (`app.js:304-343`) is a near-verbatim copy of the
  per-slot body of `applyFeedback` (`app.js:99-149`). The balanced-overlap tie-break logic is
  duplicated three times (`heuristicSuggestion`, `placementSuggestion`, and inline). Any semantic
  change to a feedback rule must be made in **two** places or the lookahead silently diverges from
  reality — a latent correctness bug generator.
- **Magic-number soup** in the strategic engine: `0.15`, `0.02`, `0.98`, `0.005`, `0.01`, blend
  weights `0.7/0.3`, `LOOKAHEAD_N=8`, thresholds `1.5 / 2 / 3`. None are named constants or
  justified. This is the single biggest obstacle to tuning or trusting the engine.
- **Mixed idiom:** `const`/`let` in some functions, `var` + ES5 loops in others (a sign of two
  authoring eras — consistent with the "optimize the engine more" commit that rewrote 339 lines).

### 3.4 Robustness — thin

- **No input universe validation** beyond `canStart`. The engine trusts feedback is self-consistent.
- **Contradictions are surfaced but not handled.** A slot reaching `possible.size === 0` shows a
  warning banner (`app.js:1114`) but the engine keeps running and the suggestion generator will
  happily emit degenerate guesses. There's no "you probably mis-entered round 2" diagnosis and no
  rollback.
- **Silent `catch (_)`** everywhere in persistence hides corruption.
- **No integer-overflow / memory-safety concerns** — it's JS with tiny bounded data (≤10 slots,
  ≤45 hybrids). This category from the brief is essentially N/A.
- **`propagate` caps at 100 iterations** (`app.js:153`) — a defensive guard, but if it ever hit the
  cap it would silently return a partially-propagated state.

### 3.5 Performance — not a real concern, one wart

The data is tiny, so nothing "dominates runtime" meaningfully. The only structurally wasteful
pattern:

- **`cloneState` deep-copies every Set on every simulation.** The strategic engine's lookahead calls
  `simulateFeedback1Slot` (→ `cloneState` + `propagate`) up to `LOOKAHEAD_N × 4` times *per uncertain
  slot* (`app.js:579-585`). Worst case ~ `8 × 4 × L` clones of `L` Sets per suggestion. For L=10
  that's a few hundred small Set copies — imperceptible, but it's the one place that would matter if
  the domain grew.

**Estimated hot path:** `propagate` (called inside every simulation) and `compositeScore`
(O(candidates × slots × possible)). Both are bounded and fine at current scale.

---

## 4. Parsing Pipeline (the real one: feedback → constraints)

The core is `applyFeedback` + `propagate`. Semantic contract of each feedback type — this *is* the
"format spec" of this solver:

| Feedback | Meaning | Constraint applied (`app.js:108-144`) |
|---|---|---|
| `correct` | exact hybrid, exact slot | `possible[s]={key}`, confirm+lock, remove key from all other slots |
| `wrongslot` | hybrid is in answer, different slot | remove key from `possible[s]`, add to `mustInclude` |
| `partial` | one base plant matches this slot | hybrid *entirely absent* → remove from all slots + `excluded`; keep only `possible[s]` sharing a base with `{p1,p2}` |
| `allwrong` | neither base matches | remove hybrid everywhere; keep only `possible[s]` sharing **no** base with `{p1,p2}` |

**Propagation** (`app.js:151-184`) then runs a fixpoint:
- **Rule 1 (naked single):** a slot with one possibility is confirmed and that hybrid is stripped
  from other slots.
- **Rule 2 (hidden single):** a `mustInclude` hybrid with exactly one viable slot is locked there.

This is a clean, small CSP engine. The design is sound.

---

## 5. File Format Analysis

No binary format exists, so this documents the two *data* formats that do.

### 5.1 The `COMBINATIONS` matrix (transcribed from the .xlsx)

- **Confirmed:** symmetric 10×10; `null` = invalid pairing; diagonal = "pure" self-combos (all 10
  present).
- **Strong evidence:** the matrix was hand-transcribed from `GE Decode Sheet.xlsx` (the file exists,
  isn't read at runtime, and the comment says "from Excel" `app.js:8`). This makes the spreadsheet
  the **de-facto source of truth with a manual, error-prone sync step**.
- **Hypothesis:** the null pattern (10 invalid pairs) encodes real game rules about which plants
  can't hybridize — worth documenting, since it's currently implicit.

### 5.2 The `localStorage` save schema (the only versioned "format")

```jsonc
{ "v": 3,                        // schema version; loader accepts 1|2|3
  "config": { selectedPlants, codeLength },
  "engine": "strategic|heuristic",
  "data": {
    "validHybrids": [...],
    "solverState": {             // Sets serialized as arrays
      possible: string[][], mustInclude: [], excluded: [],
      confirmed: (string|null)[], gameLocked: bool[] },
    "history": [...], "suggestion": [...] } }
```

- **Confirmed fields**; `gameLocked` was added in a later version (loader defaults it if absent —
  `app.js:733`). This is the one place real "version handling" lives, and it's done reasonably.
- **Weakness:** `v1`/`v2` are "accepted" but there is **no migration** — an old blob missing
  `gameLocked` is patched, but nothing else. Accepting a version you can't fully migrate risks
  loading a subtly-wrong state.

---

## 6. Code Quality Review — representative findings

**A. Duplicated feedback logic is a correctness time-bomb.**
`applyFeedback` and `simulateFeedback1Slot` must stay semantically identical or the strategic
engine's lookahead optimizes against a *wrong* model of the game.
> **Fix:** extract `applyFeedbackToSlot(state, slot, p1, p2, fb, len)` and call it from both.

**B. The strategic probability model is not principled.**
`estimateFbProbs` (`app.js:354-389`) returns vectors like `[0, 0.02, pPartial*0.98, pAllWrong*0.98]`
that **don't necessarily sum to 1** and use unexplained constants. The "minimax lookahead" comment
(`app.js:303`) is a misnomer — it computes an **expected** uncertainty reduction (`Σ p·Δ`), not a
minimax (worst-case) value. Naming implies a guarantee the code doesn't provide.

**C. Nondeterministic first guess.**
`firstGuess` uses `Math.random()` among tied candidates (`app.js:696`). Nice for variety, but it
makes the engine **untestable and irreproducible**. A seedable RNG would fix both.

**D. Fake build + stale deploy docs.**
`scripts/build.js` only checks three files exist. `DEPLOY.md` documents endpoints/files that don't
exist. Both mislead a new contributor.

**E. Server path guard is *mostly* fine but subtle.**
`candidate.startsWith(PUBLIC_DIR)` after `path.join` (`server.js:37`) blocks basic `..` traversal
(join normalizes). On case-insensitive Windows FS the prefix check is a string compare, not a
realpath check — low risk for a static toy server, but not something to copy into anything serious.

---

## 7. Limitations (and why they exist)

| Limitation | Root cause |
|---|---|
| Only the **first N** base plants are ever usable; `getValidHybrids` supports arbitrary subsets but the UI forces `0..N-1` (`app.js:850-854`) | UI was "simplified" — dead flexibility in the engine |
| **Hardcoded matrix** in JS; manual .xlsx sync | No data pipeline; transcription by hand |
| **No tests** | Single-file IIFE with no exports makes testing awkward |
| **Magic constants** can't be tuned/validated | Engine evolved by hand-tuning, never parameterized |
| **Contradiction = dead end**, no rollback/diagnosis | Solver assumes perfect user input |
| **Expected-value engine mislabeled "minimax"**, ad-hoc probs | Heuristic development, no formal model |
| **Docs describe a nonexistent architecture** | Drift after a refactor |

---

## 8. Improvement Suggestions

Each with *why / benefit / difficulty / trade-off*.

1. **Split engine from UI into a pure `engine.js` with exports.**
   *Why:* enables unit tests + reuse. *Benefit:* high (unlocks everything below).
   *Difficulty:* low (cut/paste + `export`). *Trade-off:* need a tiny bundler or ES-module script.

2. **De-duplicate the feedback rules** (finding A).
   *Why:* single source of truth for game semantics. *Benefit:* eliminates a bug class.
   *Difficulty:* low. *Trade-off:* none.

3. **Name every magic constant in a `TUNING` object with comments.**
   *Benefit:* makes the engine explainable and A/B-tunable. *Difficulty:* low. *Trade-off:* none.

4. **Replace the ad-hoc probability model with an explicit hypothesis set.** Per-slot possibilities
   are small, so you can compute **true** expected information gain by enumerating consistent answers
   per slot (or a sampled subset). *Benefit:* correctness + genuinely optimal probes; retire the
   magic numbers. *Difficulty:* medium. *Trade-off:* more compute (still trivial at this scale).

5. **Load the matrix from a generated JSON** produced by a script that reads `GE Decode Sheet.xlsx`.
   *Benefit:* kills manual transcription error; single source of truth. *Difficulty:* medium.
   *Trade-off:* adds a real build.

6. **Seedable RNG** for `firstGuess`. *Benefit:* reproducible tests + optional variety.
   *Difficulty:* trivial.

7. **Contradiction diagnostics:** when a slot hits 0, identify the earliest inconsistent round and
   offer an undo. *Benefit:* huge UX win (mis-entry is the #1 user error). *Difficulty:* medium
   (keep per-round snapshots — already cheap to clone).

8. **A real build/test setup** (Vitest + a bundler). Replace the placebo `build.js`.
   *Benefit:* confidence. *Difficulty:* low-medium.

9. **Rename `lookaheadScore`/comments** to "expected info gain," or actually implement worst-case
   minimax as an option. *Benefit:* honesty + a stronger mode. *Difficulty:* low (rename) /
   medium (true minimax).

10. **Fix `DEPLOY.md`** to match reality. *Benefit:* onboarding. *Difficulty:* trivial.

---

## 9. Extension Ideas (technically realistic)

- **Solver self-play harness** — simulate random secret codes and measure avg rounds-to-solve per
  engine. The single most valuable addition: turns "the engine feels better" into a number.
- **True optimal mode** via full consistent-answer enumeration for small configs; heuristic fallback
  for large ones.
- **Arbitrary plant-subset selection** in the UI (engine already supports it).
- **Shareable game state** via URL-encoded save (schema is already serializable).
- **JSON/CSV export of the matrix + a format-doc generator** from the spreadsheet.
- **"Explain this suggestion"** debug panel showing per-candidate scores — trivial once constants
  are named.
- **Encoder/round-trip:** given a secret code, generate the exact feedback a guess would receive —
  useful for testing.

---

## 10. Reverse Engineering Notes

- **The interesting inference in the code** is the `partial` handling (`app.js:118-130`): it deduces
  that a `partial` result means the *exact hybrid is absent from the entire answer*, justified by the
  feedback **priority order** (`correct`/`wrongslot` would have fired first). A correct, non-obvious
  deduction — the strongest piece of reasoning in the project. It deserves a comment citing the
  priority ordering as the proof.
- **The null pattern in `COMBINATIONS`** encodes game rules not documented anywhere; reverse-
  engineering *why* those 10 pairings are invalid would be worthwhile.
- **No checksums, encryption, or compression** exist to analyze — stated plainly because the brief
  expects them.
- **Two authoring eras** are visible (const/let vs var; the `optimize the engine more` commit added
  the entire strategic engine). The strategic engine is bolted alongside the heuristic one rather
  than replacing it — worth deciding if both should survive.

---

## 11. Prioritized Recommendations

### Top 10 highest-impact
1. Extract a pure, exported engine module (unlocks tests).
2. De-duplicate feedback logic into one shared function.
3. Add a self-play benchmark harness to measure engine quality objectively.
4. Replace the ad-hoc probability model with enumerated consistent answers (true info gain).
5. Name and document all tuning constants.
6. Generate `COMBINATIONS` from the .xlsx via a build script.
7. Add contradiction diagnosis + per-round undo.
8. Add a real test suite (rules + propagation invariants).
9. Correct the "minimax" misnomer / implement a real worst-case mode.
10. Fix `DEPLOY.md` and `build.js` to reflect reality.

### Top 5 easiest, high-benefit
1. Fix stale `DEPLOY.md` (5 min).
2. Seedable RNG in `firstGuess` (15 min, unlocks reproducible tests).
3. Hoist magic numbers into a named `TUNING` object (30 min).
4. Extract `applyFeedbackToSlot` shared helper (30 min, kills a bug class).
5. Rename `lookaheadScore` → `expectedInfoGain` + accurate comments (10 min).

### Long-term roadmap → reusable framework
1. **Phase 1 – Separate & test:** engine module + Vitest + benchmark harness. Establish a baseline.
2. **Phase 2 – Principled solver:** replace heuristics with enumerated/sampled information-gain; keep
   the fast heuristic as a "quick" mode.
3. **Phase 3 – Data-driven:** matrix + rules loaded from generated JSON; make the engine agnostic to
   *which* Mastermind-variant it solves (plants → generic symbols, hybrids → generic pair-tokens).
4. **Phase 4 – Product:** contradiction/undo UX, shareable state, explain-panel, arbitrary subsets.
   At this point the core is a small, tested, generic **constraint-solver library** with a thin
   PvZ-Decode skin.

---

## 12. Final Conclusion

This is a **well-executed hobby app with a genuinely clever solver core wrapped in throwaway
infrastructure and no safety net.** The constraint engine (`applyFeedback` + `propagate`) is correct
and elegant; the `partial`-implies-absent deduction is a highlight. The strategic engine is ambitious
but **hand-tuned, mislabeled, and duplicated**, and the whole thing is **untestable as written**
because engine and UI share one scope.

The brief's binary-decoder framing does not fit this codebase. Judged as what it *is* (a deductive
puzzle solver), the highest-leverage move by far is **#1 + #2 + #3: extract the engine, unify the
feedback logic, and add a self-play benchmark.** Those three unlock every other improvement and
convert subjective "the engine is smarter now" claims into measurable ones.

**Scorecard**

| Dimension | Grade | One-line justification |
|---|---|---|
| Architecture quality | C | Works, but monolithic single-file IIFE, no separation |
| Decoder (solver) completeness | B+ | Correct CSP core; strategic engine ambitious |
| Robustness | C− | No tests, contradictions unhandled, silent catches |
| Extensibility | C | Engine flexibility exists but is locked away/undocumented |
| Maintainability | C− | Duplication + magic numbers + stale docs |
| Reverse-engineering quality | B | The `partial` deduction is genuinely sharp |
