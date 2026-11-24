"""Phase 2 — Materialize feature matrix from annotated_pairs.csv (human labels required).

Reads only rows with numeric label_score. Writes:
  - data/processed/features_labeled.csv
  - data/processed/splits_parent_id.json (GroupShuffle by parent_id: ~70% train / 15% val / 15% test)

Does NOT train a model. Safe to run after human annotation.
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
from sklearn.model_selection import GroupShuffleSplit

from app.matching import NUMERIC_FEATURES, features


def parse_json(s: str) -> dict:
    if pd.isna(s) or not str(s).strip():
        return {}
    v = json.loads(s)
    if not isinstance(v, dict):
        raise ValueError("profile must be object")
    return v


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--annotations",
        default="data/processed/annotated_pairs.csv",
        help="CSV with label_score filled by humans",
    )
    p.add_argument("--out-features", default="data/processed/features_labeled.csv")
    p.add_argument("--out-splits", default="data/processed/splits_parent_id.json")
    p.add_argument("--val-size", type=float, default=0.15)
    p.add_argument("--test-size", type=float, default=0.15)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args()

    path = ROOT / a.annotations
    if not path.exists():
        raise SystemExit(
            f"Missing {path}. Copy annotation_queue_it.csv → annotated_pairs.csv "
            "after filling label_score (see docs/ANNOTATION_PROTOCOL.md)."
        )

    df = pd.read_csv(path)
    required = {"parent_id", "cv_profile_json", "offer_profile_json", "label_score"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Missing columns: {missing}")

    df["label_score"] = pd.to_numeric(df["label_score"], errors="coerce")
    df = df[df["label_score"].notna()].copy()
    if len(df) == 0:
        raise SystemExit(
            "BLOCKER: no human label_score filled yet. "
            "Annotate data/processed/annotation_queue_it.csv first."
        )
    if not df["label_score"].between(0, 1).all():
        raise SystemExit("label_score must be in [0,1]")
    if "label_source" in df.columns:
        human = df["label_source"].astype(str).str.contains(r"^human", case=False, na=False)
        if human.sum() == 0:
            print(
                "WARNING: no label_source starting with 'human'. "
                "Proceeding, but prefer human_* sources before training."
            )

    rows = []
    for _, r in df.iterrows():
        f = features(parse_json(r["cv_profile_json"]), parse_json(r["offer_profile_json"]))
        row = {k: f.get(k) for k in NUMERIC_FEATURES}
        row.update(
            {
                "annotation_id": r.get("annotation_id"),
                "parent_id": r["parent_id"],
                "cv_id": r.get("cv_id"),
                "offer_id": r.get("offer_id"),
                "label_score": float(r["label_score"]),
                "label_source": r.get("label_source", ""),
            }
        )
        rows.append(row)

    feat = pd.DataFrame(rows)
    out_f = ROOT / a.out_features
    feat.to_csv(out_f, index=False)

    # Group-aware split: test, then val from remaining train
    gss_test = GroupShuffleSplit(n_splits=1, test_size=a.test_size, random_state=a.seed)
    idx = list(range(len(feat)))
    groups = feat["parent_id"]
    trainval_idx, test_idx = next(gss_test.split(idx, feat["label_score"], groups=groups))
    # val from trainval
    rel = a.val_size / max(1e-9, (1.0 - a.test_size))
    gss_val = GroupShuffleSplit(n_splits=1, test_size=rel, random_state=a.seed + 1)
    tr_rel, val_rel = next(
        gss_val.split(
            trainval_idx,
            feat.iloc[trainval_idx]["label_score"],
            groups=feat.iloc[trainval_idx]["parent_id"],
        )
    )
    train_idx = [trainval_idx[i] for i in tr_rel]
    val_idx = [trainval_idx[i] for i in val_rel]

    splits = {
        "seed": a.seed,
        "test_size": a.test_size,
        "val_size": a.val_size,
        "n_labeled": int(len(feat)),
        "n_train": len(train_idx),
        "n_val": len(val_idx),
        "n_test": len(test_idx),
        "distinct_parent_train": int(feat.iloc[train_idx]["parent_id"].nunique()),
        "distinct_parent_val": int(feat.iloc[val_idx]["parent_id"].nunique()),
        "distinct_parent_test": int(feat.iloc[test_idx]["parent_id"].nunique()),
        "train_indices": train_idx,
        "val_indices": val_idx,
        "test_indices": list(map(int, test_idx)),
        "features": list(NUMERIC_FEATURES),
        "warning": "Indices refer to rows of features_labeled.csv in order.",
    }
    # ensure JSON serializable
    splits["test_indices"] = [int(i) for i in test_idx]
    splits["train_indices"] = [int(i) for i in train_idx]
    splits["val_indices"] = [int(i) for i in val_idx]

    out_s = ROOT / a.out_splits
    out_s.write_text(json.dumps(splits, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "features": str(out_f),
                "splits": str(out_s),
                "n_labeled": splits["n_labeled"],
                "n_train": splits["n_train"],
                "n_val": splits["n_val"],
                "n_test": splits["n_test"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
