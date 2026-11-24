"""DechliRecrutement AI-Service — FastAPI entrypoint."""
from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.extract_pipeline import extract, extract_backend_status
from app.matching import NUMERIC_FEATURES, baseline, features, rank_candidates, score_band
from app.schemas import (
    BatchMatchInput,
    BatchMatchResponse,
    ErrorResponse,
    ExtractResponse,
    HealthResponse,
    MatchInput,
    MatchResponse,
    MlMatchResponse,
    TextInput,
)
from app.security import auth_required, require_internal_api_key
from app.semantic import backend_name

logger = logging.getLogger("ai-service")
logging.basicConfig(level=os.getenv("AI_LOG_LEVEL", "INFO"))

APP_VERSION = "1.3.2"

app = FastAPI(
    title="DechliRecrutement AI Service",
    version=APP_VERSION,
    description=(
        "Internal NLP extraction and hybrid matching (local, 0€ API). "
        "Jury baseline: rules extract + hybrid-v3 match. "
        "Optional: Ollama extract (AI_EXTRACT_BACKEND=auto|ollama), supervised /match/ml after human labels. "
        "For Spring Boot orchestration only — not for direct browser access."
    ),
)


def _model_loaded() -> bool:
    path = Path(os.getenv("MATCHING_MODEL_PATH", "models/matching_model.joblib"))
    return path.is_file()


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers["X-Request-Id"] = request_id
    # No body/PII logging — path + status + latency only.
    logger.info(
        "request_id=%s method=%s path=%s status=%s latency_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(detail="Validation error", code="validation_error").model_dump()
        | {"errors": exc.errors()},
    )


@app.exception_handler(Exception)
async def unhandled_handler(_, exc: Exception):
    logger.exception("unhandled_error type=%s", type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            detail="Internal server error",
            code="internal_error",
        ).model_dump(),
    )


@app.get("/health", response_model=HealthResponse, tags=["ops"])
def health():
    ext = extract_backend_status()
    return HealthResponse(
        status="ok",
        service="ai-service",
        version=APP_VERSION,
        semanticBackend=backend_name(),
        authRequired=auth_required(),
        supervisedModelLoaded=_model_loaded(),
        extractBackendConfigured=ext["extractBackendConfigured"],
        extractBackendEffective=ext["extractBackendEffective"],
        ollamaAvailable=ext["ollamaAvailable"],
    )


@app.post(
    "/api/v1/extract/cv",
    response_model=ExtractResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["extract"],
)
def extract_cv(payload: TextInput):
    return extract(payload.text)


@app.post(
    "/api/v1/extract/offer",
    response_model=ExtractResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["extract"],
)
def extract_offer(payload: TextInput):
    return extract(payload.text)


@app.post(
    "/api/v1/extract/text",
    response_model=ExtractResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["extract"],
)
def extract_text(payload: TextInput):
    return extract(payload.text)


@app.post(
    "/api/v1/extract/cv/pdf",
    response_model=ExtractResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["extract"],
)
async def extract_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF required")
    content_type = (file.content_type or "").lower()
    if content_type and content_type not in {
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=400, detail="Invalid content type for PDF")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF too large (10 MB max)")
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF")
    try:
        import pymupdf

        with pymupdf.open(stream=content, filetype="pdf") as doc:
            if len(doc) > 30:
                raise HTTPException(status_code=413, detail="PDF too many pages")
            if getattr(doc, "is_encrypted", False):
                raise HTTPException(status_code=422, detail="Encrypted PDF not supported")
            text = " ".join(page.get_text() for page in doc)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=422, detail="PDF could not be parsed")
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="No extractable text (scanned PDF requires OCR)",
        )
    return extract(text[:200_000])


@app.post(
    "/api/v1/match",
    response_model=MatchResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["match"],
)
def match(payload: MatchInput):
    return baseline(
        payload.candidate.model_dump(),
        payload.offer.model_dump(),
        candidatureId=payload.candidatureId,
        cvId=payload.cvId,
    )


@app.post(
    "/api/v1/match/batch",
    response_model=BatchMatchResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["match"],
)
def match_batch(payload: BatchMatchInput):
    items = [c.model_dump() for c in payload.candidates]
    return rank_candidates(payload.offer.model_dump(), items)


@app.post(
    "/api/v1/match/ml",
    response_model=MlMatchResponse,
    dependencies=[Depends(require_internal_api_key)],
    tags=["match"],
)
def match_ml(payload: MatchInput):
    """Optional validated local model, trained separately on annotated pairs."""
    import joblib
    import numpy as np
    import pandas as pd

    path = Path(os.getenv("MATCHING_MODEL_PATH", "models/matching_model.joblib"))
    if not path.is_file():
        raise HTTPException(
            status_code=503,
            detail="Trained model unavailable; use baseline /api/v1/match",
        )
    artifact = joblib.load(path)
    feature_names = artifact.get("features") or NUMERIC_FEATURES
    f = features(payload.candidate.model_dump(), payload.offer.model_dump())
    row = {name: f.get(name) for name in feature_names}
    X = pd.DataFrame([row])[feature_names].astype(float)
    score = float(np.clip(artifact["model"].predict(X)[0], 0, 1))
    rounded = round(score, 4)
    return MlMatchResponse(
        score=rounded,
        scoreBand=score_band(rounded),
        features=f,
        method="supervised-ml",
        modelVersion=str(artifact.get("version", "unknown")),
        warning=(
            "SUPERVISED ML score (not hybrid-v3 baseline, not a human annotation). "
            "Estimated relevance from training labels — not a hiring probability. "
            "Validate label provenance before production."
        ),
        candidatureId=payload.candidatureId,
        cvId=payload.cvId,
    )
