/**
 * app.js — Orchestration principale v2
 * Chargement des données normalisées, navigation, analyses statistiques formelles
 */

/* ── État global ─────────────────────────────────────────── */

const AppState = {
  // Données brutes
  affairs: [],
  parties: [],         // métriques normalisées (depuis parties.json)
  cumulative: null,    // frise cumulative (depuis cumulative.json)
  stats: null,

  // Analyses
  pcaVars: ["taux_wikidata", "taux_recidive", "taux_definitif", "gravite_moyenne", "position_spectre"],
  pcaData: [],
  acpResult: null,
  clusterLabels: null,
  corrVars: ["taux_wikidata", "taux_crapu", "taux_par_carriere", "taux_recidive", "taux_definitif", "gravite_moyenne", "position_spectre"],

  // Métriques affichées
  currentMetric: "taux_wikidata",
  cumulMetric: "rate_wikidata",
  selectedCumulParties: [],

  // Régression
  regXVar: "position_spectre",
  regYVar: "taux_wikidata",

  // Tableau
  tableSort: { col: "annee", dir: -1 },
  tablePage: 0,
  PAGE_SIZE: 30,
  tableFilteredAffaires: [],
};

/* ── Chargement ──────────────────────────────────────────── */

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Erreur chargement ${path}: ${r.status}`);
  return r.json();
}

async function init() {
  try {
    const [affairs, parties, cumulative, stats] = await Promise.all([
      loadJSON("data/affairs.json"),
      loadJSON("data/parties.json"),
      loadJSON("data/cumulative.json"),
      loadJSON("data/stats.json"),
    ]);

    AppState.affairs = affairs;
    AppState.parties = parties;
    AppState.cumulative = cumulative;
    AppState.stats = stats;

    // Date de génération
    const elDate = document.getElementById("date-generation");
    if (elDate && stats.meta?.date_generation) {
      elDate.textContent = new Date(stats.meta.date_generation).toLocaleString("fr-FR");
    }
    const elMeta = document.getElementById("meta-info");
    if (elMeta && stats.meta) {
      elMeta.innerHTML = `<em>Données générées le ${new Date(stats.meta.date_generation).toLocaleString("fr-FR")} —
        ${stats.meta.nb_affaires_total} affaires (${stats.meta.nb_affaires_definitif} définitives) ·
        ${stats.meta.nb_politiciens} politiciens · ${stats.meta.nb_partis} partis ·
        ${stats.meta.nb_avec_wikidata} partis avec données Wikidata</em>`;
    }

    // Données PCA (partis avec assez de métriques)
    AppState.pcaData = parties.filter(p =>
      p.taux_wikidata != null && p.position_spectre != null
    );

    // Pré-sélection des top partis pour la frise cumulative
    const topPids = Object.entries(cumulative.partis || {})
      .sort((a, b) => {
        const lastA = Object.values(a[1].serie || {}).slice(-1)[0];
        const lastB = Object.values(b[1].serie || {}).slice(-1)[0];
        return (lastB?.rate_wikidata ?? 0) - (lastA?.rate_wikidata ?? 0);
      })
      .slice(0, 7)
      .map(e => e[0]);
    AppState.selectedCumulParties = topPids;

    // Remplir le filtre parti du tableau
    populatePartiSelect(parties);

    // Initialiser l'interface
    initNav();
    initMetricSelector();
    initCumulativeSelector();
    initPCAVarCheckboxes();
    initRegressionSelectors();
    initStatistiques();
    initTableau();
    initModalMethodologie();
    initHeatmapToggle();
    Export.initButtons(AppState);

    // Afficher l'onglet actif
    renderTaux();

  } catch (e) {
    console.error("Erreur chargement :", e);
    document.body.innerHTML = `<div style="padding:40px;color:#dc2626">
      <h2>Erreur de chargement des données</h2>
      <p>Vérifiez que le pipeline a été exécuté : <code>python data/scripts/process.py</code></p>
      <pre>${esc(e.message)}</pre>
    </div>`;
  }
}

/* ── Navigation ─────────────────────────────────────────── */

let activeTab = "taux";

function initNav() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tab}`));
  refreshActiveTab();
}

function refreshActiveTab() {
  switch (activeTab) {
    case "taux":         renderTaux(); break;
    case "evolution":    renderEvolution(); break;
    case "statistiques": refreshSubTab(); break;
    case "tableau":      renderTableau(); break;
  }
}

