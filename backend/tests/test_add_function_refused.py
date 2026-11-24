"""A Function is never written as a standalone node (#349, #348).

Placing a function from the Components panel used to write
``New_DualAdaptiveIntegrator_1 = pnl.DualAdaptiveIntegrator(name=...)``. A
Function takes no ``name``, so the model then failed to load. A function goes
onto a mechanism as its ``function=``; the add-node change refuses one.
"""

import tempfile
from pathlib import Path

import pytest

from app.services.file_writer import apply_structural_change, is_function_type

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")


@pytest.fixture
def tmp_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(Path(TEST_MODEL).read_text())
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


@pytest.mark.parametrize("ftype", ["DualAdaptiveIntegrator", "Logistic", "Linear", "UserDefinedFunction"])
def test_add_node_refuses_function_and_leaves_file_alone(tmp_model, ftype):
    before = Path(tmp_model).read_text()
    with pytest.raises(ValueError, match="belongs to a mechanism"):
        apply_structural_change(tmp_model, {
            "action": "add_node",
            "var_name": f"New_{ftype}_1",
            "type": ftype,
            "params": {},
            "composition": "stroop_model",
        })
    after = Path(tmp_model).read_text()
    assert after == before
    assert "name=" not in after.replace(before, "")


@pytest.mark.parametrize("mtype", ["TransferMechanism", "IntegratorMechanism", "DDM", "ProcessingMechanism"])
def test_mechanisms_are_not_function_types(mtype):
    assert not is_function_type(mtype)


def test_structural_change_route_answers_400_for_a_function(tmp_model):
    from fastapi.testclient import TestClient
    from app.main import app

    before = Path(tmp_model).read_text()
    resp = TestClient(app).post("/api/model/structural-change", json={
        "file_path": tmp_model,
        "changes": {
            "action": "add_node",
            "var_name": "New_Logistic_1",
            "type": "Logistic",
            "params": {},
            "composition": "stroop_model",
        },
    })
    assert resp.status_code == 400
    assert "belongs to a mechanism" in resp.json()["detail"]
    assert Path(tmp_model).read_text() == before
