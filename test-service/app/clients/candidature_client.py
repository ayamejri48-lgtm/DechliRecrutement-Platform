"""HTTP client → Offre-Service candidatures."""
from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status

from app.config import get_settings


@dataclass
class CandidatureSnapshot:
    id: int
    offre_id: int
    candidate_id: int
    status: str


def list_candidatures_for_offre(
    offre_id: int, bearer_token: str
) -> list[CandidatureSnapshot]:
    settings = get_settings()
    base = settings.offre_service_url.rstrip("/")
    headers = {"Authorization": f"Bearer {bearer_token}"}
    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(f"{base}/candidatures/offre/{offre_id}", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Offre-Service unreachable: {type(exc).__name__}",
        ) from exc

    if r.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="Accès refusé aux candidatures")
    if r.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Candidatures HTTP {r.status_code}",
        )

    out: list[CandidatureSnapshot] = []
    for row in r.json() or []:
        out.append(
            CandidatureSnapshot(
                id=int(row["id"]),
                offre_id=int(row["offreId"]),
                candidate_id=int(row["candidateId"]),
                status=str(row.get("status") or ""),
            )
        )
    return out
