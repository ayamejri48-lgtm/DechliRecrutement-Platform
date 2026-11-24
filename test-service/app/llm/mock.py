"""Deterministic mock LLM for local tests without Groq key."""
from __future__ import annotations

from typing import Any


class MockLlmClient:
    provider = "mock"
    model = "mock-v1"

    def complete_json(self, *, system: str, user: str) -> dict[str, Any]:
        # Phase 4 grading
        if '"grades"' in system or "Corrige les réponses" in (user or ""):
            return self._mock_grades(user or "")
        mcqs = []
        for i in range(1, 11):
            mcqs.append(
                {
                    "prompt": f"[MOCK] QCM {i} — Quelle affirmation est correcte sur Git ?",
                    "options": {
                        "A": "Git est un SGBD relationnel",
                        "B": "Git est un système de contrôle de version",
                        "C": "Git remplace HTTP",
                    },
                    "correctOption": "B",
                }
            )
        opens = []
        for i in range(1, 4):
            opens.append(
                {
                    "prompt": (
                        f"[MOCK] Question ouverte {i} — Expliquez brièvement "
                        "l'intérêt des tests automatisés dans un pipeline CI/CD."
                    ),
                    "rubric": {
                        "criteria": [
                            "Pertinence technique",
                            "Exactitude",
                            "Clarté",
                        ],
                        "maxScore": 13.33,
                    },
                }
            )
        return {"mcqs": mcqs, "openQuestions": opens}

    def _mock_grades(self, user: str) -> dict[str, Any]:
        import re

        grades = []
        for m in re.finditer(
            r"questionId=(\d+)\s*\(maxScore=([0-9.]+)\)", user
        ):
            qid = int(m.group(1))
            max_s = float(m.group(2))
            # crude heuristic: empty → 0; else ~70% max
            block_start = m.start()
            next_h = user.find("### questionId=", block_start + 1)
            block = user[block_start : next_h if next_h > 0 else None]
            ans = ""
            if "Réponse candidat:" in block:
                ans = block.split("Réponse candidat:", 1)[1].strip()
            empty = not ans or ans.startswith("(vide)")
            score = 0.0 if empty else round(max_s * 0.7, 2)
            grades.append(
                {
                    "questionId": qid,
                    "score": score,
                    "feedback": (
                        "[MOCK] Réponse vide."
                        if empty
                        else "[MOCK] Réponse partiellement pertinente."
                    ),
                }
            )
        return {"grades": grades}
