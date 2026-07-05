# 8. Magic Constants

Every literal that affects behavior, with its value, location, and meaning. Values are quoted
from `public/engine.js` (and `server.js` where noted). Documentation only.

## 8.1 CSP / propagation

| Value | Location | Meaning |
|---|---|---|
| `100` | `propagate`, `engine.js:166` (`iter < 100`) | max fixpoint iterations; safety cap against non-convergence |

## 8.2 First guess (`firstGuess`, engine.js:685)

| Value | Location | Meaning |
|---|---|---|
| `0.5` | `diff = h.p1 !== h.p2 ? 0.5 : 0` | bonus favoring heterozygous (two distinct base plants) pairs |
| `0.001` | `nc2 + diff2 >= bestScore - 0.001` (`engine.js:705`) | float tolerance for "tied at best score" before random pick |
| `Math.random()` | `engine.js:~700` | uniform pick among tied candidates → nondeterministic opening |

## 8.3 Composite scoring (`compositeScore`, engine.js:284)

| Value | Location | Meaning |
|---|---|---|
| `0.5` | `slotScore = -Math.abs(ratio - 0.5)` | ideal split target (halve the candidate set) |
| `weight = possSize` | same fn | uncertainty weighting of each slot |

## 8.4 Feedback-probability estimates (`estimateFbProbs`, engine.js:367)

| Value | Location | Meaning |
|---|---|---|
| `0.25` ×4 | `engine.js:369` (size-0 guard) | uniform fallback distribution |
| `0.02` | `engine.js:392` and `:401` | fixed small `wrongslot` probability |
| `0.98` | `engine.js:392` and `:401` | scaling applied to partial/allwrong shares |

## 8.5 Lookahead (`lookaheadScore`, engine.js:404)

| Value | Location | Meaning |
|---|---|---|
| `0.005` | `if (probs[fi] < 0.005) continue` (`engine.js:412`) | negligible-probability cutoff; skip simulating rare outcomes |
| `4` (implicit) | loop over feedback types | number of outcomes simulated per candidate |

## 8.6 Adaptive placement thresholds (`strategicSuggestion`, engine.js:443-478)

| Value | Location | Meaning |
|---|---|---|
| `1.5` | `avgPoss <= 1.5` (`engine.js:473`) | with probes: avg possibilities below which to start placing |
| `2` | `maxPoss <= 2` (`engine.js:473` & `:476`) | any single slot small enough → place |
| `3` | `avgPoss <= 3` (`engine.js:476`) | without probes: place sooner |
| `allActive - 1` | `unplacedWS >= allActive - 1` (`engine.js:~477`) | wrong-slot pressure forcing placement |

## 8.7 Candidate score modifiers (info mode, engine.js:558-598)

| Value | Location | Meaning |
|---|---|---|
| `-0.15` | `cs -= 0.15` (`engine.js:570`) | probe penalty: candidate shares a base with the slot's known answer |
| `0.02` | `... * 0.02` (`engine.js:572`) | bonus per untested base plant in the candidate |
| `0.01` | `cs += 0.01` (`engine.js:574`) | bonus if candidate is still possible at this slot |
| `0.005` | `cs += 0.005` (`engine.js:576`) | heterozygous-pair preference |

## 8.8 Lookahead blend (engine.js:584-596)

| Value | Location | Meaning |
|---|---|---|
| `8` | `LOOKAHEAD_N = 8` (`engine.js:584`) | number of top candidates re-ranked by lookahead |
| `0.7` | `laScore * 0.7` (`engine.js:596`) | weight on expected info reduction |
| `0.3` | `scored[li].score * 0.3` (`engine.js:596`) | weight on composite quality |
| `2` | `unknownSlots.length >= 2 && scored.length >= 2` | minimum size to enable lookahead |

## 8.9 Persistence (engine.js)

| Value | Location | Meaning |
|---|---|---|
| `3` | `v: 3` in `saveGame` (`engine.js:~752`) | current save schema version |
| `1,2,3` | `obj.v !== 1 && … !== 3` in `loadGame` (`engine.js:~770`) | accepted schema versions |
| `'ge-decode-solver-v1'` | `STORAGE_KEY` (`engine.js:57`) | localStorage key (string still says `v1` though schema is at v3) |

## 8.10 Server (server.js)

| Value | Location | Meaning |
|---|---|---|
| `5500` | `PORT = process.env.PORT || 5500` | default listen port |
| `86400` | `Cache-Control: public, max-age=86400` | 1-day cache for non html/js/css assets |
| `no-store` | health + html/js/css | disable caching of app shell |

## 8.11 UI (app.js)

| Value | Location | Meaning |
|---|---|---|
| `5` | `SetupScreen` default `plantCount` | initial base-plant count |
| `4` | `SetupScreen` default `codeLength` | initial code length |
| `3` / `10` | range `min/max` on both sliders | allowed plant-count and code-length bounds |
| `5` | AnalysisPanel "show up to 5 remaining" | truncation of possibility preview |

> Observations for future work (not acted upon here): the same literal `0.02` serves two
> unrelated roles (§8.4 vs §8.7); the `0.98`/`0.02` estimates do not form a normalized
> distribution; and `STORAGE_KEY`'s `v1` suffix is decoupled from the schema `v` field.
