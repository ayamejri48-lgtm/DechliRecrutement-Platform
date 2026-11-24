"""Pydantic contracts for OpenAPI and runtime validation."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


EducationStatus = Literal["completed", "in_progress", "unknown"]


class Profile(BaseModel):
    """Profile shape aligned with future Spring orchestration payloads."""

    skills: list[str] = Field(default_factory=list, max_length=200)
    requiredSkills: list[str] = Field(default_factory=list, max_length=100)
    experienceYears: Optional[float] = Field(default=None, ge=0, le=60)
    education: Optional[str] = Field(
        default=None,
        max_length=40,
        description=(
            "Level: bachelor|master|phd. "
            "Wire tokens edu{1|2|3}{ok|ip|un} also accepted (Offre-Service safe)."
        ),
    )
    educationStatus: Optional[EducationStatus] = Field(
        default=None,
        description="completed | in_progress | unknown (optional; ignored if absent).",
    )
    title: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Optional job title; never used alone for a high match score.",
    )
    summary: Optional[str] = Field(default=None, max_length=5000)


class MatchInput(BaseModel):
    candidate: Profile
    offer: Profile
    candidatureId: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Optional correlation id from Offre-Service (not stored).",
    )
    cvId: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Optional candidature.cvId snapshot reference (not fetched here).",
    )


class CandidateMatchItem(BaseModel):
    candidate: Profile
    candidatureId: Optional[str] = Field(default=None, max_length=64)
    cvId: Optional[str] = Field(default=None, max_length=64)


class BatchMatchInput(BaseModel):
    """Rank multiple candidates against one offer (orchestration-ready)."""

    offer: Profile
    candidates: list[CandidateMatchItem] = Field(min_length=1, max_length=50)


class ExtractionEvidence(BaseModel):
    field: str
    value: str
    span: Optional[str] = None
    confidence: float = Field(ge=0, le=1)


class ExtractResponse(BaseModel):
    skills: list[str]
    experienceYears: Optional[float] = None
    education: Optional[str] = None
    educationStatus: Optional[EducationStatus] = None
    specialty: Optional[str] = None
    method: str
    evidence: list[ExtractionEvidence] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class MatchFeatures(BaseModel):
    skills_coverage: Optional[float] = None
    skills_precision: Optional[float] = None
    skills_f1: Optional[float] = None
    skills_score: Optional[float] = None
    required_skills_coverage: Optional[float] = None
    experience_match: Optional[float] = None
    education_match: Optional[float] = None
    semantic_similarity: Optional[float] = None
    title_similarity: Optional[float] = None
    critical_skills_missing: int = 0
    matchedSkills: list[str] = Field(default_factory=list)
    missingSkills: list[str] = Field(default_factory=list)
    missingRequiredSkills: list[str] = Field(default_factory=list)


ScoreBand = Literal["low", "medium", "high", "unavailable"]


class MatchResponse(BaseModel):
    score: Optional[float] = Field(default=None, ge=0, le=1)
    scoreBand: ScoreBand = "unavailable"
    features: MatchFeatures
    explanations: list[str] = Field(default_factory=list)
    method: str
    modelVersion: str
    warning: str
    candidatureId: Optional[str] = None
    cvId: Optional[str] = None


class RankedMatchItem(BaseModel):
    rank: Optional[int] = Field(
        default=None,
        description="1-based rank among scoreable results only; null if unavailable.",
    )
    result: MatchResponse


class BatchMatchResponse(BaseModel):
    offerSkills: list[str] = Field(default_factory=list)
    results: list[RankedMatchItem]
    method: str
    modelVersion: str
    warning: str


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    semanticBackend: str
    authRequired: bool
    supervisedModelLoaded: bool
    extractBackendConfigured: Optional[str] = None
    extractBackendEffective: Optional[str] = None
    ollamaAvailable: Optional[bool] = None


class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None


class MlMatchResponse(BaseModel):
    score: float = Field(ge=0, le=1)
    scoreBand: ScoreBand
    features: dict[str, Any]
    method: str
    modelVersion: str
    warning: str
    candidatureId: Optional[str] = None
    cvId: Optional[str] = None
