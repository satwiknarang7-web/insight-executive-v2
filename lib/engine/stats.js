/**
 * The statistics behind "is this worth saying": effect sizes and tests an
 * analyst would reach for before putting a sentence on a dashboard.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Least-squares line through (i, y): slope per step, R², relative slope. */
export function linearTrend(ys) {
  const pts = ys.map((y, i) => [i, y]).filter(([, y]) => isNum(y));
  const n = pts.length;
  if (n < 3) return { slope: 0, r2: 0, rel: 0 };
  const mx = mean(pts.map((p) => p[0]));
  const my = mean(pts.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2, rel: my ? (slope * (n - 1)) / Math.abs(my) : 0 };
}

/** Complementary error function (error < 1.2e-7). */
export function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t * (1.00002368 + t * (0.37409189 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? y : 2 - y;
}

/** Pearson r with a two-sided p-value (Fisher z). */
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return { r: 0, p: 1, n };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const z = Math.abs(Math.atanh(Math.min(Math.abs(r), 0.999999))) * Math.sqrt(Math.max(1, n - 3));
  return { r, p: erfc(z / Math.SQRT2), n };
}

/** Spearman rank correlation: robust to one huge value. */
export function spearman(xs, ys) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(arr.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return out;
  };
  return correlation(rank(xs), rank(ys));
}

/**
 * How much of a numeric variable a grouping explains (eta², adjusted) and an
 * F-test p-value approximation — "does category matter for price?".
 */
export function groupEffect(groups) {
  const gs = groups.filter((g) => g.length >= 2);
  const k = gs.length;
  const n = gs.reduce((s, g) => s + g.length, 0);
  if (k < 2 || n <= k) return { eta2: 0, p: 1 };
  const grand = mean(gs.flat());
  let between = 0;
  let within = 0;
  for (const g of gs) {
    const m = mean(g);
    between += g.length * (m - grand) ** 2;
    for (const x of g) within += (x - m) ** 2;
  }
  const total = between + within;
  if (!total) return { eta2: 0, p: 1 };
  const eta2 = between / total;
  const F = within ? between / (k - 1) / (within / (n - k)) : Infinity;
  return { eta2: Math.max(0, eta2 - ((1 - eta2) * (k - 1)) / (n - k)), p: fPValue(F, k - 1, n - k) };
}

/** Upper tail of the F distribution via Wilson–Hilferty on chi-square. */
function fPValue(F, d1, d2) {
  if (!isFinite(F)) return 0;
  if (F <= 0) return 1;
  // Paulson's normal approximation.
  const a = 2 / (9 * d1);
  const b = 2 / (9 * d2);
  const f3 = Math.cbrt(F);
  const z = ((1 - b) * f3 - (1 - a)) / Math.sqrt(b * f3 * f3 + a);
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Two proportions: z-test p-value. */
export function proportionTest(h1, n1, h2, n2) {
  if (n1 < 1 || n2 < 1) return 1;
  const p = (h1 + h2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return h1 / n1 === h2 / n2 ? 1 : 0;
  const z = Math.abs(h1 / n1 - h2 / n2) / se;
  return erfc(z / Math.SQRT2);
}

/** Chi-square test of independence on a table of counts (rows × cols). */
export function chiSquare(table) {
  const R = table.length;
  const C = table[0]?.length || 0;
  if (R < 2 || C < 2) return { p: 1, v: 0 };
  const rs = table.map((r) => r.reduce((s, x) => s + x, 0));
  const cs = table[0].map((_, j) => table.reduce((s, r) => s + r[j], 0));
  const n = rs.reduce((s, x) => s + x, 0);
  if (!n) return { p: 1, v: 0 };
  let chi = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const e = (rs[i] * cs[j]) / n;
    if (e > 0) chi += (table[i][j] - e) ** 2 / e;
  }
  const df = (R - 1) * (C - 1);
  const z = (Math.cbrt(chi / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return { p: 0.5 * erfc(z / Math.SQRT2), v: Math.sqrt(chi / (n * Math.max(1, Math.min(R, C) - 1))) };
}

/** Share of the total held by the top `k` values. */
export function topShare(values, k) {
  const s = [...values].filter(isNum).sort((a, b) => b - a);
  const total = s.reduce((x, y) => x + y, 0);
  if (!total) return 0;
  return s.slice(0, k).reduce((x, y) => x + y, 0) / total;
}

/** How many of the largest values make up `share` of the total (Pareto). */
export function countToShare(values, share = 0.8) {
  const s = [...values].filter(isNum).sort((a, b) => b - a);
  const total = s.reduce((x, y) => x + y, 0);
  if (!total) return 0;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i];
    if (acc / total >= share) return i + 1;
  }
  return s.length;
}

/** Nice bin edges for a histogram: round numbers, ~`target` bins. */
export function niceEdges(values, target = 12) {
  const xs = values.filter(isNum);
  if (!xs.length) return [];
  let lo = quantile(xs, 0.01);
  let hi = quantile(xs, 0.99);
  if (lo === hi) {
    lo = Math.min(...xs);
    hi = Math.max(...xs);
  }
  if (lo === hi) return [lo];
  const raw = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow;
  const start = Math.floor(lo / step) * step;
  const edges = [];
  for (let e = start + step; e < hi + step * 0.001 && edges.length < 40; e += step) edges.push(Number(e.toPrecision(12)));
  return edges;
}

/** Robust outliers: values beyond 3 IQRs of the quartiles. */
export function outliers(values) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  if (!iqr) return [];
  return values.filter((x) => x < q1 - 3 * iqr || x > q3 + 3 * iqr);
}
