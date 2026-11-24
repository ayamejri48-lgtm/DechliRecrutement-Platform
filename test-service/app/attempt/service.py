"""Candidate attempt lifecycle: start, autosave, submit, expire, incidents."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CandidateAnswer,
    Question,
    TechnicalTest,
    TestAssignment,
    TestIncident,
)

logger = logging.getLogger("test-service.attempt")

ALLOWED_INCIDENTS = {"TAB_BLUR", "EXIT_FULLSCREEN"}
# Au-delà de ce seuil → soumission forcée (blocage intégrité).
INTEGRITY_INCIDENT_LIMIT = 3


def _now() -> datetime:
    return datetime.utcnow()


def get_assignment(db: Session, assignment_id: int) -> TestAssignment | None:
    return db.scalar(
        select(TestAssignment)
        .options(selectinload(TestAssignment.answers))
        .where(TestAssignment.id == assignment_id)
    )


def list_my_assignments(db: Session, candidate_id: int) -> list[TestAssignment]:
    _expire_pending(db, candidate_id=candidate_id)
    _autosubmit_overdue(db, candidate_id=candidate_id)
    return list(
        db.scalars(
            select(TestAssignment)
            .where(TestAssignment.candidate_id == candidate_id)
            .order_by(TestAssignment.id.desc())
        ).all()
    )


def _assert_owner(row: TestAssignment, candidate_id: int, role: str) -> None:
    if role == "ADMIN":
        return
    if row.candidate_id != candidate_id:
        raise PermissionError("Accès refusé à cette tentative")


def get_paper(
    db: Session, *, assignment_id: int, candidate_id: int, role: str
) -> tuple[TestAssignment, TechnicalTest, list[Question]]:
    row = get_assignment(db, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    _assert_owner(row, candidate_id, role)
    _refresh_timers(db, row)
    test = db.get(TechnicalTest, row.test_id)
    if test is None:
        raise LookupError("Test introuvable")
    questions = list(
        db.scalars(
            select(Question)
            .where(Question.test_id == test.id)
            .order_by(Question.position)
        ).all()
    )
    return row, test, questions


def start_attempt(
    db: Session, *, assignment_id: int, candidate_id: int, role: str
) -> TestAssignment:
    row = get_assignment(db, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    _assert_owner(row, candidate_id, role)

    now = _now()
    if row.status == "EXPIRED":
        raise ValueError("Invitation expirée")
    if row.status in {"SUBMITTED", "EVALUATING", "EVALUATED", "PUBLISHED"}:
        raise ValueError("Test déjà soumis")
    if row.status == "IN_PROGRESS":
        # idempotent resume
        return row
    if row.status != "PENDING":
        raise ValueError(f"Démarrage impossible (statut={row.status})")
    if now > row.start_deadline_at:
        row.status = "EXPIRED"
        db.commit()
        db.refresh(row)
        raise ValueError("Délai de 48 h dépassé — invitation expirée")

    test = db.get(TechnicalTest, row.test_id)
    if test is None:
        raise LookupError("Test introuvable")

    row.status = "IN_PROGRESS"
    row.started_at = now
    row.ends_at = now + timedelta(seconds=int(test.duration_sec))
    db.commit()
    db.refresh(row)
    return row


def save_answers(
    db: Session,
    *,
    assignment_id: int,
    candidate_id: int,
    role: str,
    answers: list[dict[str, Any]],
) -> TestAssignment:
    row = get_assignment(db, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    _assert_owner(row, candidate_id, role)
    _refresh_timers(db, row)
    if row.status != "IN_PROGRESS":
        raise ValueError("Autosave possible uniquement pendant IN_PROGRESS")

    q_ids = {
        q.id
        for q in db.scalars(
            select(Question).where(Question.test_id == row.test_id)
        ).all()
    }
    now = _now()
    for item in answers:
        qid = int(item["questionId"])
        if qid not in q_ids:
            raise ValueError(f"questionId {qid} n'appartient pas à ce test")
        opt = item.get("answerOption")
        text = item.get("answerText")
        existing = db.scalar(
            select(CandidateAnswer).where(
                CandidateAnswer.assignment_id == row.id,
                CandidateAnswer.question_id == qid,
            )
        )
        if existing is None:
            existing = CandidateAnswer(
                assignment_id=row.id,
                question_id=qid,
            )
            db.add(existing)
        if opt is not None:
            existing.answer_option = str(opt).strip().upper()[:1] or None
        if text is not None:
            existing.answer_text = str(text)
        existing.saved_at = now

    db.commit()
    db.refresh(row)
    return row


def add_incident(
    db: Session,
    *,
    assignment_id: int,
    candidate_id: int,
    role: str,
    incident_type: str,
    meta: dict[str, Any] | None = None,
) -> tuple[TestIncident, int, bool]:
    """Enregistre un incident. Retourne (incident, total, blocked).

    Si le total atteint INTEGRITY_INCIDENT_LIMIT, le test est soumis automatiquement.
    """
    row = get_assignment(db, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    _assert_owner(row, candidate_id, role)
    itype = (incident_type or "").strip().upper()
    if itype not in ALLOWED_INCIDENTS:
        raise ValueError(f"Type d'incident invalide: {itype}")
    if row.status != "IN_PROGRESS":
        raise ValueError("Incidents enregistrés seulement pendant le test")

    # light anti-spam: skip if same type within 5 seconds
    recent = db.scalar(
        select(TestIncident)
        .where(
            TestIncident.assignment_id == row.id,
            TestIncident.type == itype,
        )
        .order_by(TestIncident.id.desc())
        .limit(1)
    )
    now = _now()
    if recent and (now - recent.occurred_at).total_seconds() < 5:
        count = int(
            db.scalar(
                select(func.count())
                .select_from(TestIncident)
                .where(TestIncident.assignment_id == row.id)
            )
            or 0
        )
        return recent, count, False

    inc = TestIncident(
        assignment_id=row.id,
        type=itype,
        occurred_at=now,
        meta_json=meta or {},
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    count = int(
        db.scalar(
            select(func.count())
            .select_from(TestIncident)
            .where(TestIncident.assignment_id == row.id)
        )
        or 0
    )
    blocked = False
    if count >= INTEGRITY_INCIDENT_LIMIT:
        # Soumission forcée — le candidat ne peut plus répondre.
        row = submit_attempt(
            db,
            assignment_id=assignment_id,
            candidate_id=candidate_id,
            role=role,
            auto=True,
        )
        note = {
            "integrityLock": True,
            "reason": "incident_limit",
            "incidentCount": count,
            "limit": INTEGRITY_INCIDENT_LIMIT,
            "lastIncident": itype,
        }
        existing = row.evaluation_json if isinstance(row.evaluation_json, dict) else {}
        row.evaluation_json = {**existing, **note}
        db.commit()
        blocked = True
    return inc, count, blocked


def submit_attempt(
    db: Session,
    *,
    assignment_id: int,
    candidate_id: int,
    role: str,
    auto: bool = False,
) -> TestAssignment:
    row = get_assignment(db, assignment_id)
    if row is None:
        raise LookupError("Assignment introuvable")
    _assert_owner(row, candidate_id, role)

    if row.status in {"SUBMITTED", "EVALUATING", "EVALUATED", "PUBLISHED"}:
        return row
    if row.status == "EXPIRED":
        raise ValueError("Invitation expirée")
    if row.status != "IN_PROGRESS":
        raise ValueError("Soumission possible seulement en IN_PROGRESS")

    now = _now()
    if not auto and row.ends_at and now > row.ends_at:
        # late click → treat as auto close
        auto = True

    row.status = "SUBMITTED"
    row.submitted_at = now
    _score_mcq(db, row)
    db.commit()
    db.refresh(row)
    _notify_recruiter_test_submitted(db, row)
    return row


def _notify_recruiter_test_submitted(db: Session, row: TestAssignment) -> None:
    """Alerte le recruteur : le candidat a rendu — aller calculer / publier."""
    from app.clients import notification_client as notifs

    try:
        test = db.get(TechnicalTest, row.test_id)
        recruiter_id = int(test.recruiter_id) if test is not None else None
        if not recruiter_id:
            return
        title = notifs.offer_title(int(row.offre_id))
        who = notifs.person_name(int(row.candidate_id))
        notifs.notify_candidate(
            recipient_id=recruiter_id,
            title="Test technique passé",
            message=(
                f"{who} a passé le test de « {title} ». "
                f"Ouvrez Sessions pour calculer le score et le publier."
            ),
            event_key=(
                f"TEST_SUBMITTED:{row.id}:offre:{int(row.offre_id)}"
                f":recruiter:{recruiter_id}"
            ),
        )
        notifs.notify_admins(
            title="Test technique passé",
            message=f"{who} a rendu le test de « {title} ».",
            event_key=f"TEST_SUBMITTED:{row.id}",
        )
    except Exception:
        # La soumission ne doit jamais échouer à cause d’une notif.
        logger.warning(
            "recruiter_submit_notification_failed assignment=%s",
            getattr(row, "id", None),
        )


def _score_mcq(db: Session, row: TestAssignment) -> None:
    questions = list(
        db.scalars(select(Question).where(Question.test_id == row.test_id)).all()
    )
    answers = {
        a.question_id: a
        for a in db.scalars(
            select(CandidateAnswer).where(CandidateAnswer.assignment_id == row.id)
        ).all()
    }
    mcq_score = 0.0
    for q in questions:
        if q.type != "MCQ":
            continue
        ans = answers.get(q.id)
        if ans is None:
            continue
        ok = (
            (ans.answer_option or "").upper()
            == (q.correct_option or "").upper()
        )
        ans.is_correct = ok
        ans.score = float(q.max_score) if ok else 0.0
        mcq_score += float(ans.score or 0)
    row.score_mcq = round(mcq_score, 2)
    # open score filled in Phase 4
    open_part = float(row.score_open or 0)
    row.score_total = round(mcq_score + open_part, 2)


def _refresh_timers(db: Session, row: TestAssignment) -> None:
    changed = False
    submitted = False
    now = _now()
    if row.status == "PENDING" and now > row.start_deadline_at:
        row.status = "EXPIRED"
        changed = True
    elif (
        row.status == "IN_PROGRESS"
        and row.ends_at is not None
        and now >= row.ends_at
    ):
        row.status = "SUBMITTED"
        row.submitted_at = row.ends_at
        _score_mcq(db, row)
        changed = True
        submitted = True
    if changed:
        db.commit()
        db.refresh(row)
        if submitted:
            _notify_recruiter_test_submitted(db, row)


def _expire_pending(db: Session, *, candidate_id: int | None = None) -> int:
    from app.clients import notification_client as notifs
    from app.models import TechnicalTest

    now = _now()
    stmt = select(TestAssignment).where(
        TestAssignment.status == "PENDING",
        TestAssignment.start_deadline_at < now,
    )
    if candidate_id is not None:
        stmt = stmt.where(TestAssignment.candidate_id == candidate_id)
    rows = list(db.scalars(stmt).all())
    for row in rows:
        row.status = "EXPIRED"
    if rows:
        db.commit()
        for row in rows:
            title = notifs.offer_title(int(row.offre_id))
            who = notifs.person_name(int(row.candidate_id))
            notifs.notify_candidate(
                recipient_id=int(row.candidate_id),
                title="Délai du test dépassé",
                message=f"Le délai pour commencer le test de « {title} » est dépassé.",
                event_key=f"TEST_EXPIRED:{row.id}",
            )
            test = db.get(TechnicalTest, row.test_id)
            recruiter_id = int(test.recruiter_id) if test is not None else None
            if recruiter_id:
                notifs.notify_candidate(
                    recipient_id=recruiter_id,
                    title="Test non commencé",
                    message=f"{who} n’a pas commencé le test de « {title} » dans les délais.",
                    event_key=f"TEST_EXPIRED:{row.id}:recruiter:{recruiter_id}",
                )
            notifs.notify_admins(
                title="Test non commencé",
                message=f"{who} — délai dépassé pour « {title} ».",
                event_key=f"TEST_EXPIRED:{row.id}",
            )
    return len(rows)


def _autosubmit_overdue(db: Session, *, candidate_id: int | None = None) -> int:
    now = _now()
    stmt = select(TestAssignment).where(
        TestAssignment.status == "IN_PROGRESS",
        TestAssignment.ends_at.is_not(None),
        TestAssignment.ends_at <= now,
    )
    if candidate_id is not None:
        stmt = stmt.where(TestAssignment.candidate_id == candidate_id)
    rows = list(db.scalars(stmt).all())
    for row in rows:
        row.status = "SUBMITTED"
        row.submitted_at = row.ends_at
        _score_mcq(db, row)
    if rows:
        db.commit()
        for row in rows:
            db.refresh(row)
            _notify_recruiter_test_submitted(db, row)
    return len(rows)


def _remind_pending_j1(db: Session) -> int:
    """B2 — Relance candidat ~J-1 avant la deadline de démarrage (idempotent)."""
    from app.clients import notification_client as notifs

    now = _now()
    horizon = now + timedelta(hours=24)
    rows = list(
        db.scalars(
            select(TestAssignment).where(
                TestAssignment.status == "PENDING",
                TestAssignment.start_deadline_at > now,
                TestAssignment.start_deadline_at <= horizon,
            )
        ).all()
    )
    sent = 0
    for row in rows:
        title = notifs.offer_title(int(row.offre_id))
        deadline = row.start_deadline_at.strftime("%d/%m/%Y %H:%M")
        ok = notifs.notify_candidate(
            recipient_id=int(row.candidate_id),
            title="Rappel : démarrez votre test",
            message=(
                f"Il vous reste moins de 24 h pour commencer le test de « {title} » "
                f"(limite le {deadline})."
            ),
            event_key=f"TEST_REMINDER_J1:{row.id}",
        )
        if ok:
            sent += 1
    return sent


def sweep_timers(db: Session) -> dict[str, int]:
    """Global tick for expire / autosubmit / rappel J-1 (scheduler or ops endpoint)."""
    return {
        "expired": _expire_pending(db),
        "autosubmitted": _autosubmit_overdue(db),
        "reminded_j1": _remind_pending_j1(db),
    }
