"""Tests for execution-backend capability detection (#537, Learn L4)."""

from fastapi.testclient import TestClient

from app.main import app
from app.services.execution_modes import (
    DEFAULT_LEARN_MODE,
    get_execution_modes,
)

client = TestClient(app)


def test_modes_cover_the_three_backends():
    ids = {m["id"] for m in get_execution_modes()}
    assert ids == {"PyTorch", "Python", "LLVM"}


def test_python_is_available_but_not_learnable():
    python = next(m for m in get_execution_modes() if m["id"] == "Python")
    assert python["available"] is True
    assert python["learnable"] is False
    assert python["reason"]  # always explains why it can't train


def test_default_learn_mode_is_a_learnable_mode_when_present():
    modes = {m["id"]: m for m in get_execution_modes()}
    default = modes[DEFAULT_LEARN_MODE]
    # PyTorch is the only learnable backend today; if torch is installed it
    # must be both available and learnable, otherwise nothing could train.
    if default["available"]:
        assert default["learnable"] is True


def test_unavailable_modes_carry_a_reason():
    for m in get_execution_modes():
        if not m["available"] or not m["learnable"]:
            assert m["reason"], f"{m['id']} should explain its limitation"


def test_endpoint_shape():
    resp = client.get("/api/execution-modes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["defaultLearn"] == DEFAULT_LEARN_MODE
    assert {m["id"] for m in body["modes"]} == {"PyTorch", "Python", "LLVM"}
