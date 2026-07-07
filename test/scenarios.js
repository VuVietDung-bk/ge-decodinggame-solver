'use strict';
// Fixed, seeded scenarios shared by the golden generator and the
// regression test, so both replay exactly the same games.

const H = require('./helpers.js');

const SCENARIOS = [
  { id: 'strat-p5-k4-s1',  plantCount: 5,  codeLength: 4, engine: 'strategic', seed: 1 },
  { id: 'heur-p5-k4-s1',   plantCount: 5,  codeLength: 4, engine: 'heuristic', seed: 1 },
  { id: 'strat-p4-k3-s7',  plantCount: 4,  codeLength: 3, engine: 'strategic', seed: 7 },
  { id: 'heur-p4-k3-s7',   plantCount: 4,  codeLength: 3, engine: 'heuristic', seed: 7 },
  { id: 'strat-p6-k5-s3',  plantCount: 6,  codeLength: 5, engine: 'strategic', seed: 3 },
  { id: 'heur-p6-k5-s3',   plantCount: 6,  codeLength: 5, engine: 'heuristic', seed: 3 },
  { id: 'strat-p7-k6-s9',  plantCount: 7,  codeLength: 6, engine: 'strategic', seed: 9 },
  { id: 'heur-p3-k3-s42',  plantCount: 3,  codeLength: 3, engine: 'heuristic', seed: 42 },
  { id: 'strat-p10-k4-s5', plantCount: 10, codeLength: 4, engine: 'strategic', seed: 5 },
  { id: 'strat-p8-k7-s11', plantCount: 8,  codeLength: 7, engine: 'strategic', seed: 11 },
  { id: 'mm-p5-k4-s1',    plantCount: 5,  codeLength: 4, engine: 'minimax', seed: 1 },
  { id: 'mm-p4-k3-s7',    plantCount: 4,  codeLength: 3, engine: 'minimax', seed: 7 },
  { id: 'mm-p6-k5-s3',    plantCount: 6,  codeLength: 5, engine: 'minimax', seed: 3 },
  { id: 'mm-p7-k6-s9',    plantCount: 7,  codeLength: 6, engine: 'minimax', seed: 9 }
];

// Deterministically play one scenario. The seed drives BOTH the secret
// and firstGuess, so the whole transcript is reproducible.
function runScenario(sc) {
  return H.withSeed(sc.seed, function () {
    const cfg = H.config(sc.plantCount, sc.codeLength);
    const secret = H.randomSecret(cfg);
    const r = H.playGame(cfg, secret, sc.engine, sc.maxRounds || 100, { check: false });
    return { id: sc.id, secret: secret, solved: r.solved, rounds: r.rounds, transcript: r.transcript };
  });
}

module.exports = { SCENARIOS: SCENARIOS, runScenario: runScenario };
