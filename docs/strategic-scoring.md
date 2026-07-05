# 6. Strategic-Scoring Functions

The strategic engine (`strategicSuggestion`, `engine.js:422`) chooses guesses to maximize
information. It relies on five scoring helpers plus an adaptive mode switch. All are pure.

> Naming note: the code comments call the lookahead "minimax," but it computes an **expected**
> (probability-weighted) uncertainty reduction, not a worst-case minimax value. Documented here
> as it behaves.

## 6.1 `compositeScore(candKey, unknownSlots, state)` — engine.js:284

Measures how well a candidate **splits** the remaining possibilities across *all* unknown
slots (a good probe halves the space).

```
for each slot in unknownSlots with possible.size > 1:
    overlap = # possibilities at slot sharing a base plant with candidate
    ratio   = overlap / possible.size
    slotScore = -|ratio - 0.5|          # 0 when it splits the slot in half (ideal)
    weight    = possible.size           # weight harder-to-resolve slots more
return Σ(slotScore·weight) / Σweight    # weighted average, ≤ 0; closer to 0 = better
```
- Output range `(-0.5 … 0]`. Higher (nearer 0) is better.
- Slots already resolved (`size ≤ 1`) are skipped.
- The `0.5` target encodes "best question eliminates half the candidates."

## 6.2 `simulateFeedback1Slot(state, slot, p1, p2, fb, codeLen)` — engine.js:317

Produces the hypothetical next state if guessing `(p1,p2)` at `slot` returned feedback `fb`.
It applies the **same four rules** as `applyFeedback` (§5) but for a single slot, then
`propagate`s. Used by `lookaheadScore` to see the consequence of each possible outcome.

## 6.3 `totalUncertainty(state, codeLen)` — engine.js:358

```
Σ possible[s].size over all slots s where confirmed[s] is null
```
A scalar proxy for "how much is still unknown." Lower = closer to solved. This is the quantity
the lookahead tries to reduce.

## 6.4 `estimateFbProbs(candKey, slot, state, isProbe)` — engine.js:367

Estimates the probability of each feedback outcome
`[correct, wrongslot, partial, allwrong]` if the candidate is guessed at `slot`.

Partition the other possibilities at the slot:
- `partialCount` = those sharing a base plant with the candidate,
- `neitherCount` = those sharing none; `others = partialCount + neitherCount`.

**Probe slot** (`isProbe` — answer already known ≠ candidate):
```
correct   = 0                         # cannot be correct, slot already solved differently
wrongslot = 0.02                      # small fixed chance
partial   = (partialCount/others)·0.98
allwrong  = (neitherCount/others)·0.98
```

**Normal slot:**
```
pCorrect  = candidate ∈ possible[slot] ? 1/possible.size : 0
pRemain   = 1 - pCorrect
wrongslot = 0.02·pRemain
partial   = (partialCount/others)·pRemain·0.98
allwrong  = (neitherCount/others)·pRemain·0.98
```
Guard: `possible.size === 0` → uniform `[0.25,0.25,0.25,0.25]`.

*These are heuristic estimates with hand-tuned constants (`0.02`, `0.98`); they are not a
normalized probability distribution.* See [magic-constants.md](magic-constants.md).

## 6.5 `lookaheadScore(candKey, slot, state, codeLen, isProbe)` — engine.js:404

Expected reduction in uncertainty from guessing the candidate at the slot:
```
probs = estimateFbProbs(candidate, slot, state, isProbe)
current = totalUncertainty(state)
score = 0
for fb in [correct, wrongslot, partial, allwrong]:
    if probs[fb] < 0.005: skip                       # ignore negligible outcomes
    sim   = simulateFeedback1Slot(state, slot, p1, p2, fb)
    score += probs[fb] · (current - totalUncertainty(sim))
return score                                          # higher = more expected info
```
Cost: up to 4 `simulateFeedback1Slot` calls (each clones state + propagates) per candidate.

## 6.6 Adaptive placement threshold — engine.js:443-478

Decides whether to stop probing and start committing answers (`shouldPlace`):

| Condition | Result |
|---|---|
| `unknownSlots.length === 0` | place |
| every unknown slot resolved (`size ≤ 1`) | place |
| probe slots available | place only if `avgPoss ≤ 1.5` **or** `maxPoss ≤ 2` (stay in info mode longer) |
| no probes | place if `avgPoss ≤ 3` **or** `maxPoss ≤ 2` (commit sooner) |
| extra: unplaced wrong-slot hybrids fill ≥ all-active − 1 slots | force place |

## 6.7 Candidate scoring in info mode — engine.js:558-598

For each info slot, every candidate `cand` (excluding used + known-in-answer) gets:
```
cs = compositeScore(cand, unknownSlots, state)
if isProbe:
    if cand shares a base with the slot's known answer:  cs -= 0.15   # avoid re-testing known plants
    cs += (#untested base plants in cand) · 0.02                       # reward fresh plants
else:
    if cand ∈ possible[slot]:  cs += 0.01                              # slight bias to plausible
if p1 ≠ p2:  cs += 0.005                                               # prefer heterozygous pairs
```
Then, if `unknownSlots.length ≥ 2` and ≥2 candidates exist, the top `LOOKAHEAD_N` (8) by `cs`
are re-ranked by a blend:
```
blend = lookaheadScore(cand) · 0.7 + cs · 0.3       # 70% info gain, 30% composite quality
```
and the best `blend` wins. Otherwise the top `cs` candidate is chosen directly.

## 6.8 Scoring summary

| Function | Direction | Purpose |
|---|---|---|
| `compositeScore` | higher (→0) better | choose candidates that split remaining possibilities evenly |
| `estimateFbProbs` | distribution | approximate outcome likelihoods for lookahead |
| `simulateFeedback1Slot` | state | realize one hypothetical outcome |
| `totalUncertainty` | lower better | scalar progress metric |
| `lookaheadScore` | higher better | expected uncertainty reduction (the core info metric) |
