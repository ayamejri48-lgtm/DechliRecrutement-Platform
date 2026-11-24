"""Best-effort e-mail (SMTP) — ne doit jamais faire échouer la publication."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy import create_engine, text

from app.clients.notification_client import _user_db_url
from app.config import get_settings

logger = logging.getLogger("test-service.email")


def candidate_contact(user_id: int) -> tuple[str | None, str | None]:
    """Return (email, first_name) from user_db, or (None, None)."""
    try:
        engine = create_engine(_user_db_url(), pool_pre_ping=True, future=True)
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT email, first_name FROM users WHERE id = :id LIMIT 1"
                ),
                {"id": user_id},
            ).first()
        if not row or not row[0]:
            return None, None
        email = str(row[0]).strip()
        first = str(row[1]).strip() if row[1] else None
        return (email or None), (first or None)
    except Exception as exc:
        logger.warning(
            "candidate_contact_failed user=%s err=%s",
            user_id,
            type(exc).__name__,
        )
        return None, None


def send_score_published_email(
    *,
    candidate_id: int,
    offer_title: str,
    score_total: float,
    results_url: str | None = None,
) -> bool:
    """Notify the candidate that their test score is available."""
    settings = get_settings()
    host = (settings.smtp_host or "").strip()
    user = (settings.smtp_username or "").strip()
    password = (settings.smtp_password or "").strip()
    if not host or not user or not password:
        logger.info("email_skipped reason=smtp_not_configured")
        return False

    to_email, first_name = candidate_contact(candidate_id)
    if not to_email:
        logger.warning("email_skipped reason=no_recipient candidate=%s", candidate_id)
        return False

    greeting = f"Bonjour {first_name}," if first_name else "Bonjour,"
    score_line = f"{score_total:.0f}/100"
    title = (offer_title or "votre offre").strip()
    link = (results_url or settings.frontend_tests_url or "").strip()
    link_block = (
        f"\nConsultez le détail ici :\n{link}\n"
        if link
        else "\nConnectez-vous à DechliRecrutement → Tests techniques pour les consulter.\n"
    )

    body = (
        f"{greeting}\n\n"
        f"Les résultats de votre test technique pour « {title} » sont maintenant disponibles.\n\n"
        f"Score total : {score_line}\n"
        f"{link_block}\n"
        "Cordialement,\n"
        "L’équipe DechliRecrutement\n"
    )

    msg = EmailMessage()
    msg["Subject"] = f"Résultats de votre test — {title}"
    msg["From"] = user
    msg["To"] = to_email
    msg.set_content(body)

    try:
        port = int(settings.smtp_port or 587)
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.ehlo()
            if settings.smtp_starttls:
                smtp.starttls()
                smtp.ehlo()
            smtp.login(user, password)
            smtp.send_message(msg)
        logger.info(
            "email_ok candidate=%s to=%s score=%s",
            candidate_id,
            to_email,
            score_line,
        )
        return True
    except Exception as exc:
        logger.warning(
            "email_failed candidate=%s err=%s",
            candidate_id,
            type(exc).__name__,
        )
        return False