/* ── Sélecteur de métrique ──────────────────────────────── */

function initMetricSelector() {
  document.getElementById("toggle-metric")?.addEventListener("click", e => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#toggle-metric .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    AppState.currentMetric = btn.dataset.val;
    renderTaux();
  });
}

/* ── Onglet 1 : Taux normalisés ─────────────────────────── */

function renderTaux() {
  const metric = AppState.currentMetric;
  Charts.drawNormalizedBars(AppState.parties, metric);
  renderKPIs();

  // Heatmap si visible
  if (document.getElementById("heatmap-section").style.display !== "none") {
    renderHeatmap();
  }
}

function renderKPIs() {
  const el = document.getElementById("kpi-row");
  if (!el) return;

  const p = AppState.parties;
  const withWd = p.filter(x => x.taux_wikidata != null);
  const nbTotal = AppState.stats?.meta?.nb_affaires_total ?? p.reduce((s, x) => s + x.nb_affaires, 0);
  const nbDef = AppState.stats?.meta?.nb_affaires_definitif ?? p.reduce((s, x) => s + x.nb_affaires_definitif, 0);
  const topWd = withWd.length ? [...withWd].sort((a, b) => b.taux_wikidata - a.taux_wikidata)[0] : null;
  const topRec = [...p].sort((a, b) => b.taux_recidive - a.taux_recidive)[0];

  el.innerHTML = [
    { label: "Affaires totales", val: nbTotal, sub: `dont ${nbDef} définitives` },
    { label: "Partis couverts", val: p.length, sub: `${withWd.length} avec données Wikidata` },
    { label: "Taux Wikidata max", val: topWd ? topWd.taux_wikidata.toFixed(1) + "‰" : "N/A",
      sub: topWd ? topWd.parti_nom_court || topWd.parti_nom : "" },
    { label: "Récidive la plus haute", val: topRec ? (topRec.taux_recidive * 100).toFixed(0) + "%" : "N/A",
      sub: topRec ? topRec.parti_nom_court || topRec.parti_nom : "" },
  ].map(({ label, val, sub }) => `
    <div class="kpi-card">
      <div class="kpi-value">${val}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-sub">${sub}</div>
    </div>
  `).join("");
}

function renderHeatmap() {
  const metrics = [
    "taux_wikidata", "taux_crapu", "taux_par_carriere",
    "taux_recidive", "taux_definitif", "gravite_moyenne", "age_moyen_affaire"
  ];
  Charts.drawMetricsHeatmap(AppState.parties, metrics);
}

function initHeatmapToggle() {
  document.getElementById("btn-toggle-heatmap")?.addEventListener("click", () => {
    const section = document.getElementById("heatmap-section");
    const btn = document.getElementById("btn-toggle-heatmap");
    const hidden = section.style.display === "none";
    section.style.display = hidden ? "block" : "none";
    btn.textContent = hidden ? "Masquer la heatmap" : "Afficher la heatmap complète des métriques";
    if (hidden) renderHeatmap();
  });
}

/* ── Onglet 2 : Évolution temporelle ────────────────────── */

function initCumulativeSelector() {
  const container = document.getElementById("party-checkboxes");
  if (!container) return;

  const partis = AppState.cumulative?.partis || {};
  const sorted = Object.entries(partis).sort((a, b) => {
    const va = Object.values(a[1].serie).slice(-1)[0]?.rate_wikidata ?? 0;
    const vb = Object.values(b[1].serie).slice(-1)[0]?.rate_wikidata ?? 0;
    return vb - va;
  });

  container.innerHTML = sorted.map(([pid, data]) => {
    const checked = AppState.selectedCumulParties.includes(pid);
    return `<label class="party-checkbox-label">
      <input type="checkbox" value="${esc(pid)}" ${checked ? "checked" : ""} />
      ${esc(data.parti_nom_court || data.parti_nom)}
    </label>`;
  }).join("");

  container.addEventListener("change", () => {
    AppState.selectedCumulParties = [...container.querySelectorAll("input:checked")].map(i => i.value);
    if (activeTab === "evolution") renderEvolution();
  });

  document.getElementById("toggle-cumul-metric")?.addEventListener("click", e => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#toggle-cumul-metric .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    AppState.cumulMetric = btn.dataset.val;
    if (activeTab === "evolution") renderEvolution();
  });
}

