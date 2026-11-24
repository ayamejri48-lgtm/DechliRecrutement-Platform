from app.matching import hybrid, rank_candidates, score_band


def test_required_skills_penalty():
    out = hybrid(
        {"skills": ["python", "sql"], "experienceYears": 3, "education": "master"},
        {
            "skills": ["python", "pytorch", "nlp"],
            "requiredSkills": ["pytorch", "nlp"],
            "experienceYears": 2,
            "education": "master",
        },
    )
    assert out["features"]["missingRequiredSkills"] == ["nlp", "pytorch"]
    assert out["score"] is not None and out["score"] < 0.45
    assert out["scoreBand"] == "low"


def test_false_match_ai_vs_data_engineer_titles():
    out = hybrid(
        {
            "skills": ["pytorch", "nlp", "transformers", "python"],
            "title": "AI Engineer",
            "experienceYears": 4,
            "education": "master",
        },
        {
            "skills": ["spark", "airflow", "etl", "sql", "hadoop"],
            "requiredSkills": ["spark", "etl"],
            "title": "Data Engineer",
            "experienceYears": 3,
            "education": "master",
        },
    )
    assert out["score"] is not None
    assert out["score"] < 0.4
    assert out["scoreBand"] == "low"


def test_good_skill_overlap_scores_higher():
    out = hybrid(
        {
            "skills": ["python", "pytorch", "nlp", "transformers"],
            "title": "AI Engineer",
            "experienceYears": 4,
            "education": "master",
        },
        {
            "skills": ["python", "pytorch", "nlp"],
            "requiredSkills": ["pytorch", "nlp"],
            "title": "Machine Learning Engineer",
            "experienceYears": 3,
            "education": "master",
        },
    )
    assert out["score"] is not None and out["score"] >= 0.7
    assert out["scoreBand"] == "high"


def test_zero_offer_experience_not_auto_perfect():
    out = hybrid(
        {"skills": ["python"], "experienceYears": 10},
        {"skills": ["python"], "experienceYears": 0},
    )
    assert out["features"]["experience_match"] is None


def test_missing_required_cannot_be_high_band():
    out = hybrid(
        {"skills": ["python"], "experienceYears": 5, "education": "master"},
        {
            "skills": ["python", "pytorch"],
            "requiredSkills": ["pytorch"],
            "experienceYears": 2,
            "education": "master",
        },
    )
    assert out["scoreBand"] != "high"
    assert out["score"] is not None and out["score"] <= 0.69


def test_batch_ranking_order():
    ranked = rank_candidates(
        {"skills": ["python", "sql"], "requiredSkills": ["python"]},
        [
            {"candidatureId": "a", "candidate": {"skills": ["excel"]}},
            {"candidatureId": "b", "candidate": {"skills": ["python", "sql"]}},
        ],
    )
    assert ranked["results"][0]["result"]["candidatureId"] == "b"


def test_score_band_thresholds():
    assert score_band(None) == "unavailable"
    assert score_band(0.2) == "low"
    assert score_band(0.55) == "medium"
    assert score_band(0.8) == "high"


def test_education_match_completed_vs_in_progress_vs_below():
    offer = {"skills": ["python"], "education": "master"}
    completed = hybrid(
        {"skills": ["python"], "education": "master", "educationStatus": "completed"},
        offer,
    )
    in_progress = hybrid(
        {"skills": ["python"], "education": "edu2ip", "educationStatus": "in_progress"},
        offer,
    )
    below = hybrid(
        {"skills": ["python"], "education": "bachelor", "educationStatus": "completed"},
        offer,
    )
    unknown = hybrid(
        {"skills": ["python"], "education": "edu2un", "educationStatus": "unknown"},
        offer,
    )
    assert completed["features"]["education_match"] == 1.0
    assert in_progress["features"]["education_match"] == 0.5
    assert below["features"]["education_match"] == 0.0
    assert unknown["features"]["education_match"] is None
    assert "partielle" in " ".join(in_progress["explanations"])


def test_education_legacy_plain_master_still_full_credit():
    """Offre-Service may send plain 'master' without educationStatus."""
    out = hybrid(
        {"skills": ["python"], "education": "master"},
        {"skills": ["python"], "education": "master"},
    )
    assert out["features"]["education_match"] == 1.0


def test_empty_offer_skills_unavailable_not_high():
    out = hybrid(
        {
            "skills": ["python", "java", "docker"],
            "experienceYears": 4,
            "education": "master",
            "title": "Backend",
        },
        {
            "skills": [],
            "requiredSkills": [],
            "experienceYears": 1,
            "education": "master",
            "title": "Développeur symfony",
        },
    )
    assert out["score"] is None
    assert out["scoreBand"] == "unavailable"
    assert out["features"]["skills_coverage"] is None
    assert any("compétence structurée" in e.lower() or "compétences structurée" in e.lower()
               or "competence" in e.lower() or "indisponible" in e.lower()
               for e in out["explanations"])


