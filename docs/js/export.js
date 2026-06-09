/**
 * export.js — Fonctions d'export (CSV, JSON, PNG, PDF)
 */

const Export = (() => {

  /* ── CSV ───────────────────────────────────────────────── */

  function toCSV(rows, filename = "export.csv") {
    if (!rows || !rows.length) return;
    const headers = Object.keys(rows[0]);
    const escape = v => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [
      headers.join(","),
      ...rows.map(r => headers.map(h => escape(r[h])).join(","))
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    download(blob, filename);
  }

  /* ── JSON ──────────────────────────────────────────────── */

  function toJSON(data, filename = "export.json") {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    download(blob, filename);
  }

  /* ── PNG depuis canvas Chart.js ────────────────────────── */

  function chartToPNG(chartId, filename = "graphique.png") {
    const canvas = document.getElementById(chartId);
    if (!canvas) { console.warn("Canvas introuvable:", chartId); return; }
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  /* ── PNG depuis un conteneur HTML (html2canvas) ─────────  */

  async function containerToPNG(containerId, filename = "graphique.png") {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("html2canvas erreur:", e);
    }
  }

  /* ── Utilitaire de téléchargement ──────────────────────── */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── Données par vue ───────────────────────────────────── */

  /**
   * Retourne les données actuelles pour une vue donnée.
   * Appelé par le gestionnaire de boutons d'export dans app.js.
   */
  function getViewData(target, AppState) {
    switch (target) {
      case "vue-ensemble":
        return (AppState.parties || []).map(p => ({
          parti: p.parti_nom,
          parti_court: p.parti_nom_court,
          position_spectre: p.position_spectre,
          nb_affaires: p.nb_affaires,
          nb_affaires_definitif: p.nb_affaires_definitif,
          nb_politiciens_distincts: p.nb_politiciens,
          score_moyen_gravite: p.score_moyen?.toFixed(2),
          elus_actuels_total: p.total_actuel,
          taux_affaires_pourcent: p.taux_actuel != null
            ? (p.taux_actuel * 100).toFixed(1) + "%"
            : "N/A",
        }));

      case "par-parti":
        return (AppState.filteredParties || []).map(p => ({
          parti: p.parti_nom,
          nb_affaires_total: p.nb_affaires,
          nb_definitif: p.nb_affaires_definitif,
          nb_politiciens: p.nb_politiciens,
          score_moyen: p.score_moyen?.toFixed(2),
          taux_actuel: p.taux_actuel != null ? (p.taux_actuel * 100).toFixed(1) + "%" : "N/A",
        }));

      case "chronologie":
        return (AppState.chronoRows || []);

      case "tableau":
        return (AppState.tableFilteredAffaires || AppState.filteredAffaires || []).map(a => ({
          politicien: a.politicien_nom,
          parti: a.parti_nom,
          annee: a.annee,
          description: a.description,
          score_gravite: a.score_gravite,
          statut_verdict: a.statut_verdict,
          prison_ferme_mois: a.prison_ferme,
          amende_ferme_euros: a.amende_ferme,
          ineligibilite_ferme_mois: a.ineligibilite_ferme,
          parlement_actuel: a.is_current_mp ? "Oui" : "Non",
          chambre: a.chambre || "",
        }));

      case "acp":
        return (AppState.acpResult?.scores || []).map((s, i) => ({
          parti: AppState.pcaData?.[i]?.parti_nom,
          PC1: s[0]?.toFixed(4),
          PC2: s[1]?.toFixed(4),
        }));

      case "clustering":
        return (AppState.pcaData || []).map((d, i) => ({
          parti: d.parti_nom,
          cluster: (AppState.clusterLabels?.[i] ?? "") + 1,
          nb_affaires: d.nb_affaires,
          score_moyen: d.score_moyen?.toFixed(2),
          position_spectre: d.position_spectre,
        }));

      case "correlations":
        return (AppState.corrMatrix || []).flatMap((row, i) =>
          row.map((cell, j) => ({
            variable_x: AppState.corrVars?.[i],
            variable_y: AppState.corrVars?.[j],
            r: cell.r?.toFixed(4),
            p_value: cell.pvalue?.toFixed(4),
            n: cell.n,
          }))
        );

      case "regression":
        return (AppState.pcaData || []).map(d => ({
          parti: d.parti_nom,
          position_spectre: d.position_spectre,
          nb_affaires: d.nb_affaires,
          score_moyen: d.score_moyen?.toFixed(2),
        }));

      default:
        return [];
    }
  }

  /* ── Gestionnaire global des boutons d'export ───────────── */

  function initButtons(AppState) {
    document.addEventListener("click", e => {
      const btn = e.target.closest(".btn-export");
      if (!btn) return;

      const fmt = btn.dataset.fmt;
      const chartId = btn.dataset.chart;
      const target = btn.dataset.target;
      const ts = new Date().toISOString().slice(0, 10);

      if (fmt === "png" && chartId) {
        chartToPNG(chartId, `crapulopedia_${chartId}_${ts}.png`);
        return;
      }

      const rows = getViewData(target, AppState);
      if (fmt === "csv") {
        toCSV(rows, `crapulopedia_${target}_${ts}.csv`);
      } else if (fmt === "json") {
        toJSON(rows, `crapulopedia_${target}_${ts}.json`);
      }
    });
  }

  return { toCSV, toJSON, chartToPNG, containerToPNG, initButtons, getViewData };

})();
