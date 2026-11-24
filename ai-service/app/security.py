"""Internal service-to-service authentication for AI endpoints.

Designed for Spring callers (Offre/Matching orchestration). Never expose this
API key to the Angular browser; the browser must call Spring, not AI-Service.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException, status

ENV_KEY = "AI_INTERNAL_API_KEY"
HEADER_NAME = "X-Internal-Api-Key"


def auth_required() -> bool:
    return bool(os.getenv(ENV_KEY, "").strip())


def configured_api_key() -> Optional[str]:
    key = os.getenv(ENV_KEY, "").strip()
    return key or None


async def require_internal_api_key(
    x_internal_api_key: Optional[str] = Header(default=None, alias=HEADER_NAME),
) -> None:
    expected = configured_api_key()
    if not expected:
        # Local/dev mode: open. Production must set AI_INTERNAL_API_KEY.
        return
    if len(expected) < 16:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfigured: AI_INTERNAL_API_KEY must be at least 16 characters",
        )
    provided = (x_internal_api_key or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
