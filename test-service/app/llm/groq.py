"""Groq OpenAI-compatible chat completions → JSON object."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger("test-service.llm.groq")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class GroqClient:
    provider = "groq"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        settings = get_settings()
        self.api_key = (api_key if api_key is not None else settings.groq_api_key).strip()
        self.model = model or settings.groq_model
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY manquante")

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "temperature": 0.3,
            "max_tokens": 8000,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        last_err: Exception | None = None
        with httpx.Client(timeout=120.0) as client:
            for attempt in range(1, 3):
                r = client.post(_GROQ_URL, headers=headers, json=payload)
                if r.status_code >= 400:
                    logger.warning(
                        "groq_http attempt=%s status=%s body=%s",
                        attempt,
                        r.status_code,
                        r.text[:400],
                    )
                    last_err = RuntimeError(
                        f"Groq HTTP {r.status_code}: {r.text[:300]}"
                    )
                    # empty/failed JSON gen often recovers on retry
                    if r.status_code == 400 and "json_validate_failed" in r.text:
                        continue
                    raise last_err
                data = r.json()
                content = (
                    ((data.get("choices") or [{}])[0].get("message") or {}).get(
                        "content"
                    )
                    or ""
                )
                try:
                    return _parse_json_object(content)
                except Exception as exc:  # noqa: BLE001 — retry once on bad JSON
                    last_err = exc
                    logger.warning("groq_parse attempt=%s err=%s", attempt, exc)
        assert last_err is not None
        raise last_err


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise RuntimeError("Empty LLM response")
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise RuntimeError("LLM response is not JSON object")
    obj = json.loads(match.group(0))
    if not isinstance(obj, dict):
        raise RuntimeError("LLM JSON root must be object")
    return obj
