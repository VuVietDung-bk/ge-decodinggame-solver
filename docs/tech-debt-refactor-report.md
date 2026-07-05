# Tech-Debt Refactor Report

**Scope:** `public/engine.js` only. No behavior change. Verified under Node.
**Guarantee:** exported API unchanged (32 names, identical set), every numeric value identical,
both engines reproduce the pre-refactor baseline exactly.

---

## 1. Duplication removed

### 1.1 The four feedback rules (the high-risk one)

Previously the `correct` / `wrongslot` / `partial` / `allwrong` logic existed **twice**:

| Before | Lines (old) | Role |
|---|---|---|
| body of `applyFeedback`'s per-slot loop | ~112–162 | real submissions |
| body of `simulateFeedback1Slot` | ~317–356 | hypothetical outcomes for lookahead |

Both were ~40 lines of near-identical branch logic. They differed in exactly **one** way: the
`correct` branch in `applyFeedback` also set `gameLocked[s] = true`; the simulate version did not.

**After:** a single shared function

```js
function applyFeedbackToSlot(ns, slot, p1, p2, fb, len, lockOnCorrect) { … }
```

- `applyFeedback` calls it in a loop with `lockOnCorrect = true`.
- `simulateFeedback1Slot` calls it once with `lockOnCorrect = false`.

The `lockOnCorrect` flag is what preserves the one legitimate difference between the two paths,
so behavior is **exactly** preserved (verified: real feedback locks slot 0, simulate does not).

`applyFeedback` shrank to a 3-line loop; `simulateFeedback1Slot` shrank to a clone + one call +
propagate. ~70 duplicated lines collapsed to one 45-line source of truth.

> The shared helper is **internal** — it is deliberately *not* added to the export object, so
> the public API surface is unchanged.

### 1.2 Duplication intentionally left (documented, out of scope)

The following duplications from [duplicated-logic.md](duplicated-logic.md) were **not** touched,
because removing them risks behavior change and/or touches the UI, which was out of scope for a
"no observable change" pass:

- Balanced-overlap tie-break (heuristic ↔ placement) — §7.2
- Inlined base-plant overlap predicate (6 sites) — §7.3
- Game-locked auto-fill loop (heuristic ↔ strategic) — §7.4
- "sort by possible size" (heuristic ↔ placement) — §7.5
- tested/known set-building — §7.6
- UI "keep-locked" loops + `fbIcons` map — §7.7 / §7.8

Only the split-target ratio `0.5` inside 1.1-adjacent sites was unified via a shared constant
(see §2), which is a naming change, not a logic merge.

---

## 2. Magic numbers → `TUNING`

A single `TUNING` object now names every heuristic/threshold literal. **Values are copied
verbatim**; only names are new. `TUNING` is internal (not exported).

| Constant | Value | Was inlined in |
|---|---|---|
| `MAX_PROPAGATION_ITERATIONS` | 100 | `propagate` fixpoint cap |
| `SPLIT_TARGET_RATIO` | 0.5 | `compositeScore`, `heuristicSuggestion`, `placementSuggestion` |
| `FIRST_GUESS_HETERO_BONUS` | 0.5 | `firstGuess` (×2) |
| `FIRST_GUESS_TIE_EPSILON` | 0.001 | `firstGuess` tie collection |
| `UNIFORM_FB_PROB` | 0.25 | `estimateFbProbs` size-0 guard |
| `WRONGSLOT_BASE_PROB` | 0.02 | `estimateFbProbs` (probe + normal) |
| `NON_WRONGSLOT_SCALE` | 0.98 | `estimateFbProbs` (probe + normal) |
| `MIN_OUTCOME_PROB` | 0.005 | `lookaheadScore` skip threshold |
| `LOOKAHEAD_CANDIDATES` | 8 | strategic Phase 2 (`topN`) |
| `LOOKAHEAD_MIN_UNKNOWN_SLOTS` | 2 | strategic `useLookahead` |
| `LOOKAHEAD_MIN_CANDIDATES` | 2 | strategic `useLookahead` |
| `LOOKAHEAD_INFO_WEIGHT` | 0.7 | strategic blend |
| `LOOKAHEAD_QUALITY_WEIGHT` | 0.3 | strategic blend |
| `PLACE_AVG_POSS_WITH_PROBES` | 1.5 | `shouldPlace` (probes) |
| `PLACE_AVG_POSS_NO_PROBES` | 3 | `shouldPlace` (no probes) |
| `PLACE_MAX_POSS` | 2 | `shouldPlace` (both branches) |
| `PROBE_SHARED_BASE_PENALTY` | 0.15 | info-mode candidate score |
| `UNTESTED_PLANT_BONUS` | 0.02 | info-mode candidate score |
| `POSSIBLE_AT_SLOT_BONUS` | 0.01 | info-mode candidate score |
| `HETERO_PAIR_BONUS` | 0.005 | info-mode candidate score |

