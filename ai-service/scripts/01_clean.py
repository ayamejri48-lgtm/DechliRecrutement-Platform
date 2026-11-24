"""CRISP-DM Data Understanding + Data Preparation (cleaning).

Preserves original CSVs; writes cleaned copies + cleaning_report.json.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd


def clean(s):
    if pd.isna(s):
        return ""
    return re.sub(
        r"\s+",
        " ",
        re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", str(s).replace("\xa0", " ")),
    ).strip()


def run(src, kind, out):
    df = pd.read_csv(src, dtype=str, low_memory=False)
    needed = (
        ["cv_id", "parent_id", "cv_text"]
        if kind == "cv"
        else ["offer_id", "title", "description"]
    )
    missing = set(needed) - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    text_cols = ["cv_text"] if kind == "cv" else ["title", "description"]
    report = {
        "rows": len(df),
        "columns": list(df.columns),
        "null_counts": {k: int(v) for k, v in df.isna().sum().items()},
        "exact_duplicates": int(df.duplicated().sum()),
        "empty_text_rows": {
            c: int((df[c].fillna("").astype(str).str.strip() == "").sum()) for c in text_cols
        },
    }
    for c in text_cols:
        df[c + "_clean"] = df[c].map(clean)
        lengths = df[c + "_clean"].str.len()
        report[f"{c}_len_mean"] = float(lengths.mean()) if len(lengths) else 0.0
        report[f"{c}_len_p50"] = float(lengths.median()) if len(lengths) else 0.0
        report[f"{c}_len_p95"] = float(lengths.quantile(0.95)) if len(lengths) else 0.0

    if kind == "cv":
        report["unique_parent_ids"] = int(df["parent_id"].nunique())
        if "is_augmented" in df.columns:
            report["augmented_rows"] = int((df["is_augmented"].astype(str) == "1").sum())
        # Variants of the same CV share parent_id — critical for leakage control later.
        report["max_variants_per_parent"] = int(df.groupby("parent_id").size().max())
    else:
        report["unique_titles"] = int(df["title"].nunique())
        report["duplicate_titles"] = int(df["title"].duplicated().sum())

    df.to_csv(out, index=False)
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cv", required=True)
    p.add_argument("--offres", required=True)
    p.add_argument("--out", default="data/processed")
    a = p.parse_args()
    d = Path(a.out)
    d.mkdir(parents=True, exist_ok=True)
    r = {
        "cv": run(a.cv, "cv", d / "cv_cleaned.csv"),
        "offres": run(a.offres, "offres", d / "offres_cleaned.csv"),
    }
    (d / "cleaning_report.json").write_text(
        json.dumps(r, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(r, indent=2))
