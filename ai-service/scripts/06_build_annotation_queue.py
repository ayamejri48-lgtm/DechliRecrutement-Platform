"""Phase 2 — Build a diversified annotation queue (default 1000 pairs).

- Uses existing cleaned 12k CV + 12k offer corpora only.
- One CV variant per parent_id (avoids annotating near-duplicates).
- Mix: same-domain positives, hard near-domain, cross-domain negatives, random.
- label_score and label_source left EMPTY (no fake human labels).
- Writes CSV + diversity report JSON.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd

from app.matching import hybrid
from app.nlp import extract

# Coarse buckets for diversity + hard negatives (PFE-friendly).
DOMAIN_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("software_java", re.compile(r"\bjava\b|spring|j2ee|jakarta|hibernate|jvm", re.I)),
    ("software_js", re.compile(r"javascript|typescript|react|angular|vue|node\.?js|frontend", re.I)),
    ("data_ai", re.compile(r"data science|machine learning|\bml\b|\bnlp\b|pytorch|tensorflow|deep learning|\bai\b|data engineer|data analyst|pandas|spark", re.I)),
    ("devops_cloud", re.compile(r"devops|kubernetes|docker|terraform|jenkins|ci/?cd|aws|azure|gcp|sre|cloud", re.I)),
    ("cyber", re.compile(r"cyber|security|soc|siem|splunk|pentest|infosec|sécurité|securite", re.I)),
    ("hr", re.compile(r"\bhr\b|human resources|recrut|talent|people ops", re.I)),
    ("finance", re.compile(r"finance|account|banking|audit|comptable|treasury", re.I)),
    ("sales_marketing", re.compile(r"sales|marketing|business.?development|seo|crm", re.I)),
    ("healthcare", re.compile(r"health|nurse|nursing|medical|clinical|hôpital|hopital", re.I)),
    ("other", re.compile(r".*", re.I)),
]

# Pairs of buckets considered "hard" (look similar / adjacent but often mismatch).
HARD_BUCKET_PAIRS = [
    ("data_ai", "devops_cloud"),
    ("software_java", "software_js"),
    ("data_ai", "software_java"),
    ("cyber", "devops_cloud"),
    ("hr", "sales_marketing"),
    ("finance", "sales_marketing"),
]


def _bucket(text: str) -> str:
    for name, pat in DOMAIN_PATTERNS:
        if name == "other":
            continue
        if pat.search(text or ""):
            return name
    return "other"


def _profile(ext: dict, required: list[str] | None = None) -> dict:
    return {
        "skills": ext.get("skills") or [],
        "requiredSkills": required or [],
        "experienceYears": ext.get("experienceYears"),
        "education": ext.get("education"),
        "educationStatus": ext.get("educationStatus"),
        "title": None,
        "summary": None,
    }


def _preview(text: str, n: int = 400) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t[:n]


def _sample_bucket(df: pd.DataFrame, bucket: str, n: int, seed: int) -> pd.DataFrame:
    sub = df[df["_bucket"] == bucket]
    if len(sub) == 0:
        return df.sample(n=min(n, len(df)), random_state=seed)
    if len(sub) >= n:
        return sub.sample(n=n, random_state=seed)
    # top-up from same df
    extra = df.drop(index=sub.index, errors="ignore")
    need = n - len(sub)
    if len(extra) == 0:
        return sub.sample(n=min(n, len(sub)), replace=True, random_state=seed)
    return pd.concat([sub, extra.sample(n=min(need, len(extra)), random_state=seed)], ignore_index=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--cv", default="data/processed/cv_cleaned.csv")
    p.add_argument("--offres", default="data/processed/offres_cleaned.csv")
    p.add_argument("--out", default="data/processed/annotation_queue_1000.csv")
    p.add_argument("--pairs", type=int, default=1000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--compute-weak", action="store_true")
    a = p.parse_args()

    cv = pd.read_csv(ROOT / a.cv, dtype=str).fillna("")
    off = pd.read_csv(ROOT / a.offres, dtype=str).fillna("")
    if "cv_text_clean" not in cv.columns or "description_clean" not in off.columns:
        raise SystemExit("Run scripts/01_clean.py first")

    # Deduplicate variants sharing parent_id (keep non-augmented preferentially).
    cv = (
        cv.sort_values(["parent_id", "is_augmented"])
        .groupby("parent_id", as_index=False)
        .head(1)
        .reset_index(drop=True)
    )
    cv["_bucket"] = [
        _bucket(f"{r.get('category', '')} {str(r.get('cv_text_clean', ''))[:800]}")
        for _, r in cv.iterrows()
    ]
    off["_bucket"] = [
        _bucket(
            f"{r.get('title_clean', r.get('title', ''))} {str(r.get('description_clean', ''))[:800]}"
        )
        for _, r in off.iterrows()
    ]

    n = int(a.pairs)
    n_pos = int(round(n * 0.30))
    n_hard = int(round(n * 0.30))
    n_cross = int(round(n * 0.25))
    n_rand = n - n_pos - n_hard - n_cross

    rng = a.seed
    planned: list[tuple[str, pd.Series, pd.Series]] = []
    seen_pairs: set[tuple[str, str]] = set()
    used_parents: dict[str, int] = {}

    def _add(pair_type: str, c: pd.Series, o: pd.Series) -> bool:
        key = (str(c["cv_id"]), str(o["offer_id"]))
        if key in seen_pairs:
            return False
        # Cap how often the same parent_id appears (diversity)
        pid = str(c["parent_id"])
        if used_parents.get(pid, 0) >= 3:
            return False
        seen_pairs.add(key)
        used_parents[pid] = used_parents.get(pid, 0) + 1
        planned.append((pair_type, c, o))
        return True

    buckets = [b for b, _ in DOMAIN_PATTERNS if b != "other"]
    # --- same-domain positives ---
    i = 0
    attempts = 0
    while len([1 for t, _, _ in planned if t == "same_domain_positive"]) < n_pos and attempts < n_pos * 20:
        attempts += 1
        b = buckets[i % len(buckets)]
        i += 1
        c_df = _sample_bucket(cv, b, 1, rng + attempts)
        o_df = _sample_bucket(off, b, 1, rng + 1000 + attempts)
        if len(c_df) and len(o_df):
            _add("same_domain_positive", c_df.iloc[0], o_df.iloc[0])

    # --- hard near-domain ---
    attempts = 0
    hi = 0
    while len([1 for t, _, _ in planned if t == "hard_near_domain"]) < n_hard and attempts < n_hard * 25:
        attempts += 1
        b1, b2 = HARD_BUCKET_PAIRS[hi % len(HARD_BUCKET_PAIRS)]
        hi += 1
        # alternate direction
        if attempts % 2 == 0:
            b1, b2 = b2, b1
        c_df = _sample_bucket(cv, b1, 1, rng + 2000 + attempts)
        o_df = _sample_bucket(off, b2, 1, rng + 3000 + attempts)
        if len(c_df) and len(o_df):
            _add("hard_near_domain", c_df.iloc[0], o_df.iloc[0])

    # --- cross-domain negatives ---
    attempts = 0
    while len([1 for t, _, _ in planned if t == "cross_domain_negative"]) < n_cross and attempts < n_cross * 25:
        attempts += 1
        c_row = cv.sample(n=1, random_state=rng + 4000 + attempts).iloc[0]
        # force different bucket when possible
        other = off[off["_bucket"] != c_row["_bucket"]]
        if len(other) == 0:
            other = off
        o_row = other.sample(n=1, random_state=rng + 5000 + attempts).iloc[0]
        _add("cross_domain_negative", c_row, o_row)

    # --- random ---
    attempts = 0
    while len([1 for t, _, _ in planned if t == "random_pair"]) < n_rand and attempts < n_rand * 20:
        attempts += 1
        c_row = cv.sample(n=1, random_state=rng + 6000 + attempts).iloc[0]
        o_row = off.sample(n=1, random_state=rng + 7000 + attempts).iloc[0]
        _add("random_pair", c_row, o_row)

    # Top-up if short
    attempts = 0
    while len(planned) < n and attempts < n * 30:
        attempts += 1
        c_row = cv.sample(n=1, random_state=rng + 8000 + attempts).iloc[0]
        o_row = off.sample(n=1, random_state=rng + 9000 + attempts).iloc[0]
        _add("random_pair", c_row, o_row)

    planned = planned[:n]

    rows = []
    for idx, (pair_type, c, o) in enumerate(planned):
        c_ext = extract(c["cv_text_clean"])
        o_text = f"{o.get('title_clean') or o.get('title')}\n{o.get('description_clean')}"
        o_ext = extract(o_text)
        req = (o_ext.get("skills") or [])[: max(1, len(o_ext.get("skills") or []) // 2)]
        cand = _profile(c_ext)
        cand["title"] = (c.get("category") or "")[:200] or None
        offer = _profile(o_ext, required=req)
        offer["title"] = (o.get("title_clean") or o.get("title") or "")[:200] or None
        weak = ""
        if a.compute_weak:
            score = hybrid(cand, offer).get("score")
            weak = score if score is not None else ""
        rows.append(
            {
                "annotation_id": f"ANN{idx:05d}",
                "pair_type": pair_type,
                "cv_domain_bucket": c.get("_bucket", ""),
                "offer_domain_bucket": o.get("_bucket", ""),
                "parent_id": c["parent_id"],
                "cv_id": c["cv_id"],
                "offer_id": o["offer_id"],
                "cv_category": c.get("category", ""),
                "offer_title": o.get("title_clean") or o.get("title", ""),
                "cv_text_preview": _preview(c.get("cv_text_clean", ""), 450),
                "offer_text_preview": _preview(o_text, 450),
                "cv_profile_json": json.dumps(cand, ensure_ascii=False),
                "offer_profile_json": json.dumps(offer, ensure_ascii=False),
                "weak_label_score": weak,
                "label_score": "",
                "label_source": "",
                "label_method": "",
                "notes": "",
                # Annotation grid helper columns (filled by human optionally)
                "score_skills": "",
                "score_experience": "",
                "score_education": "",
                "score_job_fit": "",
            }
        )

    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    df_out = pd.DataFrame(rows)
    df_out.to_csv(out, index=False)

    # Diversity report
    report = {
        "rows": int(len(df_out)),
        "out": str(out),
        "seed": a.seed,
        "warning": (
            "label_score and label_source are EMPTY. "
            "Do not copy weak_label_score as human truth."
        ),
        "pair_type_counts": df_out["pair_type"].value_counts().to_dict(),
        "cv_domain_bucket_counts": df_out["cv_domain_bucket"].value_counts().to_dict(),
        "offer_domain_bucket_counts": df_out["offer_domain_bucket"].value_counts().to_dict(),
        "unique_parent_id": int(df_out["parent_id"].nunique()),
        "unique_cv_id": int(df_out["cv_id"].nunique()),
        "unique_offer_id": int(df_out["offer_id"].nunique()),
        "duplicate_cv_offer_pairs": int(
            df_out.duplicated(subset=["cv_id", "offer_id"]).sum()
        ),
        "max_pairs_per_parent_id": int(df_out.groupby("parent_id").size().max()),
        "unique_cv_categories": int(df_out["cv_category"].nunique()),
        "split_after_annotation": {
            "train": 0.70,
            "validation": 0.15,
            "test": 0.15,
            "group_by": "parent_id",
            "script": "scripts/07_build_feature_matrix.py --val-size 0.15 --test-size 0.15",
        },
        "hard_bucket_pairs": HARD_BUCKET_PAIRS,
        "weak_computed": bool(a.compute_weak),
    }
    report_path = out.with_name(out.stem + "_diversity_report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    out.with_suffix(".meta.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