function renderEvolution() {
  Charts.drawCumulative(AppState.cumulative, AppState.selectedCumulParties, AppState.cumulMetric);
}

/* ── Onglet 3 : Analyses statistiques ───────────────────── */

let activeSubTab = "tests";

function initStatistiques() {
  document.querySelectorAll(".sub-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubTab = btn.dataset.subtab;
      document.querySelectorAll(".sub-tab").forEach(b =>
        b.classList.toggle("active", b.dataset.subtab === activeSubTab));
      document.querySelectorAll(".sub-panel").forEach(p =>
        p.classList.toggle("active", p.id === `subtab-${activeSubTab}`));
      refreshSubTab();
    });
  });

  document.getElementById("k-slider")?.addEventListener("input", e => {
    document.getElementById("k-label").textContent = e.target.value;
    if (activeSubTab === "clustering") runClustering(parseInt(e.target.value));
  });

  document.getElementById("btn-run-reg")?.addEventListener("click", runRegression);
}

function refreshSubTab() {
  if (AppState.pcaData.length < 3) return;
  switch (activeSubTab) {
    case "tests":        runHypothesisTests(); break;
    case "biplot":       runBiplot(); break;
    case "clustering":   runClustering(parseInt(document.getElementById("k-slider")?.value || 3)); break;
    case "correlations": runCorrelations(); break;
    case "regression":   runRegression(); break;
  }
}

/* ── Tests d'hypothèses formels ─────────────────────────── */

