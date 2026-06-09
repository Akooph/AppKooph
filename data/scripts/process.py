#!/usr/bin/env python3
"""
Pipeline de données — Crapulopédia × Parlement français
Télécharge, normalise (par politicien-années Wikidata, par âge) et exporte
des JSON statiques analytiquement rigoureux pour le site GitHub Pages.
"""

import csv
import json
import math
import re
import time
import io
import zipfile
import urllib.request
import urllib.parse
from collections import defaultdict
from pathlib import Path
from datetime import datetime

RAW_DIR = Path(__file__).parent.parent / "raw"
OUT_DIR = Path(__file__).parent.parent.parent / "docs" / "data"
RAW_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

CODEBERG_BASE = "https://codeberg.org/raphael-jolivet/crapulopedia/raw/branch/main/data/out"
SOURCES = {
    "politicians": f"{CODEBERG_BASE}/politicians.csv",
    "affaires":    f"{CODEBERG_BASE}/affaires-out.csv",
    "parties":     f"{CODEBERG_BASE}/parties.json",
    "naissance":   f"{CODEBERG_BASE}/wikidata_out.csv",
}
AN_DEPUTES_URL  = "http://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip"
SENAT_API_URL   = "https://www.senat.fr/api-senat/senateurs.json"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
CURRENT_YEAR    = datetime.utcnow().year


# ── helpers ──────────────────────────────────────────────────────────────────

def fetch(url: str, dest: Path, label: str) -> bytes:
    if dest.exists():
        print(f"  [cache] {label}")
        return dest.read_bytes()
    print(f"  [fetch] {label} …")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "crapulopedia-viz/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        dest.write_bytes(data)
        print(f"         → {len(data):,} octets")
        return data
    except Exception as e:
        print(f"  [ERREUR] {label}: {e}")
        return b""


