from datetime import datetime, timedelta

from app.attempt.service import save_answers, start_attempt, submit_attempt
from app.db import SessionLocal
from app.models import (
    CandidateAnswer,
    Question,
    TechnicalTest,
    TestAssignment,
    TestIncident,
)


def _seed():
    db = SessionLocal()
    # cleanup offre 9920
    t = db.query(TechnicalTest).filter_by(offre_id=9920).first()
    if t:
        for a in db.query(TestAssignment).filter_by(test_id=t.id).all():
            db.query(CandidateAnswer).filter_by(assignment_id=a.id).delete()
            db.query(TestIncident).filter_by(assignment_id=a.id).delete()
            db.delete(a)
        db.query(Question).filter_by(test_id=t.id).delete()
        db.delete(t)
        db.commit()

    test = TechnicalTest(
        offre_id=9920,
        recruiter_id=58,
        difficulty="JUNIOR",
        duration_sec=1800,
        status="ASSIGNED",
        regenerate_count=0,
    )
    db.add(test)
    db.flush()
    q1 = Question(
        test_id=test.id,
        position=1,
        type="MCQ",
        prompt="Q1",
        options_json={"A": "1", "B": "2", "C": "3"},
        correct_option="B",
        max_score=6,
    )
    q2 = Question(
        test_id=test.id,
        position=2,
        type="OPEN",
        prompt="Explain",
        max_score=13.33,
        grading_rubric_json={"criteria": ["x"]},
    )
    db.add_all([q1, q2])
    asg = TestAssignment(
        test_id=test.id,
        offre_id=9920,
        candidature_id=88001,
        candidate_id=777,
        status="PENDING",
        invited_at=datetime.utcnow(),
        start_deadline_at=datetime.utcnow() + timedelta(hours=48),
    )
    db.add(asg)
    db.commit()
    db.refresh(asg)
    db.refresh(q1)
    aid, qid = asg.id, q1.id
    db.close()
    return aid, qid


def test_start_save_submit_mcq():
    aid, qid = _seed()
    db = SessionLocal()
    try:
        row = start_attempt(db, assignment_id=aid, candidate_id=777, role="CANDIDATE")
        assert row.status == "IN_PROGRESS"
        assert row.ends_at is not None

        save_answers(
            db,
            assignment_id=aid,
            candidate_id=777,
            role="CANDIDATE",
            answers=[{"questionId": qid, "answerOption": "B"}],
        )
        row = submit_attempt(
            db, assignment_id=aid, candidate_id=777, role="CANDIDATE"
        )
        assert row.status == "SUBMITTED"
        assert float(row.score_mcq or 0) == 6.0
    finally:
        db.close()
