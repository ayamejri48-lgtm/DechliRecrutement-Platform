"""Lightweight timer sweep every N seconds (no Celery)."""
from __future__ import annotations

import logging
import threading
import time

from app.attempt.service import sweep_timers
from app.db import SessionLocal
from app.evaluation.service import sweep_evaluations

logger = logging.getLogger("test-service.scheduler")
_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop(interval_sec: int = 30) -> None:
    while not _stop.wait(interval_sec):
        db = SessionLocal()
        try:
            stats = sweep_timers(db)
            grades = sweep_evaluations(db)
            if (
                stats["expired"]
                or stats["autosubmitted"]
                or stats.get("reminded_j1")
                or grades["evaluated"]
                or grades["failed"]
            ):
                logger.info("sweep %s %s", stats, grades)
        except Exception:
            logger.exception("sweep_failed")
        finally:
            db.close()


def start_scheduler(interval_sec: int = 30) -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(
        target=_loop, kwargs={"interval_sec": interval_sec}, daemon=True
    )
    _thread.start()
    logger.info("scheduler_started interval=%ss", interval_sec)


def stop_scheduler() -> None:
    _stop.set()
