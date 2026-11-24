"""Evaluate hybrid-v3 baseline: distribution, false-match probes, determinism.

Does NOT train ML and does NOT treat weak scores as gold labels.
Writes data/processed/final_baseline_eval_report.json
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd

from app.matching import hybrid, rank_candidates
from app.extract_pipeline import extract_backend_status
from app.semantic import backend_name


def _band_hist(scores: list[float | None]) -> dict:
    from app.matching import score_band

    bands = [score_band(s) for s in scores]
    return {b: bands.count(b) for b in ("low", "medium", "high", "unavailable")}


def false_match_probes() -> list[dict]:
    cases = [
        {
            "name": "ai_vs_data_engineer",
            "candidate": {
                "skills": ["pytorch", "nlp", "transformers", "python"],
                "title": "AI Engineer",
                "experienceYears": 4,
                "education": "master",
            },
            "offer": {
                "skills": ["spark", "airflow", "etl", "sql", "hadoop"],
                "requiredSkills": ["spark", "etl"],
                "title": "Data Engineer",
                "experienceYears": 3,
                "education": "master",
            },
            "expect_max": 0.4,
        },
        {
            "name": "java_vs_cyber_zero_overlap",
            "candidate": {
                "skills": ["java", "spring boot"],
                "title": "Software Engineer",
                "experienceYears": 3,
                "education": "master",
            },
            "offer": {
                "skills": ["siem", "splunk", "nmap"],
                "requiredSkills": ["siem"],
                "title": "Software Engineer",
                "experienceYears": 2,
                "education": "master",
            },
            "expect_max": 0.35,
        },
        {
            "name": "good_ml_overlap",
            "candidate": {
                "skills": ["python", "pytorch", "nlp"],
                "experienceYears": 4,
                "education": "master",
            },
            "offer": {
                "skills": ["python", "pytorch", "nlp"],
                "requiredSkills": ["pytorch"],
                "experienceYears": 3,
                "education": "master",
            },
            "expect_min": 0.7,
        },
        {
            "name": "empty_offer_skills",
            "candidate": {"skills": ["python"]},
            "offer": {"skills": []},
            "expect_null": True,
        },
    ]
    results = []
    for c in cases:
        t0 = time.perf_counter()
        out = hybrid(c["candidate"], c["offer"])
        ms = int((time.perf_counter() - t0) * 1000)
        ok = True
        if c.get("expect_null"):
            ok = out["score"] is None and out["scoreBand"] == "unavailable"
        if "expect_max" in c and out["score"] is not None:
            ok = ok and out["score"] < c["expect_max"]
        if "expect_min" in c and out["score"] is not None:
            ok = ok and out["score"] >= c["expect_min"]
        results.append(
            {
                "name": c["name"],
                "ok": ok,
                "score": out.get("score"),
                "scoreBand": out.get("scoreBand"),
                "ms": ms,
                "method": out.get("method"),
            }
        )
    return results


def eval_queue(path: Path, limit: int = 1000) -> dict:
    if not path.exists():
        return {"skipped": True, "reason": f"missing {path}"}
    df = pd.read_csv(path, dtype=str).fillna("")
    df = df.head(limit)
    scores = []
    latencies = []
    for _, row in df.iterrows():
        try:
            cand = json.loads(row["cv_profile_json"])
            offer = json.loads(row["offer_profile_json"])
        except Exception:
            continue
        t0 = time.perf_counter()
        out = hybrid(cand, offer)
        latencies.append(int((time.perf_counter() - t0) * 1000))
        scores.append(out.get("score"))
    numeric = [s for s in scores if s is not None]
    return {
        "n_pairs": len(scores),
        "n_scored": len(numeric),
        "n_unavailable": len(scores) - len(numeric),
        "score_mean": round(sum(numeric) / len(numeric), 4) if numeric else None,
        "score_min": min(numeric) if numeric else None,
        "score_max": max(numeric) if numeric else None,
        "band_histogram": _band_hist(scores),
        "latency_ms": {
            "min": min(latencies) if latencies else None,
            "p50": sorted(latencies)[len(latencies) // 2] if latencies else None,
            "max": max(latencies) if latencies else None,
            "avg": round(sum(latencies) / len(latencies), 1) if latencies else None,
        },
        "by_pair_type": {},
    }


def main() -> None:
    queue = ROOT / "data/processed/annotation_queue_1000.csv"
    queue_stats = eval_queue(queue)
    if not queue_stats.get("skipped") and queue.exists():
        df = pd.read_csv(queue, dtype=str).fillna("")
        by_type = {}
        for ptype, g in df.groupby("pair_type"):
            scores = []
            for _, row in g.iterrows():
                try:
                    out = hybrid(json.loads(row["cv_profile_json"]), json.loads(row["offer_profile_json"]))
                    scores.append(out.get("score"))
                except Exception:
                    pass
            num = [s for s in scores if s is not None]
            by_type[str(ptype)] = {
                "n": len(scores),
                "mean": round(sum(num) / len(num), 4) if num else None,
                "bands": _band_hist(scores),
            }
        queue_stats["by_pair_type"] = by_type

    probes = false_match_probes()
    ranked = rank_candidates(
        {"skills": ["python", "sql"], "requiredSkills": ["python"]},
        [
            {"candidatureId": "weak", "candidate": {"skills": ["excel"]}},
            {"candidatureId": "strong", "candidate": {"skills": ["python", "sql"]}},
        ],
    )

    # Determinism
    a = hybrid({"skills": ["python"]}, {"skills": ["python", "sql"]})
    b = hybrid({"skills": ["python"]}, {"skills": ["python", "sql"]})

    report = {
        "service_version_target": "1.3.0",
        "semanticBackend": backend_name(),
        "extract": extract_backend_status(),
        "false_match_probes": probes,
        "false_match_pass": all(p["ok"] for p in probes),
        "batch_rank_top": ranked["results"][0]["result"]["candidatureId"],
        "determinism_ok": a["score"] == b["score"],
        "annotation_queue_baseline_distribution": queue_stats,
        "notes": [
            "Queue scores describe hybrid-v3 behavior only — NOT human gold labels.",
            "Supervised ML remains blocked until annotated_pairs.csv is human-filled.",
            "Ollama extract is integrated with fallback; install+run Ollama to activate.",
        ],
    }
    out = ROOT / "data/processed/final_baseline_eval_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
