#!/usr/bin/env python3
"""
Pipeline de données — Crapulopédia x Parlement français
Télécharge les données brutes, les normalise et exporte des JSON statiques
pour le site GitHub Pages.
"""

import csv
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
import io
from collections import defaultdict
from pathlib import Path

RAW_DIR = Path(__file__).parent.parent / "raw"
OUT_DIR = Path(__file__).parent.parent.parent / "docs" / "data"

RAW_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

CODEBERG_BASE = "https://codeberg.org/raphael-jolivet/crapulopedia/raw/branch/main/data/out"
SOURCES = {
    "politicians": f"{CODEBERG_BASE}/politicians.csv",
    "affaires": f"{CODEBERG_BASE}/affaires-out.csv",
    "parties": f"{CODEBERG_BASE}/parties.json",
}

AN_DEPUTES_URL = "http://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip"
SENAT_API_URL = "https://www.senat.fr/api-senat/senateurs.json"


# ── helpers ──────────────────────────────────────────────────────────────────

def fetch(url: str, dest: Path, label: str) -> bytes:
    if dest.exists():
        print(f"  [cache] {label}")
        return dest.read_bytes()
    print(f"  [fetch] {label} …")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "crapulopedia-viz/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        dest.write_bytes(data)
        print(f"         → {len(data):,} octets")
        return data
    except Exception as e:
        print(f"  [ERREUR] {label}: {e}")
        return b""


