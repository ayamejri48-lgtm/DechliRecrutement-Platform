import pytest

from app.generation.validator import ValidationError, validate_generated_test
from app.llm.mock import MockLlmClient


def test_mock_payload_validates():
    raw = MockLlmClient().complete_json(system="x", user="y")
    out = validate_generated_test(raw)
    assert len(out["mcqs"]) == 10
    assert len(out["openQuestions"]) == 3
    assert out["mcqs"][0]["correctOption"] in {"A", "B", "C"}


def test_rejects_wrong_mcq_count():
    raw = MockLlmClient().complete_json(system="x", user="y")
    raw["mcqs"] = raw["mcqs"][:5]
    with pytest.raises(ValidationError):
        validate_generated_test(raw)
