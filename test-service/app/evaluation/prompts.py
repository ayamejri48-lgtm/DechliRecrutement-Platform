"""Prompts for open-question LLM grading."""
from __future__ import annotations

from typing import Any

PROMPT_VERSION = "v1-open-grade"

SYSTEM = """Tu es un correcteur technique IT strict mais juste.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown.
Schéma exact:
{
  "grades": [
    {
      "questionId": 123,
      "score": 0.0,
      "feedback": "commentaire court en français"
    }
  ]
}
Règles:
- Une entrée par question ouverte fournie.
- score entre 0 et maxScore inclus (nombre).
- Évalue selon la grille (criteria).
- feedback: 1–3 phrases, concret, sans inventer des faits absents de la réponse.
- Si réponse vide / hors sujet → score bas (0–20% du max).
"""


def build_user_prompt(*, items: list[dict[str, Any]]) -> str:
    lines = ["Corrige les réponses ouvertes suivantes:", ""]
    for it in items:
        lines.append(f"### questionId={it['questionId']} (maxScore={it['maxScore']})")
        lines.append(f"Énoncé: {it['prompt']}")
        rubric = it.get("rubric") or {}
        criteria = rubric.get("criteria") if isinstance(rubric, dict) else None
        if criteria:
            lines.append(f"Critères: {', '.join(str(c) for c in criteria)}")
        lines.append(f"Réponse candidat:\n{it.get('answerText') or '(vide)'}")
        lines.append("")
    lines.append("Retourne le JSON grades maintenant.")
    return "\n".join(lines)
