"""Phase 1 generation with mocked Offre + mock LLM (no Groq / no Offre-Service)."""
from __future__ import annotations

import jwt
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.generation.service import run_generation_job, start_generation
from app.main import app
from app.models import Question, TechnicalTest

client = TestClient(app)


def _token(user_id: int = 58, role: str = "RECRUITER") -> str:
    settings = get_settings()
    return jwt.encode(
        {"sub": "roua@test.com", "userId": user_id, "role": role},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def test_generate_persist_ready(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    get_settings.cache_clear()

    class Snap:
        id = 18
        recruiter_id = 58
        title = "Backend Python"
        description = "FastAPI Django"
        experience_years = 3
        status = "PUBLISHED"
        skill_names = ["Python", "FastAPI", "Django"]
        required_skill_names = ["Python", "FastAPI"]

    monkeypatch.setattr(
        "app.generation.service.fetch_offre_for_recruiter",
        lambda *a, **k: Snap(),
    )

    db = SessionLocal()
    try:
        # cleanup previous runs for offre 18
        existing = db.query(TechnicalTest).filter_by(offre_id=18).first()
        if existing:
            db.query(Question).filter_by(test_id=existing.id).delete()
            db.delete(existing)
            db.commit()

        test, launch = start_generation(
            db,
            offre_id=18,
            recruiter_id=58,
            role="RECRUITER",
            bearer_token="dummy",
            regenerate=False,
        )
        assert launch is True
        assert test.status == "GENERATING"
        tid = test.id
    finally:
        db.close()

    run_generation_job(test_id=tid, offre_id=18, bearer_token="dummy")

    db = SessionLocal()
    try:
        test = db.get(TechnicalTest, tid)
        assert test is not None
        assert test.status == "READY"
        assert test.difficulty == "INTERMEDIATE"
        assert test.duration_sec == 2700
        qs = db.query(Question).filter_by(test_id=tid).all()
        assert len(qs) == 13
        assert sum(1 for q in qs if q.type == "MCQ") == 10
        assert sum(1 for q in qs if q.type == "OPEN") == 3
    finally:
        db.close()

    # API get
    r = client.get(
        "/api/v1/tests/offres/18",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "READY"
    assert len(body["questions"]) == 13
    assert body["questions"][0]["correctOption"] in {"A", "B", "C"}
