"""Schemas for technical test APIs (Phase 1)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class QuestionOut(BaseModel):
    id: int
    position: int
    type: Literal["MCQ", "OPEN"]
    prompt: str
    options: Optional[dict[str, str]] = None
    correctOption: Optional[str] = None  # recruiter view only
    maxScore: float
    rubric: Optional[Any] = None


class TechnicalTestOut(BaseModel):
    id: int
    offreId: int
    recruiterId: int
    difficulty: str
    durationSec: int
    status: str
    llmProvider: Optional[str] = None
    llmModel: Optional[str] = None
    promptVersion: Optional[str] = None
    regenerateCount: int
    errorMessage: Optional[str] = None
    questions: list[QuestionOut] = Field(default_factory=list)
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class GenerateAccepted(BaseModel):
    testId: int
    offreId: int
    status: str
    message: str


class AssignRequest(BaseModel):
    candidatureIds: list[int]


class AssignmentOut(BaseModel):
    id: int
    testId: int
    offreId: int
    candidatureId: int
    candidateId: int
    status: str
    invitedAt: Optional[datetime] = None
    startDeadlineAt: Optional[datetime] = None
    startedAt: Optional[datetime] = None
    endsAt: Optional[datetime] = None
    submittedAt: Optional[datetime] = None
    scoreMcq: Optional[float] = None
    scoreOpen: Optional[float] = None
    scoreTotal: Optional[float] = None
    evaluation: Optional[Any] = None
    publishedAt: Optional[datetime] = None


class AssignResponse(BaseModel):
    offreId: int
    testId: int
    assigned: list[AssignmentOut]
    message: str


class EvaluationAccepted(BaseModel):
    assignmentId: int
    status: str
    message: str


class PublishRequest(BaseModel):
    assignmentIds: Optional[list[int]] = None  # None = all EVALUATED for offre


class PublishResponse(BaseModel):
    offreId: int
    published: list[AssignmentOut]
    message: str


class AnswerResultOut(BaseModel):
    questionId: int
    position: int
    type: Literal["MCQ", "OPEN"]
    prompt: str
    maxScore: float
    score: Optional[float] = None
    isCorrect: Optional[bool] = None
    feedback: Optional[str] = None
    answerOption: Optional[str] = None
    answerText: Optional[str] = None
    correctOption: Optional[str] = None  # recruteur uniquement


class CandidateResultOut(BaseModel):
    assignment: AssignmentOut
    answers: list[AnswerResultOut] = Field(default_factory=list)


class QuestionDiffItem(BaseModel):
    position: int
    type: Optional[str] = None
    prompt: Optional[str] = None
    fromPrompt: Optional[str] = None
    toPrompt: Optional[str] = None


class QuestionDiffOut(BaseModel):
    added: list[QuestionDiffItem] = Field(default_factory=list)
    removed: list[QuestionDiffItem] = Field(default_factory=list)
    changed: list[QuestionDiffItem] = Field(default_factory=list)
    addedCount: int = 0
    removedCount: int = 0
    changedCount: int = 0


class GenerationRevisionOut(BaseModel):
    revision: int
    difficulty: str
    durationSec: int
    llmProvider: Optional[str] = None
    llmModel: Optional[str] = None
    createdAt: Optional[datetime] = None
    questionCount: int
    questions: list[dict[str, Any]] = Field(default_factory=list)
    diffFromPrevious: Optional[QuestionDiffOut] = None


class GenerationHistoryOut(BaseModel):
    testId: int
    offreId: int
    regenerateCount: int
    revisions: list[GenerationRevisionOut] = Field(default_factory=list)


class CorrectionDetailOut(BaseModel):
    """Vue recruteur : copies corrigées (avant ou après publication)."""

    assignment: AssignmentOut
    answers: list[AnswerResultOut] = Field(default_factory=list)
