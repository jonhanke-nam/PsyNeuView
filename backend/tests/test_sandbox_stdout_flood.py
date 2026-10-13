"""Regression: a model that prints heavily at module level must not deadlock
the sandbox worker (#865).

The persistent worker returns results over *stdout*. A model that ``print()``s
more than the ~64KB OS pipe buffer during ``exec_module`` floods that channel;
the parent only drains stdout while awaiting a result, so the worker blocks
mid-write and never emits the result marker — the task then hits its timeout and
a fast model (the ``_Leabra-Demo`` script, which dumps large numpy arrays)
surfaces as a 300s hang. ``load_module`` now redirects a loaded model's stdout
to the continuously-drained stderr during exec, so heavy module-level prints
can't stall the result protocol.

This mirrors ``test_sandbox_stderr_drain.py`` (#810) for the stdout direction.
"""

import pytest

try:
    import psyneulink  # noqa: F401
    HAVE_PNL = True
except ImportError:
    HAVE_PNL = False

from app.services.introspector import load_and_introspect
from app.services.executor import get_input_nodes, run_model

# A trivial, fast model that dumps well past the pipe buffer to stdout at module
# scope — the shape of _Leabra-Demo's array prints, distilled. Before the fix the
# module-level print floods stdout and get-inputs/run hang to their timeout.
_FLOODY_MODEL = '''\
import psyneulink as pnl

print("X" * 200_000)  # >> 64KB OS pipe buffer, at module scope

comp = pnl.Composition(name="floody")
a = pnl.TransferMechanism(name="A")
comp.add_node(a)
'''

skip_if_no_pnl = pytest.mark.skipif(not HAVE_PNL, reason="PsyNeuLink not installed")


@skip_if_no_pnl
def test_stdout_flooding_model_does_not_deadlock_sandbox(tmp_path):
    f = tmp_path / "floody.py"
    f.write_text(_FLOODY_MODEL)

    # Every stage below goes through the real subprocess worker. The only way to
    # exceed the (generous) task timeouts on this trivial model is the stdout
    # pipe-buffer deadlock the redirect is here to prevent.
    r = load_and_introspect(str(f), use_sandbox=True)
    assert "error" not in r, r.get("error")
    assert r.get("compositions"), "floody model produced no compositions"
    cv = r["compositions"][0]["varName"]

    info = get_input_nodes(str(f), cv, use_sandbox=True)
    assert "error" not in info, info.get("error")

    inputs = {n["varName"]: [[0.0]] for n in info.get("inputNodes", [])}
    res = run_model(str(f), cv, inputs, use_sandbox=True)
    assert "error" not in res, res.get("error")
    assert res.get("numTrials", 0) >= 1, f"floody model produced no trials ({res!r})"
