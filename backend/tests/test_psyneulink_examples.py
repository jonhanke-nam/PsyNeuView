"""Live PsyNeuLink examples endpoint (#843).

These are read verbatim from the *active source's* ``Scripts/Examples`` — not
copied — so behavior depends on whether the active PsyNeuLink is a full repo
checkout (has ``Scripts/``) or a pip install (doesn't). Tests here stay hermetic:
they assert the response *shape* and the safety guards, not a specific corpus.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_returns_available_flag_and_shape():
    resp = client.get("/api/psyneulink-examples")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["models"], list)
    assert isinstance(data["available"], bool)
    # When a source with Scripts/ is present, each entry is well-formed.
    if data["available"]:
        for m in data["models"]:
            assert m["name"] and m["label"] and m["path"]
            assert m["path"].endswith(".py")


def test_load_unknown_example_is_404():
    resp = client.post("/api/psyneulink-examples/load", json={"name": "definitely-not-a-real-example"})
    assert resp.status_code == 404


def test_load_rejects_path_traversal():
    # A crafted name must not escape the Scripts/Examples dir.
    resp = client.post("/api/psyneulink-examples/load", json={"name": "../../../../etc/passwd"})
    assert resp.status_code == 404


def test_status_returns_shape_and_cache():
    resp = client.get("/api/psyneulink-examples/status")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["status"], dict)
    assert isinstance(data["available"], bool)
    if data["available"]:
        for name, s in data["status"].items():
            assert s["load"] in ("ok", "fail")
            if s["load"] == "fail":
                assert s.get("error")
            else:
                # A model that loads is also probed for run success; the
                # badge distinguishes "runs" (green) from "loads" (amber).
                assert s.get("run") in ("ok", "fail")
                if s["run"] == "fail":
                    assert s.get("runError")
        # Second call is served from the per-commit cache.
        again = client.get("/api/psyneulink-examples/status").json()
        assert again.get("cached") is True
