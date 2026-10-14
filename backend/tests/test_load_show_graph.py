"""A load asked for show_graph keeps its answers, so the layout needn't reload (#27).

With the "Like show_graph" layout picked, the page's load carries a
``show_graph`` request. The load asks show_graph about the model it has just
built and keeps the answers in the show_graph cache, so the layout's own
request, which follows at once, is answered without loading the model again.
"""

import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import sandbox, show_graph_cache

client = TestClient(app, raise_server_exceptions=False)

DEMOS = Path(__file__).resolve().parent.parent / "demos"


@pytest.fixture(autouse=True)
def empty_cache():
    show_graph_cache.clear()
    yield
    show_graph_cache.clear()


def copy_demo(tmp_path, name):
    path = tmp_path / name
    shutil.copy(DEMOS / name, path)
    return path


def outermost(model):
    """The page's rule (modelStore): the first composition that isn't a node of another."""
    def clean(n):
        return re.sub(r"-\d+$", "", n)

    nested = set()
    for c in model["compositions"]:
        for node in c.get("nodes") or []:
            if node.get("kind") == "composition":
                n = node.get("varName") or node.get("name")
                nested.update({n, clean(n)})
    return next(c["varName"] for c in model["compositions"]
                if c["varName"] not in nested and clean(c["varName"]) not in nested)


def layout_request(path, composition, show_learning=False, show_nested="nested"):
    """The request useShowGraphLayout sends."""
    return client.post("/api/model/show-graph", json={
        "file_path": str(path),
        "composition_name": composition,
        "options": {
            "show_controller": True,
            "show_learning": show_learning,
            "show_cim": False,
            "show_nested": show_nested,
        },
        "format": "dot",
    })


@pytest.fixture
def runner_calls(monkeypatch):
    """After the load: count what still reaches the model runner."""
    calls = []
    real = sandbox.run_in_sandbox

    def counting(task, params, timeout=None):
        calls.append(task)
        return real(task, params, timeout)

    return lambda: (monkeypatch.setattr(sandbox, "run_in_sandbox", counting), calls)[1]


@pytest.mark.parametrize("demo", ["nested_compositions.py", "feedforward_network.py"])
def test_layout_after_a_show_graph_load_does_not_reload(tmp_path, demo, runner_calls):
    path = copy_demo(tmp_path, demo)
    resp = client.post("/api/model/load", json={
        "file_path": str(path),
        "show_graph": {"show_controller": True, "show_learning": False},
    })
    assert resp.status_code == 200
    model = resp.json()["model"]
    assert "showGraph" not in model  # kept by the backend, not sent to the page
    comp = outermost(model)

    calls = runner_calls()
    for show_nested in ("nested", False):
        for show_learning in (False, True):
            r = layout_request(path, comp, show_learning=show_learning, show_nested=show_nested)
            # Answered either way; a refusal is show_graph's own, as when asked.
            assert r.status_code in (200, 400)
            if r.status_code == 200:
                assert r.json()["dot"].startswith(("digraph", "graph", "strict"))
    assert calls == []


def test_plain_load_keeps_nothing(tmp_path, runner_calls):
    path = copy_demo(tmp_path, "feedforward_network.py")
    model = client.post("/api/model/load", json={"file_path": str(path)}).json()["model"]
    calls = runner_calls()
    assert layout_request(path, outermost(model)).status_code == 200
    assert calls == ["show_graph"]


def test_editing_after_the_load_asks_again(tmp_path, runner_calls):
    path = copy_demo(tmp_path, "feedforward_network.py")
    model = client.post("/api/model/load", json={
        "file_path": str(path),
        "show_graph": {"show_controller": True, "show_learning": False},
    }).json()["model"]
    path.write_text(path.read_text() + "\n# edited\n")
    calls = runner_calls()
    assert layout_request(path, outermost(model)).status_code == 200
    assert calls == ["show_graph"]
