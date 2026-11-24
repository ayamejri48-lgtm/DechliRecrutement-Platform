"""Prompt templates for technical test generation."""
from __future__ import annotations

PROMPT_VERSION = "v1-it-tech-test"

SYSTEM = """Tu es un expert en recrutement IT. Tu génères des tests techniques en français.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown.
Schéma exact:
{
  "mcqs": [
    {
      "prompt": "énoncé",
      "options": {"A": "...", "B": "...", "C": "..."},
      "correctOption": "A" | "B" | "C"
    }
  ],
  "openQuestions": [
    {
      "prompt": "énoncé",
      "rubric": {
        "criteria": ["Pertinence technique", "Exactitude", "Clarté"],
        "maxScore": 13.33
      }
    }
  ]
}
Règles:
- Exactement 10 QCM et 3 questions ouvertes.
- Chaque QCM a exactement 3 options A,B,C et UNE seule bonne réponse.
- Niveau adapté à la difficulté demandée.
- Questions liées aux compétences de l'offre (surtout les obligatoires).
- Pas de questions hors IT. Pas d'ambiguïté volontaire.
"""


def build_user_prompt(
    *,
    title: str,
    description: str,
    difficulty: str,
    duration_min: int,
    skills: list[str],
    required_skills: list[str],
) -> str:
    return (
        f"Offre: {title}\n"
        f"Difficulté: {difficulty} (durée {duration_min} min)\n"
        f"Compétences: {', '.join(skills) or 'N/A'}\n"
        f"Obligatoires: {', '.join(required_skills) or 'N/A'}\n"
        f"Contexte (extrait):\n{(description or '')[:1200]}\n"
        "Génère le test JSON maintenant."
    )
