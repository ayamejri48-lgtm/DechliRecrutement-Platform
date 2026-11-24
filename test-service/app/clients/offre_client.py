"""HTTP client → Offre-Service (forward recruiter JWT)."""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import get_settings


class OffreSnapshot:
    def __init__(
        self,
        *,
        id: int,
        recruiter_id: int,
        title: str,
        description: str,
        experience_years: int | None,
        status: str,
        skills: list[dict[str, Any]],
    ):
        self.id = id
        self.recruiter_id = recruiter_id
        self.title = title
        self.description = description
        self.experience_years = experience_years
        self.status = status
        self.skills = skills

    @property
    def skill_names(self) -> list[str]:
        return [str(s.get("name") or "").strip() for s in self.skills if s.get("name")]

    @property
    def required_skill_names(self) -> list[str]:
        return [
            str(s.get("name") or "").strip()
            for s in self.skills
            if s.get("name") and s.get("required")
        ]


def fetch_offre_for_recruiter(offre_id: int, bearer_token: str) -> OffreSnapshot:
    settings = get_settings()
    base = settings.offre_service_url.rstrip("/")
    headers = {"Authorization": f"Bearer {bearer_token}"}

    try:
        with httpx.Client(timeout=20.0) as client:
            offre_r = client.get(f"{base}/offres/{offre_id}", headers=headers)
            skills_r = client.get(f"{base}/offres/{offre_id}/skills", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Offre-Service unreachable: {type(exc).__name__}",
        ) from exc

    if offre_r.status_code == 404:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if offre_r.status_code in (401, 403):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès refusé à cette offre",
        )
    if offre_r.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Offre-Service error HTTP {offre_r.status_code}",
        )
    if skills_r.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Impossible de lire les compétences (HTTP {skills_r.status_code})",
        )

    offre = offre_r.json()
    skills = skills_r.json() or []
    return OffreSnapshot(
        id=int(offre["id"]),
        recruiter_id=int(offre["recruiterId"]),
        title=str(offre.get("title") or ""),
        description=str(offre.get("description") or ""),
        experience_years=offre.get("experienceYears"),
        status=str(offre.get("status") or ""),
        skills=list(skills),
    )
