/**
 * stats.js — Fonctions d'analyse statistique en JavaScript pur
 * ACP (Jacobi), k-means++, Spearman, Mann-Whitney U, Kruskal-Wallis,
 * corrélation de Pearson, régression linéaire
 */

const Stats = (() => {

  /* ── Utilitaires matriciels ────────────────────────────── */

  function mean(arr) {
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function std(arr) {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  function transpose(matrix) {
    return matrix[0].map((_, c) => matrix.map(r => r[c]));
  }

  function matMul(A, B) {
    return A.map(row =>
      B[0].map((_, c) => row.reduce((s, v, r) => s + v * B[r][c], 0))
    );
  }

  function standardize(matrix) {
    const T = transpose(matrix);
    const scaled = T.map(col => {
      const m = mean(col);
      const s = std(col) || 1;
      return col.map(v => (v - m) / s);
    });
    return transpose(scaled);
  }

  function covariance(matrix) {
    const n = matrix.length;
    const T = transpose(matrix);
    return T.map(ri =>
      T.map(rj => ri.reduce((s, v, k) => s + v * rj[k], 0) / (n - 1))
    );
  }

  /* ── ACP (Jacobi) ──────────────────────────────────────── */

  function jacobiEigen(A, maxIter = 200) {
    const n = A.length;
    let S = A.map(r => [...r]);
    let V = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
    );

    for (let iter = 0; iter < maxIter; iter++) {
      let p = 0, q = 1, max = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(S[i][j]) > max) { max = Math.abs(S[i][j]); p = i; q = j; }
        }
      }
      if (max < 1e-10) break;

      const tau = (S[q][q] - S[p][p]) / (2 * S[p][q]);
      const t = tau >= 0
        ? 1 / (tau + Math.sqrt(1 + tau * tau))
        : 1 / (tau - Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      const Snew = S.map(r => [...r]);
      for (let i = 0; i < n; i++) {
        if (i !== p && i !== q) {
          Snew[i][p] = c * S[i][p] - s * S[i][q];
          Snew[p][i] = Snew[i][p];
          Snew[i][q] = s * S[i][p] + c * S[i][q];
          Snew[q][i] = Snew[i][q];
        }
      }
      Snew[p][p] = c * c * S[p][p] - 2 * s * c * S[p][q] + s * s * S[q][q];
      Snew[q][q] = s * s * S[p][p] + 2 * s * c * S[p][q] + c * c * S[q][q];
      Snew[p][q] = 0; Snew[q][p] = 0;
      S = Snew;

      const Vnew = V.map(r => [...r]);
      for (let i = 0; i < n; i++) {
        Vnew[i][p] = c * V[i][p] - s * V[i][q];
        Vnew[i][q] = s * V[i][p] + c * V[i][q];
      }
      V = Vnew;
    }

    const values = S.map((r, i) => r[i]);
    const order = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    return {
      values: order.map(i => values[i]),
      vectors: order.map(i => V.map(r => r[i])),
    };
  }

  function pca(data, variables) {
    const matrix = data.map(d => variables.map(v => d[v] ?? 0));
    const Z = standardize(matrix);
    const C = covariance(Z);
    const { values, vectors } = jacobiEigen(C);

    const totalVar = values.reduce((s, v) => s + Math.max(0, v), 0);
    const explainedRatio = values.map(v => Math.max(0, v) / totalVar);

    const scores = Z.map(row =>
      vectors.map(vec => row.reduce((s, v, i) => s + v * vec[i], 0))
    );

    return { scores, loadings: vectors, variance: values, explainedRatio, variables };
  }

  /* ── K-means ───────────────────────────────────────────── */

  function euclidean(a, b) {
    return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  }

  function kmeans(points, k, maxIter = 200) {
    const n = points.length;
    let centroids = [points[Math.floor(Math.random() * n)]];
    for (let ki = 1; ki < k; ki++) {
      const dists = points.map(p => Math.min(...centroids.map(c => euclidean(p, c))));
      const total = dists.reduce((s, d) => s + d * d, 0);
      let r = Math.random() * total, cumul = 0, chosen = 0;
      for (let i = 0; i < n; i++) {
        cumul += dists[i] * dists[i];
        if (cumul >= r) { chosen = i; break; }
      }
      centroids.push([...points[chosen]]);
    }

    let labels = new Array(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
      const newLabels = points.map(p => {
        let minD = Infinity, best = 0;
        centroids.forEach((c, ki) => { const d = euclidean(p, c); if (d < minD) { minD = d; best = ki; } });
        return best;
      });
      const changed = newLabels.some((l, i) => l !== labels[i]);
      labels = newLabels;
      if (!changed) break;
      const dims = points[0].length;
      const sums = Array.from({ length: k }, () => new Array(dims).fill(0));
      const counts = new Array(k).fill(0);
      labels.forEach((l, i) => { points[i].forEach((v, d) => { sums[l][d] += v; }); counts[l]++; });
      centroids = sums.map((s, ki) => counts[ki] > 0 ? s.map(v => v / counts[ki]) : centroids[ki]);
    }

    const inertia = points.reduce((s, p, i) => s + euclidean(p, centroids[labels[i]]) ** 2, 0);
    return { labels, centroids, inertia };
  }

  function elbowData(points, maxK = 6, runs = 3) {
    const result = [];
    for (let k = 2; k <= maxK; k++) {
      let best = Infinity;
      for (let r = 0; r < runs; r++) {
        const { inertia } = kmeans(points, k);
        if (inertia < best) best = inertia;
      }
      result.push({ k, inertia: best });
    }
    return result;
  }

  /* ── Distributions ─────────────────────────────────────── */

  function lgamma(z) {
    const p = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
    let x = z - 1, t = x + 5.5;
    let ser = 1.000000000190015;
    p.forEach((c, i) => { ser += c / (x + i + 1); });
    return (0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(ser));
  }

  function betaIncomplete(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
    const MAXIT = 100, EPS = 3e-7;
    let C = 1, D = 1 - (a + b) * x / (a + 1);
    if (Math.abs(D) < 1e-30) D = 1e-30;
    D = 1 / D;
    let h = D;
    for (let m = 1; m <= MAXIT; m++) {
      let d = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
      D = 1 + d * D; if (Math.abs(D) < 1e-30) D = 1e-30;
      C = 1 + d / C; if (Math.abs(C) < 1e-30) C = 1e-30;
      D = 1 / D; h *= D * C;
      d = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
      D = 1 + d * D; if (Math.abs(D) < 1e-30) D = 1e-30;
      C = 1 + d / C; if (Math.abs(C) < 1e-30) C = 1e-30;
      D = 1 / D;
      const del = D * C;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return front * h;
  }

  function tCDF(t, df) {
    const x = df / (df + t * t);
    return 1 - 0.5 * betaIncomplete(x, df / 2, 0.5);
  }

  /* CDF normale standard (Abramowitz & Stegun 26.2.17) */
  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = t * (0.319381530 + t * (-0.356563782 +
      t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    const cdf = 1 - pdf * poly;
    return z >= 0 ? cdf : 1 - cdf;
  }

  /* CDF chi-carré (série de Poisson) */
  function chiSquaredCDF(x, df) {
    if (x <= 0) return 0;
    const a = df / 2;
    let term = Math.exp(a * Math.log(x / 2) - x / 2 - lgamma(a + 1));
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= (x / 2) / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-12) break;
    }
    return Math.min(1, sum);
  }

  /* ── Corrélation de Pearson ────────────────────────────── */

  function pearson(x, y) {
    const n = x.length;
    if (n < 3) return { r: NaN, pvalue: NaN, n };
    const mx = mean(x), my = mean(y);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i] - mx, yi = y[i] - my;
      num += xi * yi; dx2 += xi * xi; dy2 += yi * yi;
    }
    const r = num / Math.sqrt(dx2 * dy2 + 1e-12);
    const tStat = r * Math.sqrt(n - 2) / Math.sqrt(1 - r * r + 1e-10);
    const pvalue = 2 * (1 - tCDF(Math.abs(tStat), n - 2));
    return { r, pvalue, n };
  }

  /* ── Rangs avec correction ex aequo ───────────────────── */

  function rankArray(arr) {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length - 1 && sorted[j + 1].v === sorted[j].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  }

  /* ── Corrélation de Spearman ──────────────────────────── */

  function spearman(x, y) {
    if (x.length < 3) return { r: NaN, pvalue: NaN, n: x.length };
    return pearson(rankArray(x), rankArray(y));
  }

  /* ── Mann-Whitney U ────────────────────────────────────── */

  function mannWhitney(group1, group2) {
    const n1 = group1.length, n2 = group2.length;
    if (n1 < 2 || n2 < 2) return { U: NaN, pvalue: NaN, n1, n2, z: NaN };

    const combined = [
      ...group1.map(v => ({ v, g: 0 })),
      ...group2.map(v => ({ v, g: 1 })),
    ];
    const ranks = rankArray(combined.map(c => c.v));

    let R1 = 0;
    combined.forEach((c, i) => { if (c.g === 0) R1 += ranks[i]; });

    const U1 = R1 - n1 * (n1 + 1) / 2;
    const U2 = n1 * n2 - U1;
    const U = Math.min(U1, U2);

    const meanU = n1 * n2 / 2;
    const sdU = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
    const z = (U - meanU) / sdU;
    const pvalue = 2 * (1 - normalCDF(Math.abs(z)));

    return { U, U1, U2, z, pvalue, n1, n2 };
  }

  /* ── Kruskal-Wallis H ──────────────────────────────────── */

  function kruskalWallis(groups) {
    const k = groups.length;
    const ns = groups.map(g => g.length);
    const N = ns.reduce((s, n) => s + n, 0);
    if (N < 3 || k < 2) return { H: NaN, pvalue: NaN, df: k - 1 };

    const combined = groups.flatMap((g, gi) => g.map(v => ({ v, gi })));
    const ranks = rankArray(combined.map(c => c.v));

    const Ri = new Array(k).fill(0);
    combined.forEach((c, i) => { Ri[c.gi] += ranks[i]; });

    const H = (12 / (N * (N + 1))) *
      Ri.reduce((s, r, i) => s + (r * r) / ns[i], 0) - 3 * (N + 1);

    const pvalue = 1 - chiSquaredCDF(Math.max(0, H), k - 1);

    return { H, pvalue, df: k - 1, ns, Ri };
  }

  /* ── Matrices de corrélation ────────────────────────────── */

  function correlationMatrix(data, variables) {
    const cols = variables.map(v => data.map(d => d[v] ?? 0));
    return variables.map((_, i) => variables.map((_, j) => pearson(cols[i], cols[j])));
  }

  function spearmanMatrix(data, variables) {
    const cols = variables.map(v => data.map(d => d[v] ?? 0));
    return variables.map((_, i) => variables.map((_, j) => spearman(cols[i], cols[j])));
  }

  /* ── Régression linéaire ───────────────────────────────── */

  function linearRegression(x, y) {
    const n = x.length;
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) ** 2;
    }
    const b = sxx === 0 ? 0 : sxy / sxx;
    const a = my - b * mx;

    const yPred = x.map(xi => a + b * xi);
    const residuals = y.map((yi, i) => yi - yPred[i]);
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const sst = y.reduce((s, yi) => s + (yi - my) ** 2, 0);
    const r2 = sst === 0 ? 0 : 1 - sse / sst;

    const se = Math.sqrt(sse / (n - 2));
    const seb = se / Math.sqrt(sxx || 1);
    const tStat = seb === 0 ? 0 : b / seb;
    const pvalue = 2 * (1 - tCDF(Math.abs(tStat), n - 2));

    const xRange = Array.from({ length: 50 }, (_, i) => {
      const xmin = Math.min(...x), xmax = Math.max(...x);
      return xmin + (xmax - xmin) * i / 49;
    });

    const tCrit = 1.96;
    const confBand = xRange.map(xi => {
      const se_yi = se * Math.sqrt(1 / n + (xi - mx) ** 2 / sxx);
      return { x: xi, y: a + b * xi, upper: a + b * xi + tCrit * se_yi, lower: a + b * xi - tCrit * se_yi };
    });

    return { a, b, r2, pvalue, n, se, xMean: mx, yMean: my, residuals, confBand };
  }

  /* ── API publique ──────────────────────────────────────── */

  return {
    pca, kmeans, elbowData,
    pearson, spearman, mannWhitney, kruskalWallis,
    correlationMatrix, spearmanMatrix,
    linearRegression,
    mean, std, standardize, rankArray,
  };

})();
