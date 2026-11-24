"""Assign a READY technical test to selected candidatures."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clients.candidature_client import list_candidatures_for_offre
from app.clients.notification_client import notify_admins, notify_candidate, offer_title, person_name
from app.generation.service import get_test_by_offre
from app.models import TestAssignment

INVITE_TTL = timedelta(hours=48)
BLOCKED_STATUSES = {"WITHDRAWN"}


def assign_candidatures(
    db: Session,
    *,
    offre_id: int,
    candidature_ids: list[int],
    recruiter_id: int,
    role: str,
    bearer_token: str,
) -> list[TestAssignment]:
    if not candidature_ids:
        raise ValueError("candidatureIds requis")

    test = get_test_by_offre(db, offre_id)
    if test is None:
        raise ValueError("Aucun test pour cette offre — générez-le d'abord")
    if test.status not in {"READY", "ASSIGNED"}:
        raise ValueError(f"Test non assignable (statut={test.status})")
    if role != "ADMIN" and test.recruiter_id != recruiter_id:
        raise PermissionError("Accès refusé")

    apps = {
        c.id: c for c in list_candidatures_for_offre(offre_id, bearer_token)
    }
    created: list[TestAssignment] = []
    now = datetime.utcnow()
    deadline = now + INVITE_TTL

    for cid in candidature_ids:
        app = apps.get(cid)
        if app is None:
            raise ValueError(f"Candidature #{cid} absente de cette offre")
        if app.status in BLOCKED_STATUSES:
            raise ValueError(f"Candidature #{cid} retirée — non assignable")

        existing = db.scalar(
            select(TestAssignment).where(TestAssignment.candidature_id == cid)
        )
        if existing is not None:
            # idempotent: skip already invited
            created.append(existing)
            continue

        row = TestAssignment(
            test_id=test.id,
            offre_id=offre_id,
            candidature_id=cid,
            candidate_id=app.candidate_id,
            status="PENDING",
            invited_at=now,
            start_deadline_at=deadline,
        )
        db.add(row)
        db.flush()
        created.append(row)

        title = offer_title(offre_id)
        who = person_name(app.candidate_id)
        notify_candidate(
            recipient_id=app.candidate_id,
            title="Invitation à un test technique",
            message=(
                f"Vous avez 48 h pour commencer le test technique "
                f"de « {title} ». Bonne chance !"
            ),
            event_key=f"TEST_INVITED:{row.id}",
        )
        notify_admins(
            title="Test technique envoyé",
            message=f"{who} a reçu un test pour « {title} ».",
            event_key=f"TEST_INVITED:{row.id}",
        )

    if test.status == "READY":
        test.status = "ASSIGNED"
    db.commit()
    for row in created:
        db.refresh(row)
    return created


def list_assignments_for_offre(
    db: Session,
    *,
    offre_id: int,
    recruiter_id: int,
    role: str,
) -> list[TestAssignment]:
    test = get_test_by_offre(db, offre_id)
    if test is None:
        return []
    if role != "ADMIN" and test.recruiter_id != recruiter_id:
        raise PermissionError("Accès refusé")
    return list(
        db.scalars(
            select(TestAssignment)
            .where(TestAssignment.test_id == test.id)
            .order_by(TestAssignment.id.desc())
        ).all()
    )
