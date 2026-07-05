'use strict';
// Report writers: turn a benchmark results object into CSV + Markdown.

const fs = require('fs');
const path = require('path');

function n(x, d) {
  if (x === undefined || x === null || (typeof x === 'number' && !isFinite(x))) return '';
  return Number(x).toFixed(d === undefined ? 2 : d);
}
function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvField).join(','); }

// ---- CSV: per (engine, config) summary ----
function summaryCSV(results) {
  const head = ['engine', 'configId', 'plantCount', 'codeLength', 'games', 'solved', 'solveRate',
    'avgRounds', 'medianRounds', 'minRounds', 'maxRounds', 'stddevRounds', 'p90Rounds', 'p95Rounds',
    'avgMs', 'totalMs', 'gamesPerSec'];
  const lines = [csvRow(head)];
  const rows = results.summary.slice().sort(function (a, b) {
    return a.configId < b.configId ? -1 : a.configId > b.configId ? 1 : (a.engine < b.engine ? -1 : 1);
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(csvRow([r.engine, r.configId, r.plantCount, r.codeLength, r.games, r.solved, n(r.solveRate, 4),
      n(r.avgRounds, 3), r.medianRounds, r.minRounds, r.maxRounds, n(r.stddevRounds, 3), r.p90Rounds, r.p95Rounds,
      n(r.avgMs, 4), n(r.totalMs, 2), n(r.gamesPerSec, 1)]));
  }
  return lines.join('\n') + '\n';
}

// ---- CSV: raw per-game rows ----
function gamesCSV(results) {
  const head = ['engine', 'configId', 'plantCount', 'codeLength', 'seed', 'rounds', 'solved', 'ms'];
  const lines = [csvRow(head)];
  for (let i = 0; i < results.games.length; i++) {
    const g = results.games[i];
    lines.push(csvRow([g.engine, g.configId, g.plantCount, g.codeLength, g.seed, g.rounds, g.solved ? 1 : 0, n(g.ms, 4)]));
  }
  return lines.join('\n') + '\n';
}

// ---- CSV: solve-length distribution (per config + overall) ----
function distributionCSV(results) {
  const head = ['engine', 'scope', 'rounds', 'count'];
  const lines = [csvRow(head)];
  function emit(rows, scopeName) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const scope = scopeName || r.configId;
      const keys = Object.keys(r.dist).map(Number).sort(function (a, b) { return a - b; });
      for (let j = 0; j < keys.length; j++) lines.push(csvRow([r.engine, scope, keys[j], r.dist[keys[j]]]));
    }
  }
  emit(results.summary, null);
  emit(results.overall, 'ALL');
  return lines.join('\n') + '\n';
}

// ---- Markdown report ----
function bar(count, maxCount, width) {
  if (maxCount <= 0) return '';
  const len = Math.round((count / maxCount) * width);
  let s = '';
  for (let i = 0; i < len; i++) s += '#';
  return s;
}

function markdown(results) {
  const m = results.meta;
  const out = [];
  out.push('# Solver Benchmark Report');
  out.push('');
  out.push('- Generated: `' + m.generatedAt + '` (Node ' + m.node + ')');
  out.push('- Engines: ' + m.engines.map(function (e) { return '`' + e + '`'; }).join(', '));
  out.push('- Games/config: **' + m.gamesPerConfig + '**, configs: **' + m.configs.length + '**, total games: **' + m.totalGames + '**');
  out.push('- Solve bound: ' + m.bound + ' rounds · base seed: ' + m.baseSeed + ' · wall time: ' + n(m.wallMs, 0) + ' ms');
  out.push('');

  // Overall per-engine comparison
  out.push('## Overall (all configs combined)');
  out.push('');
  out.push('| Engine | Games | Solve % | Avg rounds | Median | p90 | Max | Avg ms | Games/s |');
  out.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|');
  const overall = results.overall.slice().sort(function (a, b) { return a.avgRounds - b.avgRounds; });
  for (let i = 0; i < overall.length; i++) {
    const r = overall[i];
    out.push('| `' + r.engine + '` | ' + r.games + ' | ' + n(r.solveRate * 100, 1) + '% | **' + n(r.avgRounds, 3) +
      '** | ' + r.medianRounds + ' | ' + r.p90Rounds + ' | ' + r.maxRounds + ' | ' + n(r.avgMs, 3) + ' | ' + n(r.gamesPerSec, 0) + ' |');
  }
  out.push('');

  // Per-config breakdown
  out.push('## Per-config breakdown');
  out.push('');
  out.push('| Config | Engine | Avg rounds | Median | p90 | Max | Solve % | Avg ms |');
  out.push('|---|---|--:|--:|--:|--:|--:|--:|');
  const rows = results.summary.slice().sort(function (a, b) {
    if (a.plantCount !== b.plantCount) return a.plantCount - b.plantCount;
    if (a.codeLength !== b.codeLength) return a.codeLength - b.codeLength;
    return a.engine < b.engine ? -1 : 1;
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = r.plantCount + 'p×' + r.codeLength + 'k';
    out.push('| ' + label + ' | `' + r.engine + '` | ' + n(r.avgRounds, 3) + ' | ' + r.medianRounds + ' | ' +
      r.p90Rounds + ' | ' + r.maxRounds + ' | ' + n(r.solveRate * 100, 1) + '% | ' + n(r.avgMs, 3) + ' |');
  }
  out.push('');

  // Distribution histograms (overall, per engine)
  out.push('## Solve-length distribution (all configs)');
  out.push('');
  for (let i = 0; i < results.overall.length; i++) {
    const r = results.overall[i];
    out.push('### `' + r.engine + '`');
    out.push('');
    out.push('```');
    const keys = Object.keys(r.dist).map(Number).sort(function (a, b) { return a - b; });
    let maxCount = 0;
    for (let j = 0; j < keys.length; j++) if (r.dist[keys[j]] > maxCount) maxCount = r.dist[keys[j]];
    const total = r.games;
    for (let j = 0; j < keys.length; j++) {
      const c = r.dist[keys[j]];
      const pct = total ? (c / total * 100) : 0;
      const label = ('' + keys[j]).padStart ? ('' + keys[j]).padStart(3, ' ') : keys[j];
      out.push(label + ' rounds | ' + bar(c, maxCount, 40).padEnd(40, ' ') + ' ' + c + ' (' + n(pct, 1) + '%)');
    }
    out.push('```');
    out.push('');
  }

  return out.join('\n');
}

function writeReports(results, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    'summary.csv': summaryCSV(results),
    'games.csv': gamesCSV(results),
    'distribution.csv': distributionCSV(results),
    'report.md': markdown(results)
  };
  const written = [];
  for (const name in files) {
    if (!Object.prototype.hasOwnProperty.call(files, name)) continue;
    const p = path.join(outDir, name);
    fs.writeFileSync(p, files[name]);
    written.push(p);
  }
  return written;
}

module.exports = {
  summaryCSV: summaryCSV, gamesCSV: gamesCSV, distributionCSV: distributionCSV,
  markdown: markdown, writeReports: writeReports
};
