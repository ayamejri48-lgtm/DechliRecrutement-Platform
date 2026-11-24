from datetime import datetime, timedelta

from app.attempt.service import save_answers, start_attempt, submit_attempt
from app.db import SessionLocal
from app.evaluation.service import evaluate_assignment
from app.models import (
    CandidateAnswer,
    Question,
    TechnicalTest,
    TestAssignment,
    TestIncident,
)


def _seed_submitted_with_open():
    db = SessionLocal()
    t = db.query(TechnicalTest).filter_by(offre_id=9921).first()
    if t:
        for a in db.query(TestAssignment).filter_by(test_id=t.id).all():
            db.query(CandidateAnswer).filter_by(assignment_id=a.id).delete()
            db.query(TestIncident).filter_by(assignment_id=a.id).delete()
            db.delete(a)
        db.query(Question).filter_by(test_id=t.id).delete()
        db.delete(t)
        db.commit()

    test = TechnicalTest(
        offre_id=9921,
        recruiter_id=58,
        difficulty="JUNIOR",
        duration_sec=1800,
        status="ASSIGNED",
        regenerate_count=0,
    )
    db.add(test)
    db.flush()
    q_open = Question(
        test_id=test.id,
        position=1,
        type="OPEN",
        prompt="Explique CI/CD",
        max_score=10.0,
        grading_rubric_json={"criteria": ["Pertinence", "Clarté"]},
    )
    db.add(q_open)
    asg = TestAssignment(
        test_id=test.id,
        offre_id=9921,
        candidature_id=88021,
        candidate_id=778,
        status="PENDING",
        invited_at=datetime.utcnow(),
        start_deadline_at=datetime.utcnow() + timedelta(hours=48),
    )
    db.add(asg)
    db.commit()
    db.refresh(asg)
    db.refresh(q_open)
    aid, qid = asg.id, q_open.id
    db.close()
    return aid, qid


def test_evaluate_open_with_mock(monkeypatch):
    from app.llm.mock import MockLlmClient

    monkeypatch.setattr(
        "app.evaluation.service.get_llm_client", lambda: MockLlmClient()
    )

    aid, qid = _seed_submitted_with_open()
    db = SessionLocal()
    try:
        start_attempt(db, assignment_id=aid, candidate_id=778, role="CANDIDATE")
        save_answers(
            db,
            assignment_id=aid,
            candidate_id=778,
            role="CANDIDATE",
            answers=[
                {
                    "questionId": qid,
                    "answerText": "CI/CD automatise build, test et déploiement.",
                }
            ],
        )
        submit_attempt(db, assignment_id=aid, candidate_id=778, role="CANDIDATE")
        row = evaluate_assignment(db, aid)
        assert row.status == "EVALUATED"
        assert float(row.score_open or 0) == 7.0  # 70% of 10
        assert float(row.score_total or 0) == 7.0
        assert row.evaluation_json and row.evaluation_json.get("grades")
    finally:
        db.close()
