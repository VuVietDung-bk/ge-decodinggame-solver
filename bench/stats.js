'use strict';
// Small dependency-free statistics helpers.

function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function mean(a) { return a.length ? sum(a) / a.length : 0; }
function min(a) { if (!a.length) return 0; let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
function max(a) { if (!a.length) return 0; let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

// Sample standard deviation.
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
  return Math.sqrt(s / (a.length - 1));
}

// Nearest-rank percentile (p in 0..100).
function percentile(a, p) {
  if (!a.length) return 0;
  const b = a.slice().sort(function (x, y) { return x - y; });
  const rank = Math.ceil((p / 100) * b.length);
  const idx = Math.min(b.length - 1, Math.max(0, rank - 1));
  return b[idx];
}

function median(a) { return percentile(a, 50); }

// Histogram value -> count.
function distribution(a) {
  const m = {};
  for (let i = 0; i < a.length; i++) { const v = a[i]; m[v] = (m[v] || 0) + 1; }
  return m;
}

module.exports = {
  sum: sum, mean: mean, min: min, max: max,
  stddev: stddev, percentile: percentile, median: median, distribution: distribution
};
