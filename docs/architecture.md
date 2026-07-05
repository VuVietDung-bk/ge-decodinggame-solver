# 1. Architecture

## 1.1 One-paragraph overview

A fully client-side single-page app. A trivial Node HTTP server serves three static
assets; **all logic runs in the browser**. React (from a CDN) renders the UI in `app.js`,
which delegates every piece of solver logic to a standalone module, `engine.js`, exposed as
the browser global `window.DecodeEngine`. There is no backend state, no database, no build
transform — persistence is `localStorage` only.

## 1.2 Layered view

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation (public/app.js)                               │
│  React components: App, SetupScreen, SolverScreen,          │
│  SuggestionPanel, AnalysisPanel, HistoryPanel               │
│  + UI-only helpers: suggestionToGuess, getLegendDesc        │
│  Talks to the engine ONLY through window.DecodeEngine       │
└───────────────▲─────────────────────────────────────────────┘
                │  exported API (32 symbols)
┌───────────────┴─────────────────────────────────────────────┐
│  Engine (public/engine.js)  — UMD, no DOM/React             │
│  • Data:   BASE_PLANTS, COMBINATIONS, FEEDBACK_TYPES …      │
│  • CSP:    createSolverState, applyFeedback, propagate      │
│  • Engines: generateSuggestion → heuristic | strategic      │
│  • Persist: serialize/deserialize/save/load/clear          │
└───────────────▲─────────────────────────────────────────────┘
                │  window global / module.exports
┌───────────────┴─────────────────────────────────────────────┐
│  Delivery                                                   │
│  index.html loads: React CDN → /engine.js → /app.js         │
│  server.js serves static files (no API beyond /api/health)  │
└─────────────────────────────────────────────────────────────┘
```

## 1.3 Runtime model

- **No module bundler / no transpile.** Plain `<script>` tags. `engine.js` uses a UMD wrapper
  so it also loads under Node (`module.exports`) for headless use/testing.
- **Load order matters:** `index.html` loads `/engine.js` *before* `/app.js`. `app.js` reads
  `window.DecodeEngine` at IIFE start (`app.js:11`); if the engine were missing, binding would
  fail immediately.
- **State ownership:** React state lives in `App` (`app.js:43`) — `config`, `data`
  (`{validHybrids, solverState, history, suggestion}`), `engine`, `screen`. The engine is
  **pure/stateless**: it receives a state object and returns a new one; it never mutates React
  state. (One in-place exception: `propagate` mutates the clone it is handed inside
  `applyFeedback`/`simulateFeedback1Slot` — never a live React object.)

## 1.4 Data flow per round

```
user picks guess + feedback in SolverScreen
        │
        ▼
handleSubmit()                              (app.js:207 SolverScreen)
        │ builds fullGuess / fullFeedback (game-locked slots auto-filled)
        ▼
Engine.applyFeedback(state, guess, feedback) → newState        (engine.js:112)
        ▼
Engine.generateSuggestion(newState, …, engine) → suggestion    (engine.js:205)
        ▼
onUpdate({ solverState:newState, history:+1, suggestion })     (app.js App.handleUpdate)
        ▼
Engine.saveGame(config, data, engine)  → localStorage          (engine.js:750)
        ▼
React re-renders Suggestion / Analysis / History panels
```

## 1.5 Server & build

- **`server.js`** — `http.createServer`; routes: `GET /api/health` → `{ok:true}`; `/` and
  `/index.html` → `public/index.html`; any other path resolved under `public/` with a
  `candidate.startsWith(PUBLIC_DIR)` traversal guard; MIME by extension; `Cache-Control`
  `no-store` for html/js/css else `max-age=86400`.
- **`scripts/build.js`** — not a real build: asserts `index.html`, `engine.js`, `app.js`,
  `styles.css` exist in `public/`, else `process.exit(1)`.
- **`netlify.toml`** — `command = "npm run build"`, `publish = "public"`.

## 1.6 External dependencies

| Dependency | How loaded | Used by |
|---|---|---|
| React 18 (`react.production.min.js`) | CDN `<script>` in index.html | app.js (`React.createElement`, hooks) |
| ReactDOM 18 | CDN `<script>` | app.js (`ReactDOM.createRoot`) |
| Inter font | Google Fonts `<link>` | styles.css |

No npm runtime dependencies; `package.json` declares only `build`/`start` scripts.
