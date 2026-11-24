"""Read-only QA: latest 4 offers × latest 4 candidates with CV (hybrid-v3)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("AI_SEMANTIC_BACKEND", "tfidf")
os.environ.setdefault("AI_EXTRACT_BACKEND", "rules")

import boto3
import pymupdf
from botocore.client import Config

from app.matching import hybrid, rank_candidates
from app.nlp import extract as extract_rules, parse_education_value

MYSQL = r"C:\xampp\mysql\bin\mysql.exe"
S3_ENDPOINT = "http://127.0.0.1:8333"
S3_BUCKET = "recrutement-cvs"
S3_KEY = os.getenv("S3_ACCESS_KEY", "recrutement-user-service")
S3_SECRET = os.getenv(
    "S3_SECRET_KEY", "f2bcn9P2ZzMseEjnQPiroLOGK25q0sWX7xYRoc5nTy4="
)
OUT = ROOT / "data" / "processed" / "qa_latest_4x4_report.json"


def mysql_query(sql: str) -> list[dict]:
    proc = subprocess.run(
        [MYSQL, "-uroot", "-B", "-e", sql],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []
    headers = lines[0].split("\t")
    rows = []
    for ln in lines[1:]:
        cols = ln.split("\t")
        rows.append({h: (None if c == "NULL" else c) for h, c in zip(headers, cols)})
    return rows


def map_offer_education(raw: str | None) -> str | None:
    if not raw:
        return None
    level, _ = parse_education_value(raw)
    return level


def download_pdf(object_key: str, dest: Path) -> None:
    client = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_KEY,
        aws_secret_access_key=S3_SECRET,
        region_name="us-east-1",
        config=Config(signature_version="s3v4"),
    )
    client.download_file(S3_BUCKET, object_key, str(dest))


def pdf_text(path: Path) -> str:
    with pymupdf.open(path) as doc:
        return " ".join(page.get_text() for page in doc)


def main() -> None:
    offers_meta = mysql_query(
        """
        SELECT id, title, status, experience_years, education_level, description
        FROM offre_db.offres
        ORDER BY id DESC
        LIMIT 4
        """
    )
    offer_ids = [int(r["id"]) for r in offers_meta]
    id_list = ",".join(str(i) for i in offer_ids)
    skills_rows = mysql_query(
        f"""
        SELECT offre_id, name, required
        FROM offre_db.offre_skills
        WHERE offre_id IN ({id_list})
        ORDER BY offre_id, name
        """
    )
    skills_by_offer: dict[int, list[dict]] = {}
    for s in skills_rows:
        oid = int(s["offre_id"])
        skills_by_offer.setdefault(oid, []).append(s)

    offers = []
    for o in offers_meta:
        oid = int(o["id"])
        sk = skills_by_offer.get(oid, [])
        all_skills = [x["name"] for x in sk]
        required = [
            x["name"]
            for x in sk
            if str(x.get("required", "")).lower() in {"1", "true", "\x01", "b'\\x01'"}
            or x.get("required") in (1, True, "1")
        ]
        # MySQL BIT often comes as weird chars — treat all listed skills as required
        # if BIT parse fails but column required=1 for all rows in this dataset.
        if not required and sk:
            required = [x["name"] for x in sk if x.get("required") not in ("0", "false", None)]
        if not required:
            required = list(all_skills)  # these offres mark skills required in DB
        offers.append(
            {
                "id": oid,
                "title": o["title"],
                "status": o["status"],
                "profile": {
                    "skills": all_skills,
                    "requiredSkills": required,
                    "experienceYears": float(o["experience_years"])
                    if o["experience_years"] is not None
                    else None,
                    "education": map_offer_education(o["education_level"]),
                    "educationRaw": o["education_level"],
                    "title": o["title"],
                    "summary": (o["description"] or "")[:500],
                },
                "n_skills": len(all_skills),
            }
        )

    cand_rows = mysql_query(
        """
        SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.role,
               c.id AS cv_id, c.object_key, c.file_name
        FROM user_db.users u
        INNER JOIN user_db.cvs c ON c.user_id = u.id
        WHERE u.role = 'CANDIDATE'
        ORDER BY c.id DESC
        LIMIT 4
        """
    )

    candidates = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for row in cand_rows:
            pdf_path = tmp_path / f"{row['user_id']}_{row['cv_id']}.pdf"
            download_pdf(row["object_key"], pdf_path)
            text = pdf_text(pdf_path)
            extracted = extract_rules(text[:200_000])
            candidates.append(
                {
                    "user_id": int(row["user_id"]),
                    "email": row["email"],
                    "name": f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
                    "cv_id": int(row["cv_id"]),
                    "file_name": row["file_name"],
                    "object_key": row["object_key"],
                    "text_chars": len(text),
                    "profile": {
                        "skills": extracted.get("skills") or [],
                        "experienceYears": extracted.get("experienceYears"),
                        "education": extracted.get("education"),
                        "educationStatus": extracted.get("educationStatus"),
                        "specialty": extracted.get("specialty"),
                        "title": extracted.get("specialty"),
                        "summary": text[:400],
                    },
                    "extract_method": extracted.get("method"),
                    "limitations": extracted.get("limitations") or [],
                }
            )

    matrix = []
    for c in candidates:
        for o in offers:
            m = hybrid(c["profile"], o["profile"], cvId=str(c["cv_id"]))
            feats = m.get("features") or {}
            matrix.append(
                {
                    "user_id": c["user_id"],
                    "cv_file": c["file_name"],
                    "offer_id": o["id"],
                    "offer_title": o["title"],
                    "score": m.get("score"),
                    "scoreBand": m.get("scoreBand"),
                    "skills_coverage": feats.get("skills_coverage"),
                    "required_skills_coverage": feats.get("required_skills_coverage"),
                    "semantic_similarity": feats.get("semantic_similarity"),
                    "experience_match": feats.get("experience_match"),
                    "education_match": feats.get("education_match"),
                    "matchedSkills": feats.get("matchedSkills"),
                    "critical_skills_missing": feats.get("critical_skills_missing"),
                    "method": m.get("method"),
                }
            )

    rankings = []
    for o in offers:
        ranked = rank_candidates(
            o["profile"],
            [
                {
                    **c["profile"],
                    "candidatureId": str(c["user_id"]),
                    "cvId": str(c["cv_id"]),
                }
                for c in candidates
            ],
        )
        rankings.append(
            {
                "offer_id": o["id"],
                "offer_title": o["title"],
                "items": [
                    {
                        "rank": it.get("rank"),
                        "score": it.get("score"),
                        "scoreBand": it.get("scoreBand"),
                        "candidatureId": it.get("candidatureId"),
                        "cvId": it.get("cvId"),
                    }
                    for it in (ranked.get("results") or ranked.get("items") or [])
                ],
            }
        )

    # Expected domain affinity (senior judgment, not gold labels)
    expected = {
        99910: {"best": [17], "label": "Data Analyst CV"},
        99911: {"best": [14], "label": "likely SE / related — check extract"},
        99912: {"best": [14, 16], "label": "Software Eng — ML or DevOps soft"},
        99913: {"best": [15], "label": "Cybersecurity Analyst"},
    }
    # Fix labels from filenames
    for c in candidates:
        fn = (c["file_name"] or "").lower()
        if "data" in fn:
            expected[c["user_id"]] = {"best": [17], "label": "Data Analyst"}
        elif "cyber" in fn:
            expected[c["user_id"]] = {"best": [15], "label": "Cybersecurity"}
        elif "software" in fn:
            expected[c["user_id"]] = {"best": [14, 16], "label": "Software Engineer"}

    sanity = []
    for c in candidates:
        uid = c["user_id"]
        rows = [r for r in matrix if r["user_id"] == uid and r["score"] is not None]
        if not rows:
            sanity.append({"user_id": uid, "ok": False, "reason": "no scored rows"})
            continue
        best = max(rows, key=lambda r: r["score"])
        exp = expected.get(uid, {})
        ok = best["offer_id"] in exp.get("best", [])
        sanity.append(
            {
                "user_id": uid,
                "label": exp.get("label"),
                "best_offer": best["offer_id"],
                "best_title": best["offer_title"],
                "best_score": best["score"],
                "expected_offers": exp.get("best"),
                "top1_matches_expected_domain": ok,
            }
        )

    report = {
        "service_version": "1.3.1",
        "method": "hybrid-baseline-v3",
        "extract": "rules",
        "semantic": "tfidf",
        "n_pairs": len(matrix),
        "offers": [
            {
                "id": o["id"],
                "title": o["title"],
                "n_skills": o["n_skills"],
                "skills": o["profile"]["skills"],
                "experienceYears": o["profile"]["experienceYears"],
                "education": o["profile"]["education"],
            }
            for o in offers
        ],
        "candidates": [
            {
                "user_id": c["user_id"],
                "email": c["email"],
                "file_name": c["file_name"],
                "text_chars": c["text_chars"],
                "skills": c["profile"]["skills"],
                "experienceYears": c["profile"]["experienceYears"],
                "education": c["profile"]["education"],
                "specialty": c["profile"]["specialty"],
                "n_skills": len(c["profile"]["skills"]),
            }
            for c in candidates
        ],
        "matrix": matrix,
        "rankings": rankings,
        "domain_sanity": sanity,
        "score_summary": {
            "n_scored": sum(1 for r in matrix if r["score"] is not None),
            "n_unavailable": sum(1 for r in matrix if r["score"] is None),
            "mean_scored": round(
                sum(r["score"] for r in matrix if r["score"] is not None)
                / max(1, sum(1 for r in matrix if r["score"] is not None)),
                4,
            ),
            "high": sum(1 for r in matrix if r["scoreBand"] == "high"),
            "medium": sum(1 for r in matrix if r["scoreBand"] == "medium"),
            "low": sum(1 for r in matrix if r["scoreBand"] == "low"),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(OUT), "summary": report["score_summary"], "sanity": sanity}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