function runHypothesisTests() {
  const container = document.getElementById("hypothesis-tests-container");
  if (!container) return;

  const p = AppState.pcaData;
  if (p.length < 4) {
    container.innerHTML = `<p class="text-muted">Données insuffisantes pour les tests statistiques.</p>`;
    return;
  }

  const tests = [];

  // Test 1 : Spearman entre spectre politique et taux Wikidata
  const withWd = p.filter(x => x.taux_wikidata != null && x.position_spectre != null);
  if (withWd.length >= 5) {
    const x1 = withWd.map(d => d.position_spectre);
    const y1 = withWd.map(d => d.taux_wikidata);
    const res = Stats.spearman(x1, y1);
    tests.push({
      titre: "Corrélation spectre politique ↔ taux Wikidata",
      H0: "Il n'existe pas de corrélation entre la position sur le spectre politique et le taux d'affaires normalisé (Wikidata).",
      H1: "Il existe une corrélation significative entre ces deux variables.",
      test: `Corrélation de Spearman (ρ)`,
      stat: `ρ = ${res.r.toFixed(3)}`,
      pvalue: res.pvalue,
      n: res.n,
      conclusion: conclu(res.pvalue, res.r, "corrélation positive", "corrélation négative"),
      note: "Test non-paramétrique sur les rangs — adapté aux distributions asymétriques.",
    });
  }

  // Test 2 : Spearman entre taux wikidata et gravité moyenne
  const withGrav = p.filter(x => x.taux_wikidata != null && x.gravite_moyenne != null);
  if (withGrav.length >= 5) {
    const x2 = withGrav.map(d => d.taux_wikidata);
    const y2 = withGrav.map(d => d.gravite_moyenne);
    const res = Stats.spearman(x2, y2);
    tests.push({
      titre: "Corrélation taux Wikidata ↔ gravité moyenne",
      H0: "Il n'existe pas de corrélation entre le taux d'affaires normalisé et la gravité moyenne des condamnations.",
      H1: "Il existe une corrélation significative.",
      test: "Corrélation de Spearman (ρ)",
      stat: `ρ = ${res.r.toFixed(3)}`,
      pvalue: res.pvalue,
      n: res.n,
      conclusion: conclu(res.pvalue, res.r,
        "les partis avec plus d'affaires tendent vers une gravité plus élevée",
        "les partis avec plus d'affaires tendent vers une gravité plus faible"),
      note: "Attention : petits effectifs. Vérifier les valeurs extrêmes.",
    });
  }

  // Test 3 : Mann-Whitney — gauche (<0) vs droite (>0) sur taux Wikidata
  const gauche = p.filter(x => x.position_spectre != null && x.position_spectre < -0.1 && x.taux_wikidata != null)
                  .map(d => d.taux_wikidata);
  const droite = p.filter(x => x.position_spectre != null && x.position_spectre > 0.1 && x.taux_wikidata != null)
                  .map(d => d.taux_wikidata);
  if (gauche.length >= 3 && droite.length >= 3) {
    const res = Stats.mannWhitney(gauche, droite);
    const medG = median(gauche).toFixed(1), medD = median(droite).toFixed(1);
    tests.push({
      titre: "Comparaison gauche vs droite — Taux Wikidata",
      H0: `Les partis de gauche (${gauche.length}) et de droite (${droite.length}) ont la même distribution de taux d'affaires.`,
      H1: "Les deux groupes ont des distributions différentes.",
      test: "Mann-Whitney U (test non-paramétrique à deux échantillons indépendants)",
      stat: `U = ${res.U?.toFixed(0) ?? "N/A"}, z = ${res.z?.toFixed(3) ?? "N/A"}`,
      pvalue: res.pvalue,
      n: `gauche n=${gauche.length}, droite n=${droite.length}`,
      conclusion: concluMW(res.pvalue, medG, medD),
      note: `Médiane taux Wikidata — gauche : ${medG}‰, droite : ${medD}‰. Seuil position spectre : ±0,1.`,
    });
  }

  // Test 4 : Kruskal-Wallis — comparaison entre 5 groupes spectre
  const groups = [
    p.filter(x => x.position_spectre != null && x.position_spectre <= -0.5 && x.taux_wikidata != null),
    p.filter(x => x.position_spectre != null && x.position_spectre > -0.5 && x.position_spectre <= -0.1 && x.taux_wikidata != null),
    p.filter(x => x.position_spectre != null && x.position_spectre > -0.1 && x.position_spectre <= 0.1 && x.taux_wikidata != null),
    p.filter(x => x.position_spectre != null && x.position_spectre > 0.1 && x.position_spectre <= 0.5 && x.taux_wikidata != null),
    p.filter(x => x.position_spectre != null && x.position_spectre > 0.5 && x.taux_wikidata != null),
  ].filter(g => g.length >= 2).map(g => g.map(d => d.taux_wikidata));

  const groupLabels = ["Gauche (< −0,5)", "Centre-gauche (−0,5 à −0,1)", "Centre (−0,1 à 0,1)", "Centre-droit (0,1 à 0,5)", "Droite (> 0,5)"];

  if (groups.length >= 3) {
    const res = Stats.kruskalWallis(groups);
    tests.push({
      titre: "Différences entre segments du spectre politique — Taux Wikidata",
      H0: `Les ${groups.length} segments du spectre politique ont la même distribution de taux d'affaires normalisé.`,
      H1: "Au moins un segment a une distribution différente.",
      test: `Kruskal-Wallis H (${groups.length} groupes, df = ${res.df})`,
      stat: `H = ${res.H?.toFixed(3) ?? "N/A"}`,
      pvalue: res.pvalue,
      n: groups.map((g, i) => `${groupLabels[i]} : n=${g.length}`).join(", "),
      conclusion: concluKW(res.pvalue, groups.length),
      note: "Tailles de groupes très inégales — interpréter avec prudence. Test post-hoc non réalisé.",
    });
  }

  // Test 5 : Spearman taux_recidive ↔ gravite_moyenne
  const withRec = p.filter(x => x.taux_recidive != null && x.gravite_moyenne != null);
  if (withRec.length >= 5) {
    const x5 = withRec.map(d => d.taux_recidive);
    const y5 = withRec.map(d => d.gravite_moyenne);
    const res = Stats.spearman(x5, y5);
    tests.push({
      titre: "Corrélation récidive ↔ gravité moyenne",
      H0: "Il n'existe pas de corrélation entre le taux de récidive et la gravité moyenne des affaires.",
      H1: "Il existe une corrélation significative.",
      test: "Corrélation de Spearman (ρ)",
      stat: `ρ = ${res.r.toFixed(3)}`,
      pvalue: res.pvalue,
      n: res.n,
      conclusion: conclu(res.pvalue, res.r,
        "les partis à forte récidive ont tendance à avoir des affaires plus graves",
        "les partis à forte récidive ont tendance à avoir des affaires moins graves"),
      note: "Attention à la construction circulaire du taux de récidive (dénominateur issu de Crapulopédia).",
    });
  }

  container.innerHTML = tests.map(t => renderTestCard(t)).join("");
}

