"""Executor must suppress a model's module-level side effects (#608, #609).

Many PsyNeuLink example scripts call ``comp.show_graph()`` and
``comp.run()`` / ``comp.learn()`` at module level. When PsyNeuView's executor
loads such a script it must not:

- #608: render a graphviz PDF (which the OS opens) or pop a plot window, and
- #609: let a module-level run/learn pollute ``comp.results`` or mutate trained
  parameters before the executor drives its own run.

These exercise the in-process path (``use_sandbox=False``); the sandbox worker
shares the same guard logic.
"""

import glob
from pathlib import Path

import pytest

from app.services.executor import run_model
from app.services.introspector import load_and_introspect


MODEL_SRC = '''\
import psyneulink as pnl

a = pnl.TransferMechanism(default_variable=[0, 0], name="A")
b = pnl.TransferMechanism(default_variable=[0, 0], name="B")
comp = pnl.Composition(pathways=[a, b], name="SideEffectModel")

# Module-level side effects the executor must suppress:
comp.run(inputs={a: [[1, 1]]})   # would pollute comp.results (#609)
comp.run(inputs={a: [[1, 1]]})   # a second stale result
comp.show_graph()                # would render/open a PDF (#608)
'''


@pytest.fixture
def model_file(tmp_path, monkeypatch):
    """Write the side-effect model and run with tmp_path as cwd.

    Running in tmp_path means any leaked graphviz output lands here, where the
    test can detect it.
    """
    monkeypatch.chdir(tmp_path)
    path = tmp_path / "side_effect_model.py"
    path.write_text(MODEL_SRC)
    return path


def _graphviz_leaks(root: Path):
    return (
        glob.glob(str(root / "**" / "*.pdf"), recursive=True)
        + glob.glob(str(root / "**" / "*.gv"), recursive=True)
        + glob.glob(str(root / "**" / "SideEffectModel*"), recursive=True)
    )


def test_run_is_not_polluted_by_module_level_run(model_file, tmp_path):
    """#609: a one-trial GUI run reports exactly one trial, not the stale ones."""
    result = run_model(str(model_file), "comp", {"a": [[1, 1]]}, use_sandbox=False)
    assert "error" not in result, result.get("error")
    assert result["numTrials"] == 1, (
        f"expected 1 trial, got {result['numTrials']} — module-level runs leaked "
        f"into comp.results"
    )


def test_run_does_not_render_graphviz_pdf(model_file, tmp_path):
    """#608: loading + running must not produce a graphviz PDF/source file."""
    result = run_model(str(model_file), "comp", {"a": [[1, 1]]}, use_sandbox=False)
    assert "error" not in result, result.get("error")
    leaks = _graphviz_leaks(tmp_path)
    assert not leaks, f"executor leaked graphviz output: {leaks}"


def test_introspect_does_not_render_graphviz_pdf(model_file, tmp_path):
    """#608: introspection (open-model path) must not render a PDF either."""
    res = load_and_introspect(str(model_file), use_sandbox=False)
    assert len(res.get("compositions", [])) == 1
    leaks = _graphviz_leaks(tmp_path)
    assert not leaks, f"introspector leaked graphviz output: {leaks}"
