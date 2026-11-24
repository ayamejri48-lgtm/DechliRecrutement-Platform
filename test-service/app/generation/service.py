"""Generate / regenerate technical tests for an offer."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.clients.offre_client import OffreSnapshot, fetch_offre_for_recruiter
from app.db import SessionLocal
from app.difficulty import difficulty_from_experience_years, duration_sec_for
from app.generation.prompts import PROMPT_VERSION, SYSTEM, build_user_prompt
from app.generation.validator import ValidationError, validate_generated_test
from app.llm.factory import get_llm_client
from app.models import Question, TechnicalTest, TestAssignment, TestGenerationRevision

logger = logging.getLogger("test-service.generation")


def _assert_owner(snapshot: OffreSnapshot, recruiter_id: int, role: str) -> None:
    if role == "ADMIN":
        return
    if snapshot.recruiter_id != recruiter_id:
        raise PermissionError("Vous n'êtes pas propriétaire de cette offre")


def get_test_by_offre(db: Session, offre_id: int) -> TechnicalTest | None:
    return db.scalar(
        select(TechnicalTest)
        .options(selectinload(TechnicalTest.questions))
        .where(TechnicalTest.offre_id == offre_id)
    )


def start_generation(
    db: Session,
    *,
    offre_id: int,
    recruiter_id: int,
    role: str,
    bearer_token: str,
    regenerate: bool = False,
) -> tuple[TechnicalTest, bool]:
    """Returns (test, should_launch_job)."""
    snapshot = fetch_offre_for_recruiter(offre_id, bearer_token)
    _assert_owner(snapshot, recruiter_id, role)

    if not snapshot.skill_names:
        raise ValueError(
            "L'offre n'a aucune compétence structurée — ajoutez-en avant de générer un test"
        )

    existing = get_test_by_offre(db, offre_id)
    if existing is not None:
        n_assign = db.scalar(
            select(TestAssignment.id).where(TestAssignment.test_id == existing.id).limit(1)
        )
        if n_assign is not None:
            raise ValueError("Impossible de (re)générer : des candidatures sont déjà assignées")
        if regenerate:
            if existing.regenerate_count >= 1:
                raise ValueError("Régénération déjà utilisée (maximum 1)")
            if existing.status not in {"READY", "FAILED"}:
                raise ValueError(f"Régénération impossible en statut {existing.status}")
            existing.regenerate_count += 1
        else:
            if existing.status == "GENERATING":
                return existing, False
            if existing.status == "READY":
                raise ValueError(
                    "Un test READY existe déjà — utilisez /regenerate (1× max) si besoin"
                )
        test = existing
        test.status = "GENERATING"
        test.error_message = None
    else:
        if regenerate:
            raise ValueError("Aucun test à régénérer — lancez d'abord /generate")
        difficulty = difficulty_from_experience_years(snapshot.experience_years)
        test = TechnicalTest(
            offre_id=offre_id,
            recruiter_id=snapshot.recruiter_id,
            difficulty=difficulty,
            duration_sec=duration_sec_for(difficulty),
            status="GENERATING",
            regenerate_count=0,
            prompt_version=PROMPT_VERSION,
        )
        db.add(test)

    difficulty = difficulty_from_experience_years(snapshot.experience_years)
    test.difficulty = difficulty
    test.duration_sec = duration_sec_for(difficulty)
    test.prompt_version = PROMPT_VERSION
    db.commit()
    db.refresh(test)
    return test, True

def run_generation_job(
    *,
    test_id: int,
    offre_id: int,
    bearer_token: str,
) -> None:
    """Background worker: LLM → validate → persist questions."""
    db = SessionLocal()
    try:
        test = db.get(TechnicalTest, test_id)
        if test is None:
            return
        snapshot = fetch_offre_for_recruiter(offre_id, bearer_token)
        llm = get_llm_client()
        user_prompt = build_user_prompt(
            title=snapshot.title,
            description=snapshot.description,
            difficulty=test.difficulty,
            duration_min=test.duration_sec // 60,
            skills=snapshot.skill_names,
            required_skills=snapshot.required_skill_names or snapshot.skill_names,
        )
        raw = llm.complete_json(system=SYSTEM, user=user_prompt)
        validated = validate_generated_test(raw)
        _replace_questions(db, test, validated)
        test.status = "READY"
        test.llm_provider = getattr(llm, "provider", None)
        test.llm_model = getattr(llm, "model", None)
        test.error_message = None
        _save_revision_snapshot(db, test)
        db.commit()
        logger.info("generation_ok test_id=%s offre_id=%s", test_id, offre_id)
    except Exception as exc:
        logger.exception("generation_failed test_id=%s", test_id)
        try:
            test = db.get(TechnicalTest, test_id)
            if test is not None:
                test.status = "FAILED"
                test.error_message = str(exc)[:1000]
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def _questions_payload(questions: list[Question]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for q in sorted(questions, key=lambda x: x.position):
        rows.append(
            {
                "position": q.position,
                "type": q.type,
                "prompt": q.prompt,
                "options": q.options_json if isinstance(q.options_json, dict) else None,
                "correctOption": q.correct_option,
                "maxScore": float(q.max_score),
                "rubric": q.grading_rubric_json,
            }
        )
    return rows


def _next_revision_number(db: Session, test_id: int) -> int:
    current = db.scalar(
        select(TestGenerationRevision.revision)
        .where(TestGenerationRevision.test_id == test_id)
        .order_by(TestGenerationRevision.revision.desc())
        .limit(1)
    )
    return (int(current) + 1) if current is not None else 0


def _save_revision_snapshot(db: Session, test: TechnicalTest) -> None:
    """B7 — Archive la version courante des questions après génération réussie."""
    questions = list(
        db.scalars(select(Question).where(Question.test_id == test.id)).all()
    )
    if not questions:
        return
    rev = _next_revision_number(db, test.id)
    db.add(
        TestGenerationRevision(
            test_id=test.id,
            revision=rev,
            difficulty=test.difficulty,
            duration_sec=test.duration_sec,
            questions_json=_questions_payload(questions),
            llm_provider=test.llm_provider,
            llm_model=test.llm_model,
        )
    )
    db.flush()


def _diff_questions(
    before: list[dict[str, Any]] | None, after: list[dict[str, Any]] | None
) -> dict[str, Any]:
    before = before or []
    after = after or []
    before_by_pos = {int(q.get("position", i)): q for i, q in enumerate(before)}
    after_by_pos = {int(q.get("position", i)): q for i, q in enumerate(after)}
    added: list[dict[str, Any]] = []
    removed: list[dict[str, Any]] = []
    changed: list[dict[str, Any]] = []
    for pos, q in after_by_pos.items():
        prev = before_by_pos.get(pos)
        if prev is None:
            added.append({"position": pos, "type": q.get("type"), "prompt": q.get("prompt")})
            continue
        if (prev.get("prompt") or "") != (q.get("prompt") or "") or prev.get("type") != q.get(
            "type"
        ):
            changed.append(
                {
                    "position": pos,
                    "type": q.get("type"),
                    "fromPrompt": prev.get("prompt"),
                    "toPrompt": q.get("prompt"),
                }
            )
    for pos, q in before_by_pos.items():
        if pos not in after_by_pos:
            removed.append(
                {"position": pos, "type": q.get("type"), "prompt": q.get("prompt")}
            )
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "addedCount": len(added),
        "removedCount": len(removed),
        "changedCount": len(changed),
    }


def list_generation_history(db: Session, test: TechnicalTest) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(
            select(TestGenerationRevision)
            .where(TestGenerationRevision.test_id == test.id)
            .order_by(TestGenerationRevision.revision.asc())
        ).all()
    )
    history: list[dict[str, Any]] = []
    prev_questions: list[dict[str, Any]] | None = None
    for row in rows:
        questions = row.questions_json if isinstance(row.questions_json, list) else []
        history.append(
            {
                "revision": row.revision,
                "difficulty": row.difficulty,
                "durationSec": row.duration_sec,
                "llmProvider": row.llm_provider,
                "llmModel": row.llm_model,
                "createdAt": row.created_at,
                "questionCount": len(questions),
                "questions": questions,
                "diffFromPrevious": _diff_questions(prev_questions, questions)
                if prev_questions is not None
                else None,
            }
        )
        prev_questions = questions
    return history


def _replace_questions(db: Session, test: TechnicalTest, validated: dict[str, Any]) -> None:
    # Si aucune révision n'existe encore (tests créés avant B7), capturer l'état avant replace.
    has_rev = db.scalar(
        select(TestGenerationRevision.id)
        .where(TestGenerationRevision.test_id == test.id)
        .limit(1)
    )
    existing_qs = list(
        db.scalars(select(Question).where(Question.test_id == test.id)).all()
    )
    if has_rev is None and existing_qs:
        db.add(
            TestGenerationRevision(
                test_id=test.id,
                revision=0,
                difficulty=test.difficulty,
                duration_sec=test.duration_sec,
                questions_json=_questions_payload(existing_qs),
                llm_provider=test.llm_provider,
                llm_model=test.llm_model,
            )
        )
        db.flush()

    db.execute(delete(Question).where(Question.test_id == test.id))
    pos = 1
    for mcq in validated["mcqs"]:
        db.add(
            Question(
                test_id=test.id,
                position=pos,
                type="MCQ",
                prompt=mcq["prompt"],
                options_json=mcq["options"],
                correct_option=mcq["correctOption"],
                max_score=mcq["maxScore"],
                grading_rubric_json=None,
            )
        )
        pos += 1
    for open_q in validated["openQuestions"]:
        db.add(
            Question(
                test_id=test.id,
                position=pos,
                type="OPEN",
                prompt=open_q["prompt"],
                options_json=None,
                correct_option=None,
                max_score=open_q["maxScore"],
                grading_rubric_json=open_q["rubric"],
            )
        )
        pos += 1
    db.flush()
