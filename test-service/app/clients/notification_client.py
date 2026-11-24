"""Best-effort notifications into user_db.notifications (same MySQL host).

No public POST exists on User-Service; Kafka topics are owned by Offre-Service.
For PFE we insert idempotently by event_key (same uniqueness rule as NotificationService).
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import create_engine, text

from app.config import get_settings

logger = logging.getLogger("test-service.notifications")


def _user_db_url() -> str:
    """Prefer NOTIFICATION_DATABASE_URL, else derive …/user_db from DATABASE_URL."""
    settings = get_settings()
    if (settings.notification_database_url or "").strip():
        return settings.notification_database_url.strip()
    url = settings.database_url
    if "/test_db" in url:
        return url.replace("/test_db", "/user_db")
    return url


def _other_db(name: str) -> str:
    settings = get_settings()
    url = settings.database_url
    if "/test_db" in url:
        return url.replace("/test_db", f"/{name}")
    return url


def _first_text(url: str, sql: str, params: dict) -> str | None:
    try:
        engine = create_engine(url, pool_pre_ping=True, future=True)
        with engine.connect() as conn:
            row = conn.execute(text(sql), params).first()
        if not row:
            return None
        value = " ".join(str(part).strip() for part in row if part is not None).strip()
        return value or None
    except Exception:
        return None


def offer_title(offre_id: int) -> str:
    found = _first_text(
        _other_db("offre_db"),
        "SELECT title FROM offres WHERE id = :id",
        {"id": offre_id},
    )
    return found or "une offre"


def person_name(user_id: int) -> str:
    found = _first_text(
        _user_db_url(),
        "SELECT first_name, last_name FROM users WHERE id = :id",
        {"id": user_id},
    )
    return found or "Un candidat"


def notify_admins(*, title: str, message: str, event_key: str) -> None:
    """One row per active admin. The event key stays unique per recipient."""
    try:
        engine = create_engine(_user_db_url(), pool_pre_ping=True, future=True)
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id FROM users WHERE role = 'ADMIN' AND enabled = 1")
            ).all()
        for (admin_id,) in rows:
            notify_candidate(
                recipient_id=int(admin_id),
                title=title,
                message=message,
                event_key=f"{event_key}:admin:{int(admin_id)}",
            )
    except Exception as exc:
        logger.warning("admin_notification_failed key=%s err=%s", event_key, type(exc).__name__)


def notify_candidate(
    *,
    recipient_id: int,
    title: str,
    message: str,
    event_key: str,
) -> bool:
    try:
        engine = create_engine(_user_db_url(), pool_pre_ping=True, future=True)
        with engine.begin() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM notifications WHERE event_key = :k LIMIT 1"),
                {"k": event_key},
            ).first()
            if exists:
                return False
            conn.execute(
                text(
                    """
                    INSERT INTO notifications
                      (recipient_id, title, message, event_key, is_read, created_at)
                    VALUES
                      (:rid, :title, :msg, :ek, 0, :now)
                    """
                ),
                {
                    "rid": recipient_id,
                    "title": title[:255],
                    "msg": message[:1000],
                    "ek": event_key[:255],
                    "now": datetime.utcnow(),
                },
            )
        logger.info("notification_ok recipient=%s key=%s", recipient_id, event_key)
        return True
    except Exception as exc:
        # Assignment must not fail if notif DB is down.
        logger.warning(
            "notification_failed recipient=%s err=%s", recipient_id, type(exc).__name__
        )
        return False
