"""Execution-mode selection on the *run* path (#764).

Companion to test_execution_modes.py, which covers capability detection. This
file covers the half that decides what a run actually executes under: the
resolver, the request field, and the `defaultRun` the frontend seeds its
selector from.

The resolver is deliberately stricter to test than the learn one: learning can
legitimately force PyTorch, but a forward run must honor what was asked for,
so "it returned a mode" is not enough — the test pins *which* mode.
"""

import psyneulink as pnl
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.execution_modes import DEFAULT_RUN_MODE, get_execution_modes
from app.services.executor import _resolve_run_execution_mode

client = TestClient(app)


def _resolve(requested):
    return _resolve_run_execution_mode(pnl, requested)


@pytest.mark.parametrize("requested", [None, ""])
def test_omitted_mode_uses_the_documented_default(requested):
    """An omitted mode must keep pre-#764 behaviour, not silently change it."""
    mode, effective, reason = _resolve(requested)
    assert effective == DEFAULT_RUN_MODE
    assert reason is None
    assert mode is getattr(pnl.ExecutionMode, DEFAULT_RUN_MODE)


def test_available_modes_are_honored_not_overridden():
    """The run path differs from learn: an available backend is used as asked."""
    for info in get_execution_modes():
        if not info["available"]:
            continue
        _, effective, reason = _resolve(info["id"])
        assert effective == info["id"], f"{info['id']} was overridden to {effective}"
        assert reason is None


def test_unknown_mode_falls_back_and_says_why():
    mode, effective, reason = _resolve("Bogus")
    assert effective == DEFAULT_RUN_MODE
    assert mode is getattr(pnl.ExecutionMode, DEFAULT_RUN_MODE)
    assert reason and "Bogus" in reason


def test_capability_ids_map_to_real_executionmode_members():
    """Guards the trap that made the LLVM option decorative.

    ExecutionMode's real members are PyTorch / _LLVM / _PTX / _PerNode / _Exec /
    _Run / _Fallback. "Python" is a composite alias and there is no "LLVM" at
    all — the public compiled-run mode is LLVMRun. A naive getattr therefore
    resolved LLVM to the fallback and the selector silently did nothing. If a
    future PsyNeuLink renames a member, this fails instead of quietly
    degrading every run to Python.
    """
    for info in get_execution_modes():
        if not info["available"]:
            continue
        mode, effective, reason = _resolve(info["id"])
        assert reason is None, f"{info['id']} did not resolve: {reason}"
        assert isinstance(mode, pnl.ExecutionMode)
        assert effective == info["id"]


def test_execution_modes_endpoint_advertises_default_run():
    """The Run selector seeds itself from `defaultRun`; Learn uses defaultLearn."""
    resp = client.get("/api/execution-modes")
    assert resp.status_code == 200
    body = resp.json()
    assert body["defaultRun"] == DEFAULT_RUN_MODE
    assert "defaultLearn" in body  # unchanged by #764
    assert {m["id"] for m in body["modes"]} >= {"Python", "PyTorch"}


def test_default_run_mode_is_actually_available():
    """A default nothing can run under would break every omitted-mode request."""
    modes = {m["id"]: m for m in get_execution_modes()}
    assert modes[DEFAULT_RUN_MODE]["available"] is True


def test_run_request_accepts_execution_mode_field():
    """RunModelRequest gained the field LearnModelRequest already had."""
    from app.api.routes import RunModelRequest

    req = RunModelRequest(
        file_path="/tmp/x.py",
        composition_name="c",
        inputs={},
        execution_mode="PyTorch",
    )
    assert req.execution_mode == "PyTorch"
    # Optional: omitting it is what every pre-#764 client does.
    assert RunModelRequest(file_path="/tmp/x.py", composition_name="c", inputs={}).execution_mode is None
