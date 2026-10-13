"""Endpoint tests for the developer-mode pytest test loader (#274 / Phase 3 of #249).

Covers:

- GET /api/dev/tests — happy path, no-PNL fallback, missing tests subdir
- POST /api/dev/extract-test — happy path, file-not-found 404, unextractable 422

The discovery + extraction logic itself is covered in test_test_extractor.py;
these tests verify the HTTP surface and source-tree resolution.
"""

import textwrap
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.routes import _pnl_source_tree
from app.main import app

client = TestClient(app)


# ── /api/dev/tests ──────────────────────────────────────────────────────


def test_discover_happy_path(tmp_path):
    """Endpoint walks tests/composition under the resolved source tree and
    returns each discovered test as a structured DTO."""
    (tmp_path / "tests" / "composition").mkdir(parents=True)
    (tmp_path / "tests" / "composition" / "test_x.py").write_text(
        textwrap.dedent('''
            class TestThings:
                def test_one(self): pass
                def test_two(self): pass

            def test_module_level(): pass
        ''')
    )

    with patch("app.api.routes._pnl_source_tree", return_value=tmp_path):
        resp = client.get("/api/dev/tests")

    assert resp.status_code == 200
    body = resp.json()
    assert body["source_tree"] == str(tmp_path)

    qualified = sorted(t["qualified_name"] for t in body["tests"])
    assert qualified == ["TestThings.test_one", "TestThings.test_two", "test_module_level"]

    # DTO shape: each entry has file, class_name (nullable), method_name, qualified_name.
    module_level = next(t for t in body["tests"] if t["qualified_name"] == "test_module_level")
    assert module_level["class_name"] is None
    assert module_level["method_name"] == "test_module_level"


def test_discover_returns_empty_when_no_pnl():
    """Wheel installs or environments without PsyNeuLink return an empty list
    with source_tree=null — the frontend should surface this as 'install PNL
    from source to use developer tests', not as an error."""
    with patch("app.api.routes._pnl_source_tree", return_value=None):
        resp = client.get("/api/dev/tests")

    assert resp.status_code == 200
    assert resp.json() == {"tests": [], "source_tree": None}


def test_discover_returns_empty_when_subdir_missing(tmp_path):
    """If the source tree exists but tests/composition doesn't, discovery
    yields empty rather than 500. _pnl_source_tree gates on the directory
    existing, but a race between gating and walk should still degrade
    gracefully."""
    with patch("app.api.routes._pnl_source_tree", return_value=tmp_path):
        resp = client.get("/api/dev/tests")

    assert resp.status_code == 200
    assert resp.json() == {"tests": [], "source_tree": str(tmp_path)}


# ── /api/dev/extract-test ───────────────────────────────────────────────


