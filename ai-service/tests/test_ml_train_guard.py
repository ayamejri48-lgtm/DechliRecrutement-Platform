"""Training guards — do not invent successful training metrics here."""
import json
from pathlib import Path

import pandas as pd
import pytest


def test_train_rejects_pending_weak_labels(tmp_path: Path):
    csv_path = tmp_path / "ann.csv"
    rows = []
    for i in range(120):
        rows.append(
            {
                "parent_id": f"p{i % 40}",
                "cv_profile_json": json.dumps({"skills": ["python"], "experienceYears": 2}),
                "offer_profile_json": json.dumps(
                    {"skills": ["python"], "requiredSkills": ["python"], "experienceYears": 1}
                ),
                "label_score": 0.8,
                "label_source": "pending_human",
            }
        )
    pd.DataFrame(rows).to_csv(csv_path, index=False)

    import subprocess
    import sys

    proc = subprocess.run(
        [
            sys.executable,
            "scripts/03_train.py",
            "--annotations",
            str(csv_path),
            "--out",
            str(tmp_path / "models"),
        ],
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0
    assert "weak/pending" in (proc.stderr + proc.stdout).lower() or proc.returncode != 0


def test_train_with_human_labels_produces_report(tmp_path: Path):
    csv_path = tmp_path / "ann_human.csv"
    rows = []
    for i in range(120):
        score = 0.9 if i % 2 == 0 else 0.2
        skills_c = ["python", "pytorch"] if i % 2 == 0 else ["sql"]
        skills_o = ["python", "pytorch"] if i % 2 == 0 else ["hadoop"]
        rows.append(
            {
                "parent_id": f"p{i % 40}",
                "cv_profile_json": json.dumps(
                    {"skills": skills_c, "experienceYears": 3, "education": "master"}
                ),
                "offer_profile_json": json.dumps(
                    {
                        "skills": skills_o,
                        "requiredSkills": skills_o[:1],
                        "experienceYears": 2,
                        "education": "master",
                    }
                ),
                "label_score": score,
                "label_source": "human_v1",
            }
        )
    pd.DataFrame(rows).to_csv(csv_path, index=False)

    import subprocess
    import sys

    out_dir = tmp_path / "models"
    proc = subprocess.run(
        [
            sys.executable,
            "scripts/03_train.py",
            "--annotations",
            str(csv_path),
            "--out",
            str(out_dir),
        ],
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = json.loads((out_dir / "training_report.json").read_text(encoding="utf-8"))
    assert report["rows"] == 120
    assert "mae" in report and "dummy_mae" in report
    assert (out_dir / "matching_model.joblib").is_file()
