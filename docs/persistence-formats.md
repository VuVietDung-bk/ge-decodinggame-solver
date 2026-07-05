# 9. Persistence Formats

All persistence is browser `localStorage`; there is no server-side storage. Handled entirely by
`saveGame`/`loadGame`/`clearGame` + `serializeState`/`deserializeState` in `engine.js`.

## 9.1 Storage location

- **Key:** `STORAGE_KEY = 'ge-decode-solver-v1'` (`engine.js:57`).
- **Value:** a single JSON string (the save blob below).
- Note: the key string is fixed at `-v1`; the *schema* version lives separately in the `v`
  field (currently `3`). They are not kept in sync.

## 9.2 Save blob (schema v3) — `saveGame`, engine.js:750

```jsonc
{
  "v": 3,                              // schema version
  "config": {
    "selectedPlants": [0,1,2,3,4],     // base-plant indices in play
    "codeLength": 4                    // number of slots K
  },
  "engine": "strategic",               // "strategic" | "heuristic"
  "data": {
    "validHybrids": [                  // universe of pairs for this config
      { "key": "0_1", "p1": 0, "p2": 1, "name": "Snow Pea" }
      // …
    ],
    "solverState": { /* serialized state, see 9.3 */ },
    "history": [ /* rounds, see 9.4 */ ],
    "suggestion": ["0_1","2_3", …]     // current suggested keys (null per empty slot)
  }
}
```

## 9.3 Serialized solver state — `serializeState`, engine.js:729

Sets cannot be JSON-encoded, so they are converted to arrays:

```jsonc
{
  "possible":   [ ["0_1","0_2", …], … ],   // Set<key> per slot → string[][]
  "mustInclude":["1_2"],                    // Set<key> → string[]
  "excluded":   ["2_3","0_4"],              // Set<key> → string[]
  "confirmed":  ["0_1", null, null, null],  // (key|null)[] (stored as-is)
  "gameLocked": [true, false, false, false] // bool[] (stored as-is)
}
```

`deserializeState` (`engine.js:739`) reverses this: `possible`, `mustInclude`, `excluded`
arrays → `Set`s; `confirmed` used as-is; **`gameLocked` defaults to `[false…]` if absent**
(the only backward-compat shim — see 9.6).

## 9.4 History entry format

Each element of `data.history`:
```jsonc
{
  "guess":   [ { "p1": 0, "p2": 1 }, … ],                 // one pair per slot
  "feedback":[ "correct", "allwrong", "partial", "wrongslot" ]  // one id per slot
}
```
Rendered by `HistoryPanel`; the hybrid name is re-derived via `getHybridName(p1,p2)` at render
time (names are not stored in history).

## 9.5 Load & validation — `loadGame`, engine.js:767

```
raw = localStorage.getItem(STORAGE_KEY)
if !raw            → return null
obj = JSON.parse(raw)               // wrapped in try/catch → null on error
if obj.v ∉ {1,2,3} → return null    // unknown/newer versions rejected
return { config, engine: obj.engine || 'strategic', data: { …, solverState: deserialize(...) } }
```
Any thrown error (bad JSON, shape mismatch) is swallowed and yields `null`, causing the app to
start at the Setup screen.

## 9.6 Version history & backward compatibility

| Version | Difference | Compatibility handling |
|---|---|---|
| v1 / v2 | no `gameLocked` array in serialized state | `deserializeState` supplies `new Array(codeLen).fill(false)` |
| v3 | adds `gameLocked`; `engine` field present | default `engine = 'strategic'` if missing |

- **Accepted but not migrated:** a v1/v2 blob is loaded and only `gameLocked` is back-filled;
  no other field is transformed. This is the extent of migration.
- **Write path is always v3:** `saveGame` hard-codes `v: 3`, so any successful load is rewritten
  as v3 on the next save.

## 9.7 The `COMBINATIONS` data format (compile-time, not persisted)

Though not a persistence format, the hybrid matrix is the app's core data format and is worth
recording:
- 10×10 array, **symmetric** (`COMBINATIONS[i][j] === COMBINATIONS[j][i]`).
- Cell = hybrid name (string) or `null` for an invalid pairing.
- Diagonal (`i===j`) = "pure" self-combinations (all 10 present).
- Hand-transcribed from `GE Decode Sheet.xlsx`; the spreadsheet is the source of truth and is
  **not** read at runtime.
- For the full 10-plant set: 45 valid hybrids, 10 invalid pairs (upper triangle incl. diagonal).

## 9.8 Clear — `clearGame`, engine.js:786

`localStorage.removeItem(STORAGE_KEY)` inside try/catch. Invoked by `App.handleReset`
("New Game").