def safe_float(v, default=None):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def wikidata_id(url_or_id: str) -> str:
    """Extrait l'ID Wikidata (Q123…) d'une URL ou le retourne tel quel."""
    if not url_or_id:
        return ""
    m = re.search(r"(Q\d+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()


# ── étape 1 : téléchargement ──────────────────────────────────────────────────

def download_all():
    print("\n=== Téléchargement des données ===")
    raw = {}
    for key, url in SOURCES.items():
        dest = RAW_DIR / f"{key}.{'json' if key == 'parties' else 'csv'}"
        raw[key] = fetch(url, dest, key)

    # Assemblée nationale — fichier zip JSON (multi-fichiers acteurs + organes)
    an_zip_dest = RAW_DIR / "an_deputes.zip"
    fetch(AN_DEPUTES_URL, an_zip_dest, "AN députés (zip)")
    raw["an_deputes_zip"] = str(an_zip_dest) if an_zip_dest.exists() else ""

    # Sénat
    senat_dest = RAW_DIR / "senateurs.json"
    raw["senateurs"] = fetch(SENAT_API_URL, senat_dest, "Sénat sénateurs")

    return raw


# ── étape 2 : parsing crapulopedia ───────────────────────────────────────────

def parse_crapulopedia(raw: dict):
    print("\n=== Parsing Crapulopédia ===")

    # Partis
    parties_raw = json.loads(raw["parties"].decode("utf-8") if raw["parties"] else "{}")
    parties = {}
    for qid, p in parties_raw.items():
        parties[qid] = {
            "id": qid,
            "nom": p.get("name", p.get("shortname", qid)),
            "nom_court": p.get("shortname", ""),
            "position": safe_float(p.get("position")),
            "logo": p.get("logo", ""),
            "debut": p.get("start", ""),
            "fin": p.get("end", ""),
        }
    print(f"  {len(parties)} partis chargés")

    # Politiciens
    politicians = {}
    if raw["politicians"]:
        reader = csv.DictReader(raw["politicians"].decode("utf-8").splitlines())
        for row in reader:
            qid = wikidata_id(row.get("id", ""))
            if qid:
                politicians[qid] = {
                    "id": qid,
                    "nom": row.get("name", "").strip(),
                    "derniere_maj": row.get("last_wiki_update", ""),
                    "is_current_mp": False,
                    "groupe_actuel": None,
                    "chambre": None,
                }
    print(f"  {len(politicians)} politiciens chargés")

    # Affaires
    affaires = []
    if raw["affaires"]:
        reader = csv.DictReader(raw["affaires"].decode("utf-8").splitlines())
        for row in reader:
            pol_id = wikidata_id(row.get("politician", ""))
            party_id = wikidata_id(row.get("party", ""))
            party_info = parties.get(party_id, {})

            recours = row.get("recours", "").strip()
            is_definitif = recours == "definitif"

            score = safe_float(row.get("score"), 0.0)
            annee = safe_float(row.get("annee"))
            position = safe_float(row.get("position"))

            affaire = {
                "id": f"{pol_id}_{row.get('annee', '')}_{len(affaires)}",
                "politicien_id": pol_id,
                "politicien_nom": politicians.get(pol_id, {}).get("nom", pol_id),
                "annee": int(annee) if annee else None,
                "description": row.get("affaire", "").strip(),
                "prison_total": safe_float(row.get("prison_total")),
                "prison_ferme": safe_float(row.get("prison_ferme")),
                "prison_sursis": safe_float(row.get("prison_sursis")),
                "amende_total": safe_float(row.get("amende_total")),
                "amende_ferme": safe_float(row.get("amende_ferme")),
                "ineligibilite_ferme": safe_float(row.get("ineligibilite_ferme")),
                "score_gravite": score,
                "statut_verdict": recours if recours else "inconnu",
                "is_definitif": is_definitif,
                "parti_id": party_id,
                "parti_nom": party_info.get("nom", party_id),
                "parti_nom_court": party_info.get("nom_court", ""),
                "position_spectre": position if position is not None else party_info.get("position"),
                "parti_certain": row.get("party_sure", "").lower() in ("true", "1", "yes"),
            }
            affaires.append(affaire)

    print(f"  {len(affaires)} affaires chargées")
    return parties, politicians, affaires


# ── étape 3 : parlement actuel ────────────────────────────────────────────────

def parse_parlement_actuel(raw: dict, politicians: dict):
    print("\n=== Parlement actuel ===")
    groupes = {}  # groupe_nom → {"total": N, "politiciens": [qid, …]}

    # Sénat
    try:
        senateurs_data = json.loads(raw["senateurs"].decode("utf-8") if raw["senateurs"] else "[]")
        # Peut être une liste ou un dict avec une clé
        if isinstance(senateurs_data, dict):
            senateurs_list = senateurs_data.get("senateurs", senateurs_data.get("data", list(senateurs_data.values())[0] if senateurs_data else []))
        else:
            senateurs_list = senateurs_data

        def normalize_name(n):
            return re.sub(r"\s+", " ", n.strip().lower())

        nom_to_qid = {normalize_name(p["nom"]): qid for qid, p in politicians.items()}

        count_sen = 0
        matched_sen = 0
        for s in senateurs_list:
            groupe = s.get("groupe", {})
            if isinstance(groupe, dict):
                nom_groupe = groupe.get("libelle", groupe.get("libelleCourt", "Inconnu"))
                nom_court = groupe.get("libelleCourt", "")
            else:
                nom_groupe = str(groupe) if groupe else "Inconnu"
                nom_court = ""
            nom_groupe_sen = f"{nom_groupe} (Sénat)"
            if nom_groupe_sen not in groupes:
                groupes[nom_groupe_sen] = {"total": 0, "politiciens_qids": [], "chambre": "Sénat", "nom_court": nom_court}
            groupes[nom_groupe_sen]["total"] += 1
            count_sen += 1

            # Matching par nom
            prenom = s.get("prenom", "")
            nom = s.get("nom", "")
            full = normalize_name(f"{prenom} {nom}")
            full_inv = normalize_name(f"{nom} {prenom}")
            qid = nom_to_qid.get(full) or nom_to_qid.get(full_inv)
            if qid:
                politicians[qid]["is_current_mp"] = True
                politicians[qid]["groupe_actuel"] = nom_groupe
                politicians[qid]["chambre"] = "Sénat"
                groupes[nom_groupe_sen]["politiciens_qids"].append(qid)
                matched_sen += 1

        print(f"  {count_sen} sénateurs, {len([g for g in groupes if 'Sénat' in g])} groupes sénat, {matched_sen} matchés")
    except Exception as e:
        print(f"  [ERREUR] parsing sénat: {e}")

    # Assemblée nationale — zip avec json/acteur/PA*.json + json/organe/PO*.json
    try:
        zip_path = raw.get("an_deputes_zip", "")
        if zip_path and Path(zip_path).exists():
            with zipfile.ZipFile(zip_path) as z:
                names = z.namelist()

                # 1. Construire mapping organe_id → nom de groupe (GP seulement)
                organe_noms = {}
                for fname in names:
                    if not fname.startswith("json/organe/"):
                        continue
                    try:
                        organe_data = json.loads(z.read(fname))
                        org = organe_data.get("organe", {})
                        if org.get("codeType") == "GP":
                            organe_noms[org["uid"]] = org.get("libelle", org["uid"])
                    except Exception:
                        pass

                # 2. Construire index nom normalisé → QID depuis crapulopedia
                def normalize_name(n):
                    return re.sub(r"\s+", " ", n.strip().lower())
                nom_to_qid = {}
                for qid, pol in politicians.items():
                    nom_to_qid[normalize_name(pol["nom"])] = qid

                # 3. Parser les acteurs
                count_an = 0
                matched_an = 0
                for fname in names:
                    if not fname.startswith("json/acteur/"):
                        continue
                    try:
                        acteur_data = json.loads(z.read(fname))
                        acteur = acteur_data.get("acteur", {})

                        ident = acteur.get("etatCivil", {}).get("ident", {})
                        prenom = ident.get("prenom", "")
                        nom = ident.get("nom", "")
                        full_name = normalize_name(f"{prenom} {nom}")
                        full_name_inv = normalize_name(f"{nom} {prenom}")

                        mandats = acteur.get("mandats", {}).get("mandat", [])
                        if isinstance(mandats, dict):
                            mandats = [mandats]

                        groupe_ref = None
                        for m in (mandats or []):
                            if m.get("typeOrgane") == "GP" and not m.get("dateFin"):
                                groupe_ref = m.get("organes", {}).get("organeRef", "")
                                break

                        if groupe_ref and groupe_ref in organe_noms:
                            groupe_nom = organe_noms[groupe_ref]
                            nom_groupe_an = f"{groupe_nom} (AN)"
                            if nom_groupe_an not in groupes:
                                groupes[nom_groupe_an] = {"total": 0, "politiciens_qids": [], "chambre": "AN", "nom_court": ""}
                            groupes[nom_groupe_an]["total"] += 1
                            count_an += 1

                            qid = nom_to_qid.get(full_name) or nom_to_qid.get(full_name_inv)
                            if qid:
                                politicians[qid]["is_current_mp"] = True
                                politicians[qid]["groupe_actuel"] = groupe_nom
                                politicians[qid]["chambre"] = "AN"
                                groupes[nom_groupe_an]["politiciens_qids"].append(qid)
                                matched_an += 1
                    except Exception:
                        pass

                print(f"  {count_an} députés AN, {len(organe_noms)} groupes, {matched_an} matchés avec crapulopedia")
        else:
            print("  [SKIP] Données AN non disponibles")
    except Exception as e:
        print(f"  [ERREUR] parsing AN: {e}")
        import traceback; traceback.print_exc()

    return groupes


# ── étape 4 : statistiques par parti ─────────────────────────────────────────

def compute_stats(parties: dict, politicians: dict, affaires: list, groupes: dict):
    print("\n=== Calcul des statistiques ===")

    # Taux par parti (crapulopedia) — parlement actuel
    current_qids = {qid for qid, p in politicians.items() if p["is_current_mp"]}

    # Agréger les affaires par politicien
    affaires_par_pol = defaultdict(list)
    for a in affaires:
        affaires_par_pol[a["politicien_id"]].append(a)

    # Stats par parti (données historiques crapulopedia)
    stats_par_parti = defaultdict(lambda: {
        "nb_affaires": 0,
        "nb_affaires_definitif": 0,
        "nb_politiciens": 0,
        "score_total": 0.0,
        "scores": [],
        "annees": [],
    })

    politiciens_avec_affaire = set()
    for a in affaires:
        pid = a["parti_id"]
        stats_par_parti[pid]["nb_affaires"] += 1
        if a["is_definitif"]:
            stats_par_parti[pid]["nb_affaires_definitif"] += 1
        stats_par_parti[pid]["score_total"] += a["score_gravite"] or 0
        stats_par_parti[pid]["scores"].append(a["score_gravite"] or 0)
        if a["annee"]:
            stats_par_parti[pid]["annees"].append(a["annee"])
        politiciens_avec_affaire.add(a["politicien_id"])

    for pid, s in stats_par_parti.items():
        s["score_moyen"] = s["score_total"] / s["nb_affaires"] if s["nb_affaires"] > 0 else 0
        s["score_median"] = sorted(s["scores"])[len(s["scores"]) // 2] if s["scores"] else 0
        del s["scores"]

    # Nb politiciens distincts par parti
    pol_par_parti = defaultdict(set)
    for a in affaires:
        pol_par_parti[a["parti_id"]].add(a["politicien_id"])
    for pid, pols in pol_par_parti.items():
        stats_par_parti[pid]["nb_politiciens"] = len(pols)

    # Enrichir avec métadonnées du parti
    stats_enrichies = {}
    for pid, s in stats_par_parti.items():
        p = parties.get(pid, {})
        stats_enrichies[pid] = {
            **s,
            "parti_id": pid,
            "parti_nom": p.get("nom", pid),
            "parti_nom_court": p.get("nom_court", ""),
            "position_spectre": p.get("position"),
            "logo": p.get("logo", ""),
            "debut": p.get("debut", ""),
            "fin": p.get("fin", ""),
            "total_actuel": None,
            "taux_actuel": None,
        }

    # Chronologie : affaires par année et par parti
    chrono = defaultdict(lambda: defaultdict(int))
    for a in affaires:
        if a["annee"]:
            chrono[a["annee"]][a["parti_id"]] += 1

    # Matrice de corrélation (données pour l'ACP côté client)
    pca_data = []
    for pid, s in stats_enrichies.items():
        if s["nb_affaires"] > 0 and s["position_spectre"] is not None:
            pca_data.append({
                "parti_id": pid,
                "parti_nom": s["parti_nom"],
                "parti_nom_court": s["parti_nom_court"],
                "nb_affaires": s["nb_affaires"],
                "nb_affaires_definitif": s["nb_affaires_definitif"],
                "nb_politiciens": s["nb_politiciens"],
                "score_moyen": s["score_moyen"],
                "position_spectre": s["position_spectre"],
                "taux_actuel": s["taux_actuel"],
            })

    print(f"  {len(stats_enrichies)} partis avec affaires")
    print(f"  {len(current_qids)} politiciens actuels identifiés")

    return stats_enrichies, dict(chrono), pca_data


# ── étape 5 : export JSON ─────────────────────────────────────────────────────

def export_json(parties, politicians, affaires, stats, chrono, pca_data, groupes):
    print("\n=== Export JSON ===")

    # affairs.json
    affairs_out = []
    for a in affaires:
        pol = politicians.get(a["politicien_id"], {})
        affairs_out.append({
            **a,
            "is_current_mp": pol.get("is_current_mp", False),
            "groupe_actuel": pol.get("groupe_actuel"),
            "chambre": pol.get("chambre"),
        })
    path = OUT_DIR / "affairs.json"
    path.write_text(json.dumps(affairs_out, ensure_ascii=False, indent=2))
    print(f"  affairs.json — {len(affairs_out)} affaires")

    # politicians.json
    pol_out = []
    affaires_par_pol = defaultdict(list)
    for a in affaires:
        affaires_par_pol[a["politicien_id"]].append({
            "id": a["id"],
            "annee": a["annee"],
            "description": a["description"],
            "score_gravite": a["score_gravite"],
            "statut_verdict": a["statut_verdict"],
            "is_definitif": a["is_definitif"],
            "parti_id": a["parti_id"],
            "parti_nom": a["parti_nom"],
        })
    for qid, p in politicians.items():
        pol_out.append({
            **p,
            "nb_affaires": len(affaires_par_pol.get(qid, [])),
            "nb_definitif": sum(1 for a in affaires_par_pol.get(qid, []) if a["is_definitif"]),
            "score_total": sum(a["score_gravite"] or 0 for a in affaires_par_pol.get(qid, [])),
            "affaires": affaires_par_pol.get(qid, []),
        })
    path = OUT_DIR / "politicians.json"
    path.write_text(json.dumps(pol_out, ensure_ascii=False, indent=2))
    print(f"  politicians.json — {len(pol_out)} politiciens")

    # parties.json
    parties_out = list(stats.values())
    path = OUT_DIR / "parties.json"
    path.write_text(json.dumps(parties_out, ensure_ascii=False, indent=2))
    print(f"  parties.json — {len(parties_out)} partis")

    # stats.json — agrégats pour chargement rapide
    annees_disponibles = sorted(chrono.keys())
    stats_out = {
        "meta": {
            "date_generation": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "nb_affaires_total": len(affaires),
            "nb_affaires_definitif": sum(1 for a in affaires if a["is_definitif"]),
            "nb_politiciens": len(politicians),
            "nb_partis": len(stats),
            "annee_min": min(annees_disponibles) if annees_disponibles else None,
            "annee_max": max(annees_disponibles) if annees_disponibles else None,
        },
        "chronologie": {
            str(annee): partis for annee, partis in sorted(chrono.items())
        },
        "pca_variables": pca_data,
        "groupes_parlement": {
            nom: {"total": g["total"], "chambre": g["chambre"]}
            for nom, g in groupes.items()
        },
        "top_partis_affaires": sorted(
            [{"parti_nom": s["parti_nom"], "nb_affaires": s["nb_affaires"], "position_spectre": s["position_spectre"]}
             for s in stats.values()],
            key=lambda x: x["nb_affaires"], reverse=True
        )[:15],
        "top_partis_gravite": sorted(
            [{"parti_nom": s["parti_nom"], "score_moyen": round(s["score_moyen"], 2), "nb_affaires": s["nb_affaires"]}
             for s in stats.values() if s["nb_affaires"] >= 2],
            key=lambda x: x["score_moyen"], reverse=True
        )[:15],
    }
    path = OUT_DIR / "stats.json"
    path.write_text(json.dumps(stats_out, ensure_ascii=False, indent=2))
    print(f"  stats.json — généré")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Pipeline Crapulopédia × Parlement Français")
    print("=" * 60)

    raw = download_all()
    parties, politicians, affaires = parse_crapulopedia(raw)
    groupes = parse_parlement_actuel(raw, politicians)
    stats, chrono, pca_data = compute_stats(parties, politicians, affaires, groupes)
    export_json(parties, politicians, affaires, stats, chrono, pca_data, groupes)

    print("\n✓ Pipeline terminé. Fichiers dans docs/data/")


if __name__ == "__main__":
    main()
