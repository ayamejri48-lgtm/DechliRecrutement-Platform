"""Pydantic API schemas (Phase 0 — health + auth context)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    detail: str
    code: str = "error"


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"] = "ok"
    service: str = "test-service"
    version: str
    database: Literal["up", "down", "unknown"] = "unknown"
    authRequired: bool = True
    llmProvider: str = "groq"


class CurrentUser(BaseModel):
    user_id: int
    email: str
    role: str = Field(description="RECRUITER | CANDIDATE | ADMIN")
