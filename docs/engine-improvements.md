# Engine Improvements — Strategic v2 + Optimal engine

Two changes to `public/engine.js`:
1. **Strategic** (human-tactical) refined per the four requested points.
2. **Optimal** — a new "computer-thinking" engine using exact information gain.

All values are `TUNING` constants (no bare literals). Behavior verified by the test suite
(property/invariant/randomized all pass for every engine) and measured by the benchmark.

---

## Part A — Strategic v2 (human tactics)

| # | Request | Change | Where |
|---|---|---|---|
| 1 | Confidence to try **Wrong Slot** | In placement, `mustInclude` hybrids are now placed **most-constrained-first** (fewest viable slots → highest confidence), reducing mis-placements | `placementSuggestion` → `wsViableSlots` sort |
| 2 | Fill known slots with **unseen** plants (not all plants) | Every candidate now gets a reward per **untested base plant**; final pick uses a fresh-plant tie-break instead of raw argmax | `untestedCount`, `pickBestFresh` |
| 3 | Don't reuse a hybrid **known wrong** for a slot if a fresh option gives equal info | At a known (probe) slot, candidates in `excluded` get `KNOWN_WRONG_PENALTY` (they yield no new info); ties break toward untested plants | scoring loop + `pickBestFresh` |
| 4 | **Endgame**: few options left → fresh plants give more info than known ones | When `totalUncertainty ≤ ENDGAME_UNCERTAINTY`, the untested-plant reward is multiplied by `ENDGAME_FRESH_MULT` | `isEndgame`/`freshMult` |

New `TUNING` knobs: `KNOWN_WRONG_PENALTY` (0.20), `STRATEGIC_TIE_EPSILON` (0.02),
`ENDGAME_UNCERTAINTY` (8), `ENDGAME_FRESH_MULT` (4).

`pickBestFresh` selects, among candidates within `STRATEGIC_TIE_EPSILON` of the best score
("equal information"), the one probing the most untested plants — the concrete implementation of
"when two guesses gather equal info, prefer the one using unseen plants." It is deterministic.

---

## Part B — Optimal engine (`ENGINE_OPTIMAL = 'optimal'`)

A principled solver that fixes the strategic engine's core weakness (a hand-tuned, non-normalized
probability model). Instead of estimating feedback probabilities, it computes them **exactly** over
the set of still-consistent answers.

### Algorithm
1. **Estimate** the joint answer count (product of per-slot possibilities). If it exceeds
   `OPTIMAL_ENUM_CAP` (2000) → **fall back to Strategic v2** (early game).
2. **Enumerate** `A` = every full answer consistent with the constraints (distinct hybrids per slot,
   drawn from `possible[]`, covering every `mustInclude`), with a node budget (`enumerateAnswers`).
3. **Score** each candidate guess `G` by partitioning `A` by the exact feedback `G` would receive
   (`feedbackSignature`) and taking the **expected remaining answers** `Σ |bucket|² / |A|`
   (minimize). Candidate guesses = the consistent answers (subsampled to `OPTIMAL_GUESS_CAP`) plus
   a bounded set of deliberately-wrong **probes** (`buildProbes`) that fill known slots with the
   freshest hybrids — so the "probe" tactic is available and chosen only when it strictly helps.
4. **Tie-break**: prefer a guess that could itself be the answer (chance to win), then smaller
   worst-case bucket, then deterministic key order.

### Why it's stronger
- The feedback distribution is **exact**, not estimated — it directly minimizes remaining
  uncertainty rather than a proxy.
- Progress is guaranteed in exact mode: guessing any consistent answer separates itself from the
  rest, so `|A|` strictly shrinks → always solves.

### Cost / regime
- Exact mode only engages when `|A|` is small (endgame), so per-round cost is bounded
  (`≤ guesses × |A| × K`). Early game defers to Strategic v2.
- New knobs: `OPTIMAL_ENUM_CAP` (2000), `OPTIMAL_NODE_CAP` (200000), `OPTIMAL_GUESS_CAP` (400).

### New exports
`ENGINE_OPTIMAL`, `optimalSuggestion`, `feedbackSignature`, `enumerateAnswers`
(plus dispatch in `generateSuggestion`). Registered in `bench/engines.js` and the web UI switcher.

### Known limitation / future work
The optimal engine is **myopic** (1-move expected gain) and only exact in the endgame. The early
game still uses the heuristic. A **Monte-Carlo** variant (sample consistent answers when `A` is too
large to enumerate) would extend exact-style play to the opening — the natural next step.

---

## Results (benchmark, identical seeds/games: 150/config × 9 configs)

| Engine | Avg rounds | vs before | Avg ms/game |
|---|--:|--:|--:|
| `optimal` (new) | **4.432** | — | 46.2 |
| `strategic` v2 | **4.473** | ⬇ from 4.516 | 4.9 |
| `heuristic` | 4.554 | unchanged | 0.4 |

Strategic improved on identical games; heuristic is untouched (sanity check); optimal is best on
average rounds at ~10× the runtime (the human-vs-computer tradeoff). Reproduce with `npm run bench`.

## Testing

- 63 tests pass. Property/invariant/randomized suites now exercise **all three** engines
  (soundness — never prune the true answer — and solve-within-bound verified for `optimal`).
- New unit tests cover `enumerateAnswers` (counts, confirmed/mustInclude constraints, cap→null)
  and `feedbackSignature` (matches the four game rules).
- Golden transcripts regenerated (strategic changed intentionally; 4 `optimal` scenarios added):
  `npm run test:golden`.

> Note: `docs/strategic-scoring.md` and `docs/magic-constants.md` predate these changes and are now
> partially stale (new `TUNING` knobs, fresh-plant tie-break, optimal engine).