function renderTestCard(t) {
  const sigClass = t.pvalue < 0.05 ? "test-sig" : "test-ns";
  const sigLabel = t.pvalue < 0.001 ? "p < 0,001 ***"
    : t.pvalue < 0.01  ? `p = ${t.pvalue.toFixed(4)} **`
    : t.pvalue < 0.05  ? `p = ${t.pvalue.toFixed(4)} *`
    : isNaN(t.pvalue)  ? "p = N/A"
    : `p = ${t.pvalue.toFixed(4)} (ns)`;

  return `
  <div class="test-card ${sigClass}">
    <h4>${esc(t.titre)}</h4>
    <table class="test-table">
      <tr><th>H₀</th><td>${esc(t.H0)}</td></tr>
      <tr><th>H₁</th><td>${esc(t.H1)}</td></tr>
      <tr><th>Test</th><td>${esc(t.test)}</td></tr>
      <tr><th>Statistique</th><td><code>${esc(t.stat)}</code></td></tr>
      <tr><th>p-value</th><td><strong class="${sigClass}-text">${sigLabel}</strong></td></tr>
      <tr><th>n</th><td>${esc(String(t.n))}</td></tr>
      <tr><th>Conclusion</th><td>${esc(t.conclusion)}</td></tr>
      ${t.note ? `<tr><th>Note</th><td class="text-muted small">${esc(t.note)}</td></tr>` : ""}
    </table>
  </div>`;
}

function conclu(pvalue, r, posLabel, negLabel) {
  if (isNaN(pvalue)) return "Impossible à calculer (données insuffisantes).";
  const dir = r > 0 ? posLabel : negLabel;
  if (pvalue < 0.05) {
    return `On rejette H₀ (α = 0,05). La corrélation est statistiquement significative (${dir}, ρ = ${r.toFixed(2)}).`;
  }
  return `On ne rejette pas H₀ (α = 0,05). La corrélation n'est pas statistiquement significative (ρ = ${r.toFixed(2)}).`;
}

function concluMW(pvalue, medG, medD) {
  if (isNaN(pvalue)) return "Impossible à calculer (données insuffisantes).";
  if (pvalue < 0.05) {
    const diff = parseFloat(medG) > parseFloat(medD) ? "gauche > droite" : "droite > gauche";
    return `On rejette H₀. La différence est statistiquement significative (${diff}, p = ${pvalue.toFixed(4)}).`;
  }
  return `On ne rejette pas H₀. Aucune différence significative entre gauche et droite (p = ${pvalue.toFixed(4)}).`;
}

