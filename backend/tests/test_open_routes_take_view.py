"""Every route that opens a model builds it in the view asked for (#428).

The page opens models flattened; the backend's default is nested. Only
/model/load took the view, so a model opened from the Reference Models section
(and the demo, example, project, MDF and save-as opens) came back nested under
a view menu reading "Flatten (all compositions)", and EGO's EM showed folded.
"""

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app

client = TestClient(app)


@pytest.fixture
def asked(tmp_path, monkeypatch):
    """Record the view each load is built in, without building anything."""
    monkeypatch.setenv("PSYNEUVIEW_WORKING_DIR", str(tmp_path))
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)
    calls: list[dict] = []

    def fake(path, **kw):
        calls.append({"flat": kw.get("flat", False), "pytorch": kw.get("pytorch", False)})
        return {"compositions": [], "lineMap": {}}

    monkeypatch.setattr(routes, "load_and_introspect", fake)
    return calls


VIEWS = [{"flat": True, "pytorch": False}, {"flat": False, "pytorch": True}, {"flat": False, "pytorch": False}]


@pytest.mark.parametrize("view", VIEWS)
def test_reference_model_open_takes_the_view(asked, view):
    r = client.post("/api/reference-models/load", json={"name": "GilzenratModel", **view})
    assert r.status_code == 200, r.text
    assert asked == [view]


@pytest.mark.parametrize("view", VIEWS)
def test_demo_open_takes_the_view(asked, view):
    r = client.post("/api/demos/reset", json={"demo_name": "scheduling_demo", **view})
    assert r.status_code == 200, r.text
    assert asked == [view]


@pytest.mark.parametrize("view", VIEWS)
def test_save_as_open_takes_the_view(asked, view):
    r = client.post(
        "/api/models/save-as",
        json={"source": "import psyneulink as pnl\n", "file_name": "view_428.py", **view},
    )
    assert r.status_code == 200, r.text
    assert asked == [view]


def test_left_out_the_view_is_nested_as_before(asked):
    """Older callers that send no view still get the nested view."""
    r = client.post("/api/reference-models/load", json={"name": "GilzenratModel"})
    assert r.status_code == 200, r.text
    assert asked == [{"flat": False, "pytorch": False}]
