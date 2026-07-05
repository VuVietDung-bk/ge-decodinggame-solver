# Solver Test Suite

Zero-dependency automated tests for `public/engine.js`. Runs on any **Node ≥ 12**
(no `node:test`, no npm install, no bundler).

```bash
npm test                 # run everything  (node test/run.js)
npm run test:golden      # regenerate golden transcripts after a REVIEWED change
```

Exit code = number of failing tests (0 = pass).

## Goal

Detect **behavioral regressions** after future algorithm changes. The suite mixes
tests that pin exact current behavior (regression/golden) with tests that assert
properties any correct solver must satisfy (invariants/property/randomized), so both
accidental changes and genuine bugs surface.

## Layout

| File | Kind | What it guards |
|---|---|---|
| `harness.js` | — | tiny suite/test runner + summary |
| `helpers.js` | — | engine loader, **seeded RNG**, **feedback oracle**, self-play driver, `assertInvariants` |
| `scenarios.js` | — | fixed seeded games shared by golden generator + regression test |
| `unit.test.js` | **unit** | every pure function: keys, `getValidHybrids`, state, each feedback rule, `propagate`, suggestions, scoring helpers, persistence |
| `propagation-invariants.test.js` | **invariants** | I1–I6 (see below), targeted + 300-game randomized sweep |
| `property.test.js` | **property-based** | purity, monotonic shrinkage, idempotence, determinism, confirmed/lock monotonicity |
| `randomized.test.js` | **randomized** | 300+ seeded self-play games solve within bound; edge configs |
| `regression.test.js` | **regression** | frozen `applyFeedback` snapshot + 10 golden transcripts |
| `golden.json` | data | generated golden transcripts (commit it) |

## Key mechanisms

- **Feedback oracle** (`helpers.oracleFeedback`) — ground-truth game response for
  `(guess, secret)` using the priority order `correct > wrongslot > partial > allwrong`.
  This lets tests play full games and check that the engine's deductions are *sound*.
- **Seeded RNG** (`helpers.withSeed`) — overrides `Math.random` so `firstGuess` (which
  shuffles tied openings) is reproducible; makes golden transcripts deterministic.
- **Invariants** checked after every truthful `applyFeedback`:
  - **I1** excluded keys never remain in any possibility set
  - **I2** `mustInclude ∩ excluded = ∅`
  - **I3** `confirmed ⇔ singleton` with matching element
  - **I4** a game-locked hybrid appears in no other slot
  - **I5** truthful feedback never empties a slot
  - **I6** *soundness* — the true answer is never pruned

## Golden transcripts

`regression.test.js` replays the `scenarios.js` games with fixed seeds and compares the
full transcript (guesses + feedback + rounds) against `golden.json`. Any algorithm change
that alters observable play will fail these — **intended**. If the change is deliberate and
reviewed, regenerate with `npm run test:golden` and commit the new `golden.json`.

> The suite has been self-verified: perturbing a hot-path constant
> (`SPLIT_TARGET_RATIO`) makes 12 tests fail (snapshot + all golden + two solve-bound
> checks); reverting restores green.

## Notes / assumptions

- Answers use **distinct** hybrids per slot (the engine's `correct` rule removes a matched
  hybrid from every other slot); `randomSecret` honors this.
- Calibration (400 games/engine) showed worst-case **7** rounds to solve; the randomized
  `SOLVE_BOUND` is **40**, so a solve failure indicates a real regression, not variance.
