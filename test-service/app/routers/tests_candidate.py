"""Candidate endpoints — attempt lifecycle."""
from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.attempt.service import (
    INTEGRITY_INCIDENT_LIMIT,
    add_incident,
    get_paper,
    list_my_assignments,
    save_answers,
    start_attempt,
    submit_attempt,
    sweep_timers,
)
from app.db import get_db
from app.evaluation.service import run_evaluation_job, sweep_evaluations
from app.models import CandidateAnswer
from app.publish.service import get_published_result
from app.schemas import CurrentUser
from app.schemas_tests import (
    AnswerResultOut,
    AssignmentOut,
    CandidateResultOut,
    QuestionOut,
)
from app.security import require_candidate, require_internal_api_key

router = APIRouter(prefix="/api/v1/tests", tags=["candidate-tests"])


class PaperAnswerOut(BaseModel):
    questionId: int
    answerOption: Optional[str] = None
    answerText: Optional[str] = None


class PaperOut(BaseModel):
    assignment: AssignmentOut
    durationSec: int
    serverNow: str
    remainingSec: Optional[int] = None
    questions: list[QuestionOut]
    answers: list[PaperAnswerOut] = Field(default_factory=list)


class AnswerItem(BaseModel):
    questionId: int
    answerOption: Optional[str] = None
    answerText: Optional[str] = None


class SaveAnswersRequest(BaseModel):
    answers: list[AnswerItem] = Field(default_factory=list)


class IncidentRequest(BaseModel):
    type: str
    meta: Optional[dict[str, Any]] = None


def _assignment_out(row, *, reveal_scores: bool = False) -> AssignmentOut:
    # Candidate sees scores only after PUBLISHED (Phase 5); until then hide.
    published = row.status == "PUBLISHED" or reveal_scores
    return AssignmentOut(
        id=row.id,
        testId=row.test_id,
        offreId=row.offre_id,
        candidatureId=row.candidature_id,
        candidateId=row.candidate_id,
        status=row.status,
        invitedAt=row.invited_at,
        startDeadlineAt=row.start_deadline_at,
        startedAt=row.started_at,
        endsAt=row.ends_at,
        submittedAt=row.submitted_at,
        scoreMcq=float(row.score_mcq) if published and row.score_mcq is not None else None,
        scoreOpen=float(row.score_open) if published and row.score_open is not None else None,
        scoreTotal=(
            float(row.score_total) if published and row.score_total is not None else None
        ),
        evaluation=row.evaluation_json if published else None,
        publishedAt=row.published_at,
    )


def _map_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    raise exc


@router.get("/me/assignments", response_model=list[AssignmentOut])
def my_assignments(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    rows = list_my_assignments(db, user.user_id)
    return [_assignment_out(r) for r in rows]


@router.get(
    "/me/assignments/{assignment_id}/result",
    response_model=CandidateResultOut,
)
def my_result(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    try:
        row, details = get_published_result(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
        )
    except Exception as exc:
        raise _map_exc(exc) from exc
    return CandidateResultOut(
        assignment=_assignment_out(row),
        answers=[AnswerResultOut(**d) for d in details],
    )


@router.get("/assignments/{assignment_id}/paper", response_model=PaperOut)
def paper(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    from datetime import datetime

    try:
        row, test, questions = get_paper(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
        )
    except Exception as exc:
        raise _map_exc(exc) from exc

    now = datetime.utcnow()
    remaining = None
    if row.ends_at and row.status == "IN_PROGRESS":
        remaining = max(0, int((row.ends_at - now).total_seconds()))

    q_out = [
        QuestionOut(
            id=q.id,
            position=q.position,
            type=q.type,  # type: ignore[arg-type]
            prompt=q.prompt,
            options=q.options_json if isinstance(q.options_json, dict) else None,
            correctOption=None,
            maxScore=float(q.max_score),
            rubric=None,
        )
        for q in questions
    ]
    # Reload autosaved answers so resume does not look empty
    saved = list(
        db.scalars(
            select(CandidateAnswer).where(CandidateAnswer.assignment_id == row.id)
        ).all()
    )
    a_out = [
        PaperAnswerOut(
            questionId=a.question_id,
            answerOption=a.answer_option,
            answerText=a.answer_text,
        )
        for a in saved
    ]
    return PaperOut(
        assignment=_assignment_out(row),
        durationSec=test.duration_sec,
        serverNow=now.isoformat() + "Z",
        remainingSec=remaining,
        questions=q_out,
        answers=a_out,
    )


@router.post("/assignments/{assignment_id}/start", response_model=AssignmentOut)
def start(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    try:
        row = start_attempt(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
        )
    except Exception as exc:
        raise _map_exc(exc) from exc
    return _assignment_out(row)


@router.put("/assignments/{assignment_id}/answers", response_model=AssignmentOut)
def answers(
    assignment_id: int,
    body: SaveAnswersRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    try:
        row = save_answers(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
            answers=[a.model_dump() for a in body.answers],
        )
    except Exception as exc:
        raise _map_exc(exc) from exc
    return _assignment_out(row)


@router.post("/assignments/{assignment_id}/submit", response_model=AssignmentOut)
def submit(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    try:
        row = submit_attempt(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
            auto=False,
        )
    except Exception as exc:
        raise _map_exc(exc) from exc
    if row.status == "SUBMITTED":
        background_tasks.add_task(run_evaluation_job, assignment_id)
    return _assignment_out(row)


@router.post("/assignments/{assignment_id}/incidents")
def incidents(
    assignment_id: int,
    body: IncidentRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_candidate)],
):
    try:
        inc, count, blocked = add_incident(
            db,
            assignment_id=assignment_id,
            candidate_id=user.user_id,
            role=user.role,
            incident_type=body.type,
            meta=body.meta,
        )
    except Exception as exc:
        raise _map_exc(exc) from exc
    if blocked:
        background_tasks.add_task(run_evaluation_job, assignment_id)
    return {
        "id": inc.id,
        "type": inc.type,
        "occurredAt": inc.occurred_at.isoformat() + "Z",
        "incidentCount": count,
        "limit": INTEGRITY_INCIDENT_LIMIT,
        "blocked": blocked,
        "message": (
            "Test bloqué et soumis automatiquement (trop d’incidents d’intégrité)."
            if blocked
            else None
        ),
    }


@router.post("/ops/sweep-timers", dependencies=[Depends(require_internal_api_key)])
def ops_sweep(db: Annotated[Session, Depends(get_db)]):
    """Expire invitations / autosubmit overdue attempts + evaluate pending."""
    timers = sweep_timers(db)
    grades = sweep_evaluations(db)
    return {**timers, **grades}
