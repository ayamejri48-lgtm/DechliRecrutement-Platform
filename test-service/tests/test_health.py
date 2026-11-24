from fastapi.testclient import TestClient

from app.difficulty import difficulty_from_experience_years, duration_sec_for
from app.main import app

client = TestClient(app)


def test_health_returns_service_name():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "test-service"
    assert "version" in body
    assert body["database"] in {"up", "down", "unknown"}


def test_me_requires_auth():
    r = client.get("/api/v1/tests/me")
    assert r.status_code == 401


def test_difficulty_mapping():
    assert difficulty_from_experience_years(0) == "JUNIOR"
    assert difficulty_from_experience_years(2) == "JUNIOR"
    assert difficulty_from_experience_years(3) == "INTERMEDIATE"
    assert difficulty_from_experience_years(5) == "INTERMEDIATE"
    assert difficulty_from_experience_years(6) == "SENIOR"
    assert duration_sec_for("JUNIOR") == 1800
    assert duration_sec_for("INTERMEDIATE") == 2700
    assert duration_sec_for("SENIOR") == 3600
