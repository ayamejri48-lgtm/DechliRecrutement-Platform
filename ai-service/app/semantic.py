"""Semantic similarity backends for hybrid matching.

Primary: Sentence Transformers (all-MiniLM-L6-v2) when installed and enabled.
Fallback: character n-gram TF-IDF cosine (deterministic, no download).

Title-only similarity must never drive a high match score by itself.
"""
from __future__ import annotations

import hashlib
import os
import re
from functools import lru_cache
from typing import Optional

import numpy as np

_MODEL_NAME = os.getenv("AI_SENTENCE_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
_BACKEND_PREF = os.getenv("AI_SEMANTIC_BACKEND", "auto").lower()  # auto|st|tfidf


def backend_name() -> str:
    if _BACKEND_PREF == "tfidf":
        return "tfidf-ngram"
    if _BACKEND_PREF == "st":
        return "sentence-transformers" if _st_available() else "tfidf-ngram"
    return "sentence-transformers" if _st_available() else "tfidf-ngram"


def _st_available() -> bool:
    try:
        import sentence_transformers  # noqa: F401

        return True
    except Exception:
        return False


@lru_cache(maxsize=1)
def _st_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(_MODEL_NAME)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _tfidf_embed(texts: list[str]) -> np.ndarray:
    """Lightweight deterministic embeddings without external downloads."""
    from sklearn.feature_extraction.text import HashingVectorizer

    vectorizer = HashingVectorizer(
        n_features=512,
        alternate_sign=False,
        norm="l2",
        ngram_range=(1, 2),
        analyzer="char_wb",
    )
    return vectorizer.transform(texts).toarray().astype(np.float32)


def _st_embed(texts: list[str]) -> np.ndarray:
    model = _st_model()
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vectors, dtype=np.float32)


def embed(texts: list[str]) -> np.ndarray:
    cleaned = [_normalize(t) or " " for t in texts]
    if backend_name() == "sentence-transformers":
        try:
            return _st_embed(cleaned)
        except Exception:
            return _tfidf_embed(cleaned)
    return _tfidf_embed(cleaned)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.clip(np.dot(a, b) / denom, 0.0, 1.0))


def similarity(text_a: str, text_b: str) -> Optional[float]:
    if not _normalize(text_a) or not _normalize(text_b):
        return None
    va, vb = embed([text_a, text_b])
    return round(cosine(va, vb), 4)


def skills_text(skills: list[str]) -> str:
    return ", ".join(sorted({s.strip().lower() for s in skills if s and s.strip()}))


def profile_semantic_text(profile: dict, *, include_title: bool = True) -> str:
    parts: list[str] = []
    skills = skills_text(profile.get("skills") or [])
    if skills:
        parts.append(f"skills: {skills}")
    if include_title and profile.get("title"):
        parts.append(f"title: {profile['title']}")
    if profile.get("summary"):
        parts.append(str(profile["summary"])[:1000])
    if profile.get("education"):
        parts.append(f"education: {profile['education']}")
    return " | ".join(parts)


def deterministic_probe_hash(seed: str) -> str:
    """Helper for reproducible smoke tests (not used in scoring)."""
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]
