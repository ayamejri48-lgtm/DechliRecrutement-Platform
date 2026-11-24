from app.extract_pipeline import extract, extract_backend_status


def test_rules_backend_extract(monkeypatch):
    monkeypatch.setenv("AI_EXTRACT_BACKEND", "rules")
    out = extract("Python, SQL and Docker. 3 years of experience. Master degree.")
    assert {"python", "sql", "docker"} <= set(out["skills"])
    assert out["experienceYears"] == 3
    assert out["method"].startswith("rule-based") or "rule" in out["method"]


def test_ollama_backend_falls_back_when_down(monkeypatch):
    monkeypatch.setenv("AI_EXTRACT_BACKEND", "ollama")
    monkeypatch.setattr("app.extract_pipeline.ollama_available", lambda: False)
    out = extract("Experienced with React and Kubernetes.")
    assert "react" in out["skills"]
    assert "fallback" in out["method"] or any("fallback" in x.lower() for x in out.get("limitations", []))


def test_extract_backend_status_keys(monkeypatch):
    monkeypatch.setenv("AI_EXTRACT_BACKEND", "rules")
    st = extract_backend_status()
    assert st["extractBackendConfigured"] == "rules"
    assert st["extractBackendEffective"] == "rules"
    assert "ollamaAvailable" in st
    assert st["ollamaAvailable"] is False


def test_default_backend_is_rules(monkeypatch):
    monkeypatch.delenv("AI_EXTRACT_BACKEND", raising=False)
    from app.extract_pipeline import configured_extract_backend

    assert configured_extract_backend() == "rules"


def test_rules_status_skips_ollama_probe(monkeypatch):
    monkeypatch.setenv("AI_EXTRACT_BACKEND", "rules")

    def _boom():
        raise AssertionError("ollama must not be probed in rules mode")

    monkeypatch.setattr("app.extract_pipeline.ollama_available", _boom)
    st = extract_backend_status()
    assert st["extractBackendEffective"] == "rules"
