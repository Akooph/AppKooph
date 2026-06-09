/**
 * charts.js — Construction des graphiques Chart.js
 * Vue d'ensemble (bulles), par parti (barres), chronologie, ACP, clustering, régression
 */

const Charts = (() => {

  /* ── Palette de couleurs pour les partis ─────────────────── */

  const PALETTE = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
    "#14b8a6", "#a855f7", "#d946ef", "#0ea5e9", "#78716c",
  ];

  function partisColors(partis) {
    const map = {};
    partis.forEach((p, i) => { map[p] = PALETTE[i % PALETTE.length]; });
    return map;
  }

  /* Couleur selon position spectre */
  function spectreColor(pos) {
    if (pos == null) return "#94a3b8";
    if (pos < -2) return "#3b82f6";
    if (pos < -0.5) return "#6366f1";
    if (pos < 0.5) return "#8b5cf6";
    if (pos < 2) return "#f97316";
    return "#ef4444";
  }

  /* Couleur verdict */
  function verdictColor(statut) {
    const map = {
      definitif: "rgba(21,128,61,.8)",
      appel: "rgba(217,119,6,.8)",
      cassation: "rgba(124,58,237,.8)",
      inconnu: "rgba(156,163,175,.6)",
    };
    return map[statut] || map.inconnu;
  }

  /* Registre des instances Chart.js */
  const _instances = {};
  function destroyChart(id) {
    if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }
  }

  /* ── 1. Graphique à bulles ──────────────────────────────── */

  function drawBubble(parties, filtres) {
    destroyChart("bubble-chart");
    const ctx = document.getElementById("bubble-chart")?.getContext("2d");
    if (!ctx) return;

    const data = parties
      .filter(p => p.position_spectre != null)
      .sort((a, b) => a.position_spectre - b.position_spectre);

    const maxScore = Math.max(...data.map(p => p.score_moyen || 0), 1);
    const maxPol = Math.max(...data.map(p => p.total_actuel || p.nb_politiciens || 1), 1);

    const datasets = [data.map(p => ({
      x: p.position_spectre,
      y: p.nb_affaires,
      r: Math.max(6, Math.sqrt((p.total_actuel || p.nb_politiciens || 2) / maxPol) * 40),
      _data: p,
    }))];

    _instances["bubble-chart"] = new Chart(ctx, {
      type: "bubble",
      data: {
        datasets: [{
          label: "Partis",
          data: datasets[0],
          backgroundColor: datasets[0].map(d => spectreColor(d.x) + "cc"),
          borderColor: datasets[0].map(d => spectreColor(d.x)),
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
                const d = ctx.raw._data;
                const taux = d.taux_actuel != null
                  ? ` · Taux actuel : ${(d.taux_actuel * 100).toFixed(1)}%`
                  : "";
                const total = d.total_actuel ? ` (${d.total_actuel} élus actuels)` : "";
                return [
                  d.parti_nom,
                  `${d.nb_affaires} affaire(s)${total}${taux}`,
                  `Gravité moy. : ${d.score_moyen?.toFixed(1) ?? "N/A"}`,
                  `Spectre : ${d.position_spectre?.toFixed(2)}`,
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "Position sur le spectre politique (← Gauche · Droite →)" },
            grid: { color: "#e5e7eb" },
          },
          y: {
            title: { display: true, text: "Nombre d'affaires" },
            beginAtZero: true,
            grid: { color: "#e5e7eb" },
          }
        }
      }
    });
  }

  /* ── 2. Graphique en barres horizontales ─────────────────── */

  function drawBars(parties) {
    destroyChart("bar-chart");
    const ctx = document.getElementById("bar-chart")?.getContext("2d");
    if (!ctx) return;

    const sorted = [...parties].sort((a, b) => b.nb_affaires - a.nb_affaires);
    const labels = sorted.map(p =>
      p.parti_nom_court || p.parti_nom.substring(0, 30)
    );

    // Affichage des labels avec taux si disponible
    const labelsRich = sorted.map(p => {
      const suffix = p.taux_actuel != null
        ? ` (${(p.taux_actuel * 100).toFixed(1)}%)`
        : p.total_actuel ? ` [${p.total_actuel} élus]` : "";
      return (p.parti_nom_court || p.parti_nom.substring(0, 25)) + suffix;
    });

    _instances["bar-chart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labelsRich,
        datasets: [
          {
            label: "Définitif",
            data: sorted.map(p => p.nb_affaires_definitif || 0),
            backgroundColor: "rgba(21,128,61,.85)",
          },
          {
            label: "En appel / cassation",
            data: sorted.map(p =>
              (p.nb_affaires || 0) - (p.nb_affaires_definitif || 0)
            ),
            backgroundColor: "rgba(217,119,6,.7)",
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              afterBody(ctx) {
                const d = sorted[ctx[0].dataIndex];
                const taux = d.taux_actuel != null
                  ? `Taux : ${(d.taux_actuel * 100).toFixed(1)}% des ${d.total_actuel} élus actuels`
                  : "Période historique (taux non calculable)";
                return [`Politiciens distincts : ${d.nb_politiciens}`, taux];
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            title: { display: true, text: "Nombre d'affaires" },
            grid: { color: "#e5e7eb" },
          },
          y: {
            stacked: true,
            ticks: { font: { size: 11 } },
          }
        }
      }
    });
  }

  /* ── 3. Chronologie ─────────────────────────────────────── */

  function drawChrono(chronoData, partiesMap, debutAn, finAn) {
    destroyChart("chrono-chart");
    const ctx = document.getElementById("chrono-chart")?.getContext("2d");
    if (!ctx) return;

    const annees = Object.keys(chronoData)
      .map(Number)
      .filter(y => y >= debutAn && y <= finAn)
      .sort();

    // Top 7 partis par nb total d'affaires sur la période
    const totals = {};
    annees.forEach(y => {
      Object.entries(chronoData[y] || {}).forEach(([pid, n]) => {
        totals[pid] = (totals[pid] || 0) + n;
      });
    });
    const top7 = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(e => e[0]);

    const colors = partisColors(top7);

    const datasets = [
      ...top7.map(pid => ({
        label: partiesMap[pid]?.parti_nom_court || partiesMap[pid]?.parti_nom || pid,
        data: annees.map(y => (chronoData[y] || {})[pid] || 0),
        backgroundColor: colors[pid] + "cc",
        borderColor: colors[pid],
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
        plugins: {
          legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12 } },
        },
        scales: {
          x: { stacked: true, title: { display: true, text: "Année" } },
          y: { stacked: true, title: { display: true, text: "Nombre d'affaires" }, beginAtZero: true },
        }
      }
    });
  }

  /* ── 4. ACP ──────────────────────────────────────────────── */

  function drawACP(pcaResult, pcaData, clusterLabels) {
    destroyChart("acp-chart");
    const ctx = document.getElementById("acp-chart")?.getContext("2d");
    if (!ctx) return;

    const colors = PALETTE;
    const datasets = clusterLabels
      ? groupBy(pcaData.map((d, i) => ({ d, i })), item => clusterLabels[item.i]).map((group, ki) => ({
          label: `Groupe ${ki + 1}`,
          data: group.map(item => ({
            x: pcaResult.scores[item.i][0],
            y: pcaResult.scores[item.i][1],
            _label: pcaData[item.i].parti_nom_court || pcaData[item.i].parti_nom,
          })),
          backgroundColor: colors[ki % colors.length] + "aa",
          borderColor: colors[ki % colors.length],
          pointRadius: 8,
          borderWidth: 2,
        }))
      : [{
          label: "Partis",
          data: pcaData.map((d, i) => ({
            x: pcaResult.scores[i][0],
            y: pcaResult.scores[i][1],
            _label: d.parti_nom_court || d.parti_nom,
          })),
          backgroundColor: pcaData.map(d => spectreColor(d.position_spectre) + "aa"),
          borderColor: pcaData.map(d => spectreColor(d.position_spectre)),
          pointRadius: 8,
          borderWidth: 2,
        }];

    _instances["acp-chart"] = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label(ctx) {
                const d = ctx.raw;
                return `${d._label} (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: `PC1 (${(pcaResult.explainedRatio[0] * 100).toFixed(1)}% de variance)`,
            },
            grid: { color: "#e5e7eb" },
          },
          y: {
            title: {
              display: true,
              text: `PC2 (${(pcaResult.explainedRatio[1] * 100).toFixed(1)}% de variance)`,
            },
            grid: { color: "#e5e7eb" },
          }
        }
      }
    });

    // Mise à jour du tableau des loadings
    const tbody = document.querySelector("#loadings-table tbody");
    if (tbody) {
      tbody.innerHTML = pcaResult.variables.map((v, i) =>
        `<tr><td>${labelVar(v)}</td><td>${pcaResult.loadings[0][i].toFixed(3)}</td><td>${pcaResult.loadings[1][i].toFixed(3)}</td></tr>`
      ).join("");
    }
    const vi = document.getElementById("variance-info");
    if (vi) {
      vi.textContent = `Variance expliquée : PC1=${(pcaResult.explainedRatio[0]*100).toFixed(1)}%, PC2=${(pcaResult.explainedRatio[1]*100).toFixed(1)}%`;
    }
  }

  /* ── 5. Clustering (scatter sur PC1/PC2) ─────────────────── */

  function drawClustering(pcaResult, pcaData, labels) {
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
          _d: d,
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
          tooltip: {
            callbacks: {
              label(ctx) {
                const d = ctx.raw;
                return `${d._label} (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`;
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: "PC1" }, grid: { color: "#e5e7eb" } },
          y: { title: { display: true, text: "PC2" }, grid: { color: "#e5e7eb" } },
        }
      }
    });

    // Fiches de groupes
    const container = document.getElementById("cluster-details");
    if (container) {
      container.innerHTML = Array.from({ length: k }, (_, ki) => {
        const membres = pcaData.filter((_, i) => labels[i] === ki);
        return `<div class="cluster-card" style="border-left:4px solid ${PALETTE[ki % PALETTE.length]}">
          <h5 style="color:${PALETTE[ki % PALETTE.length]}">Groupe ${ki + 1} (${membres.length} partis)</h5>
          <div>${membres.map(m => m.parti_nom_court || m.parti_nom).join(", ")}</div>
          <div class="text-muted small" style="margin-top:6px">
            Moy. affaires : ${(membres.reduce((s, m) => s + m.nb_affaires, 0) / membres.length).toFixed(1)} ·
            Gravité : ${(membres.reduce((s, m) => s + m.score_moyen, 0) / membres.length).toFixed(1)}
          </div>
        </div>`;
      }).join("");
    }
  }

  /* ── 5b. Méthode du coude ────────────────────────────────── */

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
          backgroundColor: "rgba(59,130,246,.15)",
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

  /* ── 6. Corrélations ─────────────────────────────────────── */

  function drawCorrelations(matrix, variables) {
    const table = document.getElementById("corr-table");
    if (!table) return;

    const colorForR = r => {
      if (isNaN(r)) return "#f3f4f6";
      const a = Math.abs(r);
      if (r > 0) return `rgba(59,130,246,${a * 0.7})`;
      return `rgba(239,68,68,${a * 0.7})`;
    };

    const sigStar = p => p < 0.01 ? "**" : p < 0.05 ? "*" : "";
    const varLabels = variables.map(labelVar);

    const header = `<thead><tr><th></th>${varLabels.map(v => `<th>${v}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${matrix.map((row, i) =>
      `<tr><th>${varLabels[i]}</th>${row.map(cell => {
        const r = isNaN(cell.r) ? "—" : cell.r.toFixed(2);
        const star = isNaN(cell.pvalue) ? "" : sigStar(cell.pvalue);
        const bg = colorForR(cell.r);
        const title = isNaN(cell.r) ? "" : `title="r=${cell.r.toFixed(4)}, p=${cell.pvalue.toFixed(4)}, n=${cell.n}"`;
        return `<td style="background:${bg}" ${title}>${r}${star}</td>`;
      }).join("")}</tr>`
    ).join("")}</tbody>`;

    table.innerHTML = header + body;
  }

  /* ── 7. Régression ───────────────────────────────────────── */

  function drawRegression(regResult, pcaData, xVar, yVar) {
    destroyChart("regression-chart");
    const ctx = document.getElementById("regression-chart")?.getContext("2d");
    if (!ctx) return;

    const points = pcaData.map(d => ({
      x: d[xVar] ?? 0,
      y: d[yVar] ?? 0,
      _label: d.parti_nom_court || d.parti_nom,
    }));

    const lineData = regResult.confBand.map(c => ({ x: c.x, y: c.y }));
    const upperData = regResult.confBand.map(c => ({ x: c.x, y: c.upper }));
    const lowerData = regResult.confBand.map(c => ({ x: c.x, y: c.lower }));

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
            type: "scatter",
          },
          {
            label: "Régression",
            data: lineData,
            type: "line",
            borderColor: "#1d4ed8",
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
          {
            label: "IC 95%",
            data: upperData,
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
            data: lowerData,
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
          legend: {
            labels: {
              filter: item => item.text !== "_lower",
              font: { size: 12 },
            }
          },
          tooltip: {
            filter: item => item.datasetIndex === 0,
            callbacks: {
              label(ctx) {
                const d = ctx.raw;
                return `${d._label} : (${d.x?.toFixed(2)}, ${d.y})`;
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: labelVar(xVar) }, grid: { color: "#e5e7eb" } },
          y: { title: { display: true, text: labelVar(yVar) }, grid: { color: "#e5e7eb" } },
        }
      }
    });

    // Stats bloc
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

  /* ── Utilitaires ─────────────────────────────────────────── */

  function labelVar(v) {
    const labels = {
      nb_affaires: "Nb affaires",
      nb_affaires_definitif: "Affaires définitives",
      nb_politiciens: "Nb politiciens",
      score_moyen: "Gravité moy.",
      position_spectre: "Spectre politique",
      taux_actuel: "Taux actuel",
    };
    return labels[v] || v;
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    arr.forEach(item => {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return [...map.values()];
  }

  return { drawBubble, drawBars, drawChrono, drawACP, drawClustering, drawElbow, drawCorrelations, drawRegression, spectreColor };

})();
