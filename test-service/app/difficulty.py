"""Map offre.experienceYears → difficulty + duration (frozen PFE rule)."""
from __future__ import annotations

from typing import Literal

Difficulty = Literal["JUNIOR", "INTERMEDIATE", "SENIOR"]

_DURATION = {
    "JUNIOR": 30 * 60,
    "INTERMEDIATE": 45 * 60,
    "SENIOR": 60 * 60,
}


def difficulty_from_experience_years(years: int | float | None) -> Difficulty:
    y = 0 if years is None else int(years)
    if y <= 2:
        return "JUNIOR"
    if y <= 5:
        return "INTERMEDIATE"
    return "SENIOR"


def duration_sec_for(difficulty: Difficulty) -> int:
    return _DURATION[difficulty]