def test_extract_happy_path(tmp_path):
    """Round-trip: write a simple parametrized test to disk, ask the endpoint
    to extract it, get back the standalone .py content and a suggested
    filename derived from the source stem + qualified name."""
    src = tmp_path / "test_simple.py"
    src.write_text(textwrap.dedent('''
        import pytest

        class TestThing:
            @pytest.mark.parametrize("x", [1, 2, 3])
            def test_it(self, x):
                assert x > 0
    '''))

    resp = client.post(
        "/api/dev/extract-test",
        json={"file": str(src), "qualified_name": "TestThing.test_it"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert "x = 1" in body["content"]  # first parametrize value picked
    assert body["suggested_filename"] == "test_simple__TestThing__test_it.py"


def test_extract_returns_404_when_file_missing(tmp_path):
    resp = client.post(
        "/api/dev/extract-test",
        json={"file": str(tmp_path / "nope.py"), "qualified_name": "X.y"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["reason"] == "not_found"


def test_extract_returns_422_for_unextractable(tmp_path):
    """A test with an unsupported fixture should surface as 422 (unprocessable
    entity) with a clear reason — the frontend shows this inline in the
    dropdown row, not as a generic toast."""
    src = tmp_path / "test_fixture.py"
    src.write_text(textwrap.dedent('''
        import pytest

        class TestThing:
            @pytest.mark.parametrize("x", [1, 2])
            def test_uses_fixture(self, x, some_fixture):
                pass
    '''))

    resp = client.post(
        "/api/dev/extract-test",
        json={"file": str(src), "qualified_name": "TestThing.test_uses_fixture"},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["reason"] == "unextractable"
    assert "some_fixture" in resp.json()["detail"]["message"]


# ── _pnl_source_tree resolution ─────────────────────────────────────────


def _make_tree_with_tests(root: Path) -> Path:
    (root / "tests" / "composition").mkdir(parents=True)
    return root


def test_resolver_prefers_env_override(tmp_path, monkeypatch):
    """An explicit PSYNEUVIEW_PNL_TESTS_ROOT wins over every other path —
    devs pointing at a specific checkout shouldn't be overridden by the
    Mac-app cache."""
    override = _make_tree_with_tests(tmp_path / "override")
    cached = _make_tree_with_tests(tmp_path / "cache" / "PsyNeuLink-someone")

    monkeypatch.setenv("PSYNEUVIEW_PNL_TESTS_ROOT", str(override))
    monkeypatch.setenv("PSYNEUVIEW_PNL_REPO", "someone/PsyNeuLink")
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path / "cache" / "..")

    assert _pnl_source_tree() == override


def test_resolver_falls_back_to_mac_app_cache(tmp_path, monkeypatch):
    """Without an env override, fall back to ~/.psyneuview/sources/PsyNeuLink-{owner}/
    where ``{owner}`` is parsed out of PSYNEUVIEW_PNL_REPO."""
    home = tmp_path / "home"
    cached = _make_tree_with_tests(home / ".psyneuview" / "sources" / "PsyNeuLink-jonhanke-nam")

    monkeypatch.delenv("PSYNEUVIEW_PNL_TESTS_ROOT", raising=False)
    monkeypatch.setenv("PSYNEUVIEW_PNL_REPO", "jonhanke-nam/PsyNeuLink")
    monkeypatch.setattr("pathlib.Path.home", lambda: home)

    assert _pnl_source_tree() == cached


def test_resolver_defaults_repo_owner_to_princeton(tmp_path, monkeypatch):
    """When PSYNEUVIEW_PNL_REPO is unset, the Mac-app cache lookup uses
    PrincetonUniversity as the default owner."""
    home = tmp_path / "home"
    cached = _make_tree_with_tests(home / ".psyneuview" / "sources" / "PsyNeuLink-PrincetonUniversity")

    monkeypatch.delenv("PSYNEUVIEW_PNL_TESTS_ROOT", raising=False)
    monkeypatch.delenv("PSYNEUVIEW_PNL_REPO", raising=False)
    monkeypatch.setattr("pathlib.Path.home", lambda: home)

    assert _pnl_source_tree() == cached


# ── developer_mode on /model/load and /models/save-as (#273) ───────────


def _script_that_records_run(tmp_path: Path) -> tuple[Path, Path]:
    """Tiny model whose module body calls .run() and writes a sentinel only
    when Composition.run actually executes (i.e. wasn't patched to a no-op).
    Shared with test_introspector but duplicated here so the endpoint tests
    don't reach across test packages."""
    sentinel = tmp_path / "ran.flag"
    script = tmp_path / "ran.py"
    script.write_text(
        f"""
import psyneulink as pnl

input_node = pnl.TransferMechanism(name='input_node')
output_node = pnl.TransferMechanism(name='output_node')
my_model = pnl.Composition(name='my_model')
my_model.add_node(input_node)
my_model.add_node(output_node)
my_model.add_projection(pnl.MappingProjection(sender=input_node, receiver=output_node))

result = my_model.run(inputs={{input_node: [[1.0]]}})
if result is not None:
    open(r"{sentinel}", "w").write("ran")
"""
    )
    return script, sentinel


def test_model_load_default_skips_run(tmp_path):
    """Default /model/load (no developer_mode field) leaves the run patches
    in place — the script's .run() is a no-op and the sentinel is never written."""
    script, sentinel = _script_that_records_run(tmp_path)
    resp = client.post("/api/model/load", json={"file_path": str(script)})
    assert resp.status_code == 200
    assert not sentinel.exists()
    assert len(resp.json()["model"]["compositions"]) == 1


def test_model_load_developer_mode_executes_run(tmp_path):
    """/model/load with developer_mode=true skips the patches — the script's
    .run() fires for real, sentinel is written, and we still get the graph."""
    script, sentinel = _script_that_records_run(tmp_path)
    resp = client.post(
        "/api/model/load",
        json={"file_path": str(script), "developer_mode": True},
    )
    assert resp.status_code == 200, resp.text
    assert sentinel.exists(), "Composition.run should have actually executed"
    assert len(resp.json()["model"]["compositions"]) == 1


def test_save_as_developer_mode_executes_run(tmp_path, monkeypatch):
    """/models/save-as with developer_mode=true runs the just-saved script
    as part of post-save introspection. This is the path the dev-tests
    loader uses to actually exercise an extracted pytest test (#274)."""
    from app.services import model_dirs
    from app.api import routes

    monkeypatch.setattr(model_dirs, "get_default_save_dir", lambda: tmp_path)
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)

    sentinel = tmp_path / "ran.flag"
    source = f"""
import psyneulink as pnl

input_node = pnl.TransferMechanism(name='input_node')
output_node = pnl.TransferMechanism(name='output_node')
my_model = pnl.Composition(name='my_model')
my_model.add_node(input_node)
my_model.add_node(output_node)
my_model.add_projection(pnl.MappingProjection(sender=input_node, receiver=output_node))

result = my_model.run(inputs={{input_node: [[1.0]]}})
if result is not None:
    open(r"{sentinel}", "w").write("ran")
"""
    resp = client.post(
        "/api/models/save-as",
        json={
            "source": source,
            "file_name": "dev_mode_save_as_test",
            "developer_mode": True,
        },
    )
    assert resp.status_code == 200, resp.text
    assert sentinel.exists(), "save-as should have run the saved script under developer_mode"
    assert len(resp.json()["model"]["compositions"]) == 1
