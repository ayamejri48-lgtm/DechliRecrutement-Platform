"""Validate LLM test payload before persistence."""
from __future__ import annotations

from typing import Any

MCQ_SCORE = 6.0
OPEN_SCORE = round(40.0 / 3.0, 2)  # 13.33


class ValidationError(ValueError):
    pass


def validate_generated_test(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("Root must be object")
    mcqs = payload.get("mcqs")
    opens = payload.get("openQuestions") or payload.get("open_questions")
    if not isinstance(mcqs, list) or len(mcqs) != 10:
        raise ValidationError("Exactly 10 mcqs required")
    if not isinstance(opens, list) or len(opens) != 3:
        raise ValidationError("Exactly 3 openQuestions required")

    clean_mcqs: list[dict[str, Any]] = []
    for i, raw in enumerate(mcqs, start=1):
        if not isinstance(raw, dict):
            raise ValidationError(f"mcq[{i}] must be object")
        prompt = str(raw.get("prompt") or "").strip()
        options = raw.get("options") or {}
        correct = str(
            raw.get("correctOption") or raw.get("correct_option") or ""
        ).strip().upper()
        if not prompt:
            raise ValidationError(f"mcq[{i}] empty prompt")
        if not isinstance(options, dict):
            raise ValidationError(f"mcq[{i}] options must be object")
        normalized_opts = {
            k.upper(): str(v).strip()
            for k, v in options.items()
            if str(k).upper() in {"A", "B", "C"} and str(v).strip()
        }
        if set(normalized_opts.keys()) != {"A", "B", "C"}:
            raise ValidationError(f"mcq[{i}] must have options A,B,C")
        if correct not in {"A", "B", "C"}:
            raise ValidationError(f"mcq[{i}] correctOption invalid")
        clean_mcqs.append(
            {
                "prompt": prompt,
                "options": normalized_opts,
                "correctOption": correct,
                "maxScore": MCQ_SCORE,
            }
        )

    clean_opens: list[dict[str, Any]] = []
    for i, raw in enumerate(opens, start=1):
        if not isinstance(raw, dict):
            raise ValidationError(f"open[{i}] must be object")
        prompt = str(raw.get("prompt") or "").strip()
        if not prompt:
            raise ValidationError(f"open[{i}] empty prompt")
        rubric = raw.get("rubric") or {
            "criteria": ["Pertinence technique", "Exactitude", "Clarté"],
            "maxScore": OPEN_SCORE,
        }
        if not isinstance(rubric, dict):
            raise ValidationError(f"open[{i}] rubric must be object")
        rubric = {
            **rubric,
            "maxScore": OPEN_SCORE,
            "criteria": rubric.get("criteria")
            or ["Pertinence technique", "Exactitude", "Clarté"],
        }
        clean_opens.append(
            {"prompt": prompt, "rubric": rubric, "maxScore": OPEN_SCORE}
        )

    return {"mcqs": clean_mcqs, "openQuestions": clean_opens}
