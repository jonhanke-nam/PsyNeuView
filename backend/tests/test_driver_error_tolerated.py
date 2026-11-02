"""show_graph, Learn and MDF export load a model that drives itself (#161).

Loading a model runs its file with the file's own runs no-op'd. A library
model such as Botvinick's conflict-monitoring model then goes on to reset its
layers with ``context=`` its composition, after a run that never happened, and
PsyNeuLink raises "Parameter 'integrator_mode' of COLOR HIDDEN has no value for
execution_id …". The Composition is built by then. Run and the input list
already tolerated that (#796); show_graph, Learn, MDF export and the MDF gaps
check did not, so the show_graph tab showed the error instead of the graph.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import sandbox_worker as worker
from app.services import show_graph_cache

client = TestClient(app, raise_server_exceptions=False)

DRIVEN = '''
import psyneulink as pnl

a = pnl.TransferMechanism(name="A", integrator_mode=True)
b = pnl.TransferMechanism(name="B")
comp = pnl.Composition(name="DRIVEN", pathways=[[a, b]])

comp.run(inputs={a: [[1.0]]})
a.reset([[0.0]], context=comp)  # needs the run above, which a load no-ops
'''

NO_VALUE = "has no value for execution_id"


@pytest.fixture(autouse=True)
def empty_cache():
    show_graph_cache.clear()
    yield
    show_graph_cache.clear()


@pytest.fixture
def driven(tmp_path) -> str:
    path = tmp_path / "driven.py"
    path.write_text(DRIVEN)
    return str(path)


def _library_model(name: str) -> Path | None:
    try:
        import psyneulink
    except ImportError:
        return None
    p = Path(psyneulink.__file__).resolve().parent / "library" / "models" / name
    return p if p.exists() else None


BOTVINICK = _library_model("Botvinick_conflict_monitoring_model.py")
MONTAGUE = _library_model("MontagueDayanSejnowski96.py")


def test_the_model_does_raise_after_its_runs_are_no_opd(driven):
    """The fixture reproduces the report: without tolerance the load raises."""
    with pytest.raises(Exception, match=NO_VALUE):
        worker.load_module(driven, reset_registry=True)


def show_graph(path, comp_name, fmt):
    """The page's request, through the worker process. In this process the
    suite stubs show_graph out (conftest), so it isn't asked directly."""
    return client.post("/api/model/show-graph", json={
        "file_path": path, "composition_name": comp_name,
        "options": {"show_controller": True}, "format": fmt,
    })


@pytest.mark.parametrize("fmt", ["dot", "svg"])
def test_show_graph(driven, fmt):
    r = show_graph(driven, "DRIVEN", fmt)
    if fmt == "svg" and r.status_code == 400 and "graphviz" in r.text.lower():
        pytest.skip("Graphviz programs not installed")
    assert r.status_code == 200, r.text
    assert "A" in r.json()[fmt]


def test_export_mdf(driven):
    result = worker.task_export_mdf({"file_path": driven, "composition_name": "DRIVEN", "fmt": "yaml"})
    assert NO_VALUE not in str(result.get("error", "")), result["error"]


def test_mdf_gaps(driven):
    result = worker.task_mdf_gaps({"file_path": driven, "composition_name": "DRIVEN"})
    assert "error" not in result, result["error"]


def test_learn_gets_past_the_load(driven):
    """DRIVEN isn't an AutodiffComposition, so Learn declines it, but for that
    reason, not the driver's error."""
    result = worker.task_learn({"file_path": driven, "composition_name": "DRIVEN", "inputs": {}})
    assert NO_VALUE not in str(result.get("error", "")), result["error"]


@pytest.mark.skipif(BOTVINICK is None, reason="PsyNeuLink library models not available")
def test_botvinick_show_graph_with_controller():
    """The reported model and options."""
    r = show_graph(str(BOTVINICK), "CONFLICT MONITORING_SYSTEM", "dot")
    assert r.status_code == 200, r.text
    assert "COLOR HIDDEN" in r.json()["dot"]


@pytest.mark.skipif(MONTAGUE is None, reason="PsyNeuLink library models not available")
def test_montague_show_graph():
    """The same cause, another face: the model reads its own results after
    the no-op'd run and raises KeyError, shown as just 'TD_Learning_Figure_5A'."""
    r = show_graph(str(MONTAGUE), "TD_Learning_Figure_5A", "dot")
    assert r.status_code == 200, r.text
    assert "Action Selection" in r.json()["dot"]