Additionally, the magic `4` in `lookaheadScore`'s loop (`fi < 4`) became `fi < fbTypes.length`
(structural, not a knob).

**Deliberately out of scope** (not algorithm tuning, and outside `engine.js`):
- `server.js` — port `5500`, cache `86400` (conventional HTTP settings).
- `app.js` — UI defaults (plant count `5`, code length `4`, slider bounds `3`/`10`, "show 5
  remaining"). These are UI config, not engine tuning, and moving them into an engine `TUNING`
  object would couple the layers.

---

## 3. Misleading names/comments corrected

The code repeatedly called the lookahead **"minimax"**, but it computes a **probability-weighted
expected** uncertainty reduction (`Σ p·Δ`), not a worst-case minimax value.

| Location | Before | After |
|---|---|---|
| strategic header comment #6 | "Minimax lookahead (#4): simulate feedback outcomes" | "Expected-info-gain lookahead (#4): probability-weighted 1-ply simulation…" |
| above `simulateFeedback1Slot` | "Proposal #4: Minimax lookahead (1-ply)" | "Expected-information-gain lookahead (1-ply)" + note on lock semantics |
| strategic Phase 2 | "Minimax lookahead (#4) on top candidates" | "Expected-info-gain lookahead on top candidates" |
| blend comment | "Blend: 70% lookahead info reduction, 30% composite quality" | "Blend expected info reduction with composite quality" (weights now named) |

**Exported function names were NOT changed** (`lookaheadScore`, `simulateFeedback1Slot`,
`compositeScore`, …) because renaming them would alter the public API — comments were corrected
instead.

---

## 4. Verification

Run under Node (WSL), asserted programmatically:

1. **Exports unchanged** — `Object.keys(DecodeEngine)` equals the exact 32-name baseline; neither
   `applyFeedbackToSlot` nor `TUNING` leaked into exports.
2. **Behavior identical** — same fixture (`plants [0,1,2,3,4]`, K=4, feedback
   `[correct, allwrong, partial, wrongslot]`) yields the baseline exactly:
   - `possible` sizes `[1,4,7,10]`, `confirmed[0]=0_1` locked, `mustInclude={1_2}`,
     `excluded={2_3,0_4}`.
   - strategic suggestion `["0_1","1_1","4_4","1_4"]`; heuristic `["0_1","1_4","0_2","0_3"]`.
3. **Lock semantics preserved** — `simulateFeedback1Slot(..,'correct',..)` sets `confirmed` but
   leaves `gameLocked=false`; real `applyFeedback` sets `gameLocked=true`.
4. **Shared helper stress** — all four feedback types exercised together produce consistent state.

All assertions passed.

---

## 5. Note on documentation drift

[magic-constants.md](magic-constants.md) and [duplicated-logic.md](duplicated-logic.md) were
written against the *pre-refactor* source and now describe historical state (inline literals,
duplicated feedback logic). They remain accurate as a record of the debt that was removed; a
follow-up pass could annotate them with "resolved in tech-debt-refactor-report.md" if desired.
