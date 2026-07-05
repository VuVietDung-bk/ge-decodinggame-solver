# 5. Feedback → Constraint Propagation

Source: `applyFeedback` (`engine.js:112-162`) applies per-slot rules; then `propagate`
(`engine.js:164-199`) runs a fixpoint. `simulateFeedback1Slot` (`engine.js:317`) mirrors the
same four rules for a single hypothetical slot.

## 5.1 Setup per slot

For slot `s`, guess pair `(p1,p2)`, `key = hKey(p1,p2)`, feedback `fb = feedback[s]`.
Feedback semantics follow the game's **priority order** `correct > wrongslot > partial > allwrong`,
which is what makes the `partial`/`allwrong` inferences valid (a higher-priority result would
have fired first).

## 5.2 The four rules

### `correct` — exact hybrid, exact slot (`engine.js:118-124`)
```
possible[s]   = { key }        // slot fully determined
confirmed[s]  = key
gameLocked[s] = true           // hard lock
for every other slot j: possible[j].delete(key)   // a hybrid can't repeat here
```
*Deduction:* the answer at `s` is exactly this hybrid; because each hybrid occupies at most one
slot, it is removed from all other slots.

### `wrongslot` — hybrid in answer, different slot (`engine.js:125-127`)
```
possible[s].delete(key)        // not here
mustInclude.add(key)           // but somewhere
```
*Deduction:* the hybrid exists in the answer but not at `s`. Its correct slot is discovered
later by propagation Rule 2.

### `partial` — one base plant matches this slot (`engine.js:128-140`)
```
for every slot j: possible[j].delete(key)   // hybrid H itself is absent everywhere
excluded.add(key)
// keep only candidates at s that SHARE a base plant with (p1,p2):
possible[s] = { k ∈ possible[s] : parseKey(k) intersects {p1,p2} }
```
*Deduction:* since `correct`/`wrongslot` did not fire, hybrid `H=key` is not in the answer at
all → remove it everywhere and mark excluded. But one of `p1`/`p2` belongs to the correct pair
at `s`, so the slot's answer must share at least one base plant with `{p1,p2}`.

### `allwrong` — neither base plant matches (`engine.js:141-153`)
```
for every slot j: possible[j].delete(key)   // hybrid absent everywhere
excluded.add(key)
// keep only candidates at s that share NO base plant with (p1,p2):
possible[s] = { k ∈ possible[s] : parseKey(k) disjoint from {p1,p2} }
```
*Deduction:* neither base plant is part of the slot's correct pair → eliminate every candidate
containing `p1` or `p2` at `s`, and remove `H` from the whole board.

### Base-plant intersection test
Every rule that inspects pairs uses the same overlap predicate (also reused across the
strategic scorers — see [duplicated-logic.md](duplicated-logic.md)):
```
op[0]===cp[0] || op[1]===cp[0] || op[0]===cp[1] || op[1]===cp[1]
```

## 5.3 Propagation fixpoint (`propagate`, engine.js:164)

Runs while something changed, capped at 100 iterations.

### Rule 1 — naked single (`engine.js:170-181`)
If `possible[s].size === 1` and `s` is not yet confirmed:
```
confirmed[s] = the only key
remove that key from every other slot's possible set   // sets `changed`
```

### Rule 2 — hidden single (`engine.js:184-195`)
For each `mKey ∈ mustInclude`: collect slots whose `possible` set still contains `mKey`.
If exactly one such slot exists **and** that slot still has >1 possibility:
```
possible[thatSlot] = { mKey }
confirmed[thatSlot] = mKey       // sets `changed`
```
*This is how a `wrongslot` hint eventually resolves to a concrete slot.*

## 5.4 Worked example

Config: plants `[0,1,2,3,4]`, K=4. Guess
`[(0,1),(2,3),(0,4),(1,2)]`, feedback `[correct, allwrong, partial, wrongslot]`:

| Slot | fb | Effect |
|---|---|---|
| 0 | correct | `possible[0]={0_1}`, `confirmed[0]=0_1`, `gameLocked[0]=true`; `0_1` removed elsewhere |
| 1 | allwrong | `2_3` excluded everywhere; `possible[1]` keeps only pairs with **no** 2 or 3 |
| 2 | partial | `0_4` excluded everywhere; `possible[2]` keeps only pairs containing 0 **or** 4 |
| 3 | wrongslot | `1_2` removed from `possible[3]`; `1_2` added to `mustInclude` |

Observed result (verified under Node): `possible` sizes `[1,4,7,10]`,
`confirmed[0]=0_1` locked, `mustInclude={1_2}`, `excluded={2_3,0_4}`.

## 5.5 Invariants & caveats

- **Exclusion is global, placement is local.** `partial`/`allwrong` remove the *hybrid* from
  all slots but only constrain *base-plant membership* at the guessed slot.
- **`mustInclude` is never pruned** once a hybrid is placed, and a `mustInclude` hybrid with
  **zero** viable slots is silently ignored by Rule 2 (no contradiction is raised there).
- **No rollback:** contradictory feedback shrinks a set to size 0 and stays there; only the UI
  surfaces a warning.
