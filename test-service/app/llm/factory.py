from __future__ import annotations

from app.config import get_settings
from app.llm.groq import GroqClient
from app.llm.mock import MockLlmClient


def get_llm_client():
    settings = get_settings()
    provider = (settings.llm_provider or "groq").strip().lower()
    if provider == "mock":
        return MockLlmClient()
    if provider == "groq":
        return GroqClient()
    raise RuntimeError(f"Unsupported LLM_PROVIDER={provider}")
