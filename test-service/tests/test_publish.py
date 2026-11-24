from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models import (
    CandidateAnswer,
    Question,
    TechnicalTest,
    TestAssignment,
    TestIncident,
)
from app.publish.service import get_published_result, publish_assignment


def _seed_evaluated():
    db = SessionLocal()
    t = db.query(TechnicalTest).filter_by(offre_id=9922).first()
    if t:
        for a in db.query(TestAssignment).filter_by(test_id=t.id).all():
            db.query(CandidateAnswer).filter_by(assignment_id=a.id).delete()
            db.query(TestIncident).filter_by(assignment_id=a.id).delete()
            db.delete(a)
        db.query(Question).filter_by(test_id=t.id).delete()
        db.delete(t)
        db.commit()

    test = TechnicalTest(
        offre_id=9922,
        recruiter_id=58,
        difficulty="JUNIOR",
        duration_sec=1800,
        status="ASSIGNED",
        regenerate_count=0,
    )
    db.add(test)
    db.flush()
    q = Question(
        test_id=test.id,
        position=1,
        type="OPEN",
        prompt="Explain",
        max_score=10.0,
        grading_rubric_json={"criteria": ["x"]},
    )
    db.add(q)
    asg = TestAssignment(
        test_id=test.id,
        offre_id=9922,
        candidature_id=88022,
        candidate_id=779,
        status="EVALUATED",
        invited_at=datetime.utcnow(),
        start_deadline_at=datetime.utcnow() + timedelta(hours=48),
        started_at=datetime.utcnow(),
        submitted_at=datetime.utcnow(),
        score_mcq=0,
        score_open=7.0,
        score_total=7.0,
        evaluation_json={"grades": [{"questionId": 0, "score": 7.0}]},
    )
    db.add(asg)
    db.flush()
    db.add(
        CandidateAnswer(
            assignment_id=asg.id,
            question_id=q.id,
            answer_text="ok",
            score=7.0,
            feedback="bien",
        )
    )
    db.commit()
    db.refresh(asg)
    aid = asg.id
    db.close()
    return aid


def test_publish_and_candidate_result(monkeypatch):
    monkeypatch.setattr(
        "app.publish.service.notify_candidate",
        lambda **kwargs: True,
    )
    aid = _seed_evaluated()
    db = SessionLocal()
    try:
        row = publish_assignment(
            db, assignment_id=aid, recruiter_id=58, role="RECRUITER"
        )
        assert row.status == "PUBLISHED"
        assert row.published_at is not None

        # idempotent
        row2 = publish_assignment(
            db, assignment_id=aid, recruiter_id=58, role="RECRUITER"
        )
        assert row2.status == "PUBLISHED"

        asg, details = get_published_result(
            db, assignment_id=aid, candidate_id=779, role="CANDIDATE"
        )
        assert asg.status == "PUBLISHED"
        assert float(asg.score_total) == 7.0
        assert len(details) == 1
        assert details[0]["score"] == 7.0
    finally:
        db.close()
