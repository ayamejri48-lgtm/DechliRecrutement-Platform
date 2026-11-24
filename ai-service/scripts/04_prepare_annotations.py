"""Prepare TRACEABLE CV–offer annotation candidates.

IMPORTANT:
- Labels produced here are WEAK / HEURISTIC (from hybrid features), NOT human ground truth.
- They are suitable for annotation prioritization and pipeline smoke tests only.
- Do NOT present these labels to a jury as verified gold data.
- Supervised training (`03_train.py`) should prefer human-validated `label_score` values.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd

from app.matching import hybrid
from app.nlp import extract


def _profile_from_extract(ext: dict, required: list[str] | None = None) -> dict:
    return {
        "skills": ext.get("skills") or [],
        "requiredSkills": required or [],
        "experienceYears": ext.get("experienceYears"),
        "education": ext.get("education"),
        "title": None,
        "summary": None,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cv", default="data/processed/cv_cleaned.csv")
    p.add_argument("--offres", default="data/processed/offres_cleaned.csv")
    p.add_argument("--out", default="data/processed/annotation_candidates.csv")
    p.add_argument("--pairs", type=int, default=200)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args()

    cv = pd.read_csv(a.cv, dtype=str).fillna("")
    offres = pd.read_csv(a.offres, dtype=str).fillna("")
    if "cv_text_clean" not in cv.columns or "description_clean" not in offres.columns:
        raise SystemExit("Run scripts/01_clean.py first")

    cv_sample = cv.sample(n=min(a.pairs, len(cv)), random_state=a.seed)
    off_sample = offres.sample(n=min(a.pairs, len(offres)), random_state=a.seed + 1)

    rows = []
    for i, ((_, c), (_, o)) in enumerate(zip(cv_sample.iterrows(), off_sample.iterrows())):
        c_ext = extract(c["cv_text_clean"])
        o_ext = extract(o["description_clean"] + " " + o.get("title_clean", ""))
        # Weak required skills: top half of offer skills (heuristic — mark as such).
        req = (o_ext.get("skills") or [])[: max(1, len(o_ext.get("skills") or []) // 2)]
        cand = _profile_from_extract(c_ext)
        offer = _profile_from_extract(o_ext, required=req)
        offer["title"] = o.get("title_clean") or o.get("title")
        match = hybrid(cand, offer)
        weak = match["score"]
        rows.append(
            {
                "annotation_id": f"ANN{i:05d}",
                "parent_id": c["parent_id"],
                "cv_id": c["cv_id"],
                "offer_id": o["offer_id"],
                "cv_profile_json": json.dumps(cand, ensure_ascii=False),
                "offer_profile_json": json.dumps(offer, ensure_ascii=False),
                "weak_label_score": weak,
                "label_score": "",  # leave blank for human annotator
                "label_source": "pending_human",
                "label_method": "hybrid-baseline-v2-weak-prioritization-only",
                "notes": "",
            }
        )

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    meta = {
        "rows": len(rows),
        "warning": (
            "weak_label_score is NOT ground truth. Fill label_score via human review "
            "before supervised training."
        ),
        "recommended_human_protocol": [
            "Score each pair in [0,1] for role relevance (skills/exp/education).",
            "Do not use titles alone; reject high scores for AI Engineer vs Data Engineer without skill overlap.",
            "Record annotator id and disagreements; adjudicate ties.",
            "Keep all variants of the same parent_id consistent when possible.",
        ],
    }
    out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(out), **meta}, indent=2))
