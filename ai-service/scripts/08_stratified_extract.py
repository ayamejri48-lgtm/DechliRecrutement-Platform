"""Phase 2 — Stratified NLP extraction sample over cleaned CV/offer corpora.

Produces data/processed/cv_extracted_stratified.csv and offres_extracted_stratified.csv
plus a small JSON report. Does not overwrite the historical 500-row extract unless asked.
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

from app.nlp import extract, normalize_skills


def stratified_sample(df: pd.DataFrame, col: str, n: int, seed: int) -> pd.DataFrame:
    if col not in df.columns or df[col].nunique() <= 1:
        return df.sample(n=min(n, len(df)), random_state=seed)
    groups = list(df.groupby(col, dropna=False))
    per = max(1, n // max(1, len(groups)))
    parts = []
    for _, g in groups:
        parts.append(g.sample(n=min(per, len(g)), random_state=seed))
    out = pd.concat(parts, ignore_index=True)
    if len(out) > n:
        out = out.sample(n=n, random_state=seed)
    elif len(out) < n:
        extra = df.drop(index=out.index, errors="ignore")
        need = n - len(out)
        if len(extra) > 0:
            out = pd.concat(
                [out, extra.sample(n=min(need, len(extra)), random_state=seed + 1)],
                ignore_index=True,
            )
    return out.reset_index(drop=True)


def run_extract(df: pd.DataFrame, text_col: str) -> pd.DataFrame:
    results = [extract(s) for s in df[text_col].fillna("")]
    out = df.copy()
    out["skills_extracted"] = [json.dumps(r["skills"], ensure_ascii=False) for r in results]
    out["skills_normalized"] = [
        json.dumps(normalize_skills(r["skills"]), ensure_ascii=False) for r in results
    ]
    out["experience_years_extracted"] = [r["experienceYears"] for r in results]
    out["education_extracted"] = [r["education"] for r in results]
    out["education_status_extracted"] = [r.get("educationStatus") for r in results]
    out["specialty_extracted"] = [r.get("specialty") for r in results]
    out["extract_method"] = [r.get("method") for r in results]
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--cv", default="data/processed/cv_cleaned.csv")
    p.add_argument("--offres", default="data/processed/offres_cleaned.csv")
    p.add_argument("--out-dir", default="data/processed")
    p.add_argument("--n-cv", type=int, default=1200)
    p.add_argument("--n-offres", type=int, default=1200)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args()

    out_dir = ROOT / a.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    cv = pd.read_csv(ROOT / a.cv, dtype=str).fillna("")
    off = pd.read_csv(ROOT / a.offres, dtype=str).fillna("")
    if "cv_text_clean" not in cv.columns or "description_clean" not in off.columns:
        raise SystemExit("Run scripts/01_clean.py first")

    cv_s = stratified_sample(cv, "category", a.n_cv, a.seed)
    off_s = stratified_sample(off, "work_type", a.n_offres, a.seed)

    cv_out = run_extract(cv_s, "cv_text_clean")
    off_out = run_extract(
        off_s.assign(
            _text=off_s["title_clean"].fillna("") + "\n" + off_s["description_clean"].fillna("")
        ),
        "_text",
    )
    off_out = off_out.drop(columns=["_text"], errors="ignore")

    cv_path = out_dir / "cv_extracted_stratified.csv"
    off_path = out_dir / "offres_extracted_stratified.csv"
    cv_out.to_csv(cv_path, index=False)
    off_out.to_csv(off_path, index=False)

    def skill_hit(series: pd.Series) -> float:
        return float((~series.fillna("").str.strip().isin(["", "[]"])).mean())

    report = {
        "n_cv": int(len(cv_out)),
        "n_offres": int(len(off_out)),
        "cv_skill_hit_rate": round(skill_hit(cv_out["skills_extracted"]), 4),
        "offer_skill_hit_rate": round(skill_hit(off_out["skills_extracted"]), 4),
        "cv_exp_nonnull_rate": round(
            float(pd.to_numeric(cv_out["experience_years_extracted"], errors="coerce").notna().mean()),
            4,
        ),
        "cv_edu_nonnull_rate": round(
            float(cv_out["education_extracted"].fillna("").str.strip().ne("").mean()),
            4,
        ),
        "cv_categories_sampled": int(cv_out["category"].nunique()) if "category" in cv_out else None,
        "paths": {"cv": str(cv_path), "offres": str(off_path)},
    }
    (out_dir / "stratified_extract_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