function concluKW(pvalue, k) {
  if (isNaN(pvalue)) return "Impossible à calculer.";
  if (pvalue < 0.05) {
    return `On rejette H₀. Au moins un segment du spectre a une distribution significativement différente (p = ${pvalue.toFixed(4)}). Un test post-hoc serait nécessaire pour identifier le(s) groupe(s) différent(s).`;
  }
  return `On ne rejette pas H₀. Aucune différence significative entre les ${k} segments (p = ${pvalue.toFixed(4)}).`;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── Checkboxes variables PCA ────────────────────────────── */

function initPCAVarCheckboxes() {
  const container = document.getElementById("pca-var-checkboxes");
  if (!container) return;

  const available = [
    "taux_wikidata", "taux_crapu", "taux_par_carriere",
    "taux_recidive", "taux_definitif", "gravite_moyenne",
    "age_moyen_affaire", "position_spectre",
  ];

  container.innerHTML = available.map(v => `
    <label class="var-checkbox-label">
      <input type="checkbox" value="${v}" ${AppState.pcaVars.includes(v) ? "checked" : ""} />
      ${esc(Charts.labelVar(v))}
    </label>
  `).join("");

  container.addEventListener("change", () => {
    AppState.pcaVars = [...container.querySelectorAll("input:checked")].map(i => i.value);
    if (activeTab === "statistiques" && activeSubTab === "biplot") runBiplot();
    if (activeTab === "statistiques" && activeSubTab === "clustering") runClustering(3);
  });
}

/* ── ACP / Biplot ────────────────────────────────────────── */

function runBiplot() {
  const vars = AppState.pcaVars;
  const data = AppState.pcaData.filter(p => vars.every(v => p[v] != null));
  if (data.length < 3) {
    document.getElementById("biplot-container").innerHTML =
      `<p class="text-muted" style="padding:40px;text-align:center">Données insuffisantes (${data.length} partis avec toutes les variables sélectionnées).</p>`;
    return;
  }

  const result = Stats.pca(data, vars);
  AppState.acpResult = result;
  AppState.pcaData = data;
  Charts.drawBiplot(result, data, AppState.clusterLabels);

  const vi = document.getElementById("variance-info");
  if (vi) {
    vi.textContent = `Variance expliquée — PC1 : ${(result.explainedRatio[0] * 100).toFixed(1)}%, PC2 : ${(result.explainedRatio[1] * 100).toFixed(1)}%`;
  }
}

/* ── Classification ──────────────────────────────────────── */

function runClustering(k) {
  const vars = AppState.pcaVars;
  const data = AppState.pcaData.filter(p => vars.every(v => p[v] != null));
  if (data.length < k + 1) return;

  if (!AppState.acpResult || AppState.acpResult.variables.join() !== vars.join()) {
    const result = Stats.pca(data, vars);
    AppState.acpResult = result;
  }

  const points = data.map(d => vars.map(v => d[v] ?? 0));
  const normalized = Stats.standardize(points);
  const { labels } = Stats.kmeans(normalized, k);
  AppState.clusterLabels = labels;

  Charts.drawClustering(AppState.acpResult, data, labels, vars);

  const maxK = Math.min(6, data.length - 1);
  if (maxK >= 2) {
    const elbow = Stats.elbowData(normalized, maxK);
    Charts.drawElbow(elbow);
  }
}

/* ── Corrélations Spearman ───────────────────────────────── */

function runCorrelations() {
  const vars = AppState.corrVars;
  const data = AppState.parties.filter(p => vars.some(v => p[v] != null));
  if (data.length < 3) return;

  const matrix = Stats.spearmanMatrix(data, vars);
  AppState.corrMatrix = matrix;
  Charts.drawCorrelations(matrix, vars);
}

/* ── Régression ──────────────────────────────────────────── */

function initRegressionSelectors() {
  const regVarOptions = [
    "taux_wikidata", "taux_crapu", "taux_par_carriere",
    "taux_recidive", "taux_definitif", "gravite_moyenne",
    "age_moyen_affaire", "position_spectre",
  ];

  const xSel = document.getElementById("reg-x-var");
  const ySel = document.getElementById("reg-y-var");
  if (!xSel || !ySel) return;

  regVarOptions.forEach(v => {
    const ox = document.createElement("option");
    ox.value = v; ox.textContent = Charts.labelVar(v);
    if (v === AppState.regXVar) ox.selected = true;
    xSel.appendChild(ox);

    const oy = document.createElement("option");
    oy.value = v; oy.textContent = Charts.labelVar(v);
    if (v === AppState.regYVar) oy.selected = true;
    ySel.appendChild(oy);
  });

  xSel.addEventListener("change", () => { AppState.regXVar = xSel.value; });
  ySel.addEventListener("change", () => { AppState.regYVar = ySel.value; });
}

function runRegression() {
  const xVar = AppState.regXVar;
  const yVar = AppState.regYVar;

  const data = AppState.parties.filter(p => p[xVar] != null && p[yVar] != null);
  if (data.length < 3) return;

  const x = data.map(d => d[xVar]);
  const y = data.map(d => d[yVar]);
  const result = Stats.linearRegression(x, y);

  Charts.drawRegression(result, data, xVar, yVar);
}

/* ── Tableau détaillé ────────────────────────────────────── */

let tableSearch = "", tableParti = "", tableStatut = "", tableGravite = 0;

function initTableau() {
  const search = document.getElementById("search-input");
  const selParti = document.getElementById("filter-parti");
  const selStatut = document.getElementById("filter-statut");
  const sliderGravite = document.getElementById("filter-gravite");
  const labelGravite = document.getElementById("gravite-label");

  search?.addEventListener("input", () => { tableSearch = search.value.toLowerCase(); AppState.tablePage = 0; renderTableau(); });
  selParti?.addEventListener("change", () => { tableParti = selParti.value; AppState.tablePage = 0; renderTableau(); });
  selStatut?.addEventListener("change", () => { tableStatut = selStatut.value; AppState.tablePage = 0; renderTableau(); });
  sliderGravite?.addEventListener("input", () => {
    tableGravite = parseFloat(sliderGravite.value);
    if (labelGravite) labelGravite.textContent = tableGravite;
    AppState.tablePage = 0;
    renderTableau();
  });

  document.querySelectorAll("#affaires-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (AppState.tableSort.col === col) AppState.tableSort.dir *= -1;
      else { AppState.tableSort.col = col; AppState.tableSort.dir = -1; }
      AppState.tablePage = 0;
      renderTableau();
    });
  });
}

