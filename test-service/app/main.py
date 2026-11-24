"""Test-Service FastAPI entrypoint — Phase 0 skeleton."""
from __future__ import annotations

import logging
import time
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from contextlib import asynccontextmanager

from app.config import get_settings
from app.db import engine
from app.routers import tests_candidate, tests_recruiter
from app.scheduler import start_scheduler, stop_scheduler
from app.schemas import CurrentUser, ErrorResponse, HealthResponse
from app.security import get_current_user

settings = get_settings()
logger = logging.getLogger("test-service")
logging.basicConfig(level=settings.log_level.upper())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_scheduler(30)
    yield
    stop_scheduler()


app = FastAPI(
    title="DechliRecrutement Test Service",
    version=settings.app_version,
    lifespan=lifespan,
    description=(
        "Technical IT tests: generate (LLM), assign, timed attempt, "
        "QCM+open grading, publish results. Phase 6 = Angular + Gateway."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(tests_recruiter.router)
app.include_router(tests_candidate.router)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers["X-Request-Id"] = request_id
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
        content=ErrorResponse(detail="Internal server error", code="internal_error").model_dump(),
    )


def _db_status() -> str:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return "up"
    except Exception:
        return "down"


@app.get("/health", response_model=HealthResponse, tags=["ops"])
def health():
    db = _db_status()
    return HealthResponse(
        status="ok" if db != "down" else "degraded",
        service=settings.app_name,
        version=settings.app_version,
        database=db,  # type: ignore[arg-type]
        authRequired=True,
        llmProvider=settings.llm_provider,
    )


@app.get("/api/v1/tests/me", response_model=CurrentUser, tags=["auth-smoke"])
def me(user: CurrentUser = Depends(get_current_user)):
    """Smoke endpoint: validates JWT claims (userId, role, email)."""
    return user
