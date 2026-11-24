import os

from fastapi.testclient import TestClient


def test_internal_api_key_required(monkeypatch):
    monkeypatch.setenv("AI_INTERNAL_API_KEY", "test-secret-key-ok")
    from app.main import app

    client = TestClient(app)
    denied = client.post("/api/v1/extract/cv", json={"text": "Python experience"})
    assert denied.status_code == 401

    ok = client.post(
        "/api/v1/extract/cv",
        json={"text": "Python experience"},
        headers={"X-Internal-Api-Key": "test-secret-key-ok"},
    )
    assert ok.status_code == 200
    assert "python" in ok.json()["skills"]

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["authRequired"] is True


def test_wrong_api_key_rejected(monkeypatch):
    monkeypatch.setenv("AI_INTERNAL_API_KEY", "test-secret-key-ok")
    from app.main import app

    client = TestClient(app)
    r = client.post(
        "/api/v1/match",
        json={"candidate": {"skills": ["python"]}, "offer": {"skills": ["python"]}},
        headers={"X-Internal-Api-Key": "wrong"},
    )
    assert r.status_code == 401


def test_short_api_key_rejected_as_misconfig(monkeypatch):
    monkeypatch.setenv("AI_INTERNAL_API_KEY", "short")
    from app.main import app

    client = TestClient(app)
    r = client.post(
        "/api/v1/extract/cv",
        json={"text": "Python"},
        headers={"X-Internal-Api-Key": "short"},
    )
    assert r.status_code == 500

