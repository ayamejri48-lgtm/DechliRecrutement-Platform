"""Phase 1 Data Understanding — read-only analysis, writes report under data/processed."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
OUT = PROC / "phase1_data_understanding.json"

IT_HINT = re.compile(
    r"software|developer|engineer|data|python|java|devops|cyber|security|ml|ai|"
    r"cloud|backend|frontend|full.?stack|analyst|architect|it\b|information.?tech|"
    r"machine learning|network",
    re.I,
)


def nonempty(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().ne("")


def main() -> None:
    cv = pd.read_csv(RAW / "pfe_cv_12000.csv", dtype=str, low_memory=False)
    off = pd.read_csv(RAW / "pfe_offres_12000.csv", dtype=str, low_memory=False)

    cv_len = cv["cv_text"].fillna("").str.len()
    off_len = off["description"].fillna("").str.len()

    # IT-ish categories for PFE focus estimate
    cat_counts = cv["category"].fillna("UNKNOWN").value_counts()
    it_mask = cv["category"].fillna("").str.contains(IT_HINT)
    it_cats = (
        cv.loc[it_mask, "category"]
        .value_counts()
        .head(30)
        .to_dict()
    )

    # skills_raw parseability sample
    skills_present = nonempty(cv["skills_raw"])
    parse_ok = 0
    parse_fail = 0
    skill_name_counter: Counter[str] = Counter()
    sample = cv.loc[skills_present].head(2000)
    for raw in sample["skills_raw"]:
        try:
            obj = json.loads(raw)
            parse_ok += 1
            # walk nested dict/list for name fields
            def walk(node):
                if isinstance(node, dict):
                    if "name" in node and isinstance(node["name"], str):
                        skill_name_counter[node["name"].strip().lower()] += 1
                    for v in node.values():
                        walk(v)
                elif isinstance(node, list):
                    for x in node:
                        walk(x)

            walk(obj)
        except Exception:
            parse_fail += 1

    # offer title IT-ish
    off_it = off["title"].fillna("").str.contains(IT_HINT)

    # extracted sample if present
    extract_stats = None
    cex = PROC / "cv_extracted.csv"
    if cex.exists():
        ex = pd.read_csv(cex, dtype=str, low_memory=False)
        has = ~ex["skills_extracted"].fillna("").str.strip().isin(["", "[]", "null"])
        extract_stats = {
            "rows": int(len(ex)),
            "skills_hit_rate": round(float(has.mean()), 4),
            "by_category_hit_rate": {
                str(k): {
                    "n": int(v["count"]),
                    "hit_rate": round(float(v["mean"]), 4),
                }
                for k, v in ex.assign(_h=has)
                .groupby("category")["_h"]
                .agg(["mean", "count"])
                .sort_values("count", ascending=False)
                .head(12)
                .iterrows()
            },
        }

    ann_stats = None
    ann = PROC / "annotation_candidates.csv"
    if ann.exists():
        a = pd.read_csv(ann, dtype=str)
        weak = pd.to_numeric(a.get("weak_label_score"), errors="coerce")
        ann_stats = {
            "rows": int(len(a)),
            "label_score_filled": int(a["label_score"].fillna("").str.strip().ne("").sum()),
            "weak_nonnull": int(weak.notna().sum()),
            "weak_mean": float(weak.mean()) if weak.notna().any() else None,
        }

    parent_sizes = cv.groupby("parent_id").size()

    report = {
        "phase": "1-data-understanding",
        "generated_from": {
            "cv": str(RAW / "pfe_cv_12000.csv"),
            "offres": str(RAW / "pfe_offres_12000.csv"),
        },
        "cv": {
            "rows": int(len(cv)),
            "columns": list(cv.columns),
            "exact_duplicate_rows": int(cv.duplicated().sum()),
            "empty_cv_text": int((~nonempty(cv["cv_text"])).sum()),
            "unique_parent_id": int(cv["parent_id"].nunique()),
            "augmented_rows": int((cv["is_augmented"].astype(str) == "1").sum()),
            "source_counts": cv["source"].value_counts(dropna=False).to_dict(),
            "category_nunique": int(cv["category"].nunique()),
            "category_top15": cat_counts.head(15).to_dict(),
            "category_bottom10": cat_counts.tail(10).to_dict(),
            "structured_empty": {
                "skills_raw": int((~nonempty(cv["skills_raw"])).sum()),
                "experience_raw": int((~nonempty(cv["experience_raw"])).sum()),
                "education_raw": int((~nonempty(cv["education_raw"])).sum()),
            },
            "cv_text_len": {
                "min": int(cv_len.min()),
                "p50": float(cv_len.median()),
                "p95": float(cv_len.quantile(0.95)),
                "max": int(cv_len.max()),
                "mean": float(cv_len.mean()),
            },
            "parent_variants": {
                "mean": float(parent_sizes.mean()),
                "p50": float(parent_sizes.median()),
                "max": int(parent_sizes.max()),
            },
            "it_like_rows_estimate": int(it_mask.sum()),
            "it_like_share": round(float(it_mask.mean()), 4),
            "it_like_top_categories": it_cats,
            "skills_raw_json_sample": {
                "sampled": int(len(sample)),
                "parse_ok": parse_ok,
                "parse_fail": parse_fail,
                "top_skill_names_20": dict(skill_name_counter.most_common(20)),
            },
        },
        "offres": {
            "rows": int(len(off)),
            "columns": list(off.columns),
            "exact_duplicate_rows": int(off.duplicated().sum()),
            "empty_title": int((~nonempty(off["title"])).sum()),
            "empty_description": int((~nonempty(off["description"])).sum()),
            "unique_titles": int(off["title"].nunique()),
            "duplicate_titles": int(off["title"].duplicated().sum()),
            "skills_desc_empty": int((~nonempty(off["skills_desc"])).sum()),
            "experience_level_counts": off["experience_level"]
            .fillna("NULL")
            .value_counts()
            .to_dict(),
            "work_type_counts": off["work_type"].fillna("NULL").value_counts().to_dict(),
            "description_len": {
                "min": int(off_len.min()),
                "p50": float(off_len.median()),
                "p95": float(off_len.quantile(0.95)),
                "max": int(off_len.max()),
                "mean": float(off_len.mean()),
            },
            "it_like_title_rows": int(off_it.sum()),
            "it_like_title_share": round(float(off_it.mean()), 4),
        },
        "pairing": {
            "native_cv_offer_pairs": False,
            "implication": (
                "Supervised matching requires constructing pairs and human label_score; "
                "raw corpora alone are insufficient."
            ),
        },
        "existing_processed": {
            "cleaning_report_exists": (PROC / "cleaning_report.json").exists(),
            "cv_extracted": extract_stats,
            "annotation_candidates": ann_stats,
            "matching_model_exists": (ROOT / "models" / "matching_model.joblib").exists(),
        },
        "anomalies": [
            {
                "id": "A1",
                "severity": "high",
                "title": "No labeled CV↔offer pairs in raw data",
                "detail": "Two independent corpora; blocks supervised training until annotation.",
            },
            {
                "id": "A2",
                "severity": "high",
                "title": "Offer skills_desc almost empty (~98%)",
                "detail": "Offer skills for matching must come from NLP/LLM extraction or platform offre_skills.",
            },
            {
                "id": "A3",
                "severity": "medium",
                "title": "CV augmentations share parent_id",
                "detail": "Must GroupShuffleSplit by parent_id to avoid leakage.",
            },
            {
                "id": "A4",
                "severity": "medium",
                "title": "Heterogeneous non-IT categories (Chef, Fitness, etc.)",
                "detail": "Rule lexicon hit-rate low outside IT; annotation should prioritize IT/Data/Cyber.",
            },
            {
                "id": "A5",
                "severity": "medium",
                "title": "Batch extract only 500 rows; low skill hit-rate overall",
                "detail": extract_stats,
            },
            {
                "id": "A6",
                "severity": "low",
                "title": "Duplicate offer titles (3802)",
                "detail": "Prefer offer_id as unique key; titles are not unique.",
            },
            {
                "id": "A7",
                "severity": "high",
                "title": "Zero human label_score in annotation_candidates",
                "detail": ann_stats,
            },
        ],
        "assumptions_for_pfe": {
            "annotation_focus": "IT / Software / Data / AI / Cyber / DevOps titles & categories",
            "annotation_target_pairs": 400,
            "min_pairs_for_03_train": 100,
            "weak_labels_as_gold": False,
            "baseline_frozen": "hybrid-v3",
            "api_budget_eur": 0,
        },
    }

    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(OUT), "cv_rows": report["cv"]["rows"], "off_rows": report["offres"]["rows"], "anomalies": len(report["anomalies"])}, indent=2))


if __name__ == "__main__":
    main()

