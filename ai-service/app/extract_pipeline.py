"""Unified extraction backends: rule-based (default) + optional local Ollama."""
from __future__ import annotations

import logging
import os
from typing import Literal

from app.nlp import extract as extract_rules
from app.ollama_extract import extract_with_ollama, ollama_available
from app.schemas import ExtractResponse

logger = logging.getLogger("ai-service.extract")

ExtractBackend = Literal["rules", "ollama", "auto"]


def configured_extract_backend() -> ExtractBackend:
    # Jury / production default: rules (deterministic, 0€, no Ollama required).
    # Opt-in: AI_EXTRACT_BACKEND=auto|ollama when a local LLM is available.
    raw = (os.getenv("AI_EXTRACT_BACKEND", "rules") or "rules").strip().lower()
    if raw in {"auto", "hybrid"}:
        return "auto"
    if raw in {"ollama", "llm"}:
        return "ollama"
    return "rules"


def extract_backend_status() -> dict:
    backend = configured_extract_backend()
    # Skip network probe when rules-only — keeps /health fast for demos.
    if backend == "rules":
        avail = False
        effective = "rules"
    else:
        avail = ollama_available()
        effective = backend
        if backend == "auto":
            effective = "ollama" if avail else "rules"
        elif backend == "ollama" and not avail:
            effective = "rules"
    return {
        "extractBackendConfigured": backend,
        "extractBackendEffective": effective,
        "ollamaAvailable": avail,
        "ollamaHost": os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434"),
        "ollamaModel": os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
    }


def _merge(rules: dict, llm: dict) -> dict:
    """Prefer LLM numeric/edu when present; union skills; keep evidence from both."""
    skills = sorted(set(rules.get("skills") or []) | set(llm.get("skills") or []))
    exp = llm.get("experienceYears")
    if exp is None:
        exp = rules.get("experienceYears")
    edu = llm.get("education") or rules.get("education")
    status = llm.get("educationStatus") or rules.get("educationStatus")
    specialty = llm.get("specialty") or rules.get("specialty")
    evidence = list(rules.get("evidence") or []) + list(llm.get("evidence") or [])
    limitations = list(dict.fromkeys((rules.get("limitations") or []) + (llm.get("limitations") or [])))
    limitations.append("Merged rules+ollama extraction (skills union).")
    return ExtractResponse(
        skills=skills,
        experienceYears=exp,
        education=edu,
        educationStatus=status,
        specialty=specialty,
        method="hybrid-extract-rules+ollama-v1",
        evidence=evidence[:80],
        limitations=limitations,
    ).model_dump()


def extract(text: str) -> dict:
    """Public extract entry used by FastAPI routes."""
    backend = configured_extract_backend()
    rules = extract_rules(text)

    if backend == "rules":
        return rules

    if backend == "ollama":
        if not ollama_available():
            out = dict(rules)
            lim = list(out.get("limitations") or [])
            lim.append("Ollama unavailable — fell back to rule-based-nlp-v3.")
            out["limitations"] = lim
            out["method"] = "rule-based-nlp-v3+ollama-fallback"
            return out
        try:
            return extract_with_ollama(text)
        except Exception as exc:
            logger.warning("ollama_extract_failed err=%s", type(exc).__name__)
            out = dict(rules)
            lim = list(out.get("limitations") or [])
            lim.append(f"Ollama failed ({type(exc).__name__}) — fell back to rules.")
            out["limitations"] = lim
            out["method"] = "rule-based-nlp-v3+ollama-fallback"
            return out

    # auto: merge when Ollama up, else rules only
    if not ollama_available():
        return rules
    try:
        llm = extract_with_ollama(text)
        return _merge(rules, llm)
    except Exception as exc:
        logger.warning("ollama_auto_failed err=%s", type(exc).__name__)
        return rules
