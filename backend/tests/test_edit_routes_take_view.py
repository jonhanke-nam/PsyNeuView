"""Every route that edits a model sends it back in the view asked for (#431).

After #428 every open took the view the page shows, but the edits (a
parameter, a port, a node name, saving typed code) still re-read the model
nested. Under a view menu reading "Flatten (all compositions)" the graph then
came back nested after each edit until the next reload.
"""

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app

client = TestClient(app)

SOURCE = (
    "import psyneulink as pnl\n"
    "\n"
    "A = pnl.TransferMechanism(name='A', input_ports=['in_a'], output_ports=['out_a'])\n"
    "comp = pnl.Composition(name='comp', pathways=[A])\n"
)


@pytest.fixture
def model_file(tmp_path, monkeypatch):
    """A small model in a working folder, and a record of each re-read's view."""
    monkeypatch.setenv("PSYNEUVIEW_WORKING_DIR", str(tmp_path))
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)
    path = tmp_path / "edit_view_431.py"
    path.write_text(SOURCE)
    calls: list[dict] = []

    def fake(_path, **kw):
        calls.append({"flat": kw.get("flat", False), "pytorch": kw.get("pytorch", False)})
        return {"compositions": [], "lineMap": {}}

    monkeypatch.setattr(routes, "load_and_introspect", fake)
    return str(path), calls


VIEWS = [{"flat": True, "pytorch": False}, {"flat": False, "pytorch": True}, {"flat": False, "pytorch": False}]


def _edits(path: str) -> dict[str, dict]:
    """One request for each edit route, keyed by its path."""
    return {
        "/api/model/update-param": {
            "file_path": path, "var_name": "A", "param_name": "noise", "new_value": "0.5",
        },
        "/api/model/update-function-type": {
            "file_path": path, "var_name": "A", "new_function_class": "Logistic",
        },
        "/api/model/rename-port": {
            "file_path": path, "var_name": "A", "port_kind": "input",
            "current_names": ["in_a"], "old_name": "in_a", "new_name": "in_b",
        },
        "/api/model/add-port": {
            "file_path": path, "var_name": "A", "port_kind": "output",
            "current_names": ["out_a"], "new_name": "out_b",
        },
        "/api/model/remove-port": {
            "file_path": path, "var_name": "A", "port_kind": "output",
            "current_names": ["out_a", "out_b"], "port_name": "out_b",
        },
        "/api/model/rename-node": {
            "file_path": path, "var_name": "A", "new_name": "B",
            "existing_names": ["A"], "current_name": "A",
        },
        "/api/model/save-source": {"file_path": path, "source": SOURCE},
    }


@pytest.mark.parametrize("route", list(_edits("x")))
@pytest.mark.parametrize("view", VIEWS)
def test_edit_route_takes_the_view(model_file, route, view):
    path, asked = model_file
    if route == "/api/model/remove-port":
        # Something to remove: the second output port.
        client.post("/api/model/add-port", json=_edits(path)["/api/model/add-port"])
        asked.clear()
    r = client.post(route, json={**_edits(path)[route], **view})
    assert r.status_code == 200, r.text
    assert asked == [view]


@pytest.mark.parametrize("view", VIEWS)
def test_save_source_conflict_model_takes_the_view(model_file, view):
    """The disk version shown when a save is refused is in the view too."""
    path, asked = model_file
    r = client.post(
        "/api/model/save-source",
        json={"file_path": path, "source": SOURCE, "base_source": "something else", **view},
    )
    assert r.status_code == 409, r.text
    assert asked == [view]


def test_left_out_the_view_is_nested_as_before(model_file):
    """Older callers that send no view still get the nested view."""
    path, asked = model_file
    r = client.post("/api/model/rename-port", json=_edits(path)["/api/model/rename-port"])
    assert r.status_code == 200, r.text
    assert asked == [{"flat": False, "pytorch": False}]
