"""Tests for the REST API endpoints."""

import json
import pytest
import shutil
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app

TEST_MODEL = str(Path(__file__).parent.parent / "test_model.py")
client = TestClient(app)


@pytest.fixture
def tmp_model():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(Path(TEST_MODEL).read_text())
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_load_model():
    resp = client.post(
        "/api/model/load", json={"file_path": TEST_MODEL}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "model" in data
    assert "source" in data
    assert len(data["model"]["compositions"]) == 1


def test_load_model_bundle_lists_all_layout_variants(tmp_path):
    """#631: the file-switcher bundle must list every layout/label variant
    present on disk (each with its variant name), not just the default
    sidecar — and each variant must be fetchable by name."""
    model = tmp_path / "m.py"
    model.write_text(Path(TEST_MODEL).read_text())
    (tmp_path / "m.pnlview.json").write_text(json.dumps({"version": 1, "positions": {}}))
    (tmp_path / "m.1.pnlview.json").write_text(
        json.dumps({"version": 1, "positions": {}, "name": "1"})
    )

    resp = client.post("/api/model/load", json={"file_path": str(model)})
    assert resp.status_code == 200
    bundle = resp.json()["bundle"]
    layout_variants = {e["variant"] for e in bundle if e["kind"] == "layout"}
    assert layout_variants == {"Default", "1"}

    resp2 = client.post(
        "/api/model/sidecar",
        json={"file_path": str(model), "kind": "layout", "variant": "1"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "m.1.pnlview.json"


def test_load_model_not_found():
    resp = client.post(
        "/api/model/load", json={"file_path": "/nonexistent/model.py"}
    )
    assert resp.status_code == 404


def test_load_model_not_python(tmp_path):
    txt_file = tmp_path / "test.txt"
    txt_file.write_text("not python")
    resp = client.post(
        "/api/model/load", json={"file_path": str(txt_file)}
    )
    assert resp.status_code == 400


def test_update_param(tmp_model):
    resp = client.post(
        "/api/model/update-param",
        json={
            "file_path": tmp_model,
            "var_name": "response",
            "param_name": "gain",
            "new_value": "5.0",
            "context": "function",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "gain=5.0" in data["source"]


def test_update_function_type(tmp_model):
    resp = client.post(
        "/api/model/update-function-type",
        json={
            "file_path": tmp_model,
            "var_name": "response",
            "new_function_class": "Linear",
            "skip_introspect": True,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "function=pnl.Linear()" in data["source"]
    assert "input_shapes=[2]" in data["source"]


def test_update_function_type_rejects_bad_class(tmp_model):
    resp = client.post(
        "/api/model/update-function-type",
        json={
            "file_path": tmp_model,
            "var_name": "response",
            "new_function_class": "Linear; import os",
            "skip_introspect": True,
        },
    )
    assert resp.status_code == 400


def test_load_model_reports_no_dangling_for_clean_file():
    """Healthy test model: danglingProjections key is present and empty."""
    resp = client.post("/api/model/load", json={"file_path": TEST_MODEL})
    assert resp.status_code == 200
    data = resp.json()
    assert data["model"].get("danglingProjections") == []


def test_save_source_reports_dangling_when_endpoint_undefined(tmp_model):
    """Simulate the 'deleted-node' case: save source that references a
    non-existent receiver; verify the API surfaces it in the model dict."""
    broken_source = (
        "import psyneulink as pnl\n"
        "stimulus = pnl.TransferMechanism(name='stimulus', input_shapes=[2])\n"
        "broken_proj = pnl.MappingProjection(sender=stimulus, receiver=ghost)\n"
    )
    resp = client.post(
        "/api/model/save-source",
        json={"file_path": tmp_model, "source": broken_source},
    )
    assert resp.status_code == 200
    data = resp.json()
    dangling = data["model"]["danglingProjections"]
    assert len(dangling) == 1
    assert dangling[0]["varName"] == "broken_proj"
    assert dangling[0]["missingSide"] == "receiver"
    assert dangling[0]["missing"] == ["ghost"]


def test_save_source(tmp_model):
    new_source = Path(TEST_MODEL).read_text().replace("gain=1.0", "gain=9.0")
    resp = client.post(
        "/api/model/save-source",
        json={"file_path": tmp_model, "source": new_source},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["model"]["compositions"]) == 1


def test_save_as_creates_new_file(tmp_path):
    source = Path(TEST_MODEL).read_text()
    resp = client.post(
        "/api/models/save-as",
        json={"source": source, "file_name": "new_model.py", "directory": str(tmp_path)},
    )
    assert resp.status_code == 200
    target = tmp_path / "new_model.py"
    assert target.exists()
    assert resp.json()["file_path"] == str(target)


def test_save_as_collision_409_without_overwrite(tmp_path):
    (tmp_path / "existing.py").write_text("# already here")
    resp = client.post(
        "/api/models/save-as",
        json={"source": "# new", "file_name": "existing.py", "directory": str(tmp_path)},
    )
    assert resp.status_code == 409


def test_save_as_overwrites_with_flag(tmp_path):
    target = tmp_path / "existing.py"
    target.write_text("# old contents")
    source = Path(TEST_MODEL).read_text()
    resp = client.post(
        "/api/models/save-as",
        json={
            "source": source,
            "file_name": "existing.py",
            "directory": str(tmp_path),
            "overwrite": True,
        },
    )
    assert resp.status_code == 200
    assert target.read_text() == source


def test_input_nodes():
    resp = client.post(
        "/api/model/input-nodes",
        json={"file_path": TEST_MODEL, "composition_name": "stroop_model"},
    )
    assert resp.status_code == 200
    data = resp.json()
    names = [n["varName"] for n in data["inputNodes"]]
    assert "colors_input" in names
    assert "words_input" in names


def test_run_model():
    resp = client.post(
        "/api/model/run",
        json={
            "file_path": TEST_MODEL,
            "composition_name": "stroop_model",
            "inputs": {
                "colors_input": [[1.0, 0.0, 0.0]],
                "words_input": [[0.0, 0.0, 1.0]],
            },
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["numTrials"] == 1
    assert len(data["results"]) == 1
    assert len(data["logs"]) > 0


# --- MDF import ------------------------------------------------------------


@pytest.fixture(scope="module")
def mdf_json_bytes() -> bytes:
    """Serialize a tiny MDF Model to JSON bytes for upload tests.

    Composition.as_mdf_model() returns a Graph; generate_script_from_mdf
    expects a Model containing that graph, which is the canonical MDF form
    a real exporter would produce.
    """
    import psyneulink as pnl
    from modeci_mdf.mdf import Model

    a = pnl.TransferMechanism(name="a")
    b = pnl.TransferMechanism(name="b")
    comp = pnl.Composition(name="tiny_imported", pathways=[a, b])
    model = Model(id="tiny_imported_model")
    model.graphs.append(comp.as_mdf_model())
    return model.to_json().encode("utf-8")


@pytest.fixture
def cleanup_imported(tmp_path, monkeypatch):
    """Redirect imported models into a temp directory so tests don't pollute
    the user's models dir."""
    from app.services import model_dirs

    monkeypatch.setattr(model_dirs, "get_default_save_dir", lambda: tmp_path)
    # The route imports the symbol directly, so patch there too.
    from app.api import routes
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)
    yield tmp_path


def test_import_mdf_compound_extension(mdf_json_bytes, cleanup_imported):
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("tiny.mdf.json", mdf_json_bytes, "application/json")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["projectName"] == "tiny"
    assert data["sourceFormat"] == "mdf_json"
    assert data["warnings"] == []
    assert "psyneulink" in data["source"].lower()
    # File was written
    assert Path(data["file_path"]).exists()


def test_import_mdf_auto_applies_standard_format(mdf_yaml_bytes, cleanup_imported):
    """MDF imports land in Standard format by default (#94 task 1).

    The Python that ``generate_script_from_mdf`` produces is functionally
    correct but verbose. We run it through ``convert_to_standard_format``
    in-place so the user sees a clean, header-prefixed file by default.
    """
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("tiny.mdf.yaml", mdf_yaml_bytes, "application/x-yaml")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["isStandardized"] is True, data
    # The standard-format header is the canonical signal — ``is_standardized_format``
    # in services/converter.py keys on this exact prefix.
    assert data["source"].lstrip().startswith("# PsyNeuLink Model File"), data["source"][:200]
    # The on-disk file is the standardized version.
    assert Path(data["file_path"]).read_text().lstrip().startswith("# PsyNeuLink Model File")


def test_import_mdf_bare_json_emits_rename_warning(mdf_json_bytes, cleanup_imported):
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("tiny.json", mdf_json_bytes, "application/json")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert any("mdf.json" in w for w in data["warnings"]), data["warnings"]


def test_import_mdf_rejects_non_mdf_json(cleanup_imported):
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("config.json", b'{"not": "mdf"}', "application/json")},
    )
    assert resp.status_code == 400


def test_import_mdf_rejects_python_file(cleanup_imported):
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("model.py", b"import psyneulink\n", "text/x-python")},
    )
    assert resp.status_code == 400


@pytest.fixture(scope="module")
def mdf_yaml_bytes(mdf_json_bytes) -> bytes:
    """Same MDF Model serialized as YAML bytes."""
    from modeci_mdf.mdf import Model

    model = Model.from_json(mdf_json_bytes.decode("utf-8"))
    return model.to_yaml().encode("utf-8")


def test_import_mdf_yaml_roundtrip(mdf_yaml_bytes, cleanup_imported):
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("tiny.mdf.yaml", mdf_yaml_bytes, "application/x-yaml")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sourceFormat"] == "mdf_yaml"
    assert data["warnings"] == []


def test_import_mdf_introspected_model_has_composition(mdf_json_bytes, cleanup_imported):
    """End-to-end: uploaded MDF → script → introspected model has the
    expected composition with two TransferMechanism nodes."""
    resp = client.post(
        "/api/model/import-mdf",
        files={"file": ("tiny.mdf.json", mdf_json_bytes, "application/json")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    comps = data["model"].get("compositions", [])
    assert len(comps) == 1, f"expected 1 composition, got {len(comps)}: {comps}"
    comp = comps[0]
    # PsyNeuLink may suffix duplicate names with "-N" across the test session,
    # so just verify the count of nodes and that they start with the expected
    # base names.
    node_names = [n.get("varName") or n.get("name") for n in comp.get("nodes", [])]
    assert len(node_names) == 2, node_names
    bases = sorted(n.split("-")[0] for n in node_names)
    assert bases == ["a", "b"], node_names


# --- MDF export ------------------------------------------------------------


def test_export_mdf_yaml_default():
    """No composition_name and no fmt → defaults to first composition + YAML."""
    resp = client.post("/api/model/export-mdf", json={"file_path": TEST_MODEL})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/x-yaml")
    # Filename is derived from the source .py basename, matching frontend behavior.
    assert "test_model.mdf.yaml" in resp.headers.get("content-disposition", "")
    text = resp.text
    # A valid MDF YAML export should round-trip through modeci_mdf.
    from modeci_mdf.mdf import Model
    model = Model.from_yaml(text)
    assert len(model.graphs) >= 1
    # PsyNeuLink may suffix duplicate composition names within a session
    # (e.g. "stroop_model_1"); accept any id that starts with the base name.
    assert any(g.id.startswith("stroop_model") for g in model.graphs)


def test_export_mdf_json_explicit():
    resp = client.post(
        "/api/model/export-mdf",
        json={
            "file_path": TEST_MODEL,
            "composition_name": "stroop_model",
            "fmt": "json",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert "test_model.mdf.json" in resp.headers.get("content-disposition", "")
    # JSON parses; MDF Model parses; expected graph present.
    import json as _json
    payload = _json.loads(resp.text)
    assert isinstance(payload, dict) and len(payload) >= 1
    from modeci_mdf.mdf import Model
    model = Model.from_json(resp.text)
    assert any(g.id.startswith("stroop_model") for g in model.graphs)


def test_export_mdf_unknown_format():
    resp = client.post(
        "/api/model/export-mdf",
        json={"file_path": TEST_MODEL, "fmt": "xml"},
    )
    assert resp.status_code == 400
    assert "Unsupported MDF format" in resp.json()["detail"]


def test_export_mdf_missing_file():
    resp = client.post(
        "/api/model/export-mdf",
        json={"file_path": "/nonexistent/model.py"},
    )
    assert resp.status_code == 404


def test_export_mdf_no_composition_in_file(tmp_path):
    """A .py file without any Composition should yield 400, not crash."""
    bare = tmp_path / "no_comp.py"
    bare.write_text("import psyneulink as pnl\nx = 1\n")
    resp = client.post("/api/model/export-mdf", json={"file_path": str(bare)})
    assert resp.status_code == 400
    assert "Composition" in resp.json()["detail"]


def test_export_mdf_when_var_name_differs_from_composition_name(tmp_path):
    """Regression test for #106.

    When the module-level variable name differs from the Composition's
    ``.name`` (e.g. ``comp = pnl.Composition(name='test_model')``), the
    sandbox introspector used to report the cleaned ``.name`` as
    ``varName``. The export route then sent that string to the sandbox,
    which does ``getattr(module, varName)`` — and failed with
    "Composition 'test_model' not found".

    This exercises the live sandbox path (not in-process) so that the
    keying drift between sandbox and in-process introspectors can't
    silently regress again.
    """
    src = tmp_path / "differing_var.py"
    src.write_text(
        "import psyneulink as pnl\n"
        "a = pnl.TransferMechanism(input_shapes=[1], name='a')\n"
        "b = pnl.TransferMechanism(input_shapes=[1], name='b')\n"
        "proj = pnl.MappingProjection(sender=a, receiver=b, name='proj')\n"
        "comp = pnl.Composition(name='different_model')\n"
        "comp.add_node(a)\n"
        "comp.add_node(b)\n"
        "comp.add_projection(proj)\n"
    )
    # Frontend never sends composition_name — the route resolves it from
    # introspection. That's the path this regression guards.
    resp = client.post("/api/model/export-mdf", json={"file_path": str(src)})
    assert resp.status_code == 200, resp.text
    from modeci_mdf.mdf import Model
    model = Model.from_yaml(resp.text)
    # PsyNeuLink may suffix the graph id within a session (different_model_1).
    assert any(g.id.startswith("different_model") for g in model.graphs), [g.id for g in model.graphs]


# --- MDF roundtrip (export ↔ import contract) ----------------------------


@pytest.mark.parametrize("fmt,ctype", [("yaml", "x-yaml"), ("json", "json")])
def test_mdf_export_then_import_roundtrip(fmt, ctype, tmp_path, monkeypatch):
    """Export a model to MDF, upload it via /import-mdf, assert structure
    survives. Pins the contract between #79 (import) and #81 (export)."""
    from app.services import model_dirs
    from app.api import routes
    monkeypatch.setattr(model_dirs, "get_default_save_dir", lambda: tmp_path)
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)

    # Export
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": TEST_MODEL, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    assert ctype in r.headers["content-type"]
    mdf_bytes = r.content

    # Re-import
    upload_name = f"roundtrip.mdf.{fmt}"
    r = client.post(
        "/api/model/import-mdf",
        files={"file": (upload_name, mdf_bytes, r.headers["content-type"])},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["sourceFormat"] == f"mdf_{fmt}"

    # Structural check: imported model has at least one composition with
    # the expected mechanisms (PsyNeuLink may suffix names per session
    # with either ``_N`` or ``-N``).
    comps = data["model"].get("compositions", [])
    assert len(comps) >= 1, comps
    node_names = [
        n.get("varName") or n.get("name")
        for n in comps[0].get("nodes", [])
    ]
    import re as _re
    suffix_re = _re.compile(r"[-_]\d+$")

    def _strip(n: str) -> str:
        prev = None
        while prev != n:
            prev = n
            n = suffix_re.sub("", n)
        return n

    canonical = {_strip(n) for n in node_names if n}
    # test_model.py defines colors_input, words_input, response.
    assert {"colors_input", "words_input", "response"} <= canonical, node_names


# --- #82: nested Compositions in MDF (detect-and-warn) --------------------


NESTED_FIXTURE = str(Path(__file__).parent / "fixtures" / "nested_compositions.py")


def test_detect_nested_compositions_unit():
    """The detector recognizes both signatures PsyNeuLink's export emits for
    a nested Composition: ``metadata.type == "Composition"`` and a
    non-standard nested ``nodes`` dict on a graph node."""
    import json

    from app.services.mdf_metadata import detect_nested_compositions

    def mdf(nodes: dict) -> str:
        return json.dumps(
            {"outer": {"graphs": {"outer": {"nodes": nodes, "edges": {}}}}}
        )

    by_type = mdf({
        "plain": {"metadata": {"type": "TransferMechanism"}},
        "inner_comp": {"metadata": {"type": "Composition"}},
    })
    assert detect_nested_compositions(by_type, "json") == ["inner_comp"]

    by_nested_nodes = mdf({
        "plain": {"metadata": {"type": "TransferMechanism"}},
        "inner_comp": {"nodes": {"inner_a": {}}},
    })
    assert detect_nested_compositions(by_nested_nodes, "json") == ["inner_comp"]

    flat = mdf({
        "a": {"metadata": {"type": "TransferMechanism"}},
        "b": {"metadata": {"type": "ProcessingMechanism"}},
    })
    assert detect_nested_compositions(flat, "json") == []

    # Garbage / non-MDF inputs never raise.
    assert detect_nested_compositions("{not json", "json") == []
    assert detect_nested_compositions("- [unclosed", "yaml") == []
    assert detect_nested_compositions("", "json") == []
    assert detect_nested_compositions("plain text", "unknown") == []


@pytest.mark.parametrize("fmt,ctype", [("yaml", "x-yaml"), ("json", "json")])
def test_mdf_nested_composition_detected_on_export_and_import(fmt, ctype, tmp_path, monkeypatch):
    """#82: nested Compositions don't survive PsyNeuLink's MDF round-trip —
    export "succeeds" but writes the inner Composition as an opaque node and
    drops boundary projections; re-import then crashes inside
    ``generate_script_from_mdf``. Pin the detect-and-warn contract: the
    exported text trips the detector, and the import failure names the
    nested Composition and links the upstream issue instead of surfacing a
    cryptic TypeError."""
    from app.api import routes
    from app.services import model_dirs
    from app.services.mdf_metadata import detect_nested_compositions

    monkeypatch.setattr(model_dirs, "get_default_save_dir", lambda: tmp_path)
    monkeypatch.setattr(routes, "get_default_save_dir", lambda: tmp_path)

    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": NESTED_FIXTURE, "fmt": fmt, "composition_name": "outer_comp"},
    )
    assert r.status_code == 200, r.text
    mdf_bytes = r.content

    detected = detect_nested_compositions(mdf_bytes.decode("utf-8"), fmt)
    assert any(d.startswith("inner_comp") for d in detected), detected

    r = client.post(
        "/api/model/import-mdf",
        files={"file": (f"nested.mdf.{fmt}", mdf_bytes, r.headers["content-type"])},
    )
    if r.status_code == 200:
        # If PsyNeuLink ever learns to import nested MDF, the data-loss
        # warning must still be surfaced (and this test should be revisited
        # — see jonhanke-nam/PsyNeuLink#3).
        warnings = r.json().get("warnings", [])
        assert any("nested Composition" in w for w in warnings), warnings
    else:
        assert r.status_code == 400, r.text
        detail = r.json()["detail"]
        assert "nested Composition" in detail, detail
        assert "jonhanke-nam/PsyNeuLink/issues/3" in detail, detail


# --- #86: PsyNeuView metadata bridge (.pnlview.json ↔ metadata.psyneuview)


@pytest.fixture
def tmp_model_no_sidecar(tmp_path):
    """A model copied to a fresh dir, guaranteed to have no .pnlview.json.

    Lives under ``source/`` so it's separate from the import destination —
    tests that import into ``tmp_path`` can scan for sidecars without
    seeing the source fixture's own files.
    """
    src = Path(TEST_MODEL).read_text()
    src_dir = tmp_path / "source"
    src_dir.mkdir(exist_ok=True)
    dest = src_dir / "no_sidecar_model.py"
    dest.write_text(src)
    return str(dest)


@pytest.fixture
def tmp_model_with_sidecar(tmp_path):
    """A model copied to a fresh dir, with a known sidecar attached.

    Lives under ``source/`` (see tmp_model_no_sidecar).
    """
    src = Path(TEST_MODEL).read_text()
    src_dir = tmp_path / "source"
    src_dir.mkdir(exist_ok=True)
    dest = src_dir / "with_sidecar_model.py"
    dest.write_text(src)
    sidecar = dest.with_suffix(".pnlview.json")
    sidecar.write_text(json.dumps({
        "version": 1,
        "positions": {
            "colors_input": {"x": 100.0, "y": 200.0},
            "words_input": {"x": 300.0, "y": 400.0},
            "response": {"x": 500.0, "y": 600.0},
        },
        "viewport": {"x": 10, "y": 20, "zoom": 1.5},
    }))
    return str(dest)


def _parse_mdf(text: str, fmt: str):
    """Parse exported MDF text back into a Model for assertions."""
    from modeci_mdf.mdf import Model
    return Model.from_yaml(text) if fmt == "yaml" else Model.from_json(text)


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_export_mdf_embeds_psyneuview_metadata_when_sidecar_present(fmt, tmp_model_with_sidecar):
    """Sidecar present → exported MDF carries metadata.psyneuview.layout."""
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_with_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    model = _parse_mdf(r.text, fmt)
    md = getattr(model, "metadata", None) or {}
    assert isinstance(md, dict) and "psyneuview" in md, md
    pv = md["psyneuview"]
    assert pv["version"] == 1
    assert pv["layout"]["colors_input"] == {"x": 100.0, "y": 200.0}
    assert pv["viewport"] == {"x": 10, "y": 20, "zoom": 1.5}


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_export_mdf_omits_metadata_when_no_sidecar(fmt, tmp_model_no_sidecar):
    """No sidecar → MDF has no psyneuview namespace (clean foreign output)."""
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_no_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    model = _parse_mdf(r.text, fmt)
    md = getattr(model, "metadata", None) or {}
    if isinstance(md, dict):
        assert "psyneuview" not in md, md


def _canonical_position_map(saved_positions: dict) -> dict:
    """Strip trailing PsyNeuLink instance suffixes (``_N``/``-N``) from keys.

    Both forms can appear: ``_N`` from ``generate_script_from_mdf`` when a
    var name collides in the registry, and ``-N`` from PsyNeuLink itself
    on duplicate ``mech.name``. Strip repeatedly so stacked suffixes
    (``foo_1-2``) collapse to canonical.
    """
    import re as _re
    pattern = _re.compile(r"[-_]\d+$")
    out = {}
    for k, v in saved_positions.items():
        canon = k
        prev = None
        while prev != canon:
            prev = canon
            canon = pattern.sub("", canon)
        out[canon] = v
    return out


def _imported_sidecars(import_dir) -> list:
    """Layout sidecars the import wrote, at either placement (#927): lateral in
    the import dir itself, or in its hidden ``.psyneuview/`` dot-folder. Not
    recursive — so it never picks up the *source* model's own sidecar that the
    ``tmp_model_with_sidecar`` fixture leaves in a ``source/`` subdir."""
    d = Path(import_dir)
    return sorted(d.glob("*.pnlview.json")) + sorted(
        (d / ".psyneuview").glob("*.pnlview.json")
    )


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_import_mdf_with_psyneuview_metadata_writes_sidecar(fmt, tmp_model_with_sidecar, cleanup_imported):
    """MDF carrying metadata.psyneuview → import re-creates the sidecar.

    The saved sidecar uses *live* (suffixed) node names so the frontend
    can look them up directly. We assert by canonical (stripped) key
    because the suffix value depends on PsyNeuLink session state.
    """
    # Export with sidecar to get an MDF that carries the metadata block.
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_with_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    mdf_bytes = r.content
    upload_name = f"with_layout.mdf.{fmt}"
    ctype = r.headers["content-type"]

    r = client.post(
        "/api/model/import-mdf",
        files={"file": (upload_name, mdf_bytes, ctype)},
    )
    assert r.status_code == 200, r.text

    # The route saved the import under cleanup_imported (tmp_path).
    sidecars = _imported_sidecars(cleanup_imported)
    assert len(sidecars) == 1, sidecars
    saved = json.loads(sidecars[0].read_text())
    canonical = _canonical_position_map(saved["positions"])
    assert canonical["colors_input"] == {"x": 100.0, "y": 200.0}
    assert saved["viewport"] == {"x": 10, "y": 20, "zoom": 1.5}


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_import_foreign_mdf_writes_no_sidecar(fmt, tmp_model_no_sidecar, cleanup_imported):
    """Foreign MDF (no psyneuview namespace) → import succeeds, no sidecar."""
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_no_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    mdf_bytes = r.content
    ctype = r.headers["content-type"]

    r = client.post(
        "/api/model/import-mdf",
        files={"file": (f"foreign.mdf.{fmt}", mdf_bytes, ctype)},
    )
    assert r.status_code == 200, r.text
    assert _imported_sidecars(cleanup_imported) == []


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_import_mdf_unknown_metadata_version_ignored(fmt, tmp_model_with_sidecar, cleanup_imported):
    """Unknown metadata version → forward-compat guard skips restoration."""
    # Export, then mutate the version in the parsed model and re-serialize.
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_with_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    model = _parse_mdf(r.text, fmt)
    model.metadata["psyneuview"]["version"] = 999
    text = model.to_yaml() if fmt == "yaml" else model.to_json()
    ctype = r.headers["content-type"]

    r = client.post(
        "/api/model/import-mdf",
        files={"file": (f"future.mdf.{fmt}", text.encode("utf-8"), ctype)},
    )
    assert r.status_code == 200, r.text
    assert _imported_sidecars(cleanup_imported) == []


@pytest.mark.parametrize("fmt", ["yaml", "json"])
def test_mdf_roundtrip_preserves_positions(fmt, tmp_model_with_sidecar, cleanup_imported):
    """End-to-end: export with positions → import → sidecar matches."""
    r = client.post(
        "/api/model/export-mdf",
        json={"file_path": tmp_model_with_sidecar, "fmt": fmt},
    )
    assert r.status_code == 200, r.text
    mdf_bytes = r.content
    ctype = r.headers["content-type"]

    r = client.post(
        "/api/model/import-mdf",
        files={"file": (f"rt.mdf.{fmt}", mdf_bytes, ctype)},
    )
    assert r.status_code == 200, r.text

    sidecars = _imported_sidecars(cleanup_imported)
    assert len(sidecars) == 1, sidecars
    saved = json.loads(sidecars[0].read_text())
    # Positions round-trip after canonicalizing the session suffix
    # PsyNeuLink adds during MDF re-instantiation.
    assert _canonical_position_map(saved["positions"]) == {
        "colors_input": {"x": 100.0, "y": 200.0},
        "words_input": {"x": 300.0, "y": 400.0},
        "response": {"x": 500.0, "y": 600.0},
    }
    # Saved keys are *live* names (with PsyNeuLink's session suffix), not
    # the originals from the source sidecar. This is what makes the
    # frontend lookup actually hit when the imported model is loaded.
    imported_data = r.json()
    live_names = {
        n.get("varName") or n.get("name")
        for comp in (imported_data["model"].get("compositions") or [])
        for n in comp.get("nodes", [])
    }
    saved_keys = set(saved["positions"].keys())
    assert saved_keys.issubset(live_names), (saved_keys, live_names)


# --- remap_layout_to_live_names (#86 unit test) -------------------------


def test_remap_layout_to_live_names_handles_suffixes():
    """Sidecar keys (un-suffixed) get paired with live names (suffixed)."""
    from app.services.mdf_metadata import remap_layout_to_live_names
    layout = {
        "color_input": {"x": 1, "y": 2},
        "decision": {"x": 3, "y": 4},
    }
    live = ["color_input_1", "decision_1"]
    assert remap_layout_to_live_names(layout, live) == {
        "color_input_1": {"x": 1, "y": 2},
        "decision_1": {"x": 3, "y": 4},
    }


def test_remap_layout_to_live_names_already_aligned():
    """No-op when sidecar and live names already match (no MDF detour)."""
    from app.services.mdf_metadata import remap_layout_to_live_names
    layout = {"a": {"x": 0, "y": 0}}
    assert remap_layout_to_live_names(layout, ["a"]) == {"a": {"x": 0, "y": 0}}


def test_remap_layout_to_live_names_drops_orphans():
    """Sidecar keys with no live counterpart are dropped silently."""
    from app.services.mdf_metadata import remap_layout_to_live_names
    layout = {"gone": {"x": 9, "y": 9}, "stays": {"x": 1, "y": 1}}
    assert remap_layout_to_live_names(layout, ["stays_2"]) == {
        "stays_2": {"x": 1, "y": 1},
    }


# ── Demo origin metadata (#40) ─────────────────────────────────────────


def test_demos_reset_stamps_origin_in_sidecar():
    """After /demos/reset, the sidecar names the demo we came from."""
    resp = client.post("/api/demos/reset", json={"demo_name": "scheduling_demo"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["layout"] is not None
    assert data["layout"]["demo_origin"] == "scheduling_demo"


def test_demos_pristine_returns_unmodified_source():
    """/demos/pristine reads the demo file in backend/demos/ without writing."""
    resp = client.get("/api/demos/pristine", params={"name": "scheduling_demo"})
    assert resp.status_code == 200
    body = resp.json()
    assert "source" in body
    assert isinstance(body["source"], str)
    assert len(body["source"]) > 0


def test_demos_pristine_unknown_demo_404s():
    resp = client.get("/api/demos/pristine", params={"name": "no_such_demo"})
    assert resp.status_code == 404


# ── PsyNeuLink library models (#20) ────────────────────────────────────


def test_library_models_returns_curated_set():
    resp = client.get("/api/library-models")
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    names = {m["name"] for m in data["models"]}
    # The full library package should be present when PsyNeuLink is installed —
    # including EGO, which the construct_model() factory loader materializes (#855).
    assert names == {
        "Botvinick_conflict_monitoring_model",
        "Cohen_Huston1994",
        "Cohen_Huston1994_horse_race",
        "Giallanza2024_EGO_Study2",
        "GilzenratModel",
        "Kalanthroff_PCTC_2018",
        "MontagueDayanSejnowski96",
        "Nieuwenhuis2005Model",
    }


def test_library_models_entries_have_expected_shape():
    resp = client.get("/api/library-models")
    data = resp.json()
    for entry in data["models"]:
        assert set(entry.keys()) == {"name", "label", "path"}
        assert entry["label"]  # non-empty display label
        assert entry["path"].endswith(f"{entry['name']}.py")
        assert Path(entry["path"]).is_file()


def test_library_models_skips_when_psyneulink_missing(monkeypatch):
    """Endpoint returns an empty list, not a 500, when PsyNeuLink isn't importable."""
    from app.api import routes
    monkeypatch.setattr(routes, "_library_models_dir", lambda: None)
    resp = client.get("/api/library-models")
    assert resp.status_code == 200
    assert resp.json() == {"models": []}


# ============================================================
# Port management endpoints (#198)
# ============================================================


def test_rename_port_input(tmp_model):
    resp = client.post(
        "/api/model/rename-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "input",
            "current_names": ["InputPort-0"],
            "old_name": "InputPort-0",
            "new_name": "MY_INPUT",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "input_ports=['MY_INPUT']" in data["source"]


def test_rename_port_output(tmp_model):
    resp = client.post(
        "/api/model/rename-port",
        json={
            "file_path": tmp_model,
            "var_name": "response",
            "port_kind": "output",
            "current_names": ["RESULT"],
            "old_name": "RESULT",
            "new_name": "MY_OUTPUT",
        },
    )
    assert resp.status_code == 200
    assert "output_ports=['MY_OUTPUT']" in resp.json()["source"]


def test_rename_port_bad_kind_returns_422(tmp_model):
    # port_kind is constrained to Literal["input", "output"] — anything else
    # should fail FastAPI validation before reaching the handler.
    resp = client.post(
        "/api/model/rename-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "parameter",
            "current_names": ["x"],
            "old_name": "x",
            "new_name": "y",
        },
    )
    assert resp.status_code == 422


def test_rename_port_unknown_port_returns_400(tmp_model):
    resp = client.post(
        "/api/model/rename-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "input",
            "current_names": ["InputPort-0"],
            "old_name": "nope",
            "new_name": "z",
        },
    )
    assert resp.status_code == 400


def test_add_port(tmp_model):
    resp = client.post(
        "/api/model/add-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "input",
            "current_names": ["InputPort-0"],
            "new_name": "EXTRA_IN",
        },
    )
    assert resp.status_code == 200
    assert "input_ports=['InputPort-0', 'EXTRA_IN']" in resp.json()["source"]


def test_add_port_duplicate_returns_400(tmp_model):
    resp = client.post(
        "/api/model/add-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "input",
            "current_names": ["InputPort-0"],
            "new_name": "InputPort-0",
        },
    )
    assert resp.status_code == 400


def test_remove_port_last_port_returns_400(tmp_model):
    # Default test model has one input port per mechanism — removing the
    # last is refused.
    resp = client.post(
        "/api/model/remove-port",
        json={
            "file_path": tmp_model,
            "var_name": "colors_input",
            "port_kind": "input",
            "current_names": ["InputPort-0"],
            "port_name": "InputPort-0",
        },
    )
    assert resp.status_code == 400


def test_remove_port_drops_named():
    # Build a temp model with multiple input ports so remove can succeed.
    src = (
        "import psyneulink as pnl\n"
        "m = pnl.TransferMechanism(input_ports=['a', 'b'], name='m')\n"
        "comp = pnl.Composition(name='c')\n"
        "comp.add_node(m)\n"
    )
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write(src)
        path = f.name
    try:
        resp = client.post(
            "/api/model/remove-port",
            json={
                "file_path": path,
                "var_name": "m",
                "port_kind": "input",
                "current_names": ["a", "b"],
                "port_name": "a",
            },
        )
        assert resp.status_code == 200
        assert "input_ports=['b']" in resp.json()["source"]
    finally:
        Path(path).unlink(missing_ok=True)


# --- #482 (479b): named layout/settings variant management API


def test_load_model_includes_sidecars():
    """Model-load response carries the merged variant view (479b)."""
    resp = client.post("/api/model/load", json={"file_path": TEST_MODEL})
    assert resp.status_code == 200
    sc = resp.json()["sidecars"]
    assert set(sc) == {"layouts", "activeLayout", "settings", "activeSetting", "placement"}
    # Placement state (#933): effective location + inherited-vs-explicit override.
    assert sc["placement"]["effective"] in ("lateral", "dotfolder")
    assert "perModel" in sc["placement"]


def test_sidecar_variant_lifecycle(tmp_model_no_sidecar):
    """Create → set-active → rename → duplicate → reorder → delete (layout)."""
    fp = tmp_model_no_sidecar

    def names():
        r = client.post("/api/model/sidecars/list", json={"file_path": fp})
        assert r.status_code == 200, r.text
        return [e["name"] for e in r.json()["layouts"]], r.json()["activeLayout"]

    # Create a variant — becomes active.
    r = client.post(
        "/api/model/sidecars/create",
        json={"file_path": fp, "kind": "layout", "name": "compact"},
    )
    assert r.status_code == 200, r.text
    ns, active = names()
    assert "compact" in ns and active == "compact"

    # Rename it; active follows.
    r = client.post(
        "/api/model/sidecars/rename",
        json={"file_path": fp, "kind": "layout", "name": "compact", "new_name": "tidy"},
    )
    assert r.status_code == 200, r.text
    ns, active = names()
    assert "tidy" in ns and "compact" not in ns and active == "tidy"

    # Duplicate; active unchanged.
    r = client.post(
        "/api/model/sidecars/duplicate",
        json={"file_path": fp, "kind": "layout", "name": "tidy", "new_name": "copy"},
    )
    assert r.status_code == 200, r.text
    ns, active = names()
    assert {"tidy", "copy"} <= set(ns) and active == "tidy"

    # Reorder to the exact current permutation.
    r = client.post(
        "/api/model/sidecars/reorder",
        json={"file_path": fp, "kind": "layout", "names": list(reversed(ns))},
    )
    assert r.status_code == 200, r.text

    # Delete one; survives.
    r = client.post(
        "/api/model/sidecars/delete",
        json={"file_path": fp, "kind": "layout", "name": "copy"},
    )
    assert r.status_code == 200, r.text
    ns, _ = names()
    assert "copy" not in ns and "tidy" in ns


def test_sidecar_create_invalid_name_400(tmp_model_no_sidecar):
    """A filesystem-unsafe variant name is rejected as a 400, not a 500."""
    r = client.post(
        "/api/model/sidecars/create",
        json={"file_path": tmp_model_no_sidecar, "kind": "layout", "name": "bad/name"},
    )
    assert r.status_code == 400, r.text


def test_sidecar_rename_default_rejected(tmp_model_no_sidecar):
    """The reserved Default variant cannot be renamed (400)."""
    r = client.post(
        "/api/model/sidecars/rename",
        json={
            "file_path": tmp_model_no_sidecar,
            "kind": "layout",
            "name": "Default",
            "new_name": "whatever",
        },
    )
    assert r.status_code == 400, r.text


def test_load_and_resolve_honor_active_layout_variant(tmp_model_no_sidecar):
    """A non-default active layout is what /load and /resolve return (#483)."""
    fp = tmp_model_no_sidecar
    marker = {"colors_input": {"x": 11.0, "y": 22.0}}

    # Create a variant, give it distinct positions, and make it active.
    assert client.post(
        "/api/model/sidecars/create",
        json={"file_path": fp, "kind": "layout", "name": "compact"},
    ).status_code == 200
    assert client.post(
        "/api/model/save-sidecar",
        json={
            "file_path": fp,
            "kind": "layout",
            "variant": "compact",
            "content": json.dumps({"version": 1, "positions": marker, "name": "compact"}),
        },
    ).status_code == 200

    # /load opens in the active variant.
    r = client.post("/api/model/load", json={"file_path": fp})
    assert r.status_code == 200, r.text
    assert r.json()["sidecars"]["activeLayout"] == "compact"
    assert r.json()["layout"]["positions"] == marker

    # /resolve returns the same active layout for targeted re-apply.
    r = client.post("/api/model/sidecars/resolve", json={"file_path": fp})
    assert r.status_code == 200, r.text
    assert r.json()["layout"]["positions"] == marker
