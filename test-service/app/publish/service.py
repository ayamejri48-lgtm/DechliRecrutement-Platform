"""Publish EVALUATED assignments → PUBLISHED + notify candidate."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clients.email_client import send_score_published_email
from app.clients.notification_client import (
    notify_admins,
    notify_candidate,
    offer_title,
    person_name,
)
from app.generation.service import get_test_by_offre
from app.models import CandidateAnswer, Question, TestAssignment


def _now() -> datetime:
    return datetime.utcnow()


def publish_assignment(
    db: Session,
    *,
    assignment_id: int,
    recruiter_id: int,
    role: str,
) -> TestAssignment:
    row = db.get(TestAssignment, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    test = get_test_by_offre(db, row.offre_id)
    if test is None or test.id != row.test_id:
        raise LookupError("Test introuvable")
    if role != "ADMIN" and test.recruiter_id != recruiter_id:
        raise PermissionError("Accès refusé")

    if row.status == "PUBLISHED":
        return row
    if row.status != "EVALUATED":
        raise ValueError(
            f"Publication impossible (statut={row.status}) — nécessite EVALUATED"
        )

    row.status = "PUBLISHED"
    row.published_at = _now()
    db.commit()
    db.refresh(row)

    total = float(row.score_total) if row.score_total is not None else 0.0
    title = offer_title(row.offre_id)
    who = person_name(row.candidate_id)
    notify_candidate(
        recipient_id=row.candidate_id,
        title="Résultats de votre test technique",
        message=f"Vos résultats pour « {title} » sont disponibles. Score total : {total:.0f}/100.",
        event_key=f"TEST_PUBLISHED:{row.id}",
    )
    notify_admins(
        title="Note de test publiée",
        message=f"La note de {who} pour « {title} » a été publiée.",
        event_key=f"TEST_PUBLISHED:{row.id}",
    )
    # Best-effort e-mail (SMTP) — publication already committed.
    send_score_published_email(
        candidate_id=row.candidate_id,
        offer_title=title,
        score_total=total,
    )
    return row


def publish_for_offre(
    db: Session,
    *,
    offre_id: int,
    recruiter_id: int,
    role: str,
    assignment_ids: list[int] | None = None,
) -> list[TestAssignment]:
    test = get_test_by_offre(db, offre_id)
    if test is None:
        raise LookupError("Aucun test pour cette offre")
    if role != "ADMIN" and test.recruiter_id != recruiter_id:
        raise PermissionError("Accès refusé")

    stmt = select(TestAssignment).where(
        TestAssignment.test_id == test.id,
        TestAssignment.status.in_(["EVALUATED", "PUBLISHED"]),
    )
    if assignment_ids:
        stmt = stmt.where(TestAssignment.id.in_(assignment_ids))
    rows = list(db.scalars(stmt.order_by(TestAssignment.id.asc())).all())

    if assignment_ids:
        found = {r.id for r in rows}
        missing = [i for i in assignment_ids if i not in found]
        if missing:
            raise ValueError(
                f"Assignment(s) non publiables (pas EVALUATED/PUBLISHED) : {missing}"
            )

    published: list[TestAssignment] = []
    for row in rows:
        if row.status == "PUBLISHED":
            published.append(row)
            continue
        published.append(
            publish_assignment(
                db,
                assignment_id=row.id,
                recruiter_id=recruiter_id,
                role=role,
            )
        )
    return published


def _answer_details(
    db: Session, row: TestAssignment, *, hide_correct_keys: bool
) -> list[dict]:
    questions = {
        q.id: q
        for q in db.scalars(
            select(Question).where(Question.test_id == row.test_id)
        ).all()
    }
    answers = list(
        db.scalars(
            select(CandidateAnswer).where(
                CandidateAnswer.assignment_id == row.id
            )
        ).all()
    )
    details = []
    for ans in answers:
        q = questions.get(ans.question_id)
        if q is None:
            continue
        details.append(
            {
                "questionId": q.id,
                "position": q.position,
                "type": q.type,
                "prompt": q.prompt,
                "maxScore": float(q.max_score),
                "score": float(ans.score) if ans.score is not None else None,
                "isCorrect": ans.is_correct if q.type == "MCQ" else None,
                "feedback": ans.feedback,
                "answerOption": ans.answer_option if q.type == "MCQ" else None,
                "answerText": ans.answer_text if q.type == "OPEN" else None,
                **(
                    {}
                    if hide_correct_keys
                    else {"correctOption": q.correct_option if q.type == "MCQ" else None}
                ),
            }
        )
    details.sort(key=lambda d: d["position"])
    return details


def get_published_result(
    db: Session,
    *,
    assignment_id: int,
    candidate_id: int,
    role: str,
) -> tuple[TestAssignment, list[dict]]:
    """Candidate result view: scores + per-question feedback (no correct MCQ keys)."""
    row = db.get(TestAssignment, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    if role != "ADMIN" and row.candidate_id != candidate_id:
        raise PermissionError("Accès refusé")
    if row.status != "PUBLISHED":
        raise ValueError("Résultats non encore publiés")
    return row, _answer_details(db, row, hide_correct_keys=True)


def get_recruiter_correction(
    db: Session,
    *,
    assignment_id: int,
    recruiter_id: int,
    role: str,
) -> tuple[TestAssignment, list[dict]]:
    """E7 — Vue recruteur de la correction (EVALUATED ou PUBLISHED)."""
    from app.models import TechnicalTest

    row = db.get(TestAssignment, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    test = db.get(TechnicalTest, row.test_id)
    if test is None:
        raise LookupError("Test introuvable")
    if role != "ADMIN" and test.recruiter_id != recruiter_id:
        raise PermissionError("Accès refusé")
    if row.status not in {"EVALUATED", "PUBLISHED"}:
        raise ValueError(
            f"Correction disponible seulement après évaluation (statut={row.status})"
        )
    return row, _answer_details(db, row, hide_correct_keys=False)
