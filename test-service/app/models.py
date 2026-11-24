"""ORM models — mirror sql/schema.sql."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class TechnicalTest(Base):
    __tablename__ = "technical_tests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    offre_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    recruiter_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    llm_provider: Mapped[Optional[str]] = mapped_column(String(32))
    llm_model: Mapped[Optional[str]] = mapped_column(String(128))
    prompt_version: Mapped[Optional[str]] = mapped_column(String(64))
    regenerate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    questions: Mapped[list["Question"]] = relationship(back_populates="test")
    assignments: Mapped[list["TestAssignment"]] = relationship(back_populates="test")
    revisions: Mapped[list["TestGenerationRevision"]] = relationship(
        back_populates="test"
    )


class TestGenerationRevision(Base):
    """Snapshot des questions après chaque génération réussie (B7)."""

    __tablename__ = "test_generation_revisions"
    __table_args__ = (UniqueConstraint("test_id", "revision"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("technical_tests.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    questions_json: Mapped[Any] = mapped_column(JSON, nullable=False)
    llm_provider: Mapped[Optional[str]] = mapped_column(String(32))
    llm_model: Mapped[Optional[str]] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    test: Mapped["TechnicalTest"] = relationship(back_populates="revisions")


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (UniqueConstraint("test_id", "position"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("technical_tests.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[Optional[Any]] = mapped_column(JSON)
    correct_option: Mapped[Optional[str]] = mapped_column(String(1))
    max_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    grading_rubric_json: Mapped[Optional[Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    test: Mapped["TechnicalTest"] = relationship(back_populates="questions")


class TestAssignment(Base):
    __tablename__ = "test_assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("technical_tests.id", ondelete="RESTRICT"), nullable=False
    )
    offre_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    candidature_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    candidate_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    start_deadline_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    score_mcq: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    score_open: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    score_total: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    evaluation_json: Mapped[Optional[Any]] = mapped_column(JSON)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    test: Mapped["TechnicalTest"] = relationship(back_populates="assignments")
    answers: Mapped[list["CandidateAnswer"]] = relationship(back_populates="assignment")
    incidents: Mapped[list["TestIncident"]] = relationship(back_populates="assignment")


class CandidateAnswer(Base):
    __tablename__ = "candidate_answers"
    __table_args__ = (UniqueConstraint("assignment_id", "question_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("test_assignments.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False
    )
    answer_option: Mapped[Optional[str]] = mapped_column(String(1))
    answer_text: Mapped[Optional[str]] = mapped_column(Text)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean)
    score: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    feedback: Mapped[Optional[str]] = mapped_column(Text)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    assignment: Mapped["TestAssignment"] = relationship(back_populates="answers")


class TestIncident(Base):
    __tablename__ = "test_incidents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("test_assignments.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    meta_json: Mapped[Optional[Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    assignment: Mapped["TestAssignment"] = relationship(back_populates="incidents")
