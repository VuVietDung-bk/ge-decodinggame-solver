# GE Decode Game Solver

Web-based solver for the PvZ Gardendless **Decode** puzzle game. Suggests optimal guesses based on feedback to help you crack the plant code.

## How the game works

1. Pick **plant count** (3–10 base plants) and **code length** (3–10 slots)
2. The secret answer is a sequence of hybrid plants, each made by combining two base plants
3. Guess by assigning a pair of base plants to each slot
4. Receive per-slot feedback (priority order):
   - 🟢 **Correct** — exact match for this slot
   - 🔵 **Wrong Slot** — this hybrid is in the answer but at a different slot
   - 🟣 **Partial** — one of the two base plants is part of the correct answer for this slot
   - 🔴 **All Wrong** — neither base plant matches

## How the solver works

- Maintains possible hybrids per slot using constraint propagation
- Eliminates impossibilities based on each feedback type
- Suggests guesses that maximize information gain
- First-guess heuristic maximizes base plant coverage

## Run locally

```bash
npm start
# Open http://localhost:5500
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for Render, Fly.io, and self-hosting options.

## Tech stack

- **Frontend**: React 18 (CDN) + vanilla CSS
- **Backend**: Node.js HTTP server (static files only)
- **Deploy**: Netlify, Render, Fly.io, or any Node host
