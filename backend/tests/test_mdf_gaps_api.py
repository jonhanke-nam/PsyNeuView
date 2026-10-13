"""POST /api/model/mdf-gaps: the export dialog's MDF gap warnings (#83-#87)."""
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures" / "mdf"


def test_a_shared_component_comes_back_as_a_warning():
    resp = client.post("/api/model/mdf-gaps", json={"file_path": str(FIXTURES / "conjoint_comps.py"), "composition_name": "c1"})
    assert resp.status_code == 200, resp.text
    gaps = resp.json()["gaps"]
    assert [g["issue"] for g in gaps] == [83]
    assert gaps[0]["items"] == ["shared (also in c2)"]
    assert gaps[0]["severity"] == "warning"


def test_a_plain_model_has_no_gaps_and_a_missing_file_is_404():
    resp = client.post("/api/model/mdf-gaps", json={"file_path": str(FIXTURES / "basic_linear.py")})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"gaps": []}
    assert client.post("/api/model/mdf-gaps", json={"file_path": "/nope/missing.py"}).status_code == 404
