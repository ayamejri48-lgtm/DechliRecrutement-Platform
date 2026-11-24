"""Test defaults: fast semantic backend, no auth unless a test opts in."""
import os

# Deterministic, no model download during unit/API tests.
os.environ.setdefault("AI_SEMANTIC_BACKEND", "tfidf")
# Do not call Ollama during unit/API tests.
os.environ.setdefault("AI_EXTRACT_BACKEND", "rules")
# Ensure auth is off unless a security test enables it.
os.environ.pop("AI_INTERNAL_API_KEY", None)
