"""Grade OPEN answers via LLM after submit; MCQ already scored in Phase 3."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.evaluation.prompts import PROMPT_VERSION, SYSTEM, build_user_prompt
from app.llm.factory import get_llm_client
from app.models import CandidateAnswer, Question, TestAssignment

logger = logging.getLogger("test-service.evaluation")


def evaluate_assignment(db: Session, assignment_id: int) -> TestAssignment:
    row = db.scalar(
        select(TestAssignment).where(TestAssignment.id == assignment_id)
    )
    if row is None:
        raise LookupError("Assignment introuvable")
    if row.status in {"EVALUATED", "PUBLISHED"}:
        return row
    if row.status not in {"SUBMITTED", "EVALUATING"}:
        raise ValueError(f"Évaluation impossible (statut={row.status})")

    row.status = "EVALUATING"
    db.commit()

    questions = list(
        db.scalars(select(Question).where(Question.test_id == row.test_id)).all()
    )
    answers = {
        a.question_id: a
        for a in db.scalars(
            select(CandidateAnswer).where(CandidateAnswer.assignment_id == row.id)
        ).all()
    }
    open_qs = [q for q in questions if q.type == "OPEN"]

    if not open_qs:
        row.score_open = 0.0
        row.score_total = round(float(row.score_mcq or 0), 2)
        row.evaluation_json = {
            "promptVersion": PROMPT_VERSION,
            "grades": [],
            "note": "no_open_questions",
        }
        row.status = "EVALUATED"
        db.commit()
        db.refresh(row)
        return row

    items = []
    for q in open_qs:
        ans = answers.get(q.id)
        items.append(
            {
                "questionId": q.id,
                "prompt": q.prompt,
                "maxScore": float(q.max_score),
                "rubric": q.grading_rubric_json,
                "answerText": (ans.answer_text if ans else None) or "",
            }
        )

    try:
        llm = get_llm_client()
        raw = llm.complete_json(
            system=SYSTEM,
            user=build_user_prompt(items=items),
        )
        grades_list = raw.get("grades") if isinstance(raw, dict) else None
        if not isinstance(grades_list, list):
            raise RuntimeError("LLM grades missing")

        by_qid: dict[int, dict[str, Any]] = {}
        for g in grades_list:
            if not isinstance(g, dict):
                continue
            try:
                qid = int(g.get("questionId"))
            except (TypeError, ValueError):
                continue
            by_qid[qid] = g

        grades_payload: list[dict[str, Any]] = []
        open_score = 0.0
        for q in open_qs:
            max_s = float(q.max_score)
            g = by_qid.get(q.id) or {}
            try:
                score = float(g.get("score", 0))
            except (TypeError, ValueError):
                score = 0.0
            score = max(0.0, min(max_s, round(score, 2)))
            feedback = str(g.get("feedback") or "").strip()[:1000] or None
            ans = answers.get(q.id)
            if ans is None:
                ans = CandidateAnswer(
                    assignment_id=row.id,
                    question_id=q.id,
                    answer_text="",
                )
                db.add(ans)
                answers[q.id] = ans
            ans.score = score
            ans.feedback = feedback
            open_score += score
            grades_payload.append(
                {
                    "questionId": q.id,
                    "score": score,
                    "maxScore": max_s,
                    "feedback": feedback,
                }
            )

        row.score_open = round(open_score, 2)
        row.score_total = round(float(row.score_mcq or 0) + open_score, 2)
        row.evaluation_json = {
            "promptVersion": PROMPT_VERSION,
            "provider": getattr(llm, "provider", None),
            "model": getattr(llm, "model", None),
            "grades": grades_payload,
        }
        row.status = "EVALUATED"
        db.commit()
        db.refresh(row)
        logger.info(
            "evaluated assignment=%s open=%s total=%s",
            row.id,
            row.score_open,
            row.score_total,
        )
        return row
    except Exception as exc:
        logger.exception("evaluation_failed assignment=%s", assignment_id)
        row.evaluation_json = {
            "promptVersion": PROMPT_VERSION,
            "error": type(exc).__name__,
            "detail": str(exc)[:400],
        }
        row.status = "EVALUATING"
        db.commit()
        db.refresh(row)
        raise


def run_evaluation_job(assignment_id: int) -> None:
    db = SessionLocal()
    try:
        evaluate_assignment(db, assignment_id)
    except Exception:
        logger.exception("run_evaluation_job failed id=%s", assignment_id)
    finally:
        db.close()


def sweep_evaluations(db: Session, *, limit: int = 20) -> dict[str, int]:
    """Grade SUBMITTED / stuck EVALUATING rows (scheduler / ops)."""
    rows = list(
        db.scalars(
            select(TestAssignment)
            .where(TestAssignment.status.in_(["SUBMITTED", "EVALUATING"]))
            .order_by(TestAssignment.id.asc())
            .limit(limit)
        ).all()
    )
    ok = fail = 0
    for row in rows:
        try:
            evaluate_assignment(db, row.id)
            ok += 1
        except Exception:
            fail += 1
    return {"evaluated": ok, "failed": fail}
