"""Recruiter endpoints — generate / get / regenerate technical tests."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.assignment.service import assign_candidatures, list_assignments_for_offre
from app.evaluation.service import run_evaluation_job
from app.generation.service import (
    get_test_by_offre,
    list_generation_history,
    run_generation_job,
    start_generation,
)
from app.models import TechnicalTest, TestAssignment
from app.publish.service import (
    get_recruiter_correction,
    publish_assignment,
    publish_for_offre,
)
from app.schemas import CurrentUser
from app.schemas_tests import (
    AnswerResultOut,
    AssignRequest,
    AssignResponse,
    AssignmentOut,
    CorrectionDetailOut,
    EvaluationAccepted,
    GenerateAccepted,
    GenerationHistoryOut,
    GenerationRevisionOut,
    PublishRequest,
    PublishResponse,
    QuestionDiffOut,
    QuestionOut,
    TechnicalTestOut,
)
from app.security import require_admin, require_recruiter

router = APIRouter(prefix="/api/v1/tests", tags=["recruiter-tests"])


class AdminTestRow(BaseModel):
    offreId: int
    status: str
    assignmentCount: int
    publishedCount: int
    unpublishedGradedCount: int


class AdminAssignmentRow(BaseModel):
    candidatureId: int
    offreId: int
    status: str
    scoreTotal: Optional[float] = None


class AdminOverviewOut(BaseModel):
    """Supervision admin : pas de questions, pas de corrigé. Note si elle est calculée."""

    tests: list[AdminTestRow]
    assignments: list[AdminAssignmentRow]


@router.get("/admin/overview", response_model=AdminOverviewOut)
def admin_overview(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_admin)],
):
    _ = user
    test_rows = db.execute(
        select(TechnicalTest.offre_id, TechnicalTest.status)
    ).all()
    assign_rows = db.execute(
        select(
            TestAssignment.candidature_id,
            TestAssignment.offre_id,
            TestAssignment.status,
            TestAssignment.score_total,
        )
    ).all()

    by_offre: dict[int, dict] = {}
    for offre_id, status_name in test_rows:
        oid = int(offre_id)
        by_offre[oid] = {
            "offreId": oid,
            "status": status_name,
            "assignmentCount": 0,
            "publishedCount": 0,
            "unpublishedGradedCount": 0,
        }

    assignments: list[AdminAssignmentRow] = []
    for candidature_id, offre_id, status_name, score in assign_rows:
        oid = int(offre_id)
        bucket = by_offre.get(oid)
        graded = status_name in {"EVALUATED", "PUBLISHED"}
        if bucket is not None:
            bucket["assignmentCount"] += 1
            if status_name == "PUBLISHED":
                bucket["publishedCount"] += 1
            elif status_name == "EVALUATED":
                bucket["unpublishedGradedCount"] += 1
        assignments.append(
            AdminAssignmentRow(
                candidatureId=int(candidature_id),
                offreId=oid,
                status=status_name,
                scoreTotal=float(score) if graded and score is not None else None,
            )
        )

    return AdminOverviewOut(
        tests=[AdminTestRow(**row) for row in by_offre.values()],
        assignments=assignments,
    )


_TEST_STATUSES = ("DRAFT", "GENERATING", "READY", "ASSIGNED", "FAILED")
_ASSIGN_STATUSES = (
    "PENDING",
    "IN_PROGRESS",
    "SUBMITTED",
    "EVALUATING",
    "EVALUATED",
    "PUBLISHED",
    "EXPIRED",
)


class AdminTestStatsOut(BaseModel):
    testsByStatus: dict[str, int]
    assignmentsByStatus: dict[str, int]
    unpublishedGraded: int
    scoredCount: int
    meanScore: Optional[float] = None
    meanMcq: Optional[float] = None
    meanOpen: Optional[float] = None
    mcqCount: int = 0
    openCount: int = 0
    offreIdsWithTest: list[int]


@router.get("/admin/stats", response_model=AdminTestStatsOut)
def admin_stats(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_admin)],
):
    """Comptages réels. La note moyenne inclut les copies notées non publiées. Pas de corrigé."""
    _ = user
    tests = {name: 0 for name in _TEST_STATUSES}
    for status_name, count in db.execute(
        select(TechnicalTest.status, func.count(TechnicalTest.id)).group_by(TechnicalTest.status)
    ).all():
        tests[str(status_name)] = int(count)

    assignments = {name: 0 for name in _ASSIGN_STATUSES}
    for status_name, count in db.execute(
        select(TestAssignment.status, func.count(TestAssignment.id)).group_by(TestAssignment.status)
    ).all():
        assignments[str(status_name)] = int(count)

    graded_rows = db.execute(
        select(
            TestAssignment.score_total,
            TestAssignment.score_mcq,
            TestAssignment.score_open,
        ).where(TestAssignment.status.in_(("EVALUATED", "PUBLISHED")))
    ).all()
    scores = [float(total) for total, _mcq, _open in graded_rows if total is not None]
    mcq_scores = [float(mcq) for _total, mcq, _open in graded_rows if mcq is not None]
    open_scores = [float(open_score) for _total, _mcq, open_score in graded_rows if open_score is not None]
    offre_ids = [
        int(value)
        for (value,) in db.execute(select(TechnicalTest.offre_id).distinct()).all()
    ]
    return AdminTestStatsOut(
        testsByStatus=tests,
        assignmentsByStatus=assignments,
        unpublishedGraded=assignments.get("EVALUATED", 0),
        scoredCount=len(scores),
        meanScore=round(sum(scores) / len(scores), 1) if scores else None,
        meanMcq=round(sum(mcq_scores) / len(mcq_scores), 1) if mcq_scores else None,
        meanOpen=round(sum(open_scores) / len(open_scores), 1) if open_scores else None,
        mcqCount=len(mcq_scores),
        openCount=len(open_scores),
        offreIdsWithTest=offre_ids,
    )


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    return authorization.split(" ", 1)[1].strip()


def _to_out(test: TechnicalTest, *, include_answers: bool = True) -> TechnicalTestOut:
    questions = sorted(test.questions or [], key=lambda q: q.position)
    q_out: list[QuestionOut] = []
    for q in questions:
        q_out.append(
            QuestionOut(
                id=q.id,
                position=q.position,
                type=q.type,  # type: ignore[arg-type]
                prompt=q.prompt,
                options=q.options_json if isinstance(q.options_json, dict) else None,
                correctOption=q.correct_option if include_answers else None,
                maxScore=float(q.max_score),
                rubric=q.grading_rubric_json,
            )
        )
    return TechnicalTestOut(
        id=test.id,
        offreId=test.offre_id,
        recruiterId=test.recruiter_id,
        difficulty=test.difficulty,
        durationSec=test.duration_sec,
        status=test.status,
        llmProvider=test.llm_provider,
        llmModel=test.llm_model,
        promptVersion=test.prompt_version,
        regenerateCount=test.regenerate_count,
        errorMessage=test.error_message,
        questions=q_out,
        createdAt=test.created_at,
        updatedAt=test.updated_at,
    )


@router.post(
    "/offres/{offre_id}/generate",
    response_model=GenerateAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_test(
    offre_id: int,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
    authorization: Annotated[Optional[str], Header()] = None,
):
    token = _bearer(authorization)
    try:
        test, launch = start_generation(
            db,
            offre_id=offre_id,
            recruiter_id=user.user_id,
            role=user.role,
            bearer_token=token,
            regenerate=False,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if launch:
        background_tasks.add_task(
            run_generation_job,
            test_id=test.id,
            offre_id=offre_id,
            bearer_token=token,
        )
    return GenerateAccepted(
        testId=test.id,
        offreId=offre_id,
        status=test.status,
        message=(
            "Génération démarrée — interrogez GET jusqu'à status=READY ou FAILED"
            if launch
            else "Génération déjà en cours"
        ),
    )


@router.post(
    "/offres/{offre_id}/regenerate",
    response_model=GenerateAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def regenerate_test(
    offre_id: int,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
    authorization: Annotated[Optional[str], Header()] = None,
):
    token = _bearer(authorization)
    try:
        test, launch = start_generation(
            db,
            offre_id=offre_id,
            recruiter_id=user.user_id,
            role=user.role,
            bearer_token=token,
            regenerate=True,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if launch:
        background_tasks.add_task(
            run_generation_job,
            test_id=test.id,
            offre_id=offre_id,
            bearer_token=token,
        )
    return GenerateAccepted(
        testId=test.id,
        offreId=offre_id,
        status=test.status,
        message="Régénération démarrée (1× max)" if launch else "Régénération déjà en cours",
    )


@router.get("/offres/{offre_id}", response_model=TechnicalTestOut)
def get_test_for_offre(
    offre_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
    authorization: Annotated[Optional[str], Header()] = None,
):
    # ownership soft-check via Offre if needed; primary filter = recruiter_id on row
    _ = _bearer(authorization)
    test = get_test_by_offre(db, offre_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Aucun test pour cette offre")
    if user.role != "ADMIN" and test.recruiter_id != user.user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return _to_out(test, include_answers=True)


@router.get(
    "/offres/{offre_id}/generation-history",
    response_model=GenerationHistoryOut,
)
def generation_history(
    offre_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    """B7 — Historique des versions + diff entre régénérations."""
    test = get_test_by_offre(db, offre_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Aucun test pour cette offre")
    if user.role != "ADMIN" and test.recruiter_id != user.user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    raw = list_generation_history(db, test)
    revisions: list[GenerationRevisionOut] = []
    for item in raw:
        diff = item.get("diffFromPrevious")
        revisions.append(
            GenerationRevisionOut(
                revision=item["revision"],
                difficulty=item["difficulty"],
                durationSec=item["durationSec"],
                llmProvider=item.get("llmProvider"),
                llmModel=item.get("llmModel"),
                createdAt=item.get("createdAt"),
                questionCount=item["questionCount"],
                questions=item.get("questions") or [],
                diffFromPrevious=QuestionDiffOut(**diff) if diff else None,
            )
        )
    return GenerationHistoryOut(
        testId=test.id,
        offreId=test.offre_id,
        regenerateCount=test.regenerate_count,
        revisions=revisions,
    )


def _assignment_out(row: TestAssignment) -> AssignmentOut:
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
        scoreMcq=float(row.score_mcq) if row.score_mcq is not None else None,
        scoreOpen=float(row.score_open) if row.score_open is not None else None,
        scoreTotal=float(row.score_total) if row.score_total is not None else None,
        evaluation=row.evaluation_json,
        publishedAt=row.published_at,
    )


@router.post(
    "/offres/{offre_id}/assign",
    response_model=AssignResponse,
    status_code=status.HTTP_201_CREATED,
)
def assign_test(
    offre_id: int,
    body: AssignRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
    authorization: Annotated[Optional[str], Header()] = None,
):
    token = _bearer(authorization)
    try:
        rows = assign_candidatures(
            db,
            offre_id=offre_id,
            candidature_ids=body.candidatureIds,
            recruiter_id=user.user_id,
            role=user.role,
            bearer_token=token,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    test = get_test_by_offre(db, offre_id)
    return AssignResponse(
        offreId=offre_id,
        testId=test.id if test else 0,
        assigned=[_assignment_out(r) for r in rows],
        message=f"{len(rows)} invitation(s) enregistrée(s) (délai 48 h pour démarrer)",
    )


@router.get("/offres/{offre_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(
    offre_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    try:
        rows = list_assignments_for_offre(
            db,
            offre_id=offre_id,
            recruiter_id=user.user_id,
            role=user.role,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return [_assignment_out(r) for r in rows]


@router.get("/assignments/{assignment_id}", response_model=AssignmentOut)
def get_assignment(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    row = db.get(TestAssignment, assignment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment introuvable")
    test = db.get(TechnicalTest, row.test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Test introuvable")
    if user.role != "ADMIN" and test.recruiter_id != user.user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return _assignment_out(row)


@router.get(
    "/assignments/{assignment_id}/correction",
    response_model=CorrectionDetailOut,
)
def assignment_correction(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    """E7 — Détail de correction (feedback LLM) pour le recruteur."""
    try:
        row, details = get_recruiter_correction(
            db,
            assignment_id=assignment_id,
            recruiter_id=user.user_id,
            role=user.role,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return CorrectionDetailOut(
        assignment=_assignment_out(row),
        answers=[AnswerResultOut(**d) for d in details],
    )


@router.post(
    "/assignments/{assignment_id}/evaluate",
    response_model=EvaluationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def evaluate_assignment_endpoint(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    """Retry / force open-question grading (SUBMITTED or stuck EVALUATING)."""
    row = db.get(TestAssignment, assignment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment introuvable")
    test = db.get(TechnicalTest, row.test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Test introuvable")
    if user.role != "ADMIN" and test.recruiter_id != user.user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    if row.status in {"EVALUATED", "PUBLISHED"}:
        return EvaluationAccepted(
            assignmentId=row.id,
            status=row.status,
            message="Déjà évalué",
        )
    if row.status not in {"SUBMITTED", "EVALUATING"}:
        raise HTTPException(
            status_code=409,
            detail=f"Évaluation impossible (statut={row.status})",
        )
    background_tasks.add_task(run_evaluation_job, assignment_id)
    return EvaluationAccepted(
        assignmentId=row.id,
        status="EVALUATING",
        message="Évaluation des questions ouvertes démarrée",
    )


@router.post(
    "/assignments/{assignment_id}/publish",
    response_model=AssignmentOut,
)
def publish_one(
    assignment_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    try:
        row = publish_assignment(
            db,
            assignment_id=assignment_id,
            recruiter_id=user.user_id,
            role=user.role,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _assignment_out(row)


@router.post(
    "/offres/{offre_id}/publish-results",
    response_model=PublishResponse,
)
def publish_offre_results(
    offre_id: int,
    body: PublishRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[CurrentUser, Depends(require_recruiter)],
):
    try:
        rows = publish_for_offre(
            db,
            offre_id=offre_id,
            recruiter_id=user.user_id,
            role=user.role,
            assignment_ids=body.assignmentIds,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return PublishResponse(
        offreId=offre_id,
        published=[_assignment_out(r) for r in rows],
        message=f"{len(rows)} résultat(s) publié(s) (notif candidat)",
    )
