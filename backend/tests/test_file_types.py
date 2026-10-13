"""Tests for file_types.classify_file().

Covers the four recognized types (PNL_PYTHON, PNLPROJECT, MDF_JSON, MDF_YAML),
the disagreement / mislabel cases (extension claims MDF but content fails to
parse; bare .json that is MDF; bare .json that is NOT MDF), and basic error
paths (missing file, unsupported extension).
"""

from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

import pytest

from app.services.file_types import (
    Classification,
    FileType,
    classify_file,
    classify_upload,
)


# --- Fixtures --------------------------------------------------------------


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory(prefix="psyneuview_test_") as d:
        yield Path(d)


@pytest.fixture(scope="module")
def mdf_json_str() -> str:
    """A serialized MDF model from a tiny PsyNeuLink Composition.

    Generated once per module to amortize the PsyNeuLink import cost.
    """
    import psyneulink as pnl

    a = pnl.TransferMechanism(name="a")
    b = pnl.TransferMechanism(name="b")
    comp = pnl.Composition(name="tiny", pathways=[a, b])
    mdf_dict = comp.as_mdf_model().to_dict()
    return json.dumps(mdf_dict)


@pytest.fixture(scope="module")
def mdf_yaml_str(mdf_json_str: str) -> str:
    """Same MDF model as YAML.

    Round-trips through ``Model.from_json`` then ``to_yaml`` so we get
    canonical MDF YAML output rather than hand-converting.
    """
    from modeci_mdf.mdf import Model

    model = Model.from_json(mdf_json_str)
    return model.to_yaml()


def _write(path: Path, content: str | bytes) -> Path:
    if isinstance(content, str):
        path.write_text(content)
    else:
        path.write_bytes(content)
    return path


# --- PNL Python -------------------------------------------------------------


def test_classify_py(tmp_dir):
    p = _write(tmp_dir / "model.py", "import psyneulink as pnl\n")
    result = classify_file(p)
    assert result.file_type is FileType.PNL_PYTHON
    assert result.ok
    assert result.warnings == []


# --- PsyNeuView project bundle ---------------------------------------------


def test_classify_pnlproject_valid(tmp_dir):
    p = tmp_dir / "thing.pnlproject"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"formatVersion": "1.0"}))
        zf.writestr("model.py", "x = 1\n")
    result = classify_file(p)
    assert result.file_type is FileType.PNLPROJECT
    assert result.ok


def test_classify_pnlproject_missing_manifest(tmp_dir):
    p = tmp_dir / "broken.pnlproject"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("model.py", "x = 1\n")  # no manifest
    result = classify_file(p)
    assert result.file_type is FileType.UNKNOWN
    assert "not a valid project bundle" in (result.error or "")


def test_classify_pnlproject_not_a_zip(tmp_dir):
    p = _write(tmp_dir / "fake.pnlproject", "this is plain text, not a zip")
    result = classify_file(p)
    assert result.file_type is FileType.UNKNOWN
    assert result.error is not None


# --- MDF JSON --------------------------------------------------------------


def test_classify_mdf_json_with_compound_extension(tmp_dir, mdf_json_str):
    p = _write(tmp_dir / "model.mdf.json", mdf_json_str)
    result = classify_file(p)
    assert result.file_type is FileType.MDF_JSON
    assert result.ok
    # Compound extension → no rename hint.
    assert result.warnings == []


def test_classify_mdf_json_with_bare_extension_includes_rename_hint(tmp_dir, mdf_json_str):
    p = _write(tmp_dir / "model.json", mdf_json_str)
    result = classify_file(p)
    assert result.file_type is FileType.MDF_JSON
    assert result.ok
    assert any("mdf.json" in w for w in result.warnings), result.warnings


def test_classify_mdf_json_compound_extension_but_invalid_content_is_error(tmp_dir):
    p = _write(tmp_dir / "claims-to-be.mdf.json", '{"not": "mdf"}')
    result = classify_file(p)
    assert result.file_type is FileType.UNKNOWN
    assert result.error is not None
    assert "MDF extension" in result.error


def test_classify_bare_json_that_is_not_mdf_is_rejected(tmp_dir):
    p = _write(tmp_dir / "config.json", '{"some": "config"}')
    result = classify_file(p)
    assert result.file_type is FileType.UNKNOWN
    assert result.error is not None


# --- MDF YAML --------------------------------------------------------------


def test_classify_mdf_yaml_with_compound_extension(tmp_dir, mdf_yaml_str):
    p = _write(tmp_dir / "model.mdf.yaml", mdf_yaml_str)
    result = classify_file(p)
    assert result.file_type is FileType.MDF_YAML
    assert result.ok
    assert result.warnings == []


def test_classify_mdf_yml_extension_accepted(tmp_dir, mdf_yaml_str):
    p = _write(tmp_dir / "model.mdf.yml", mdf_yaml_str)
    result = classify_file(p)
    assert result.file_type is FileType.MDF_YAML
    assert result.ok


def test_classify_mdf_yaml_with_bare_extension_includes_rename_hint(tmp_dir, mdf_yaml_str):
    p = _write(tmp_dir / "model.yaml", mdf_yaml_str)
    result = classify_file(p)
    assert result.file_type is FileType.MDF_YAML
    assert result.ok
    assert any("mdf.yaml" in w for w in result.warnings), result.warnings


# --- Error paths -----------------------------------------------------------


def test_classify_missing_file(tmp_dir):
    result = classify_file(tmp_dir / "does-not-exist.py")
    assert result.file_type is FileType.UNKNOWN
    assert "not found" in (result.error or "").lower()


def test_classify_directory_not_file(tmp_dir):
    result = classify_file(tmp_dir)
    assert result.file_type is FileType.UNKNOWN
    assert result.error is not None


def test_classify_unsupported_extension(tmp_dir):
    p = _write(tmp_dir / "image.png", b"\x89PNG\r\n\x1a\n")
    result = classify_file(p)
    assert result.file_type is FileType.UNKNOWN
    assert result.error is not None
    assert "extension" in (result.error or "").lower()


# --- classify_upload (in-memory / multipart helper) -------------------------


def test_classify_upload_py():
    result = classify_upload("model.py", b"import psyneulink\n")
    assert result.file_type is FileType.PNL_PYTHON


def test_classify_upload_pnlproject():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", "{}")
    result = classify_upload("thing.pnlproject", buf.getvalue())
    assert result.file_type is FileType.PNLPROJECT


def test_classify_upload_mdf_json(mdf_json_str):
    result = classify_upload("model.mdf.json", mdf_json_str.encode())
    assert result.file_type is FileType.MDF_JSON
    assert result.ok
