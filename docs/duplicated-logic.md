# 7. Duplicated Logic

Catalogue of repeated logic as it exists today. This is documentation only — **no changes are
made**. Each entry notes locations and the risk of divergence.

## 7.1 Feedback rules duplicated (highest risk)

- **`applyFeedback` per-slot body** (`engine.js:118-153`) vs
  **`simulateFeedback1Slot`** (`engine.js:322-356`).
- Both implement the identical four-branch logic (`correct`/`wrongslot`/`partial`/`allwrong`);
  `applyFeedback` loops over all guessed slots, `simulateFeedback1Slot` handles one hypothetical
  slot.
- **Risk:** any change to a feedback rule must be mirrored in both, or the strategic engine's
  lookahead optimizes against a model that no longer matches `applyFeedback`.

## 7.2 Balanced-overlap tie-break duplicated

The "pick the candidate whose base-plant overlap with the remaining set is closest to 0.5"
selection appears three times:
- `heuristicSuggestion` (`engine.js:~248-263`),
- `placementSuggestion` (`engine.js:~648-665`),
- conceptually again as the split objective inside `compositeScore` (`engine.js:284`) — a
  weighted variant of the same idea.

## 7.3 Base-plant intersection predicate duplicated

The pair-overlap test
`op[0]===cp[0] || op[1]===cp[0] || op[0]===cp[1] || op[1]===cp[1]`
is inlined in at least six places:
`applyFeedback` (partial, allwrong), `simulateFeedback1Slot` (partial, allwrong),
`compositeScore`, `estimateFbProbs`, `heuristicSuggestion`, `placementSuggestion`.

## 7.4 Game-locked auto-fill loop duplicated

The "copy game-locked confirmed hybrids into `result` / mark used" loop:
- `heuristicSuggestion` Step (`engine.js:~223-229`),
- `strategicSuggestion` Step 1 (`engine.js:~428-434`).

## 7.5 "Slots sorted by fewest possibilities" duplicated

`unc.sort((a,b) => possible[a].size - possible[b].size)` logic:
- `heuristicSuggestion` (`engine.js:~236`),
- `placementSuggestion` `sortedActive` (`engine.js:~623`).

## 7.6 "Tested plants" / "known-in-answer" set-building duplicated

Loops that `parseKey` over `confirmed`, `mustInclude`, and/or `excluded` to accumulate a plant
or hybrid set:
- `strategicSuggestion` builds `knownInAnswer` (`engine.js:~438-441`) and `testedPlants`
  (`engine.js:~499-512`) with near-identical iteration shapes.

## 7.7 UI: "keep game-locked slots locked" duplicated (app.js)

The loop that rewrites `newGuess[s]` from `confirmed[s]` for game-locked slots appears three
times in `SolverScreen`:
- round-change `useEffect` (`app.js:~207+`, reset block),
- `handleUseSuggestion`,
- `handleSubmit` (`fullGuess` construction).

## 7.8 UI: feedback icon maps duplicated

Feedback id→icon/label information exists both in `FEEDBACK_TYPES` (engine data) and again as a
local `fbIcons` map inside `HistoryPanel` (`app.js:~651`).

## 7.9 Persistence symmetry (expected, low risk)

`serializeState`/`deserializeState` (`engine.js:729/739`) are intentional mirror images; listed
for completeness, not as a defect.

---

### Summary table

| # | Duplicated logic | Locations | Divergence risk |
|---|---|---|---|
| 7.1 | Four feedback rules | applyFeedback ↔ simulateFeedback1Slot | High |
| 7.2 | Balanced-overlap pick | heuristic, placement, (compositeScore variant) | Medium |
| 7.3 | Pair-overlap predicate | 6+ inlined sites | Medium |
| 7.4 | Game-locked auto-fill | heuristic, strategic | Low |
| 7.5 | Sort by possible size | heuristic, placement | Low |
| 7.6 | tested/known set build | strategic (×2) | Low |
| 7.7 | Keep-locked guess loop | SolverScreen (×3) | Medium |
| 7.8 | Feedback icon map | FEEDBACK_TYPES + HistoryPanel | Low |
| 7.9 | serialize/deserialize | engine persistence | None (intended) |
