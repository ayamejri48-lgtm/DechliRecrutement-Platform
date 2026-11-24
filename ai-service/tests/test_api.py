from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)


def test_health():
    r = c.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "semanticBackend" in body
    assert body["authRequired"] is False
    assert "supervisedModelLoaded" in body
    assert "X-Request-Id" in r.headers


def test_extract():
    x = c.post(
        "/api/v1/extract/cv",
        json={
            "text": "Python, PyTorch and SQL. 3 years of experience. Master degree."
        },
    ).json()
    assert {"python", "pytorch", "sql"} <= set(x["skills"])
    assert x["experienceYears"] == 3
    assert x["education"] == "master"
    assert x["method"].startswith("rule-based-nlp")
    assert isinstance(x["evidence"], list)


def test_extract_skills_section():
    text = """Jane Doe
Skills: React, Docker, Kubernetes, PostgreSQL
Experience: 4 years of experience
Education: Bachelor's degree
"""
    x = c.post("/api/v1/extract/cv", json={"text": text}).json()
    assert {"react", "docker", "kubernetes", "postgresql"} <= set(x["skills"])


def test_extract_offer_endpoint():
    x = c.post(
        "/api/v1/extract/offer",
        json={"text": "Looking for FastAPI and Docker, at least 2 years experience"},
    ).json()
    assert "fastapi" in x["skills"]
    assert "docker" in x["skills"]
    assert x["experienceYears"] == 2


def test_distinct_skills():
    x = c.post(
        "/api/v1/match",
        json={
            "candidate": {"skills": ["Python", "SQL", "Spark", "ETL"]},
            "offer": {
                "skills": ["Python", "PyTorch", "Deep Learning", "NLP"],
                "requiredSkills": ["PyTorch", "NLP"],
            },
            "candidatureId": "c1",
            "cvId": "42",
        },
    ).json()
    assert x["features"]["missingRequiredSkills"] == ["nlp", "pytorch"]
    assert x["score"] is not None and x["score"] < 0.4
    assert x["scoreBand"] == "low"
    assert x["candidatureId"] == "c1"
    assert x["cvId"] == "42"
    assert x["explanations"]


def test_empty_requirements():
    x = c.post(
        "/api/v1/match",
        json={"candidate": {"skills": ["python"]}, "offer": {}},
    ).json()
    assert x["score"] is None
    assert x["scoreBand"] == "unavailable"


def test_batch_rank():
    x = c.post(
        "/api/v1/match/batch",
        json={
            "offer": {
                "skills": ["python", "pytorch", "nlp"],
                "requiredSkills": ["pytorch"],
                "experienceYears": 2,
                "education": "master",
            },
            "candidates": [
                {
                    "candidatureId": "weak",
                    "candidate": {
                        "skills": ["sql", "excel"],
                        "experienceYears": 1,
                        "education": "bachelor",
                    },
                },
                {
                    "candidatureId": "strong",
                    "candidate": {
                        "skills": ["python", "pytorch", "nlp"],
                        "experienceYears": 4,
                        "education": "master",
                    },
                },
            ],
        },
    ).json()
    assert x["results"][0]["rank"] == 1
    assert x["results"][0]["result"]["candidatureId"] == "strong"
    assert x["results"][0]["result"]["score"] >= x["results"][1]["result"]["score"]


def test_pdf_validation():
    assert (
        c.post(
            "/api/v1/extract/cv/pdf",
            files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
        ).status_code
        == 400
    )


def test_match_ml_unavailable():
    r = c.post(
        "/api/v1/match/ml",
        json={
            "candidate": {"skills": ["python"]},
            "offer": {"skills": ["python"]},
        },
    )
    assert r.status_code == 503


def test_match_contract_fields_and_baseline_method():
    r = c.post(
        "/api/v1/match",
        json={
            "candidate": {
                "skills": ["Python", "SQL"],
                "experienceYears": 3,
                "education": "bac + 3",
            },
            "offer": {
                "skills": ["Python", "SQL"],
                "requiredSkills": ["Python"],
                "experienceYears": 2,
                "education": "Bac + 3 (Licence)",
            },
            "candidatureId": "99",
            "cvId": "11",
        },
    )
    assert r.status_code == 200
    body = r.json()
    for key in (
        "score",
        "scoreBand",
        "features",
        "explanations",
        "method",
        "modelVersion",
        "warning",
        "candidatureId",
        "cvId",
    ):
        assert key in body
    assert body["method"] == "hybrid-baseline-v3.1"
    assert body["modelVersion"].startswith("hybrid-v3.1")
    assert body["score"] is None or (0.0 <= body["score"] <= 1.0)
    assert body["features"]["education_match"] == 1.0
    assert isinstance(body["explanations"], list) and body["explanations"]
