/**
 * charts.js — Construction des graphiques Chart.js
 */

const Charts = (() => {

  /* ── Palette ──────────────────────────────────────────── */

  const PALETTE = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
    "#14b8a6", "#a855f7", "#d946ef", "#0ea5e9", "#78716c",
  ];

  function spectreColor(pos) {
    if (pos == null) return "#94a3b8";
    if (pos <= -0.7) return "#2563eb";
    if (pos <= -0.2) return "#6366f1";
    if (pos <= 0.2)  return "#8b5cf6";
    if (pos <= 0.7)  return "#f97316";
    return "#dc2626";
  }

  const _instances = {};
  function destroyChart(id) {
    if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }
  }

  /* ── Labels lisibles pour les variables ───────────────── */

  const VAR_LABELS = {
    nb_affaires:           "Nb affaires",
    nb_affaires_definitif: "Affaires définitives",
    nb_politiciens_crapu:  "Nb politiciens (Crapu.)",
    nb_politiciens_wikidata: "Nb politiciens (Wikidata)",
    taux_crapu:            "Taux Crapulopédia (‰ pol.)",
    taux_wikidata:         "Taux Wikidata (‰ pol.)",
    taux_par_carriere:     "Taux / carrière-année",
    taux_recidive:         "Taux de récidive",
    taux_definitif:        "Part définitives",
    gravite_moyenne:       "Gravité moyenne",
    gravite_mediane:       "Gravité médiane",
    age_moyen_affaire:     "Âge moyen (affaire)",
    position_spectre:      "Position spectre",
    score_moyen:           "Gravité moy.",
    nb_politiciens:        "Nb politiciens",
  };

  function labelVar(v) { return VAR_LABELS[v] || v; }

  /* ══════════════════════════════════════════════════════════
   * 1. Taux normalisés — barres horizontales comparées
   * ══════════════════════════════════════════════════════════ */

  function drawNormalizedBars(parties, metric = "taux_wikidata") {
    destroyChart("normalized-chart");
    const ctx = document.getElementById("normalized-chart")?.getContext("2d");
    if (!ctx) return;

    const data = parties
      .filter(p => p[metric] != null)
      .sort((a, b) => b[metric] - a[metric]);

    if (!data.length) {
      const el = document.getElementById("normalized-chart");
      if (el) el.parentElement.innerHTML = `<p class="text-muted" style="padding:40px;text-align:center">
        Aucune donnée disponible pour la métrique "${labelVar(metric)}".<br>
        Essayez <em>Taux Crapulopédia</em>.
      </p>`;
      return;
    }

    const labels = data.map(p => p.parti_nom_court || p.parti_nom.substring(0, 28));
    const colors = data.map(p => spectreColor(p.position_spectre));

    _instances["normalized-chart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: labelVar(metric),
          data: data.map(p => p[metric]),
          backgroundColor: colors.map(c => c + "cc"),
          borderColor: colors,
          borderWidth: 1.5,
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const d = data[ctx.dataIndex];
                const lines = [
                  `${labelVar(metric)} : ${ctx.raw?.toFixed(2)}`,
                  `Affaires : ${d.nb_affaires}`,
                  `Politiciens (Wikidata) : ${d.nb_politiciens_wikidata ?? "N/A"}`,
                  `Spectre : ${d.position_spectre?.toFixed(2) ?? "N/A"}`,
                ];
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: labelVar(metric) },
            grid: { color: "#e5e7eb" },
          },
          y: {
            ticks: { font: { size: 11 } },
          }
        }
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
   * 2. Heatmap des métriques normalisées (HTML table)
   * ══════════════════════════════════════════════════════════ */

  function drawMetricsHeatmap(parties, metrics) {
    const container = document.getElementById("metrics-heatmap");
    if (!container) return;

    const sorted = [...parties].sort((a, b) => (b.taux_wikidata ?? 0) - (a.taux_wikidata ?? 0));

    // Normalise each column 0→1 for coloring
    const ranges = {};
    metrics.forEach(m => {
      const vals = sorted.map(p => p[m]).filter(v => v != null);
      ranges[m] = { min: Math.min(...vals), max: Math.max(...vals) };
    });

    function cellColor(m, v) {
      if (v == null) return "#f3f4f6";
      const { min, max } = ranges[m];
      const t = max === min ? 0.5 : (v - min) / (max - min);
      // white → deep red
      const r = Math.round(255);
      const g = Math.round(255 * (1 - t * 0.85));
      const b = Math.round(255 * (1 - t * 0.85));
      return `rgb(${r},${g},${b})`;
    }

    const hdr = `<thead><tr>
      <th>Parti</th>
      ${metrics.map(m => `<th title="${labelVar(m)}">${labelVar(m).substring(0, 18)}</th>`).join("")}
    </tr></thead>`;

    const bdy = `<tbody>${sorted.map(p => `
      <tr>
        <td style="white-space:nowrap;font-weight:500">${esc(p.parti_nom_court || p.parti_nom.substring(0, 22))}</td>
        ${metrics.map(m => {
          const v = p[m];
          const bg = cellColor(m, v);
          const txt = v != null ? v.toFixed(2) : "—";
          return `<td style="background:${bg};text-align:right" title="${labelVar(m)}: ${txt}">${txt}</td>`;
        }).join("")}
      </tr>`).join("")}
    </tbody>`;

    container.innerHTML = `<table class="heatmap-table">${hdr}${bdy}</table>`;
  }

  /* ══════════════════════════════════════════════════════════
   * 3. Frise cumulative — lignes multi-partis
   * ══════════════════════════════════════════════════════════ */

  function drawCumulative(cumulativeData, selectedIds, metric = "rate_wikidata") {
    destroyChart("cumul-chart");
    const ctx = document.getElementById("cumul-chart")?.getContext("2d");
    if (!ctx) return;

    const partis = cumulativeData?.partis || {};
    const yearsRange = cumulativeData?.years_range || [1965, 2026];

    // Collect all years across selected parties
    const allYears = new Set();
    selectedIds.forEach(pid => {
      const serie = partis[pid]?.serie || {};
      Object.keys(serie).forEach(y => allYears.add(parseInt(y)));
    });
    const years = [...allYears].sort((a, b) => a - b);

    if (!years.length) return;

    const datasets = selectedIds.map((pid, i) => {
      const serie = partis[pid]?.serie || {};
      const color = PALETTE[i % PALETTE.length];
      const nom = partis[pid]?.parti_nom_court || partis[pid]?.parti_nom || pid;

      return {
        label: nom,
        data: years.map(y => {
          const entry = serie[y];
          return entry?.[metric] ?? null;
        }),
        borderColor: color,
        backgroundColor: color + "22",
        pointRadius: 3,
        tension: 0.3,
        spanGaps: true,
        fill: false,
        borderWidth: 2,
      };
    }).filter(d => d.data.some(v => v != null));

    if (!datasets.length) {
      document.getElementById("cumul-chart").parentElement.innerHTML =
        `<p class="text-muted" style="padding:40px;text-align:center">
          Pas de données Wikidata pour ces partis. Sélectionnez "Taux Crapulopédia".
        </p>`;
      return;
    }

    const metricLabel = metric === "rate_wikidata"
      ? "Taux cumulé (affaires / 1 000 membres Wikidata)"
      : "Taux cumulé (affaires / politiciens Crapulopédia)";

    _instances["cumul-chart"] = new Chart(ctx, {
      type: "line",
      data: { labels: years.map(String), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 14 } },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: {
            title: { display: true, text: "Année" },
            grid: { color: "#e5e7eb" },
            ticks: { maxTicksLimit: 15 },
          },
          y: {
            title: { display: true, text: metricLabel },
            beginAtZero: true,
            grid: { color: "#e5e7eb" },
          }
        }
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
   * 4. ACP Biplot — scatter + flèches de contribution
   * ══════════════════════════════════════════════════════════ */

  function drawBiplot(pcaResult, pcaData, clusterLabels) {
    destroyChart("biplot-chart");
    const canvas = document.getElementById("biplot-chart");
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const colors = clusterLabels
      ? pcaData.map((_, i) => PALETTE[clusterLabels[i] % PALETTE.length])
      : pcaData.map(d => spectreColor(d.position_spectre));

    // Plugin pour dessiner les flèches de contribution
    const arrowPlugin = {
      id: "biplotArrows",
      afterDraw(chart) {
        const { ctx: c, scales: { x, y } } = chart;
        const vars = pcaResult.variables;
        const loadings = pcaResult.loadings;

        // Échelle pour les flèches (adaptée à l'étendue des scores)
        const scoreRange = Math.max(
          ...pcaResult.scores.map(s => Math.abs(s[0])),
          ...pcaResult.scores.map(s => Math.abs(s[1]))
        );
        const arrowScale = scoreRange * 0.8;

        vars.forEach((varName, vi) => {
          const lx = loadings[0][vi] * arrowScale;
          const ly = loadings[1][vi] * arrowScale;

          const sx = x.getPixelForValue(0);
          const sy = y.getPixelForValue(0);
          const ex = x.getPixelForValue(lx);
          const ey = y.getPixelForValue(ly);

          c.save();
          c.strokeStyle = "#dc2626";
          c.lineWidth = 1.8;
          c.beginPath();
          c.moveTo(sx, sy);
          c.lineTo(ex, ey);
          c.stroke();

          // Pointe de flèche
          const angle = Math.atan2(ey - sy, ex - sx);
          const headLen = 9;
          c.beginPath();
          c.moveTo(ex, ey);
          c.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
          c.moveTo(ex, ey);
          c.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
          c.stroke();

          // Étiquette de variable
          c.fillStyle = "#dc2626";
          c.font = "bold 11px system-ui, sans-serif";
          const pad = 8;
          c.fillText(labelVar(varName), ex + Math.cos(angle) * pad, ey + Math.sin(angle) * pad - 3);
          c.restore();
        });
      }
    };

    // Étiquettes de partis (plugin)
    const labelPlugin = {
      id: "biplotLabels",
      afterDraw(chart) {
        const { ctx: c, scales: { x, y } } = chart;
        c.save();
        c.font = "10px system-ui, sans-serif";
        c.fillStyle = "#374151";
        pcaData.forEach((d, i) => {
          const px = x.getPixelForValue(pcaResult.scores[i][0]);
          const py = y.getPixelForValue(pcaResult.scores[i][1]);
          const label = d.parti_nom_court || d.parti_nom.substring(0, 10);
          c.fillText(label, px + 7, py - 4);
        });
        c.restore();
      }
    };

    _instances["biplot-chart"] = new Chart(ctx, {
      type: "scatter",
      plugins: [arrowPlugin, labelPlugin],
      data: {
        datasets: [{
          label: "Partis",
          data: pcaData.map((d, i) => ({
            x: pcaResult.scores[i][0],
            y: pcaResult.scores[i][1],
            _label: d.parti_nom_court || d.parti_nom,
          })),
          backgroundColor: colors.map(c => c + "cc"),
          borderColor: colors,
          pointRadius: 7,
          borderWidth: 1.5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.raw._label} (${ctx.raw.x.toFixed(2)}, ${ctx.raw.y.toFixed(2)})`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: `PC1 — ${(pcaResult.explainedRatio[0] * 100).toFixed(1)}% variance`,
            },
            grid: { color: "#e5e7eb" },
          },
          y: {
            title: {
              display: true,
              text: `PC2 — ${(pcaResult.explainedRatio[1] * 100).toFixed(1)}% variance`,
            },
            grid: { color: "#e5e7eb" },
          }
        }
      }
    });

    // Tableau des contributions
    const tbody = document.querySelector("#loadings-table tbody");
    if (tbody) {
      tbody.innerHTML = pcaResult.variables.map((v, i) =>
        `<tr>
          <td>${labelVar(v)}</td>
          <td>${pcaResult.loadings[0][i].toFixed(3)}</td>
          <td>${pcaResult.loadings[1][i].toFixed(3)}</td>
        </tr>`
      ).join("");
    }
  }

  /* ══════════════════════════════════════════════════════════
   * 5. Clustering — scatter PC1/PC2 + radar par groupe
   * ══════════════════════════════════════════════════════════ */

  function drawClustering(pcaResult, pcaData, labels, pcaVars) {
    destroyChart("cluster-chart");
    const ctx = document.getElementById("cluster-chart")?.getContext("2d");
    if (!ctx) return;

    const k = Math.max(...labels) + 1;
    const datasets = Array.from({ length: k }, (_, ki) => ({
      label: `Groupe ${ki + 1}`,
      data: pcaData
        .map((d, i) => labels[i] === ki ? {
          x: pcaResult.scores[i][0],
          y: pcaResult.scores[i][1],
          _label: d.parti_nom_court || d.parti_nom,
        } : null)
        .filter(Boolean),
      backgroundColor: PALETTE[ki % PALETTE.length] + "aa",
      borderColor: PALETTE[ki % PALETTE.length],
      pointRadius: 8,
      borderWidth: 2,
    }));

    _instances["cluster-chart"] = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: {
              label(ctx) { return `${ctx.raw._label} (${ctx.raw.x.toFixed(2)}, ${ctx.raw.y.toFixed(2)})`; }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: "PC1" }, grid: { color: "#e5e7eb" } },
          y: { title: { display: true, text: "PC2" }, grid: { color: "#e5e7eb" } },
        }
      }
    });

    // Fiches de groupe avec radar
    const container = document.getElementById("cluster-details");
    if (!container) return;

    // Compute group means for each variable
    const groupMeans = Array.from({ length: k }, (_, ki) => {
      const membres = pcaData.filter((_, i) => labels[i] === ki);
      const means = {};
      (pcaVars || []).forEach(v => {
        const vals = membres.map(m => m[v]).filter(x => x != null);
        means[v] = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
      });
      return { ki, membres, means };
    });

    container.innerHTML = groupMeans.map(({ ki, membres, means }) => `
      <div class="cluster-card" style="border-left:4px solid ${PALETTE[ki % PALETTE.length]}">
        <h5 style="color:${PALETTE[ki % PALETTE.length]}">Groupe ${ki + 1} — ${membres.length} parti(s)</h5>
        <div class="cluster-members">${membres.map(m => m.parti_nom_court || m.parti_nom).join(", ")}</div>
        <div class="cluster-stats">
          ${(pcaVars || []).map(v =>
            means[v] != null
              ? `<span><b>${labelVar(v)} :</b> ${means[v].toFixed(2)}</span>`
              : ""
          ).join(" · ")}
        </div>
      </div>
    `).join("");
  }

  function drawElbow(elbowData) {
    destroyChart("elbow-chart");
    const ctx = document.getElementById("elbow-chart")?.getContext("2d");
    if (!ctx) return;

    _instances["elbow-chart"] = new Chart(ctx, {
      type: "line",
      data: {
        labels: elbowData.map(d => `k=${d.k}`),
        datasets: [{
          label: "Inertie",
          data: elbowData.map(d => d.inertia),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,.12)",
          pointRadius: 5,
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Nombre de groupes (k)" } },
          y: { title: { display: true, text: "Inertie totale" }, beginAtZero: true },
        }
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
   * 6. Corrélations — table Spearman avec p-values
   * ══════════════════════════════════════════════════════════ */

  function drawCorrelations(matrix, variables) {
    const table = document.getElementById("corr-table");
    if (!table) return;

    const colorForR = r => {
      if (isNaN(r)) return "#f3f4f6";
      const a = Math.abs(r);
      return r > 0
        ? `rgba(59,130,246,${a * 0.75})`
        : `rgba(239,68,68,${a * 0.75})`;
    };

    const sig = p => p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "";
    const varLabels = variables.map(labelVar);

    const header = `<thead><tr>
      <th></th>
      ${varLabels.map(v => `<th title="${v}">${v.substring(0, 16)}</th>`).join("")}
    </tr></thead>`;

    const body = `<tbody>${matrix.map((row, i) =>
      `<tr>
        <th>${varLabels[i].substring(0, 20)}</th>
        ${row.map(cell => {
          const r = isNaN(cell.r) ? "—" : cell.r.toFixed(2);
          const star = isNaN(cell.pvalue) ? "" : sig(cell.pvalue);
          const bg = colorForR(cell.r);
          const tt = isNaN(cell.r) ? "" : `title="ρ=${cell.r.toFixed(4)}, p=${cell.pvalue?.toFixed(4)}, n=${cell.n}"`;
          return `<td style="background:${bg}" ${tt}>${r}${star}</td>`;
        }).join("")}
      </tr>`
    ).join("")}</tbody>`;

    table.innerHTML = header + body;

    // Légende
    const leg = document.getElementById("corr-legend");
    if (leg) {
      leg.innerHTML = `<small>* p&lt;0,05 &nbsp;** p&lt;0,01 &nbsp;*** p&lt;0,001 &nbsp;|
        <span style="color:#3b82f6">■ corrélation positive</span> &nbsp;
        <span style="color:#ef4444">■ corrélation négative</span></small>`;
    }
  }

  /* ══════════════════════════════════════════════════════════
   * 7. Régression linéaire
   * ══════════════════════════════════════════════════════════ */

  function drawRegression(regResult, pcaData, xVar, yVar) {
    destroyChart("regression-chart");
    const ctx = document.getElementById("regression-chart")?.getContext("2d");
    if (!ctx) return;

    const points = pcaData.map(d => ({
      x: d[xVar] ?? 0,
      y: d[yVar] ?? 0,
      _label: d.parti_nom_court || d.parti_nom,
    }));

    _instances["regression-chart"] = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Partis",
            data: points,
            backgroundColor: points.map(p => spectreColor(p.x) + "cc"),
            borderColor: points.map(p => spectreColor(p.x)),
            pointRadius: 7,
          },
          {
            label: "Régression",
            data: regResult.confBand.map(c => ({ x: c.x, y: c.y })),
            type: "line",
            borderColor: "#1d4ed8",
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
          {
            label: "IC 95%",
            data: regResult.confBand.map(c => ({ x: c.x, y: c.upper })),
            type: "line",
            borderColor: "rgba(59,130,246,.3)",
            borderWidth: 1,
            pointRadius: 0,
            fill: "+1",
            backgroundColor: "rgba(59,130,246,.1)",
            tension: 0,
          },
          {
            label: "_lower",
            data: regResult.confBand.map(c => ({ x: c.x, y: c.lower })),
            type: "line",
            borderColor: "rgba(59,130,246,.3)",
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { filter: item => item.text !== "_lower", font: { size: 12 } } },
          tooltip: {
            filter: item => item.datasetIndex === 0,
            callbacks: {
              label(ctx) { return `${ctx.raw._label} : (${ctx.raw.x?.toFixed(2)}, ${ctx.raw.y?.toFixed(2)})`; }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: labelVar(xVar) }, grid: { color: "#e5e7eb" } },
          y: { title: { display: true, text: labelVar(yVar) }, grid: { color: "#e5e7eb" } },
        }
      }
    });

    const el = document.getElementById("regression-stats");
    if (el) {
      const pf = p => p < 0.001 ? "< 0,001" : p.toFixed(4);
      el.innerHTML = `
        <div class="stat-item"><span class="label">R²</span><span class="value">${regResult.r2.toFixed(3)}</span></div>
        <div class="stat-item"><span class="label">Pente (b)</span><span class="value">${regResult.b.toFixed(4)}</span></div>
        <div class="stat-item"><span class="label">Ordonnée (a)</span><span class="value">${regResult.a.toFixed(2)}</span></div>
        <div class="stat-item"><span class="label">p-value</span><span class="value">${pf(regResult.pvalue)}</span></div>
        <div class="stat-item"><span class="label">N (partis)</span><span class="value">${regResult.n}</span></div>
        <div class="stat-item"><span class="label">Erreur standard</span><span class="value">${regResult.se.toFixed(3)}</span></div>
      `;
    }
  }

  /* ══════════════════════════════════════════════════════════
   * 8. Chronologie brute (barres empilées)
   * ══════════════════════════════════════════════════════════ */

  function drawChrono(chronoData, partiesMap, debutAn, finAn) {
    destroyChart("chrono-chart");
    const ctx = document.getElementById("chrono-chart")?.getContext("2d");
    if (!ctx) return;

    const annees = Object.keys(chronoData)
      .map(Number)
      .filter(y => y >= debutAn && y <= finAn)
      .sort();

    const totals = {};
    annees.forEach(y => {
      Object.entries(chronoData[y] || {}).forEach(([pid, n]) => {
        totals[pid] = (totals[pid] || 0) + n;
      });
    });
    const top7 = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(e => e[0]);

    const datasets = [
      ...top7.map((pid, idx) => ({
        label: partiesMap[pid]?.parti_nom_court || partiesMap[pid]?.parti_nom || pid,
        data: annees.map(y => (chronoData[y] || {})[pid] || 0),
        backgroundColor: PALETTE[idx % PALETTE.length] + "cc",
        borderColor: PALETTE[idx % PALETTE.length],
        borderWidth: 1,
        fill: true,
      })),
      {
        label: "Autres",
        data: annees.map(y => {
          const all = Object.entries(chronoData[y] || {});
          return all.filter(([pid]) => !top7.includes(pid)).reduce((s, [, n]) => s + n, 0);
        }),
        backgroundColor: "rgba(148,163,184,.5)",
        borderColor: "#94a3b8",
        borderWidth: 1,
        fill: true,
      }
    ];

    _instances["chrono-chart"] = new Chart(ctx, {
      type: "bar",
      data: { labels: annees.map(String), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: {
          x: { stacked: true, title: { display: true, text: "Année" } },
          y: { stacked: true, title: { display: true, text: "Nombre d'affaires" }, beginAtZero: true },
        }
      }
    });
  }

  /* ── Utilitaire HTML-escape ───────────────────────────── */

  function esc(s) {
    if (!s && s !== 0) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── API publique ──────────────────────────────────────── */

  return {
    drawNormalizedBars,
    drawMetricsHeatmap,
    drawCumulative,
    drawBiplot,
    drawClustering,
    drawElbow,
    drawCorrelations,
    drawRegression,
    drawChrono,
    spectreColor,
    labelVar,
  };

})();
