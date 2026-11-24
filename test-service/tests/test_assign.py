from datetime import datetime, timedelta

from app.assignment.service import assign_candidatures
from app.clients.candidature_client import CandidatureSnapshot
from app.db import SessionLocal
from app.models import TechnicalTest, TestAssignment


def test_assign_creates_pending(monkeypatch):
    monkeypatch.setattr(
        "app.assignment.service.list_candidatures_for_offre",
        lambda offre_id, token: [
            CandidatureSnapshot(
                id=101, offre_id=offre_id, candidate_id=99916, status="PENDING"
            ),
            CandidatureSnapshot(
                id=102, offre_id=offre_id, candidate_id=99914, status="PENDING"
            ),
        ],
    )
    monkeypatch.setattr(
        "app.assignment.service.notify_candidate",
        lambda **kwargs: True,
    )

    db = SessionLocal()
    try:
        # ensure READY test for offre 9918
        t = db.query(TechnicalTest).filter_by(offre_id=9918).first()
        if t:
            db.query(TestAssignment).filter_by(test_id=t.id).delete()
            db.delete(t)
            db.commit()

        test = TechnicalTest(
            offre_id=9918,
            recruiter_id=58,
            difficulty="JUNIOR",
            duration_sec=1800,
            status="READY",
            regenerate_count=0,
        )
        db.add(test)
        db.commit()
        db.refresh(test)

        rows = assign_candidatures(
            db,
            offre_id=9918,
            candidature_ids=[101, 102],
            recruiter_id=58,
            role="RECRUITER",
            bearer_token="x",
        )
        assert len(rows) == 2
        assert all(r.status == "PENDING" for r in rows)
        assert rows[0].start_deadline_at - rows[0].invited_at >= timedelta(hours=47)
        db.refresh(test)
        assert test.status == "ASSIGNED"

        # idempotent re-assign
        rows2 = assign_candidatures(
            db,
            offre_id=9918,
            candidature_ids=[101],
            recruiter_id=58,
            role="RECRUITER",
            bearer_token="x",
        )
        assert len(rows2) == 1
        assert rows2[0].id == rows[0].id
    finally:
        db.close()