function populatePartiSelect(parties) {
  const sel = document.getElementById("filter-parti");
  if (!sel) return;
  [...parties].sort((a, b) => a.parti_nom.localeCompare(b.parti_nom, "fr")).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.parti_id;
    opt.textContent = p.parti_nom;
    sel.appendChild(opt);
  });
}

function renderTableau() {
  let rows = AppState.affairs;

  if (tableSearch) {
    rows = rows.filter(a =>
      (a.politicien_nom || "").toLowerCase().includes(tableSearch) ||
      (a.parti_nom || "").toLowerCase().includes(tableSearch) ||
      (a.description || "").toLowerCase().includes(tableSearch)
    );
  }
  if (tableParti) rows = rows.filter(a => a.parti_id === tableParti);
  if (tableStatut) rows = rows.filter(a => a.statut_verdict === tableStatut);
  if (tableGravite > 0) rows = rows.filter(a => (a.score_gravite || 0) >= tableGravite);

  const { col, dir } = AppState.tableSort;
  rows = [...rows].sort((a, b) => {
    const va = a[col] ?? "", vb = b[col] ?? "";
    return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
  });

  AppState.tableFilteredAffaires = rows;
  const total = rows.length;
  const pageCount = Math.ceil(total / AppState.PAGE_SIZE);
  if (AppState.tablePage >= pageCount) AppState.tablePage = 0;

  const page = rows.slice(
    AppState.tablePage * AppState.PAGE_SIZE,
    (AppState.tablePage + 1) * AppState.PAGE_SIZE
  );

  const tbody = document.getElementById("affaires-tbody");
  if (!tbody) return;

  tbody.innerHTML = page.map(a => `
    <tr>
      <td>${esc(a.politicien_nom)}</td>
      <td>${esc(a.parti_nom)}</td>
      <td>${a.annee ?? "?"}</td>
      <td style="max-width:300px;word-break:break-word">${esc(a.description)}</td>
      <td>${a.score_gravite != null ? a.score_gravite.toFixed(1) : "—"}</td>
      <td><span class="badge-verdict badge-${esc(a.statut_verdict)}">${esc(a.statut_verdict)}</span></td>
      <td>${a.prison_ferme != null ? a.prison_ferme + " mois" : "—"}</td>
      <td>${a.amende_ferme != null ? a.amende_ferme.toLocaleString("fr-FR") + " €" : "—"}</td>
      <td>${a.ineligibilite_ferme != null ? a.ineligibilite_ferme + " mois" : "—"}</td>
    </tr>
  `).join("");

  const pag = document.getElementById("pagination");
  if (pag) {
    const maxPages = 10;
    const start = Math.max(0, AppState.tablePage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages);
    pag.innerHTML = (AppState.tablePage > 0 ? `<button class="page-btn" data-page="${AppState.tablePage - 1}">◀</button>` : "") +
      Array.from({ length: end - start }, (_, i) => i + start).map(i =>
        `<button class="page-btn ${i === AppState.tablePage ? "active" : ""}" data-page="${i}">${i + 1}</button>`
      ).join("") +
      (AppState.tablePage < pageCount - 1 ? `<button class="page-btn" data-page="${AppState.tablePage + 1}">▶</button>` : "");

    pag.onclick = e => {
      const btn = e.target.closest(".page-btn");
      if (btn) { AppState.tablePage = parseInt(btn.dataset.page); renderTableau(); }
    };
  }

  const countEl = document.getElementById("table-count");
  if (countEl) countEl.textContent = `${total} affaire(s) correspondant aux filtres`;
}

/* ── Modal méthodologie ──────────────────────────────────── */

function initModalMethodologie() {
  const overlay = document.getElementById("modal-overlay");
  document.getElementById("lien-methodologie")?.addEventListener("click", e => {
    e.preventDefault(); overlay.hidden = false;
  });
  document.getElementById("modal-close")?.addEventListener("click", () => { overlay.hidden = true; });
  overlay?.addEventListener("click", e => { if (e.target === overlay) overlay.hidden = true; });
  document.getElementById("btn-voir-methodo")?.addEventListener("click", () => {
    overlay.hidden = true; switchTab("methodologie");
  });
}

/* ── Utilitaire HTML-escape ──────────────────────────────── */

function esc(s) {
  if (!s && s !== 0) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Démarrage ───────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => { init(); });
