# 4. Complete Solver Pipeline

End-to-end, from configuration to a solved puzzle.

## 4.1 Stage diagram

```
[Setup]  plant count L (3–10), code length K (3–10)
   │  SetupScreen; selectedPlants = first L indices
   ▼
[Universe build]  getValidHybrids(selectedPlants)          engine.js:76
   │  → validHybrids: [{key,p1,p2,name}], all valid pairs among selected plants
   ▼
[Initial state]  createSolverState(validHybrids, K)         engine.js:91
   │  possible[slot] = Set(all keys) for each of K slots
   │  mustInclude=∅, excluded=∅, confirmed=[null…], gameLocked=[false…]
   ▼
[First suggestion]  generateSuggestion(…, isFirst=true)     engine.js:205
   │  → firstGuess: maximize base-plant coverage             engine.js:685
   ▼
┌──────────────────── ROUND LOOP ────────────────────┐
│ [User guess]  select hybrid per non-locked slot     │
│ [User feedback]  correct/wrongslot/partial/allwrong │
│    ▼                                                 │
│ handleSubmit builds fullGuess/fullFeedback           │  app.js:207
│    (game-locked slots auto-filled as 'correct')      │
│    ▼                                                 │
│ [Constraint update]  applyFeedback(state,g,f)        │  engine.js:112
│    per-slot rules → propagate() fixpoint             │  engine.js:164
│    → newState (possible sets shrink; confirms/locks) │
│    ▼                                                 │
│ [Next suggestion]  generateSuggestion(newState,…)    │  engine.js:205
│    strategic OR heuristic                            │
│    ▼                                                 │
│ [Persist]  saveGame(config,data,engine)              │  engine.js:750
│    ▼                                                 │
│ [Render]  Suggestion / Analysis / History panels     │
└──────────────────────────────────────────────────────┘
   │  exit when every slot is gameLocked
   ▼
[Solved]  isSolved = gameLocked.every(true)             app.js SolverScreen
```

## 4.2 Solver state object

`applyFeedback`/`generateSuggestion` operate on this shape (per `createSolverState`,
`engine.js:91`):

| Field | Type | Meaning |
|---|---|---|
| `possible` | `Set<key>[]` (length K) | still-possible hybrids for each slot |
| `mustInclude` | `Set<key>` | hybrids known to be in the answer (from `wrongslot`) but slot unknown |
| `excluded` | `Set<key>` | hybrids known NOT in the answer anywhere (from `partial`/`allwrong`) |
| `confirmed` | `(key|null)[]` (K) | the deduced/known hybrid for a slot, if any |
| `gameLocked` | `bool[]` (K) | slot proven `correct` by the game (hard-locked, never re-guessed) |

**`confirmed` vs `gameLocked`:** a slot can be `confirmed` by pure deduction
(`propagate`) without being `gameLocked`. Game-locked ⇒ confirmed; the reverse is not true.
The strategic engine treats confirmed-but-not-locked slots as free "probe" slots
(see [strategic-scoring.md](strategic-scoring.md)).

## 4.3 Suggestion dispatch

`generateSuggestion` (`engine.js:205`):
- `isFirst` → `firstGuess` for **both** engines (opening is engine-independent).
- otherwise `engine === ENGINE_STRATEGIC` → `strategicSuggestion`, else `heuristicSuggestion`.

### Heuristic path (`engine.js:216`)
1. Auto-fill game-locked slots into `result`.
2. Order remaining slots by fewest possibilities (`possible.size` ascending).
3. For each, pick an unused candidate; if multiple, prefer the **balanced-overlap** one
   (shares a base plant with ~half the remaining possibilities → best split).

### Strategic path (`engine.js:422`)
1. Fill game-locked slots.
2. Classify non-locked slots: `probeSlots` (confirmed-not-locked) vs `unknownSlots`.
3. Decide `shouldPlace` via the adaptive threshold (avg/max possibilities, probe availability,
   unplaced wrong-slot pressure).
4. **Place mode** → `placementSuggestion` (commit known answers + best guesses).
   **Info mode** → for each info slot, score candidates by `compositeScore` + probe modifiers,
   then re-rank the top `LOOKAHEAD_N` by `lookaheadScore` (blended 70/30).

## 4.4 Termination & edge states

- **Solved:** `gameLocked.every(true)` → solved banner; suggestion panel shows the answer.
- **Contradiction:** any `possible[slot].size === 0` while not confirmed → warning banner
  (`app.js` SolverScreen). The engine does **not** roll back; it keeps producing suggestions.
- **Propagation guard:** `propagate` stops after 100 iterations regardless of convergence
  (`engine.js:166`).
- **Restart same config:** `handleRestartSameConfig` rebuilds state from the same
  `validHybrids` (new `createSolverState` + fresh `firstGuess`).
