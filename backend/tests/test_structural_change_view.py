"""A structural change answers in the view the page shows (#252).

The reply re-reads the model. It used to always be the nested view, so with
the page showing compositions flattened, a nested composition folded into one
node after every add or delete until the next reload.
"""

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
NESTED = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "nested_minimal.py"
ADD = {"action": "add_node", "var_name": "extra", "type": "TransferMechanism", "params": {}, "composition": "inner_comp"}


def _top(model: dict) -> list[str]:
    comp = next(c for c in model["compositions"] if c["varName"] == "nested_minimal")
    return [n["name"] for n in comp["nodes"]]


def test_flat_view_answers_flat(tmp_path):
    f = tmp_path / "nested_minimal.py"
    shutil.copy(NESTED, f)
    r = client.post("/api/model/structural-change", json={"file_path": str(f), "changes": ADD, "flat": True})
    assert r.status_code == 200, r.text
    top = _top(r.json()["model"])
    assert "inner_comp" not in top
    assert {"inner_a", "inner_b", "extra"} <= set(top)


def test_nested_view_stays_nested(tmp_path):
    f = tmp_path / "nested_minimal.py"
    shutil.copy(NESTED, f)
    r = client.post("/api/model/structural-change", json={"file_path": str(f), "changes": ADD})
    assert r.status_code == 200, r.text
    assert "inner_comp" in _top(r.json()["model"])
