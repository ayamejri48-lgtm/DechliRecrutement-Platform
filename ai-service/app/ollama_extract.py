"""Optional local Ollama LLM extraction with Pydantic-structured JSON.

Budget: 0 € API (localhost). If Ollama is down/unavailable, callers must fall back
to rule-based NLP — never invent skills outside the response schema.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError

from app.nlp import encode_education_wire, normalize_skills
from app.schemas import EducationStatus, ExtractResponse, ExtractionEvidence

DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_S", "45"))


class LlmProfile(BaseModel):
    """Strict schema requested from the local LLM (Structured Output)."""

    skills: list[str] = Field(default_factory=list, max_length=80)
    experienceYears: Optional[float] = Field(default=None, ge=0, le=60)
    education: Optional[str] = Field(default=None, max_length=40)
    educationStatus: Optional[EducationStatus] = None
    specialty: Optional[str] = Field(default=None, max_length=80)


def ollama_available(host: str = DEFAULT_HOST, timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(f"{host}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _chat(text: str, *, host: str, model: str) -> dict[str, Any]:
    schema = LlmProfile.model_json_schema()
    system = (
        "You extract structured hiring profile fields from CV or job-offer text. "
        "Return ONLY JSON matching the schema. "
        "Do not invent skills that are not clearly present in the text. "
        "education must be one of: bachelor, master, phd, or null. "
        "educationStatus: completed | in_progress | unknown | null."
    )
    payload = {
        "model": model,
        "stream": False,
        "format": schema,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    "Extract skills, experienceYears, education, educationStatus, "
                    f"specialty from this text:\n\n{text[:12000]}"
                ),
            },
        ],
        "options": {"temperature": 0},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{host}/api/chat",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    content = (body.get("message") or {}).get("content") or "{}"
    if isinstance(content, dict):
        return content
    return json.loads(content)


def extract_with_ollama(
    text: str,
    *,
    host: str = DEFAULT_HOST,
    model: str = DEFAULT_MODEL,
) -> dict:
    if not text or not str(text).strip():
        return ExtractResponse(
            skills=[],
            method="ollama-structured-v1",
            limitations=["Empty input text."],
        ).model_dump()

    raw = _chat(text, host=host, model=model)
    try:
        profile = LlmProfile.model_validate(raw)
    except ValidationError as exc:
        raise RuntimeError(f"Ollama JSON schema validation failed: {exc}") from exc

    skills = normalize_skills(profile.skills)
    edu = profile.education
    status = profile.educationStatus
    if edu in {"bachelor", "master", "phd"} and status:
        edu_out = encode_education_wire(edu, status)
    elif edu in {"bachelor", "master", "phd"}:
        edu_out = edu
    else:
        edu_out = None

    evidence = [
        ExtractionEvidence(
            field="skills",
            value=s,
            span=None,
            confidence=0.7,
        )
        for s in skills[:20]
    ]
    return ExtractResponse(
        skills=skills,
        experienceYears=profile.experienceYears,
        education=edu_out,
        educationStatus=status,
        specialty=profile.specialty,
        method="ollama-structured-v1",
        evidence=evidence,
        limitations=[
            f"Local Ollama model={model}; skills normalized to curated lexicon aliases when possible.",
            "LLM may miss domain terms outside the prompt; validate critical matches.",
            "No cloud API cost (localhost).",
        ],
    ).model_dump()
