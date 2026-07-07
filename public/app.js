(function () {
  'use strict';

  // ============================================================
  // ENGINE BINDINGS
  // ------------------------------------------------------------
  // The solver engine lives in standalone modules: engine-core.js plus one
  // file per engine (engine-heuristic/strategic/minimax.js), which all augment
  // the shared `window.DecodeEngine`. The UI below only consumes these exported
  // APIs — it contains no solver logic.
  // ============================================================
  var Engine = (typeof window !== 'undefined' && window.DecodeEngine) ||
    (typeof module === 'object' && module.exports ? require('./engine.js') : null);

  // Data / constants
  var BASE_PLANTS = Engine.BASE_PLANTS;
  var BASE_SHORT = Engine.BASE_SHORT;
  var PLANT_COLORS = Engine.PLANT_COLORS;
  var FEEDBACK_TYPES = Engine.FEEDBACK_TYPES;
  var ENGINE_HEURISTIC = Engine.ENGINE_HEURISTIC;
  var ENGINE_STRATEGIC = Engine.ENGINE_STRATEGIC;
  var ENGINE_MINIMAX = Engine.ENGINE_MINIMAX;

  // Pure APIs consumed by the UI
  var parseKey = Engine.parseKey;
  var getHybridName = Engine.getHybridName;
  var getValidHybrids = Engine.getValidHybrids;
  var buildHybridLookup = Engine.buildHybridLookup;
  var createSolverState = Engine.createSolverState;
  var applyFeedback = Engine.applyFeedback;
  var generateSuggestion = Engine.generateSuggestion;
  var saveGame = Engine.saveGame;
  var loadGame = Engine.loadGame;
  var clearGame = Engine.clearGame;

  const e = React.createElement;
  const { useState, useMemo, useCallback, useEffect, useRef, Fragment } = React;

  // ============================================================
  // UI HELPERS (engine is never modified — these only replay the
  // pure engine APIs over the recorded history)
  // ============================================================

  // Replay the whole history from a fresh state, returning every
  // intermediate solver state. states[0] = initial, states[k] = after round k.
  function replayStates(config, history) {
    var vh = getValidHybrids(config.selectedPlants);
    var st = createSolverState(vh, config.codeLength);
    var states = [st];
    for (var i = 0; i < history.length; i++) {
      st = applyFeedback(st, history[i].guess, history[i].feedback);
      states.push(st);
    }
    return { validHybrids: vh, states: states };
  }

  // Rebuild the full `data` object from a (possibly truncated) history.
  // Used by undo and by shared-link import.
  function rebuildFromHistory(config, engine, history) {
    var r = replayStates(config, history);
    var st = r.states[r.states.length - 1];
    var sug = generateSuggestion(st, r.validHybrids, config.codeLength, history.length === 0, config.selectedPlants, engine);
    return { validHybrids: r.validHybrids, solverState: st, history: history, suggestion: sug };
  }

  // Find the earliest round whose feedback first made a slot impossible.
  // Returns { round (1-based), slot } or null.
  function diagnoseContradiction(config, history) {
    var r = replayStates(config, history);
    for (var k = 1; k < r.states.length; k++) {
      var st = r.states[k];
      for (var s = 0; s < config.codeLength; s++) {
        // A slot with zero possibilities is always a contradiction — this
        // matches the banner's condition (possible.size === 0) exactly.
        if (st.possible[s].size === 0) {
          return { round: k, slot: s };
        }
      }
    }
    return null;
  }

  // ---- Shareable state: config + engine + history, URL-safe base64 ----
  function b64urlEncode(str) {
    var b = btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  function encodeShare(config, engine, history) {
    return b64urlEncode(JSON.stringify({ v: 1, config: config, engine: engine, history: history }));
  }
  function buildShareUrl(config, engine, history) {
    var base = location.origin + location.pathname;
    return base + '#g=' + encodeShare(config, engine, history);
  }
  function importFromHash() {
    try {
      if (typeof location === 'undefined' || !location.hash) return null;
      var m = location.hash.match(/[#&]g=([^&]+)/);
      if (!m) return null;
      var obj = JSON.parse(b64urlDecode(m[1]));
      if (!obj || !obj.config || !Array.isArray(obj.config.selectedPlants) ||
        typeof obj.config.codeLength !== 'number' || !Array.isArray(obj.history)) return null;
      var engine = obj.engine || ENGINE_STRATEGIC;
      var data = rebuildFromHistory(obj.config, engine, obj.history);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* ignore */ }
      return { config: obj.config, engine: engine, data: data };
    } catch (_) { return null; }
  }

  // ============================================================
  // COMPONENTS
  // ============================================================

  // ---- App (root) ----

  function App() {
    // A shared link (URL hash) takes precedence over the locally saved game.
    var saved = useMemo(function () { return importFromHash() || loadGame(); }, []);
    var [screen, setScreen] = useState(saved ? 'solver' : 'setup');
    var [config, setConfig] = useState(saved ? saved.config : null);
    var [data, setData] = useState(saved ? saved.data : null);
    var [engine, setEngine] = useState(saved ? saved.engine : ENGINE_STRATEGIC);

    // Persist whatever we started with (esp. an imported shared game) once.
    useEffect(function () {
      if (config && data) saveGame(config, data, engine);
    }, []); // eslint-disable-line

    var handleStart = useCallback(function (cfg) {
      var vh = getValidHybrids(cfg.selectedPlants);
      var st = createSolverState(vh, cfg.codeLength);
      var sug = generateSuggestion(st, vh, cfg.codeLength, true, cfg.selectedPlants, engine);
      var d = { validHybrids: vh, solverState: st, history: [], suggestion: sug };
      setConfig(cfg);
      setData(d);
      setScreen('solver');
      saveGame(cfg, d, engine);
    }, [engine]);

    var handleReset = useCallback(function () {
      setScreen('setup');
      setConfig(null);
      setData(null);
      clearGame();
    }, []);

    var handleUpdate = useCallback(function (newData) {
      setData(newData);
      saveGame(config, newData, engine);
    }, [config, engine]);

    var handleEngineChange = useCallback(function (newEngine) {
      setEngine(newEngine);
      if (data) {
        var newSug = generateSuggestion(data.solverState, data.validHybrids, config.codeLength, data.history.length === 0, config.selectedPlants, newEngine);
        var nd = Object.assign({}, data, { suggestion: newSug });
        setData(nd);
        saveGame(config, nd, newEngine);
      }
    }, [config, data]);

    if (screen === 'setup' || !config || !data) {
      return e(SetupScreen, { onStart: handleStart });
    }

    return e(SolverScreen, {
      config: config, data: data, onUpdate: handleUpdate,
      onReset: handleReset, engine: engine, onEngineChange: handleEngineChange
    });
  }

  // ---- SetupScreen (first N base plants auto-selected) ----

  function SetupScreen({ onStart }) {
    var [plantCount, setPlantCount] = useState(5);
    var [codeLength, setCodeLength] = useState(4);

    // Always use the first N base plants
    var selectedPlants = useMemo(function () {
      var arr = [];
      for (var i = 0; i < plantCount; i++) arr.push(i);
      return arr;
    }, [plantCount]);

    var validHybrids = useMemo(function () {
      return getValidHybrids(selectedPlants);
    }, [selectedPlants]);

    var canStart = plantCount >= 3 && codeLength >= 3 && codeLength <= validHybrids.length;

    function handleStart() {
      if (!canStart) return;
      onStart({ selectedPlants: selectedPlants, codeLength: codeLength });
    }

    return e('div', { className: 'setup-screen' },
      e('div', { className: 'setup-panel' },

        e('div', { className: 'setup-header' },
          e('div', { className: 'setup-icon' }, '🧬'),
          e('h1', null, 'GE Decode Solver'),
          e('p', null, 'Intelligent puzzle assistant for the Decode game')
        ),

        // Difficulty: Plant count
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Plant Count'),
          e('div', { className: 'setup-row' },
            e('label', null, 'Number of base plants (3–10)'),
            e('input', {
              className: 'setup-input',
              type: 'range', min: 3, max: 10,
              value: plantCount,
              onChange: function (ev) {
                setPlantCount(parseInt(ev.target.value) || 3);
              }
            }),
            e('span', { className: 'setup-range-value' }, plantCount)
          )
        ),

        // Show which plants are in play (read-only)
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Base Plants'),
          e('div', { className: 'plant-grid' },
            BASE_PLANTS.map(function (name, idx) {
              var sel = idx < plantCount;
              return e('div', {
                key: idx,
                className: 'plant-chip' + (sel ? ' selected' : ' disabled')
              },
                e('span', { className: 'plant-chip-index' }, idx + 1),
                e('div', {
                  className: 'plant-avatar',
                  style: {
                    background: sel
                      ? 'linear-gradient(135deg, ' + PLANT_COLORS[idx] + ', ' + PLANT_COLORS[idx] + '88)'
                      : 'rgba(255,255,255,0.06)'
                  }
                }, BASE_SHORT[idx].charAt(0)),
                e('span', { className: 'plant-chip-name' }, BASE_SHORT[idx])
              );
            })
          )
        ),

        // Code length
        e('div', { className: 'setup-section' },
          e('div', { className: 'setup-section-title' }, 'Code Length'),
          e('div', { className: 'setup-row' },
            e('label', null, 'Number of slots to decode (3–10)'),
            e('input', {
              className: 'setup-input',
              type: 'range', min: 3, max: 10,
              value: codeLength,
              onChange: function (ev) {
                setCodeLength(parseInt(ev.target.value) || 3);
              }
            }),
            e('span', { className: 'setup-range-value' }, codeLength)
          )
        ),

        // Info
        e('div', { className: 'setup-info' },
          e('span', { className: 'info-pill accent' }, plantCount + ' plants'),
          e('span', { className: 'info-pill' }, validHybrids.length + ' hybrids'),
          e('span', { className: 'info-pill' }, codeLength + ' slots'),
          codeLength > validHybrids.length
            ? e('span', { className: 'info-pill warning' }, '⚠ Code too long for available hybrids')
            : null
        ),

        // Start
        e('button', {
          className: 'start-btn',
          onClick: handleStart,
          disabled: !canStart
        }, 'Start Solving')
      )
    );
  }

  // ---- SolverScreen ----

  function SolverScreen({ config, data, onUpdate, onReset, engine, onEngineChange }) {
    var codeLen = config.codeLength;
    var lookup = useMemo(function () { return buildHybridLookup(data.validHybrids); }, [data.validHybrids]);
    var roundNum = data.history.length;

    var [guess, setGuess] = useState(function () {
      return suggestionToGuess(data.suggestion, lookup);
    });
    var [feedback, setFeedback] = useState(function () {
      return new Array(codeLen).fill(null);
    });
    var [shareMsg, setShareMsg] = useState(null);

    // Auto-fill game-locked slots in guess + feedback
    useEffect(function () {
      setGuess(function (prev) {
        var next = prev.slice();
        for (var s = 0; s < codeLen; s++) {
          if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
            var pk = parseKey(data.solverState.confirmed[s]);
            next[s] = { p1: pk[0], p2: pk[1] };
          }
        }
        return next;
      });
    }, [data.solverState.gameLocked]);

    // Reset guess when round changes
    useEffect(function () {
      var newGuess = suggestionToGuess(data.suggestion, lookup);
      // Keep game-locked slots locked
      for (var s = 0; s < codeLen; s++) {
        if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
          var pk = parseKey(data.solverState.confirmed[s]);
          newGuess[s] = { p1: pk[0], p2: pk[1] };
        }
      }
      setGuess(newGuess);
      // Auto-fill feedback for game-locked slots
      var newFb = new Array(codeLen).fill(null);
      for (var s2 = 0; s2 < codeLen; s2++) {
        if (data.solverState.gameLocked[s2]) newFb[s2] = 'correct';
      }
      setFeedback(newFb);
    }, [roundNum, codeLen]);

    // Puzzle is solved only when ALL slots are game-locked
    var isSolved = data.solverState.gameLocked.every(function (l) { return l; });
    var hasContradiction = data.solverState.possible.some(function (s) { return s.size === 0; });

    // For submit validation: only check NON-GAME-LOCKED slots
    var activeSlots = [];
    for (var s = 0; s < codeLen; s++) {
      if (!data.solverState.gameLocked[s]) activeSlots.push(s);
    }

    var allActiveFbSet = activeSlots.every(function (s) { return feedback[s] !== null; });
    var allActiveGuessValid = activeSlots.every(function (s) {
      var g = guess[s];
      return g && g.p1 !== null && g.p2 !== null && getHybridName(g.p1, g.p2) !== null;
    });
    var canSubmit = allActiveFbSet && allActiveGuessValid && !isSolved && activeSlots.length > 0;

    function handleUseSuggestion() {
      var newGuess = suggestionToGuess(data.suggestion, lookup);
      for (var s = 0; s < codeLen; s++) {
        if (data.solverState.gameLocked[s] && data.solverState.confirmed[s]) {
          var pk = parseKey(data.solverState.confirmed[s]);
          newGuess[s] = { p1: pk[0], p2: pk[1] };
        }
      }
      setGuess(newGuess);
    }

    function handlePlantChange(slot, which, val) {
      if (data.solverState.gameLocked[slot]) return; // locked by game
      setGuess(function (prev) {
        var next = prev.slice();
        next[slot] = Object.assign({}, next[slot]);
        next[slot][which] = val;
        return next;
      });
    }

    function handleFeedbackChange(slot, fb) {
      if (data.solverState.gameLocked[slot]) return; // locked by game
      setFeedback(function (prev) {
        var next = prev.slice();
        next[slot] = prev[slot] === fb ? null : fb;
        return next;
      });
    }

    function handleSubmit() {
      if (!canSubmit) return;
      // Build full guess/feedback arrays (game-locked slots auto-filled)
      var fullGuess = guess.map(function (g, i) {
        if (data.solverState.gameLocked[i] && data.solverState.confirmed[i]) {
          var pk = parseKey(data.solverState.confirmed[i]);
          return { p1: pk[0], p2: pk[1] };
        }
        return { p1: g.p1, p2: g.p2 };
      });
      var fullFeedback = feedback.map(function (fb, i) {
        return data.solverState.gameLocked[i] ? 'correct' : fb;
      });
      var newState = applyFeedback(data.solverState, fullGuess, fullFeedback);
      var newHistory = data.history.concat([{ guess: fullGuess, feedback: fullFeedback }]);
      var newSug = generateSuggestion(newState, data.validHybrids, codeLen, false, config.selectedPlants, engine);
      onUpdate({
        validHybrids: data.validHybrids,
        solverState: newState,
        history: newHistory,
        suggestion: newSug
      });
    }

    function handleNewGame() { onReset(); }

    function handleRestartSameConfig() {
      var vh = data.validHybrids;
      var st = createSolverState(vh, codeLen);
      var sug = generateSuggestion(st, vh, codeLen, true, config.selectedPlants, engine);
      onUpdate({ validHybrids: vh, solverState: st, history: [], suggestion: sug });
    }

    // Undo: keep the first `keepCount` rounds and rebuild everything by replay.
    function handleUndoTo(keepCount) {
      var nh = data.history.slice(0, Math.max(0, keepCount));
      onUpdate(rebuildFromHistory(config, engine, nh));
    }
    function handleUndo() { handleUndoTo(data.history.length - 1); }

    function handleShare() {
      var url = buildShareUrl(config, engine, data.history);
      var done = function () { setShareMsg('Link copied!'); setTimeout(function () { setShareMsg(null); }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this share link:', url); });
      } else {
        window.prompt('Copy this share link:', url);
      }
    }

    // Diagnose which round first caused a contradiction (cheap replay).
    var diagnosis = hasContradiction ? diagnoseContradiction(config, data.history) : null;

    var lockedCount = data.solverState.gameLocked.filter(function (l) { return l; }).length;
    var deducedCount = data.solverState.confirmed.filter(function (c, i) { return c !== null && !data.solverState.gameLocked[i]; }).length;

    return e('div', { className: 'solver-screen' },

      // Header
      e('header', { className: 'solver-header' },
        e('div', { className: 'solver-brand' },
          e('div', { className: 'solver-logo' }, '🧬'),
          e('div', null,
            e('h1', null, 'Decode Solver'),
            e('p', null, config.selectedPlants.length + ' plants · ' + codeLen + ' slots · Round ' + (roundNum + 1) +
              (lockedCount > 0 ? ' · ' + lockedCount + ' 🔒' : '') +
              (deducedCount > 0 ? ' · ' + deducedCount + ' 💡' : ''))
          )
        ),
        e('div', { className: 'solver-actions' },
          e('button', {
            className: 'header-btn', onClick: handleUndo,
            disabled: data.history.length === 0,
            title: 'Undo the last round'
          }, '↩ Undo'),
          e('button', {
            className: 'header-btn', onClick: handleShare,
            title: 'Copy a shareable link to this game'
          }, shareMsg ? '✓ ' + shareMsg : '🔗 Share'),
          e('button', { className: 'header-btn', onClick: handleRestartSameConfig }, '↻ Restart'),
          e('button', { className: 'header-btn danger', onClick: handleNewGame }, 'New Game')
        )
      ),

      // Solved banner
      isSolved ? e('div', { className: 'solved-banner' },
        e('span', { className: 'solved-icon' }, '🎉'),
        e('div', { className: 'solved-text' },
          e('h3', null, 'Puzzle Solved!'),
          e('p', null, 'Cracked in ' + roundNum + ' round' + (roundNum !== 1 ? 's' : '') + '.')
        )
      ) : null,

      // Contradiction diagnosis + one-click undo
      hasContradiction && !isSolved ? e('div', { className: 'warning-banner' },
        e('span', { className: 'warning-icon' }, '⚠'),
        e('div', { className: 'warning-body' },
          diagnosis
            ? e('div', null,
              e('strong', null, 'Contradiction detected. '),
              'Slot ' + (diagnosis.slot + 1) + ' has no possibilities left — the feedback for Round ' +
              diagnosis.round + ' is likely inconsistent with earlier rounds.')
            : e('span', null, 'Some slots have 0 possibilities. Double-check your feedback entries.'),
          diagnosis
            ? e('button', {
              className: 'warning-action',
              onClick: function () { handleUndoTo(diagnosis.round - 1); }
            }, '↩ Undo Round ' + diagnosis.round)
            : null
        )
      ) : null,

      // Suggestion panel
      e(SuggestionPanel, {
        suggestion: data.suggestion, solverState: data.solverState,
        lookup: lookup, codeLen: codeLen, isSolved: isSolved,
        onUseSuggestion: handleUseSuggestion
      }),

      // Guess input panel (horizontal, only if not solved)
      !isSolved ? e('div', { className: 'solver-panel' },
        e('div', { className: 'panel-title-bar' },
          e('div', { className: 'panel-title' },
            e('span', { className: 'panel-title-icon' }, '✏️'),
            e('h2', null, 'Your Guess & Feedback')
          ),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            e('span', { className: 'panel-title-badge' }, 'Round ' + (roundNum + 1)),
            e('div', { className: 'engine-switcher' },
              e('button', {
                className: 'engine-opt' + (engine === ENGINE_STRATEGIC ? ' active' : ''),
                onClick: function () { onEngineChange(ENGINE_STRATEGIC); },
                title: 'Strategic: maximizes information, avoids placing known answers prematurely'
              }, '🧠 Strategic'),
              e('button', {
                className: 'engine-opt' + (engine === ENGINE_MINIMAX ? ' active' : ''),
                onClick: function () { onEngineChange(ENGINE_MINIMAX); },
                title: 'Minimax: minimizes expected remaining answers via exact information gain (computer play)'
              }, '🤖 Minimax'),
              e('button', {
                className: 'engine-opt' + (engine === ENGINE_HEURISTIC ? ' active' : ''),
                onClick: function () { onEngineChange(ENGINE_HEURISTIC); },
                title: 'Heuristic: greedy placement-focused approach'
              }, '⚡ Heuristic')
            )
          )
        ),

        // Engine description
        e('div', { className: 'engine-note' },
          engine === ENGINE_MINIMAX
            ? '🤖 Minimax mode: when few answers remain it enumerates them and picks the guess that minimizes the expected number left (true information gain); falls back to Strategic early on.'
            : engine === ENGINE_STRATEGIC
              ? '💡 Strategic mode: gathers info first, avoids placing known answers until confident. Correctly-solved slots are locked by the game.'
              : '⚡ Heuristic mode: greedily picks from remaining possibilities for each slot.'
        ),

        // Horizontal guess columns
        e('div', { className: 'guess-horizontal-scroll' },
          e('div', { className: 'guess-horizontal' },
            Array.from({ length: codeLen }).map(function (_, idx) {
              var isGameLocked = data.solverState.gameLocked[idx];
              var isSolverKnown = !isGameLocked && data.solverState.confirmed[idx] !== null;
              var g = guess[idx] || { p1: null, p2: null };
              var hybridName = (g.p1 !== null && g.p2 !== null) ? getHybridName(g.p1, g.p2) : null;

              if (isGameLocked) {
                var confKey = data.solverState.confirmed[idx];
                var confH = lookup.get(confKey);
                var confPk = parseKey(confKey);
                var confName = confH ? confH.name : getHybridName(confPk[0], confPk[1]) || '?';
                return e('div', { key: idx, className: 'guess-column locked' },
                  e('div', { className: 'guess-col-header' },
                    e('div', { className: 'guess-col-number' }, '✓'),
                    e('span', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Slot ' + (idx + 1))
                  ),
                  e('div', { className: 'guess-col-result locked-name' }, confName),
                  e('div', { className: 'guess-col-pair' }, BASE_SHORT[confPk[0]] + ' + ' + BASE_SHORT[confPk[1]])
                );
              }

              return e('div', { key: idx, className: 'guess-column' + (isSolverKnown ? ' solver-known' : '') },
                e('div', { className: 'guess-col-header' },
                  e('div', { className: 'guess-col-number' + (isSolverKnown ? ' known' : '') }, isSolverKnown ? '💡' : idx + 1),
                  e('span', { style: { fontSize: '11px', fontWeight: 600, color: isSolverKnown ? 'var(--accent-light)' : 'var(--text-secondary)' } }, 'Slot ' + (idx + 1))
                ),
                // Plant A
                e('div', { className: 'col-select-wrapper' },
                  e('select', {
                    className: 'plant-select-col',
                    value: g.p1 !== null ? g.p1 : '',
                    onChange: function (ev) {
                      handlePlantChange(idx, 'p1', ev.target.value === '' ? null : parseInt(ev.target.value));
                    }
                  },
                    e('option', { value: '' }, '— Plant A —'),
                    config.selectedPlants.map(function (pi) {
                      return e('option', { key: pi, value: pi }, BASE_PLANTS[pi]);
                    })
                  )
                ),
                e('div', { className: 'col-plus' }, '+'),
                // Plant B
                e('div', { className: 'col-select-wrapper' },
                  e('select', {
                    className: 'plant-select-col',
                    value: g.p2 !== null ? g.p2 : '',
                    onChange: function (ev) {
                      handlePlantChange(idx, 'p2', ev.target.value === '' ? null : parseInt(ev.target.value));
                    }
                  },
                    e('option', { value: '' }, '— Plant B —'),
                    config.selectedPlants.map(function (pi) {
                      return e('option', { key: pi, value: pi }, BASE_PLANTS[pi]);
                    })
                  )
                ),
                // Result
                hybridName
                  ? e('div', { className: 'guess-col-result valid' }, hybridName)
                  : e('div', { className: 'guess-col-result invalid' },
                    g.p1 !== null && g.p2 !== null ? 'Invalid' : '...'),
                // Feedback 2×2 grid
                e('div', { className: 'fb-grid' },
                  FEEDBACK_TYPES.map(function (ft) {
                    var active = feedback[idx] === ft.id;
                    return e('button', {
                      key: ft.id,
                      className: 'fb-btn ' + ft.id + (active ? ' active' : ''),
                      onClick: function () { handleFeedbackChange(idx, ft.id); },
                      title: ft.label
                    },
                      e('span', { className: 'fb-icon' }, ft.icon),
                      e('span', null, ft.shortLabel)
                    );
                  })
                )
              );
            })
          )
        ),

        // Submit bar
        e('div', { className: 'submit-bar' },
          e('span', { className: 'submit-helper' },
            !allActiveGuessValid ? 'Select valid plant pairs for active slots'
              : !allActiveFbSet ? 'Set feedback for active slots'
                : 'Ready to submit'
          ),
          e('button', {
            className: 'submit-btn',
            disabled: !canSubmit,
            onClick: handleSubmit
          }, 'Submit Feedback')
        ),

        // Legend
        e('div', { className: 'legend-bar' },
          FEEDBACK_TYPES.map(function (ft) {
            return e('div', { key: ft.id, className: 'legend-item' },
              e('span', { className: 'legend-dot ' + ft.id }),
              e('span', null, ft.label + ': ' + getLegendDesc(ft.id))
            );
          })
        )
      ) : null,

      // Analysis panel
      e(AnalysisPanel, { solverState: data.solverState, lookup: lookup, codeLen: codeLen }),

      // Explanation panel
      e(ExplanationPanel, { history: data.history, solverState: data.solverState, lookup: lookup, codeLen: codeLen }),

      // History panel (with per-round undo)
      e(HistoryPanel, { history: data.history, lookup: lookup, codeLen: codeLen, onUndoTo: handleUndoTo })
    );
  }

  function getLegendDesc(id) {
    switch (id) {
      case 'correct': return 'Exact match for this slot';
      case 'wrongslot': return 'Exists in answer, wrong position';
      case 'partial': return 'One base plant matches this slot';
      case 'allwrong': return 'Neither base plant matches';
      default: return '';
    }
  }

  function suggestionToGuess(suggestion, lookup) {
    return suggestion.map(function (key) {
      if (!key) return { p1: null, p2: null };
      var h = lookup.get(key);
      if (h) return { p1: h.p1, p2: h.p2 };
      var pk = parseKey(key);
      return { p1: pk[0], p2: pk[1] };
    });
  }

  // ---- SuggestionPanel ----

  function SuggestionPanel({ suggestion, solverState, lookup, codeLen, isSolved, onUseSuggestion }) {
    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '💡'),
          e('h2', null, isSolved ? 'Answer' : 'Suggested Guess')
        )
      ),
      e('div', { className: 'panel-body' },
        e('div', { className: 'suggestion-slots' },
          suggestion.map(function (key, idx) {
            if (!key) return e('div', { key: idx, className: 'suggestion-slot' },
              e('div', { className: 'slot-number' }, idx + 1),
              e('div', null, e('div', { className: 'slot-hybrid-name' }, '—'))
            );
            var h = lookup.get(key);
            var isLocked = solverState.gameLocked[idx];
            var isKnown = !isLocked && solverState.confirmed[idx] !== null;
            var pk = parseKey(key);
            var name = h ? h.name : getHybridName(pk[0], pk[1]) || '?';
            var slotClass = 'suggestion-slot' + (isLocked ? ' confirmed' : '') + (isKnown ? ' known' : '');
            return e('div', { key: idx, className: slotClass },
              e('div', { className: 'slot-number' }, isLocked ? '🔒' : isKnown ? '💡' : idx + 1),
              e('div', null,
                e('div', { className: 'slot-hybrid-name' }, name),
                e('div', { className: 'slot-pair' }, BASE_SHORT[pk[0]] + ' + ' + BASE_SHORT[pk[1]])
              )
            );
          })
        ),
        !isSolved ? e('div', { className: 'suggestion-actions' },
          e('button', { className: 'use-suggestion-btn', onClick: onUseSuggestion }, 'Use This Suggestion')
        ) : null
      )
    );
  }

  // ---- AnalysisPanel ----

  function AnalysisPanel({ solverState, lookup, codeLen }) {
    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '📊'),
          e('h2', null, 'Analysis')
        )
      ),
      e('div', { className: 'panel-body' },
        e('div', { className: 'analysis-grid' },
          Array.from({ length: codeLen }).map(function (_, idx) {
            var poss = solverState.possible[idx];
            var confirmed = solverState.confirmed[idx];
            var isLocked = solverState.gameLocked[idx];
            var isKnown = confirmed !== null && !isLocked;
            var count = poss.size;
            var isConfirmed = confirmed !== null;
            var isImpossible = count === 0 && !isConfirmed;

            var valueName = '';
            if (isConfirmed) {
              var h = lookup.get(confirmed);
              valueName = h ? h.name : '?';
            }

            // Show up to 5 remaining possibilities
            var remaining = [];
            var i = 0;
            for (var k of poss) {
              if (i >= 5) break;
              var h2 = lookup.get(k);
              remaining.push(h2 ? h2.name : k);
              i++;
            }
            var moreCount = count - remaining.length;

            var slotClass = 'analysis-slot'
              + (isLocked ? ' confirmed' : '')
              + (isKnown ? ' known' : '')
              + (isImpossible ? ' impossible' : '');

            return e('div', { key: idx, className: slotClass },
              e('div', { className: 'analysis-slot-header' },
                e('span', { className: 'analysis-slot-label' }, 'Slot ' + (idx + 1)),
                e('span', { className: 'analysis-slot-count' },
                  isLocked ? '🔒' : isKnown ? '💡' : isImpossible ? '✕' : count
                )
              ),
              isConfirmed
                ? e('div', { className: 'analysis-slot-value' }, valueName + (isKnown ? ' (deduced)' : ''))
                : isImpossible
                  ? e('div', { className: 'analysis-slot-value', style: { color: 'var(--allwrong)' } }, 'No possibilities')
                  : e('div', { className: 'analysis-remaining-list' },
                    remaining.join(', ') + (moreCount > 0 ? ' +' + moreCount + ' more' : '')
                  )
            );
          })
        )
      )
    );
  }

  // ---- ExplanationPanel ----

  // Human-readable deduction for one slot's feedback.
  function deductionLine(g, fb, slotIdx) {
    var name = getHybridName(g.p1, g.p2) || '?';
    var A = BASE_SHORT[g.p1], B = BASE_SHORT[g.p2];
    var slot = 'Slot ' + (slotIdx + 1) + ': ';
    switch (fb) {
      case 'correct': return { icon: '🟢', text: slot + name + ' is exact — this slot is locked.' };
      case 'wrongslot': return { icon: '🔵', text: slot + name + ' is in the answer but not here — it belongs to another slot.' };
      case 'partial': return { icon: '🟣', text: slot + 'one of ' + A + ' / ' + B + ' belongs here; ' + name + ' is ruled out everywhere.' };
      case 'allwrong': return { icon: '🔴', text: slot + 'neither ' + A + ' nor ' + B + ' is here; ' + name + ' is ruled out everywhere.' };
      default: return null;
    }
  }

  function ExplanationPanel({ history, solverState, lookup, codeLen }) {
    var lastRound = history.length ? history[history.length - 1] : null;

    var placed = new Set();
    for (var s = 0; s < codeLen; s++) if (solverState.confirmed[s]) placed.add(solverState.confirmed[s]);
    var mustAppear = [];
    solverState.mustInclude.forEach(function (k) { if (!placed.has(k)) mustAppear.push(k); });
    var lockedCount = 0, deducedCount = 0;
    for (var s2 = 0; s2 < codeLen; s2++) {
      if (solverState.gameLocked[s2]) lockedCount++;
      else if (solverState.confirmed[s2]) deducedCount++;
    }
    var nameOf = function (key) { var h = lookup.get(key); return h ? h.name : key; };

    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '🧠'),
          e('h2', null, 'Explanation')
        )
      ),
      e('div', { className: 'panel-body' },
        !lastRound
          ? e('div', { className: 'history-empty' }, 'Submit a guess to see what each piece of feedback tells the solver.')
          : e('div', { className: 'explain-block' },
            e('div', { className: 'explain-subtitle' }, 'What Round ' + history.length + ' told us'),
            e('ul', { className: 'explain-list' },
              lastRound.feedback.map(function (fb, i) {
                var line = deductionLine(lastRound.guess[i], fb, i);
                if (!line) return null;
                return e('li', { key: i },
                  e('span', { className: 'explain-icon' }, line.icon),
                  e('span', null, line.text));
              })
            )
          ),
        e('div', { className: 'explain-block' },
          e('div', { className: 'explain-subtitle' }, 'What we know now'),
          e('ul', { className: 'explain-list' },
            e('li', { key: 'locked' },
              e('span', { className: 'explain-icon' }, '🔒'),
              e('span', null, lockedCount + ' slot(s) confirmed by the game' +
                (deducedCount ? ', ' + deducedCount + ' more deduced (💡)' : ''))),
            mustAppear.length
              ? e('li', { key: 'must' },
                e('span', { className: 'explain-icon' }, '🔵'),
                e('span', null, 'Must still appear somewhere: ' + mustAppear.map(nameOf).join(', ')))
              : null,
            e('li', { key: 'ruled' },
              e('span', { className: 'explain-icon' }, '🚫'),
              e('span', null, solverState.excluded.size + ' hybrid(s) ruled out of the answer entirely'))
          )
        )
      )
    );
  }

  // ---- HistoryPanel ----

  function HistoryPanel({ history, lookup, codeLen, onUndoTo }) {
    const fbIcons = { correct: '✓', wrongslot: '↔', partial: '◐', allwrong: '✕' };

    return e('div', { className: 'solver-panel' },
      e('div', { className: 'panel-title-bar' },
        e('div', { className: 'panel-title' },
          e('span', { className: 'panel-title-icon' }, '📜'),
          e('h2', null, 'History')
        ),
        e('span', { className: 'panel-title-badge' }, history.length + ' round' + (history.length !== 1 ? 's' : ''))
      ),
      history.length === 0
        ? e('div', { className: 'history-empty' }, 'No guesses yet. Submit your first guess above.')
        : e('div', null,
          history.map(function (round, rIdx) {
            return e('div', { key: rIdx, className: 'history-round' },
              e('div', { className: 'history-round-head' },
                e('div', { className: 'history-round-title' }, 'Round ' + (rIdx + 1)),
                onUndoTo ? e('button', {
                  className: 'history-undo-btn',
                  title: 'Undo this round and everything after it',
                  onClick: function () { onUndoTo(rIdx); }
                }, '↩ undo') : null
              ),
              e('div', { className: 'history-slots' },
                round.guess.map(function (g, sIdx) {
                  const fb = round.feedback[sIdx];
                  const name = getHybridName(g.p1, g.p2) || '?';
                  const icon = fbIcons[fb] || '?';
                  return e('span', { key: sIdx, className: 'history-chip ' + fb },
                    e('span', null, name),
                    e('span', { className: 'history-fb-icon' }, icon)
                  );
                })
              )
            );
          }).reverse()
        )
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  ReactDOM.createRoot(document.getElementById('root')).render(e(App));
})();
