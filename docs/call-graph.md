# 3. Call Graph

Function-level call graph. `A → B` means A calls B. UI helpers live in `app.js`; everything
under "Engine" is `engine.js`. The two layers meet only at the exported API boundary.

## 3.1 UI layer (app.js)

```
ReactDOM.createRoot(...).render(App)
App
├─ Engine.loadGame                         (initial state)
├─ handleStart      → Engine.getValidHybrids
│                   → Engine.createSolverState
│                   → Engine.generateSuggestion
│                   → Engine.saveGame
├─ handleUpdate     → Engine.saveGame
├─ handleReset      → Engine.clearGame
├─ handleEngineChange → Engine.generateSuggestion → Engine.saveGame
├─ SetupScreen      → Engine.getValidHybrids
└─ SolverScreen
   ├─ Engine.buildHybridLookup
   ├─ suggestionToGuess         → Engine.parseKey
   ├─ Engine.parseKey / Engine.getHybridName   (render + validation)
   ├─ handleSubmit              → Engine.applyFeedback
   │                            → Engine.generateSuggestion
   │                            → (App.handleUpdate → Engine.saveGame)
   ├─ handleRestartSameConfig   → Engine.createSolverState
   │                            → Engine.generateSuggestion
   ├─ SuggestionPanel           → Engine.parseKey / Engine.getHybridName
   ├─ AnalysisPanel             → (lookup Map only)
   └─ HistoryPanel              → Engine.getHybridName
```

## 3.2 Engine layer (engine.js)

```
getValidHybrids            → hKey

applyFeedback              → cloneState
                           → hKey
                           → parseKey
                           → propagate

generateSuggestion         → strategicSuggestion   (engine === 'strategic')
                           → heuristicSuggestion    (otherwise)

heuristicSuggestion        → firstGuess             (first round)
                           → parseKey

strategicSuggestion        → firstGuess             (first round)
                           → parseKey
                           → compositeScore
                           → lookaheadScore
                           → placementSuggestion    (shouldPlace branch)

placementSuggestion        → parseKey

compositeScore             → parseKey

lookaheadScore             → estimateFbProbs
                           → simulateFeedback1Slot
                           → totalUncertainty
                           → parseKey

estimateFbProbs            → parseKey

simulateFeedback1Slot      → cloneState
                           → hKey
                           → parseKey
                           → propagate

firstGuess                 → (leaf; uses Math.random)

saveGame                   → serializeState
loadGame                   → deserializeState
serializeState             → (leaf)
deserializeState           → (leaf)
createSolverState          → (leaf)
cloneState                 → (leaf)
propagate                  → (leaf)
totalUncertainty           → (leaf)
buildHybridLookup          → (leaf)
```

## 3.3 Fan-in / hot leaves

- **`parseKey`** — the most-called leaf: used by `applyFeedback`, `simulateFeedback1Slot`,
  `compositeScore`, `estimateFbProbs`, `heuristicSuggestion`, `strategicSuggestion`,
  `placementSuggestion`, plus UI render/validation.
- **`propagate`** — called once per `applyFeedback` and once per `simulateFeedback1Slot`;
  since `lookaheadScore` invokes `simulateFeedback1Slot` up to 4× per candidate and the
  strategic engine evaluates up to `LOOKAHEAD_N` (8) candidates per uncertain slot, `propagate`
  is the deepest hot path.
- **`cloneState`** — same call sites as `propagate`; deep-copies every Set each time.

## 3.4 Cross-layer entry points (the only API surface the UI touches)

`loadGame`, `saveGame`, `clearGame`, `getValidHybrids`, `createSolverState`,
`applyFeedback`, `generateSuggestion`, `buildHybridLookup`, `parseKey`, `getHybridName`,
plus data constants `BASE_PLANTS`, `BASE_SHORT`, `PLANT_COLORS`, `FEEDBACK_TYPES`,
`ENGINE_HEURISTIC`, `ENGINE_STRATEGIC`. No UI code calls any other engine internal.
