"""Tests for .pnlproject bundle export and import."""

import io
import json
import tempfile
import zipfile
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


SIMPLE_MODEL = """\
# PsyNeuLink Model File
# Format Version: 1.0
# Model: test_model

import psyneulink as pnl

a = pnl.TransferMechanism(input_shapes=[1], name='a')
b = pnl.TransferMechanism(input_shapes=[1], name='b')
proj = pnl.MappingProjection(sender=a, receiver=b, name='a_to_b')
comp = pnl.Composition(name='test_model')
comp.add_node(a)
comp.add_node(b)
comp.add_projection(proj)
"""


@pytest.fixture
def model_file(tmp_path):
    """Create a temp model file."""
    p = tmp_path / "test_model.py"
    p.write_text(SIMPLE_MODEL)
    return str(p)


class TestProjectExport:
    def test_export_creates_valid_zip(self, model_file):
        resp = client.post("/api/model/export-project", json={"file_path": model_file})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"

        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert "manifest.json" in zf.namelist()
        assert "model.py" in zf.namelist()

    def test_export_manifest_has_required_fields(self, model_file):
        resp = client.post("/api/model/export-project", json={"file_path": model_file})
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        manifest = json.loads(zf.read("manifest.json"))

        assert "formatVersion" in manifest
        assert manifest["formatVersion"] == "2.0"
        assert "model" in manifest
        assert manifest["model"]["name"] == "test_model"
        assert "files" in manifest
        assert manifest["files"]["source"] == "model.py"
        # v2 declares the reserved slots so readers know the shape (#348).
        assert "weights" in manifest["files"]
        assert "runData" in manifest["files"]
        assert "mdf" in manifest["files"]

    def test_export_contains_source(self, model_file):
        resp = client.post("/api/model/export-project", json={"file_path": model_file})
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        source = zf.read("model.py").decode("utf-8")
        assert "import psyneulink as pnl" in source
        assert "test_model" in source

    def test_export_filename_in_header(self, model_file):
        resp = client.post("/api/model/export-project", json={"file_path": model_file})
        disp = resp.headers.get("content-disposition", "")
        assert "test_model.pnlproject" in disp


class TestProjectImport:
    def _make_bundle(self, source=SIMPLE_MODEL, name="test_model"):
        buf = io.BytesIO()
        manifest = {
            "formatVersion": "1.0",
            "psyneulink": "0.18.0.0",
            "model": {"name": name, "description": ""},
            "files": {"source": "model.py", "layout": None, "weights": []},
        }
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("manifest.json", json.dumps(manifest))
            zf.writestr("model.py", source)
        buf.seek(0)
        return buf

    def test_import_returns_model(self):
        bundle = self._make_bundle()
        resp = client.post(
            "/api/model/import-project",
            files={"file": ("test.pnlproject", bundle, "application/zip")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "model" in data
        assert "source" in data
        assert "file_path" in data
        assert data["projectName"] == "test_model"

    def test_import_creates_file(self):
        bundle = self._make_bundle(name="import_test_unique")
        resp = client.post(
            "/api/model/import-project",
            files={"file": ("test.pnlproject", bundle, "application/zip")},
        )
        data = resp.json()
        assert Path(data["file_path"]).exists()

    def test_import_rejects_non_pnlproject(self):
        buf = io.BytesIO(b"not a zip")
        resp = client.post(
            "/api/model/import-project",
            files={"file": ("test.txt", buf, "text/plain")},
        )
        assert resp.status_code == 400

    def test_import_rejects_missing_manifest(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("model.py", "import psyneulink as pnl")
        buf.seek(0)
        resp = client.post(
            "/api/model/import-project",
            files={"file": ("test.pnlproject", buf, "application/zip")},
        )
        assert resp.status_code == 400


class TestRoundTrip:
    def test_export_import_preserves_model(self, model_file):
        # Export
        export_resp = client.post("/api/model/export-project", json={"file_path": model_file})
        assert export_resp.status_code == 200

        # Import
        import_resp = client.post(
            "/api/model/import-project",
            files={"file": ("roundtrip.pnlproject", io.BytesIO(export_resp.content), "application/zip")},
        )
        assert import_resp.status_code == 200
        data = import_resp.json()

        # Verify model was preserved
        assert "import psyneulink as pnl" in data["source"]
        assert len(data["model"].get("compositions", [])) >= 1


class TestOpenSaveRoundTrip:
    """The #348 in-place round-trip: open a .pnlproject, edit, save back."""

    @pytest.fixture
    def bundle_on_disk(self, tmp_path, model_file):
        """Export model_file to a real .pnlproject sitting on disk."""
        resp = client.post("/api/model/export-project", json={"file_path": model_file})
        assert resp.status_code == 200
        bundle_path = tmp_path / "roundtrip.pnlproject"
        bundle_path.write_bytes(resp.content)
        return bundle_path

    def test_open_extracts_to_working_dir(self, bundle_on_disk, tmp_path, monkeypatch):
        monkeypatch.setenv("PSYNEUVIEW_BUNDLES_ROOT", str(tmp_path / "bundles"))
        resp = client.post(
            "/api/model/open-project", json={"bundle_path": str(bundle_on_disk)}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bundleOrigin"] == str(bundle_on_disk)
        assert data["file_path"].endswith(".py")
        assert Path(data["file_path"]).exists()
        assert "import psyneulink as pnl" in data["source"]
        assert len(data["model"].get("compositions", [])) >= 1

    def test_open_rejects_non_bundle(self, model_file):
        resp = client.post("/api/model/open-project", json={"bundle_path": model_file})
        assert resp.status_code == 400

    def test_save_back_updates_origin_bundle(self, bundle_on_disk, tmp_path, monkeypatch):
        monkeypatch.setenv("PSYNEUVIEW_BUNDLES_ROOT", str(tmp_path / "bundles"))
        opened = client.post(
            "/api/model/open-project", json={"bundle_path": str(bundle_on_disk)}
        ).json()
        working = opened["file_path"]

        edited = opened["source"] + "\n# edited in place\n"
        save = client.post(
            "/api/model/save-project",
            json={
                "file_path": working,
                "source": edited,
                "bundle_path": str(bundle_on_disk),
            },
        )
        assert save.status_code == 200
        assert save.json()["bundleOrigin"] == str(bundle_on_disk)

        # The edit must be visible inside the re-zipped bundle on disk.
        zf = zipfile.ZipFile(bundle_on_disk)
        assert "# edited in place" in zf.read("model.py").decode("utf-8")
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["formatVersion"] == "2.0"

        # Reopening surfaces the edit (full round-trip).
        reopened = client.post(
            "/api/model/open-project", json={"bundle_path": str(bundle_on_disk)}
        ).json()
        assert "# edited in place" in reopened["source"]
