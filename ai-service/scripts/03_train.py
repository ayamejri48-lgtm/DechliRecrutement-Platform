"""Train ONLY on independently annotated CV/offer pairs, never fabricated ground truth.

Requires columns: parent_id, cv_profile_json, offer_profile_json, label_score ∈ [0,1]
Optional: label_source (must not be weak-only unless --allow-weak-labels).

GroupShuffleSplit by parent_id avoids leakage across CV augmentations.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import (
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit

from app.matching import NUMERIC_FEATURES, features

FEATURES = list(NUMERIC_FEATURES)


def parse_json(s):
    if pd.isna(s) or not str(s).strip():
        return {}
    v = json.loads(s)
    if not isinstance(v, dict):
        raise ValueError("Profile must be JSON object")
    return v


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--annotations",
        required=True,
        help="CSV columns: parent_id,cv_profile_json,offer_profile_json,label_score",
    )
    p.add_argument("--out", default="models")
    p.add_argument(
        "--allow-weak-labels",
        action="store_true",
        help="Allow training when label_source indicates weak/heuristic labels (demo only).",
    )
    a = p.parse_args()

    df = pd.read_csv(a.annotations)
    required = {"parent_id", "cv_profile_json", "offer_profile_json", "label_score"}
    if required - set(df.columns):
        raise ValueError(f"Missing columns {required - set(df.columns)}")
    if df.parent_id.isna().any():
        raise ValueError("parent_id required to prevent leakage")

    # Drop empty human labels.
    df = df[pd.to_numeric(df.label_score, errors="coerce").notna()].copy()
    if "label_source" in df.columns and not a.allow_weak_labels:
        weak = df["label_source"].astype(str).str.contains("weak|heuristic|pending", case=False, na=False)
        if weak.any():
            raise ValueError(
                "Annotations contain weak/pending label_source. "
                "Provide human-validated labels or pass --allow-weak-labels for experimental demos only."
            )

    if len(df) < 100 or df.parent_id.nunique() < 30:
        raise ValueError("Need >=100 annotated pairs and >=30 distinct CV parent IDs")

    y = pd.to_numeric(df.label_score, errors="raise")
    if not y.between(0, 1).all():
        raise ValueError("Labels must be within [0,1]")

    rows = [
        features(parse_json(c), parse_json(o))
        for c, o in zip(df.cv_profile_json, df.offer_profile_json)
    ]
    X = pd.DataFrame(rows)[FEATURES].astype(float)  # None → NaN; HGB handles NaN
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(splitter.split(X, y, groups=df.parent_id))

    model = HistGradientBoostingRegressor(
        max_iter=100, max_leaf_nodes=15, l2_regularization=1, random_state=42
    )
    model.fit(X.iloc[tr], y.iloc[tr])
    pred = np.clip(model.predict(X.iloc[te]), 0, 1)
    baseline = DummyRegressor(strategy="mean").fit(X.iloc[tr], y.iloc[tr])
    basepred = baseline.predict(X.iloc[te])

    y_te = y.iloc[te]
    # Classification view at relevance threshold 0.5 (secondary metrics).
    y_bin = (y_te >= 0.5).astype(int)
    p_bin = (pred >= 0.5).astype(int)
    report = {
        "rows": len(df),
        "train_rows": int(len(tr)),
        "test_rows": int(len(te)),
        "distinct_train_cv": int(df.parent_id.iloc[tr].nunique()),
        "distinct_test_cv": int(df.parent_id.iloc[te].nunique()),
        "features": FEATURES,
        "mae": float(mean_absolute_error(y_te, pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_te, pred))),
        "r2": float(r2_score(y_te, pred)),
        "dummy_mae": float(mean_absolute_error(y_te, basepred)),
        "classification_threshold": 0.5,
        "precision_at_0_5": float(precision_score(y_bin, p_bin, zero_division=0)),
        "recall_at_0_5": float(recall_score(y_bin, p_bin, zero_division=0)),
        "f1_at_0_5": float(f1_score(y_bin, p_bin, zero_division=0)),
        "allow_weak_labels": bool(a.allow_weak_labels),
        "warning": (
            "Held-out CV groups only; external validation and offer-level leakage checks "
            "still needed. Do not ship to production without human label audit."
        ),
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"model": model, "features": FEATURES, "version": "hgb-v2"},
        out / "matching_model.joblib",
    )
    (out / "training_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