def sparql_query(query: str, dest: Path, label: str) -> list:
    if dest.exists():
        print(f"  [cache] {label}")
        return json.loads(dest.read_text())
    print(f"  [sparql] {label} …")
    try:
        params = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
        req = urllib.request.Request(
            WIKIDATA_SPARQL,
            data=params,
            method="POST",
            headers={
                "User-Agent": "crapulopedia-viz/1.0 (open-source research)",
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            }
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            result = json.loads(r.read())
        bindings = result["results"]["bindings"]
        dest.write_text(json.dumps(bindings, ensure_ascii=False))
        print(f"         → {len(bindings)} lignes")
        return bindings
    except Exception as e:
        print(f"  [ERREUR] {label}: {e}")
        return []


def safe_float(v, default=None):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def wikidata_id(url_or_id: str) -> str:
    if not url_or_id:
        return ""
    m = re.search(r"(Q\d+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()


def normalize_name(n: str) -> str:
    return re.sub(r"\s+", " ", n.strip().lower())


# ── étape 1 : téléchargement ──────────────────────────────────────────────────

def download_all() -> dict:
    print("\n=== Téléchargement des sources ===")
    raw = {}
    for key, url in SOURCES.items():
        ext = "json" if key == "parties" else "csv"
        dest = RAW_DIR / f"{key}.{ext}"
        raw[key] = fetch(url, dest, key)

    an_zip = RAW_DIR / "an_deputes.zip"
    fetch(AN_DEPUTES_URL, an_zip, "AN députés (zip)")
    raw["an_zip_path"] = str(an_zip) if an_zip.exists() else ""

    raw["senateurs"] = fetch(SENAT_API_URL, RAW_DIR / "senateurs.json", "Sénat API")
    return raw


# ── étape 2 : Wikidata SPARQL ─────────────────────────────────────────────────

def build_sparql_values(party_ids: list) -> str:
    return " ".join(f"wd:{qid}" for qid in party_ids if qid.startswith("Q"))


def sparql_batch(party_ids: list, batch_size: int = 10):
    """Découpe la liste en sous-listes pour éviter les timeouts Wikidata."""
    for i in range(0, len(party_ids), batch_size):
        yield party_ids[i:i + batch_size]


def query_wikidata(party_ids: list) -> dict:
    """
    Retourne deux sous-dicts:
      total[parti_id] = nb total de politiciens français documentés
      par_annee[parti_id][annee] = nb membres ayant rejoint cette année-là
    """
    print("\n=== Requêtes Wikidata SPARQL ===")
    valid_ids = [q for q in party_ids if q.startswith("Q")]
    if not valid_ids:
        return {"total": {}, "par_annee": {}}

    # 1. Total statique par parti (unique requête avec cache)
    vals_all = build_sparql_values(valid_ids)
    q_total = f"""
    SELECT ?party (COUNT(DISTINCT ?person) AS ?total) WHERE {{
      VALUES ?party {{ {vals_all} }}
      ?person wdt:P27 wd:Q142;
              wdt:P102 ?party.
    }}
    GROUP BY ?party
    """
    total_rows = sparql_query(q_total, RAW_DIR / "wikidata_total.json", "total politiciens/parti")

    total = {}
    for row in total_rows:
        pid = wikidata_id(row["party"]["value"])
        total[pid] = int(row["total"]["value"])

    # 2. Répartition par année d'adhésion — batches de 10 pour éviter HTTP 400
    all_annee_rows = []
    cache_file = RAW_DIR / "wikidata_par_annee.json"
    if cache_file.exists():
        print(f"  [cache] politiciens/parti/année")
        all_annee_rows = json.loads(cache_file.read_text())
    else:
        print(f"  [sparql] politiciens/parti/année (batches de 10) …")
        for batch in sparql_batch(valid_ids, 10):
            vals = build_sparql_values(batch)
            q_annee = f"""
    SELECT ?party ?annee (COUNT(DISTINCT ?person) AS ?nb) WHERE {{
      VALUES ?party {{ {vals} }}
      ?person wdt:P27 wd:Q142;
              p:P102 ?stmt.
      ?stmt ps:P102 ?party;
            pq:P580 ?startDate.
      BIND(YEAR(?startDate) AS ?annee)
      FILTER(?annee >= 1945 && ?annee <= {CURRENT_YEAR})
    }}
    GROUP BY ?party ?annee
    ORDER BY ?party ?annee
    """
            tmp_file = RAW_DIR / f"wikidata_annee_tmp_{batch[0]}.json"
            rows = sparql_query(q_annee, tmp_file, f"  batch {batch[0]}…{batch[-1]}")
            all_annee_rows.extend(rows)
            time.sleep(1)  # respecter le rate-limit Wikidata
        cache_file.write_text(json.dumps(all_annee_rows, ensure_ascii=False))
        print(f"         → {len(all_annee_rows)} lignes au total")

    par_annee = defaultdict(lambda: defaultdict(int))
    for row in all_annee_rows:
        pid  = wikidata_id(row["party"]["value"])
        year = int(row["annee"]["value"])
        nb   = int(row["nb"]["value"])
        par_annee[pid][year] += nb

    return {"total": total, "par_annee": {k: dict(v) for k, v in par_annee.items()}}


# ── étape 3 : parsing crapulopedia ───────────────────────────────────────────

def parse_crapulopedia(raw: dict):
    print("\n=== Parsing Crapulopédia ===")

    # Partis
    parties = {}
    name_to_qid = {}  # "les républicains" → "Q20012759"
    for qid, p in json.loads(raw["parties"].decode("utf-8", errors="replace")).items():
        nom     = p.get("name", p.get("shortname", qid))
        nom_court = p.get("shortname", "")
        parties[qid] = {
            "id": qid,
            "nom": nom,
            "nom_court": nom_court,
            "position": safe_float(p.get("position")),
            "logo": p.get("logo", ""),
            "debut": p.get("start", ""),
            "fin": p.get("end", ""),
        }
        name_to_qid[nom.lower()] = qid
        if nom_court:
            name_to_qid[nom_court.lower()] = qid
    print(f"  {len(parties)} partis")

    # Années de naissance
    birth_years = {}
    if raw.get("naissance"):
        reader = csv.DictReader(raw["naissance"].decode("utf-8", errors="replace").splitlines())
        for row in reader:
            qid = wikidata_id(row.get("person", ""))
            by  = safe_float(row.get("birthYear"))
            if qid and by:
                birth_years[qid] = int(by)
    print(f"  {len(birth_years)} années de naissance")

    # Politiciens
    politicians = {}
    reader = csv.DictReader(raw["politicians"].decode("utf-8", errors="replace").splitlines())
    for row in reader:
        qid = wikidata_id(row.get("id", ""))
        if qid:
            politicians[qid] = {
                "id": qid,
                "nom": row.get("name", "").strip(),
                "naissance": birth_years.get(qid),
                "is_current_mp": False,
                "groupe_actuel": None,
                "chambre": None,
            }
    print(f"  {len(politicians)} politiciens")

    # Affaires
    affaires = []
    reader = csv.DictReader(raw["affaires"].decode("utf-8", errors="replace").splitlines())
    for row in reader:
        pol_id          = wikidata_id(row.get("politician", ""))
        party_name_raw  = row.get("party", "").strip()
        # Résolution : nom → QID (affaires.csv contient des noms, pas des QIDs)
        party_id        = name_to_qid.get(party_name_raw.lower()) or wikidata_id(party_name_raw)
        pinfo           = parties.get(party_id, {})
        recours  = row.get("recours", "").strip()
        score    = safe_float(row.get("score"), 0.0)
        annee    = safe_float(row.get("annee"))
        position = safe_float(row.get("position"))

        # Âge et durée de carrière au moment de l'affaire
        naissance = politicians.get(pol_id, {}).get("naissance") or birth_years.get(pol_id)
        age_affaire = int(annee - naissance) if (annee and naissance) else None
        # Proxy carrière : suppose début de carrière à 30 ans
        career_years = max(1, age_affaire - 30) if age_affaire and age_affaire > 30 else None

        affaires.append({
            "id":                  f"{pol_id}_{row.get('annee', '')}_{len(affaires)}",
            "politicien_id":       pol_id,
            "politicien_nom":      politicians.get(pol_id, {}).get("nom", pol_id),
            "annee":               int(annee) if annee else None,
            "description":         row.get("affaire", "").strip(),
            "prison_ferme":        safe_float(row.get("prison_ferme")),
            "amende_ferme":        safe_float(row.get("amende_ferme")),
            "ineligibilite_ferme": safe_float(row.get("ineligibilite_ferme")),
            "score_gravite":       score,
            "statut_verdict":      recours or "inconnu",
            "is_definitif":        recours == "definitif",
            "parti_id":            party_id,
            "parti_nom":           pinfo.get("nom", party_id),
            "parti_nom_court":     pinfo.get("nom_court", ""),
            "position_spectre":    position if position is not None else pinfo.get("position"),
            "age_affaire":         age_affaire,
            "career_years":        career_years,
        })

    print(f"  {len(affaires)} affaires")
    return parties, politicians, affaires, birth_years


# ── étape 4 : parlement actuel ────────────────────────────────────────────────

def parse_parlement_actuel(raw: dict, politicians: dict) -> dict:
    print("\n=== Parlement actuel ===")
    groupes = {}

    def normalize_name_local(n):
        return re.sub(r"\s+", " ", n.strip().lower())

    nom_to_qid = {normalize_name_local(p["nom"]): qid for qid, p in politicians.items()}

    # Sénat
    try:
        senateurs = json.loads(raw["senateurs"].decode("utf-8", errors="replace") if raw["senateurs"] else "[]")
        matched = 0
        for s in (senateurs if isinstance(senateurs, list) else []):
            g = s.get("groupe", {})
            nom_g = g.get("libelle", "Inconnu") if isinstance(g, dict) else str(g)
            key = f"{nom_g} (Sénat)"
            groupes.setdefault(key, {"total": 0, "chambre": "Sénat", "nom_court": g.get("libelleCourt", "") if isinstance(g, dict) else ""})
            groupes[key]["total"] += 1
            full = normalize_name_local(f"{s.get('prenom','')} {s.get('nom','')}")
            qid = nom_to_qid.get(full)
            if qid:
                politicians[qid].update({"is_current_mp": True, "groupe_actuel": nom_g, "chambre": "Sénat"})
                matched += 1
        print(f"  {len(senateurs)} sénateurs, {matched} matchés")
    except Exception as e:
        print(f"  [ERREUR] Sénat: {e}")

    # Assemblée nationale
    try:
        zip_path = raw.get("an_zip_path", "")
        if zip_path and Path(zip_path).exists():
            with zipfile.ZipFile(zip_path) as z:
                names = z.namelist()
                organe_noms = {}
                for fname in names:
                    if not fname.startswith("json/organe/"): continue
                    try:
                        org = json.loads(z.read(fname)).get("organe", {})
                        if org.get("codeType") == "GP":
                            organe_noms[org["uid"]] = org.get("libelle", org["uid"])
                    except Exception:
                        pass

                count, matched = 0, 0
                for fname in names:
                    if not fname.startswith("json/acteur/"): continue
                    try:
                        acteur = json.loads(z.read(fname)).get("acteur", {})
                        ident = acteur.get("etatCivil", {}).get("ident", {})
                        full = normalize_name_local(f"{ident.get('prenom','')} {ident.get('nom','')}")
                        mandats = acteur.get("mandats", {}).get("mandat", [])
                        if isinstance(mandats, dict): mandats = [mandats]
                        groupe_ref = None
                        for m in (mandats or []):
                            if m.get("typeOrgane") == "GP" and not m.get("dateFin"):
                                groupe_ref = m.get("organes", {}).get("organeRef", "")
                                break
                        if groupe_ref and groupe_ref in organe_noms:
                            nom_g = organe_noms[groupe_ref]
                            key = f"{nom_g} (AN)"
                            groupes.setdefault(key, {"total": 0, "chambre": "AN", "nom_court": ""})
                            groupes[key]["total"] += 1
                            count += 1
                            qid = nom_to_qid.get(full)
                            if qid:
                                politicians[qid].update({"is_current_mp": True, "groupe_actuel": nom_g, "chambre": "AN"})
                                matched += 1
                    except Exception:
                        pass
                print(f"  {count} députés AN, {matched} matchés")
    except Exception as e:
        print(f"  [ERREUR] AN: {e}")

    return groupes


# ── étape 5 : métriques normalisées ──────────────────────────────────────────

def compute_normalized_metrics(parties: dict, politicians: dict, affaires: list, wikidata: dict) -> list:
    print("\n=== Métriques normalisées ===")

    # Regroupement par parti
    by_parti = defaultdict(lambda: {
        "affaires": [],
        "politiciens": set(),
        "pol_multi": set(),   # récidivistes (2+ affaires)
        "scores": [],
        "ages": [],
        "career_years": [],
    })

    pol_count = defaultdict(lambda: defaultdict(int))  # {parti_id: {pol_id: count}}

    for a in affaires:
        pid = a["parti_id"]
        if not pid: continue
        by_parti[pid]["affaires"].append(a)
        by_parti[pid]["politiciens"].add(a["politicien_id"])
        pol_count[pid][a["politicien_id"]] += 1
        by_parti[pid]["scores"].append(a["score_gravite"] or 0)
        if a["age_affaire"]:
            by_parti[pid]["ages"].append(a["age_affaire"])
        if a["career_years"]:
            by_parti[pid]["career_years"].append(a["career_years"])

    for pid in pol_count:
        for pol_id, cnt in pol_count[pid].items():
            if cnt >= 2:
                by_parti[pid]["pol_multi"].add(pol_id)

    wt = wikidata.get("total", {})

    result = []
    for pid, d in by_parti.items():
        pinfo = parties.get(pid, {})
        nb_aff    = len(d["affaires"])
        nb_pol    = len(d["politiciens"])
        nb_def    = sum(1 for a in d["affaires"] if a["is_definitif"])
        nb_multi  = len(d["pol_multi"])
        scores    = d["scores"]
        ages      = d["ages"]
        cy        = d["career_years"]
        wd_total  = wt.get(pid)

        # Taux de récidive
        taux_recidive = nb_multi / nb_pol if nb_pol > 0 else 0

        # Gravité
        gravite_moy = sum(scores) / len(scores) if scores else 0
        sorted_sc   = sorted(scores)
        gravite_med = sorted_sc[len(sorted_sc) // 2] if sorted_sc else 0

        # Verdict
        taux_definitif = nb_def / nb_aff if nb_aff > 0 else 0

        # Âge moyen à l'affaire
        age_moyen = sum(ages) / len(ages) if ages else None

        # Taux corrigé par politicien-carrière
        # = nb_affaires / somme(career_years) * 100 → affaires pour 100 années-carrière
        sum_cy = sum(cy) if cy else None
        taux_par_carriere = (nb_aff / sum_cy * 100) if sum_cy else None

        # Taux Wikidata : affaires pour 1000 politiciens documentés
        taux_wikidata = (nb_aff / wd_total * 1000) if wd_total else None

        # Taux crapulopédia simple : affaires pour 100 politiciens distincts
        taux_crapu = (nb_aff / nb_pol * 100) if nb_pol > 0 else 0

        result.append({
            "parti_id":          pid,
            "parti_nom":         pinfo.get("nom", pid),
            "parti_nom_court":   pinfo.get("nom_court", ""),
            "position_spectre":  pinfo.get("position"),
            "logo":              pinfo.get("logo", ""),
            # Comptages bruts
            "nb_affaires":       nb_aff,
            "nb_affaires_definitif": nb_def,
            "nb_politiciens_crapu": nb_pol,
            "nb_politiciens_wikidata": wd_total,
            # Taux normalisés
            "taux_crapu":        round(taux_crapu, 3),
            "taux_wikidata":     round(taux_wikidata, 3) if taux_wikidata is not None else None,
            "taux_par_carriere": round(taux_par_carriere, 3) if taux_par_carriere is not None else None,
            "taux_recidive":     round(taux_recidive, 3),
            "taux_definitif":    round(taux_definitif, 3),
            "gravite_moyenne":   round(gravite_moy, 2),
            "gravite_mediane":   round(gravite_med, 2),
            "age_moyen_affaire": round(age_moyen, 1) if age_moyen else None,
            "nb_avec_age":       len(ages),
        })

    print(f"  {len(result)} partis avec métriques normalisées")
    print(f"  Wikidata total disponible pour {sum(1 for r in result if r['taux_wikidata'] is not None)} partis")
    return result


# ── étape 6 : frise cumulative ────────────────────────────────────────────────

def compute_cumulative_timeline(affaires: list, normalized_parties: list, wikidata: dict) -> dict:
    """
    Pour chaque (parti, année t) :
    - cum_affaires : nombre cumulé d'affaires jusqu'à t
    - cum_politiciens_crapu : politiciens distincts dont première affaire ≤ t
    - rate_crapu : ratio (peut être > 1 si récidivistes)
    - cum_membres_wikidata : membres cumulés documentés dans Wikidata jusqu'à t
    - rate_wikidata : affaires pour 1000 membres Wikidata
    """
    print("\n=== Frise cumulative ===")

    # Première affaire par (politicien, parti)
    first_affaire = {}  # (pol_id, parti_id) → year
    for a in affaires:
        key = (a["politicien_id"], a["parti_id"])
        if a["annee"] and (key not in first_affaire or a["annee"] < first_affaire[key]):
            first_affaire[key] = a["annee"]

    # Groupes par parti
    by_parti = defaultdict(list)
    for a in affaires:
        if a["annee"] and a["parti_id"]:
            by_parti[a["parti_id"]].append(a["annee"])

    wd_par_annee = wikidata.get("par_annee", {})

    # Plage d'années
    all_years = [a["annee"] for a in affaires if a["annee"]]
    y_min = min(all_years) if all_years else 1960
    y_max = max(all_years) if all_years else CURRENT_YEAR
    years = list(range(y_min, y_max + 1))

    # Partis à inclure (top par nb d'affaires)
    top_partis = sorted(normalized_parties, key=lambda p: p["nb_affaires"], reverse=True)[:15]
    top_ids    = [p["parti_id"] for p in top_partis]

    timeline = {}
    for pid in top_ids:
        affaires_annees = sorted(by_parti.get(pid, []))
        if not affaires_annees:
            continue

        # Politiciens distincts par première affaire
        pols_by_first = defaultdict(int)  # year → new politicians entering
        for (pol_id, parti_id), yr in first_affaire.items():
            if parti_id == pid:
                pols_by_first[yr] += 1

        # Wikidata cumulative
        wd_years = wd_par_annee.get(pid, {})

        serie = {}
        cum_aff = 0
        cum_pol_crapu = 0
        cum_wd = 0
        aff_idx = 0
        pol_events = sorted(pols_by_first.items())
        pol_idx = 0
        wd_events = sorted(wd_years.items())
        wd_idx = 0

        for yr in years:
            while aff_idx < len(affaires_annees) and affaires_annees[aff_idx] <= yr:
                cum_aff += 1
                aff_idx += 1
            while pol_idx < len(pol_events) and pol_events[pol_idx][0] <= yr:
                cum_pol_crapu += pol_events[pol_idx][1]
                pol_idx += 1
            while wd_idx < len(wd_events) and wd_events[wd_idx][0] <= yr:
                cum_wd += wd_events[wd_idx][1]
                wd_idx += 1

            if cum_aff == 0:
                continue  # pas encore d'affaires pour ce parti

            entry = {
                "cum_affaires":          cum_aff,
                "cum_politiciens_crapu": cum_pol_crapu,
                "rate_crapu":            round(cum_aff / cum_pol_crapu, 3) if cum_pol_crapu > 0 else None,
            }
            if cum_wd > 0:
                entry["cum_membres_wikidata"] = cum_wd
                entry["rate_wikidata"] = round(cum_aff / cum_wd * 1000, 4)
            serie[yr] = entry

        if serie:
            timeline[pid] = {
                "parti_nom":       next((p["parti_nom"] for p in normalized_parties if p["parti_id"] == pid), pid),
                "parti_nom_court": next((p["parti_nom_court"] for p in normalized_parties if p["parti_id"] == pid), ""),
                "position_spectre": next((p["position_spectre"] for p in normalized_parties if p["parti_id"] == pid), None),
                "serie":           serie,
                "has_wikidata":    any("rate_wikidata" in v for v in serie.values()),
            }

    print(f"  {len(timeline)} partis dans la frise, plage {y_min}–{y_max}")
    return {"years_range": [y_min, y_max], "partis": timeline}


# ── étape 7 : export ──────────────────────────────────────────────────────────

def export_json(parties, politicians, affaires, normalized_parties, cumulative, groupes):
    print("\n=== Export JSON ===")

    # affairs_enriched.json
    aff_out = []
    for a in affaires:
        pol = politicians.get(a["politicien_id"], {})
        aff_out.append({**a, "is_current_mp": pol.get("is_current_mp", False),
                        "groupe_actuel": pol.get("groupe_actuel"), "chambre": pol.get("chambre")})
    (OUT_DIR / "affairs.json").write_text(json.dumps(aff_out, ensure_ascii=False, indent=2))
    print(f"  affairs.json — {len(aff_out)} affaires")

    # normalized_parties.json (remplace parties.json)
    (OUT_DIR / "parties.json").write_text(json.dumps(normalized_parties, ensure_ascii=False, indent=2))
    print(f"  parties.json — {len(normalized_parties)} partis normalisés")

    # cumulative_timeline.json
    (OUT_DIR / "cumulative.json").write_text(json.dumps(cumulative, ensure_ascii=False, indent=2))
    print(f"  cumulative.json — {len(cumulative['partis'])} partis")

    # stats.json — méta + agrégats
    annees = sorted(set(a["annee"] for a in affaires if a["annee"]))
    meta = {
        "date_generation":     datetime.utcnow().isoformat() + "Z",
        "nb_affaires_total":   len(affaires),
        "nb_affaires_definitif": sum(1 for a in affaires if a["is_definitif"]),
        "nb_politiciens":      len(politicians),
        "nb_partis":           len(normalized_parties),
        "annee_min":           min(annees) if annees else None,
        "annee_max":           max(annees) if annees else None,
        "nb_avec_wikidata":    sum(1 for p in normalized_parties if p["taux_wikidata"] is not None),
        "nb_avec_age":         sum(1 for a in affaires if a["age_affaire"]),
    }
    # Chronologie brute (pour filtrage JS)
    chrono = defaultdict(lambda: defaultdict(int))
    for a in affaires:
        if a["annee"] and a["parti_id"]:
            chrono[a["annee"]][a["parti_id"]] += 1

    stats_out = {
        "meta": meta,
        "chronologie": {str(y): dict(v) for y, v in sorted(chrono.items())},
        "groupes_parlement": {k: {"total": v["total"], "chambre": v["chambre"]} for k, v in groupes.items()},
    }
    (OUT_DIR / "stats.json").write_text(json.dumps(stats_out, ensure_ascii=False, indent=2))
    print(f"  stats.json — généré")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Pipeline Crapulopédia × Parlement Français v2")
    print("=" * 60)

    raw                       = download_all()
    parties, politicians, affaires, birth_years = parse_crapulopedia(raw)
    groupes                   = parse_parlement_actuel(raw, politicians)

    # IDs des partis avec affaires pour Wikidata
    party_ids_with_affairs = list({a["parti_id"] for a in affaires if a["parti_id"].startswith("Q")})
    wikidata                  = query_wikidata(party_ids_with_affairs)

    normalized_parties        = compute_normalized_metrics(parties, politicians, affaires, wikidata)
    cumulative                = compute_cumulative_timeline(affaires, normalized_parties, wikidata)

    export_json(parties, politicians, affaires, normalized_parties, cumulative, groupes)
    print("\n✓ Pipeline v2 terminé — fichiers dans docs/data/")


if __name__ == "__main__":
    main()
