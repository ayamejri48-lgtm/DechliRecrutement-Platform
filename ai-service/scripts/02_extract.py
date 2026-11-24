"""Batch NLP extraction over cleaned CV/offer corpora."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd

from app.nlp import extract


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cv", default="data/processed/cv_cleaned.csv")
    p.add_argument("--offres", default="data/processed/offres_cleaned.csv")
    p.add_argument("--out", default="data/processed")
    p.add_argument("--limit", type=int, default=0, help="Optional row cap for smoke runs")
    a = p.parse_args()
    d = Path(a.out)
    d.mkdir(parents=True, exist_ok=True)

    for kind, src, col in [
        ("cv", a.cv, "cv_text_clean"),
        ("offres", a.offres, "description_clean"),
    ]:
        df = pd.read_csv(src, dtype=str).fillna("")
        if col not in df.columns:
            raise ValueError("Run cleaning first")
        if a.limit and a.limit > 0:
            df = df.head(a.limit)
        results = [extract(s) for s in df[col]]
        df["skills_extracted"] = [json.dumps(r["skills"]) for r in results]
        df["experience_years_extracted"] = [r["experienceYears"] for r in results]
        df["education_extracted"] = [r["education"] for r in results]
        df["specialty_extracted"] = [r.get("specialty") for r in results]
        df.to_csv(d / f"{kind}_extracted.csv", index=False)
        nonempty_skills = sum(1 for r in results if r["skills"])
        print(
            json.dumps(
                {
                    "kind": kind,
                    "rows": len(df),
                    "rows_with_skills": nonempty_skills,
                    "skill_hit_rate": round(nonempty_skills / len(df), 4) if len(df) else 0,
                }
            )
        )