def test_offer_with_skills_still_scores():
    out = hybrid(
        {"skills": ["python", "sql"], "experienceYears": 3, "education": "master"},
        {
            "skills": ["python", "sql"],
            "requiredSkills": ["python"],
            "experienceYears": 2,
            "education": "master",
        },
    )
    assert out["score"] is not None
    assert out["scoreBand"] != "unavailable"
    assert out["features"]["skills_coverage"] == 1.0


def test_batch_excludes_unavailable_from_rank_positions():
    ranked = rank_candidates(
        {"skills": []},
        [
            {"candidatureId": "a", "candidate": {"skills": ["python"]}},
            {"candidatureId": "b", "candidate": {"skills": ["java"]}},
        ],
    )
    assert all(item["rank"] is None for item in ranked["results"])
    assert all(item["result"]["scoreBand"] == "unavailable" for item in ranked["results"])


def test_score_always_in_unit_interval_or_null():
    out = hybrid(
        {"skills": ["python", "sql", "docker"], "experienceYears": 12, "education": "phd"},
        {
            "skills": ["python"],
            "requiredSkills": ["python"],
            "experienceYears": 1,
            "education": "bachelor",
        },
    )
    assert out["score"] is not None
    assert 0.0 <= out["score"] <= 1.0


def test_zero_skill_coverage_cannot_reach_medium():
    out = hybrid(
        {
            "skills": ["python"],
            "title": "Software Engineer",
            "experienceYears": 5,
            "education": "master",
        },
        {
            "skills": ["siem", "splunk", "nmap"],
            "requiredSkills": ["siem"],
            "title": "Software Engineer",
            "experienceYears": 2,
            "education": "master",
        },
    )
    assert out["features"]["skills_coverage"] == 0.0
    assert out["score"] is not None and out["score"] <= 0.35
    assert out["scoreBand"] == "low"


def test_baseline_warning_distinguishes_from_ml_and_human():
    out = hybrid(
        {"skills": ["python"], "experienceYears": 3},
        {"skills": ["python"], "experienceYears": 2},
    )
    assert out["method"].startswith("hybrid-baseline-v3.1")
    assert out["modelVersion"].startswith("hybrid-v3.1")
    w = out["warning"].lower()
    assert "baseline" in w
    assert "human annotation" in w or "annotation" in w
    assert "ml" in w or "supervised" in w


def test_deterministic_tfidf_baseline():
    payload_c = {"skills": ["python", "sql"], "experienceYears": 3, "education": "master"}
    payload_o = {
        "skills": ["python", "sql", "pandas"],
        "requiredSkills": ["python"],
        "experienceYears": 2,
        "education": "master",
    }
    a = hybrid(payload_c, payload_o)
    b = hybrid(payload_c, payload_o)
    assert a["score"] == b["score"]
    assert a["features"]["skills_coverage"] == b["features"]["skills_coverage"]


def test_soft_family_covers_data_viz_and_statistics():
    """FR free-text offer skills should soft-match BI/stats tooling on CV."""
    out = hybrid(
        {
            "skills": ["python", "sql", "pandas", "power bi", "numpy"],
            "experienceYears": 3,
            "education": "master",
        },
        {
            "skills": [
                "python",
                "sql",
                "pandas",
                "power bi",
                "excel",
                "statistiques",
                "visualisation des données",
            ],
            "requiredSkills": ["python", "sql"],
            "experienceYears": 1,
            "education": "bachelor",
        },
    )
    feats = out["features"]
    assert "statistics" not in (feats.get("missingSkills") or [])
    assert "data visualization" not in (feats.get("missingSkills") or [])
    assert feats.get("skills_f1") is not None
    assert feats.get("skills_score") is not None
    assert out["score"] is not None and out["score"] >= 0.55
    assert out["modelVersion"].startswith("hybrid-v3.1")


def test_fastapi_covers_required_rest_api():
    """Framework REST (FastAPI/Django) covers offer skill 'REST API' one-way."""
    out = hybrid(
        {
            "skills": ["python", "fastapi", "django", "postgresql", "git"],
            "experienceYears": 3,
            "education": "master",
            "educationStatus": "completed",
        },
        {
            "skills": [
                "python",
                "fastapi",
                "django",
                "postgresql",
                "rest api",
                "git",
            ],
            "requiredSkills": [
                "python",
                "fastapi",
                "django",
                "postgresql",
                "rest api",
                "git",
            ],
            "experienceYears": 3,
            "education": "master",
        },
    )
    feats = out["features"]
    assert "rest api" not in (feats.get("missingRequiredSkills") or [])
    assert "rest api" in (feats.get("matchedSkills") or [])
    assert (feats.get("critical_skills_missing") or 0) == 0
    assert out["score"] is not None and out["score"] >= 0.7
    assert out["scoreBand"] == "high"


def test_rest_api_alone_does_not_cover_fastapi():
    """Reverse must stay strict: 'REST API' ≠ FastAPI."""
    out = hybrid(
        {
            "skills": ["python", "rest api", "git"],
            "experienceYears": 3,
            "education": "master",
        },
        {
            "skills": ["python", "fastapi", "git"],
            "requiredSkills": ["fastapi"],
            "experienceYears": 3,
            "education": "master",
        },
    )
    feats = out["features"]
    assert "fastapi" in (feats.get("missingRequiredSkills") or [])
