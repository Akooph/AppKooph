/**
 * app.js — Orchestration principale
 * Chargement des données, gestion des filtres, navigation entre onglets
 */

/* ── État global ────────────────────────────────────────── */
const AppState = {
  // Données brutes
  affairs: [],
  parties: [],
  stats: null,

  // Filtres actifs
  filtres: {
    verdict: "tous",       // "tous" | "definitif"
    periode: "tous",       // "tous" | "actuel"
    chambre: "tous",       // "tous" | "AN" | "Sénat"
  },

  // Vues dérivées (mise à jour par applyFiltres)
  filteredAffaires: [],
  filteredParties: [],
  filteredStats: null,
  chronoRows: [],

  // Stats avancées
  pcaData: [],
  acpResult: null,
  clusterLabels: null,
  corrMatrix: null,
  corrVars: null,

  // Tableau
  tableSort: { col: "annee", dir: -1 },
  tablePage: 0,
  PAGE_SIZE: 30,
};

/* ── Chargement ─────────────────────────────────────────── */

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Erreur chargement ${path}: ${r.status}`);
  return r.json();
}

async function init() {
  try {
    const [affairs, parties, stats] = await Promise.all([
      loadJSON("data/affairs.json"),
      loadJSON("data/parties.json"),
      loadJSON("data/stats.json"),
    ]);

    AppState.affairs = affairs;
    AppState.parties = parties;
    AppState.stats = stats;

    // Remplir le select de filtres
    populatePartiSelect(parties);

    // Mettre à jour la date de génération
    const el = document.getElementById("date-generation");
    if (el && stats.meta?.date_generation) {
      el.textContent = new Date(stats.meta.date_generation).toLocaleString("fr-FR");
    }

    // Mise à jour des meta-infos
    const mi = document.getElementById("meta-info");
    if (mi && stats.meta) {
      mi.innerHTML = `
        <em>Données générées le : ${new Date(stats.meta.date_generation).toLocaleString("fr-FR")}</em><br>
        <em>Total affaires : ${stats.meta.nb_affaires_total} dont ${stats.meta.nb_affaires_definitif} définitives ·
        Politiciens : ${stats.meta.nb_politiciens} · Partis : ${stats.meta.nb_partis}</em>
      `;
    }

    applyFiltres();
    initNav();
    initFiltresGlobaux();
    initTableau();
    initStatistiques();
    Export.initButtons(AppState);
    initModalMethodologie();

  } catch (e) {
    console.error("Erreur chargement :", e);
    document.body.innerHTML = `<div style="padding:40px;color:#dc2626">
      <h2>Erreur de chargement des données</h2>
      <p>Vérifiez que le pipeline a été exécuté (<code>python data/scripts/process.py</code>).</p>
      <pre>${e.message}</pre>
    </div>`;
  }
}

/* ── Filtrage ───────────────────────────────────────────── */

function applyFiltres() {
  const { verdict, periode, chambre } = AppState.filtres;

  let affaires = AppState.affairs;

  if (verdict === "definitif") {
    affaires = affaires.filter(a => a.is_definitif);
  }
  if (periode === "actuel") {
    affaires = affaires.filter(a => a.is_current_mp);
  }
  if (chambre !== "tous") {
    affaires = affaires.filter(a => a.chambre === chambre || (chambre === "AN" && !a.chambre));
  }

  AppState.filteredAffaires = affaires;

  // Recalculer les stats par parti depuis les affaires filtrées
  const statsParParti = {};
  affaires.forEach(a => {
    const pid = a.parti_id;
    if (!pid) return;
    if (!statsParParti[pid]) {
      const pBase = AppState.parties.find(p => p.parti_id === pid) || {};
      statsParParti[pid] = {
        parti_id: pid,
        parti_nom: a.parti_nom,
        parti_nom_court: a.parti_nom_court,
        position_spectre: a.position_spectre,
        logo: pBase.logo || "",
        nb_affaires: 0,
        nb_affaires_definitif: 0,
        nb_politiciens: new Set(),
        score_total: 0,
        total_actuel: pBase.total_actuel,
        taux_actuel: pBase.taux_actuel,
      };
    }
    statsParParti[pid].nb_affaires++;
    if (a.is_definitif) statsParParti[pid].nb_affaires_definitif++;
    statsParParti[pid].nb_politiciens.add(a.politicien_id);
    statsParParti[pid].score_total += a.score_gravite || 0;
  });

  AppState.filteredParties = Object.values(statsParParti).map(p => ({
    ...p,
    nb_politiciens: p.nb_politiciens.size,
    score_moyen: p.nb_affaires > 0 ? p.score_total / p.nb_affaires : 0,
  }));

  // Chronologie
  const chrono = {};
  affaires.forEach(a => {
    if (!a.annee) return;
    if (!chrono[a.annee]) chrono[a.annee] = {};
    chrono[a.annee][a.parti_id] = (chrono[a.annee][a.parti_id] || 0) + 1;
  });
  AppState.chronoRows = Object.entries(chrono)
    .sort((a, b) => a[0] - b[0])
    .map(([annee, partis]) => ({ annee: parseInt(annee), ...partis }));

  // Données PCA (à partir des partis filtrés avec position connue)
  AppState.pcaData = AppState.filteredParties
    .filter(p => p.position_spectre != null && p.nb_affaires >= 1)
    .map(p => ({
      parti_id: p.parti_id,
      parti_nom: p.parti_nom,
      parti_nom_court: p.parti_nom_court,
      nb_affaires: p.nb_affaires,
      nb_affaires_definitif: p.nb_affaires_definitif,
      nb_politiciens: p.nb_politiciens,
      score_moyen: p.score_moyen,
      position_spectre: p.position_spectre,
      taux_actuel: p.taux_actuel,
    }));

  // Redessiner la vue active
  refreshActiveTab();
}

/* ── Navigation onglets ─────────────────────────────────── */

let activeTab = "vue-ensemble";

function initNav() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
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
    case "vue-ensemble": renderBubble(); break;
    case "par-parti":    renderBars(); break;
    case "chronologie":  renderChrono(); break;
    case "statistiques": refreshSubTab(); break;
    case "tableau":      renderTableau(); break;
    case "methodologie": break;
  }
}

/* ── Filtres globaux ────────────────────────────────────── */

function initFiltresGlobaux() {
  document.getElementById("toggle-verdict")?.addEventListener("click", e => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#toggle-verdict .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    AppState.filtres.verdict = btn.dataset.val;
    applyFiltres();
  });

  document.getElementById("toggle-periode")?.addEventListener("click", e => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#toggle-periode .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    AppState.filtres.periode = btn.dataset.val;
    applyFiltres();
  });

  document.getElementById("toggle-chambre")?.addEventListener("click", e => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#toggle-chambre .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    AppState.filtres.chambre = btn.dataset.val;
    applyFiltres();
  });
}

/* ── Vue d'ensemble ─────────────────────────────────────── */

function renderBubble() {
  Charts.drawBubble(AppState.filteredParties, AppState.filtres);
}

/* ── Par parti ──────────────────────────────────────────── */

function renderBars() {
  Charts.drawBars(AppState.filteredParties);
}

/* ── Chronologie ────────────────────────────────────────── */

let chronoDebut = 1950, chronoFin = 2026;

function renderChrono() {
  const partiesMap = {};
  AppState.parties.forEach(p => { partiesMap[p.parti_id] = p; });
  Charts.drawChrono(AppState.stats?.chronologie || {}, partiesMap, chronoDebut, chronoFin);
}

function initChrono() {
  const rDebut = document.getElementById("range-debut");
  const rFin = document.getElementById("range-fin");
  const lDebut = document.getElementById("label-debut");
  const lFin = document.getElementById("label-fin");

  if (!rDebut) return;

  // Initialiser la plage selon les données
  const annees = Object.keys(AppState.stats?.chronologie || {}).map(Number);
  if (annees.length) {
    const dMin = Math.min(...annees);
    const dMax = Math.max(...annees);
    rDebut.min = dMin; rFin.min = dMin;
    rDebut.max = dMax; rFin.max = dMax;
    rDebut.value = dMin; rFin.value = dMax;
    lDebut.textContent = dMin; lFin.textContent = dMax;
    chronoDebut = dMin; chronoFin = dMax;
  }

  rDebut.addEventListener("input", () => {
    chronoDebut = parseInt(rDebut.value);
    lDebut.textContent = chronoDebut;
    if (activeTab === "chronologie") renderChrono();
  });
  rFin.addEventListener("input", () => {
    chronoFin = parseInt(rFin.value);
    lFin.textContent = chronoFin;
    if (activeTab === "chronologie") renderChrono();
  });
}

/* ── Statistiques avancées ──────────────────────────────── */

const PCA_VARS = ["nb_affaires", "score_moyen", "position_spectre", "nb_politiciens"];
const CORR_VARS = ["nb_affaires", "nb_affaires_definitif", "score_moyen", "position_spectre", "nb_politiciens"];
let activeSubTab = "acp";

function initStatistiques() {
  document.querySelectorAll(".sub-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubTab = btn.dataset.subtab;
      document.querySelectorAll(".sub-tab").forEach(b => b.classList.toggle("active", b.dataset.subtab === activeSubTab));
      document.querySelectorAll(".sub-panel").forEach(p => p.classList.toggle("active", p.id === `subtab-${activeSubTab}`));
      refreshSubTab();
    });
  });

  // k-slider
  const kSlider = document.getElementById("k-slider");
  const kLabel = document.getElementById("k-label");
  kSlider?.addEventListener("input", () => {
    kLabel.textContent = kSlider.value;
    if (activeSubTab === "clustering") runClustering(parseInt(kSlider.value));
  });
}

function refreshSubTab() {
  if (AppState.pcaData.length < 3) return;

  switch (activeSubTab) {
    case "acp":          runACP(); break;
    case "clustering":   runClustering(parseInt(document.getElementById("k-slider")?.value || 3)); break;
    case "correlations": runCorrelations(); break;
    case "regression":   runRegression(); break;
  }
}

function runACP() {
  if (AppState.pcaData.length < 3) return;
  const result = Stats.pca(AppState.pcaData, PCA_VARS);
  AppState.acpResult = result;
  Charts.drawACP(result, AppState.pcaData, AppState.clusterLabels);
}

function runClustering(k) {
  if (!AppState.acpResult) runACP();
  if (AppState.pcaData.length < k) return;

  const points = AppState.pcaData.map(d => PCA_VARS.map(v => d[v] ?? 0));
  const normalized = Stats.standardize(points);
  const { labels } = Stats.kmeans(normalized, k);
  AppState.clusterLabels = labels;

  Charts.drawClustering(AppState.acpResult, AppState.pcaData, labels);

  // Méthode du coude (calcul limité)
  const elbow = Stats.elbowData(normalized, Math.min(6, AppState.pcaData.length - 1));
  Charts.drawElbow(elbow);
}

function runCorrelations() {
  const matrix = Stats.correlationMatrix(AppState.pcaData, CORR_VARS);
  AppState.corrMatrix = matrix;
  AppState.corrVars = CORR_VARS;
  Charts.drawCorrelations(matrix, CORR_VARS);
}

function runRegression() {
  const x = AppState.pcaData.map(d => d.position_spectre ?? 0);
  const y = AppState.pcaData.map(d => d.nb_affaires ?? 0);
  const result = Stats.linearRegression(x, y);
  Charts.drawRegression(result, AppState.pcaData, "position_spectre", "nb_affaires");
}

/* ── Tableau détaillé ───────────────────────────────────── */

let tableSearch = "", tableParti = "", tableStatut = "", tableGravite = 0;

function initTableau() {
  const search = document.getElementById("search-input");
  const selParti = document.getElementById("filter-parti");
  const selStatut = document.getElementById("filter-statut");
  const sliderGravite = document.getElementById("filter-gravite");
  const labelGravite = document.getElementById("gravite-label");

  search?.addEventListener("input", () => { tableSearch = search.value.toLowerCase(); renderTableau(); });
  selParti?.addEventListener("change", () => { tableParti = selParti.value; renderTableau(); });
  selStatut?.addEventListener("change", () => { tableStatut = selStatut.value; renderTableau(); });
  sliderGravite?.addEventListener("input", () => {
    tableGravite = parseFloat(sliderGravite.value);
    if (labelGravite) labelGravite.textContent = tableGravite;
    renderTableau();
  });

  // Tri par colonnes
  document.querySelectorAll("#affaires-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (AppState.tableSort.col === col) {
        AppState.tableSort.dir *= -1;
      } else {
        AppState.tableSort.col = col;
        AppState.tableSort.dir = -1;
      }
      AppState.tablePage = 0;
      renderTableau();
    });
  });
}

function populatePartiSelect(parties) {
  const sel = document.getElementById("filter-parti");
  if (!sel) return;
  const sorted = [...parties].sort((a, b) => a.parti_nom.localeCompare(b.parti_nom, "fr"));
  sorted.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.parti_id;
    opt.textContent = p.parti_nom;
    sel.appendChild(opt);
  });
}

function renderTableau() {
  let rows = AppState.filteredAffaires;

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

  // Tri
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

  // Pagination
  const pag = document.getElementById("pagination");
  if (pag) {
    pag.innerHTML = Array.from({ length: pageCount }, (_, i) =>
      `<button class="page-btn ${i === AppState.tablePage ? "active" : ""}" data-page="${i}">${i + 1}</button>`
    ).join("");
    pag.addEventListener("click", e => {
      const btn = e.target.closest(".page-btn");
      if (btn) { AppState.tablePage = parseInt(btn.dataset.page); renderTableau(); }
    });
  }

  const countEl = document.getElementById("table-count");
  if (countEl) countEl.textContent = `${total} affaire(s) correspondant aux filtres`;
}

function esc(s) {
  if (!s && s !== 0) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Modal méthodologie ─────────────────────────────────── */

function initModalMethodologie() {
  const overlay = document.getElementById("modal-overlay");
  const btnOpen = document.getElementById("lien-methodologie");
  const btnClose = document.getElementById("modal-close");
  const btnGo = document.getElementById("btn-voir-methodo");

  btnOpen?.addEventListener("click", e => { e.preventDefault(); overlay.hidden = false; });
  btnClose?.addEventListener("click", () => { overlay.hidden = true; });
  overlay?.addEventListener("click", e => { if (e.target === overlay) overlay.hidden = true; });
  btnGo?.addEventListener("click", () => { overlay.hidden = true; switchTab("methodologie"); });
}

/* ── Démarrage ──────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", async () => {
  await init();
  initChrono();
});
