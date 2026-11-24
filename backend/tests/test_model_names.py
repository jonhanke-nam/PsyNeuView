"""One model, one file name (#422).

A model is named by its file name, so two different models must never share
one: not among the Reference Models, not with the demos, and not with the
PsyNeuLink Library unless the Reference Model is declared as that Library
model (``library`` in REFERENCE_MODELS). Compared ignoring case, as a Mac's
file system does.

And when a PsyNeuLink source is pulled in, model files in it that share a
name are reported by name rather than one silently winning.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.api import routes
from app.api.routes import DEMOS_DIR, LIBRARY_MODEL_NAMES, REFERENCE_MODELS, library_label
from app.main import app
from app.services import model_names

client = TestClient(app)


def _lower(names):
    return [n.lower() for n in names]


def test_reference_models_have_unique_file_names():
    names = _lower(e["name"] for e in REFERENCE_MODELS)
    assert len(names) == len(set(names)), "two Reference Models share a file name"


def test_reference_models_have_unique_labels():
    labels = [e["label"] for e in REFERENCE_MODELS]
    assert len(labels) == len(set(labels)), "two Reference Models share a menu label"


def test_a_reference_model_shares_a_name_with_the_library_only_when_declared():
    library = {n.lower(): n for n in LIBRARY_MODEL_NAMES}
    for e in REFERENCE_MODELS:
        declared = e.get("library")
        if declared is not None:
            assert declared.lower() in library, f"{e['name']} declares an unknown Library model {declared}"
        if e["name"].lower() in library:
            assert declared and declared.lower() == e["name"].lower(), (
                f"Reference Model {e['name']} has a Library model's file name without being declared as it"
            )


def test_library_names_are_unique():
    names = _lower(LIBRARY_MODEL_NAMES)
    assert len(names) == len(set(names))


def test_demos_share_no_name_with_reference_or_library_models():
    demos = {p.stem.lower() for p in DEMOS_DIR.glob("*.py")}
    others = set(_lower(e["name"] for e in REFERENCE_MODELS)) | set(_lower(LIBRARY_MODEL_NAMES))
    assert not demos & others, f"a demo shares a file name: {sorted(demos & others)}"


def test_the_library_shows_the_reference_label_for_the_same_model():
    assert library_label("Cohen_Huston1994") == "Stroop — Bidirectional (Cohen & Huston 1994)"
    assert library_label("giallanza2024_EGO_study2") == "EGO — Giallanza et al. 2024 (Study 2)"
    assert library_label("Some_Other_Model") == "Some Other Model"


# ── Clashes in a PsyNeuLink source ────────────────────────────────────


def _tree(tmp_path: Path, library=(), examples=()) -> Path:
    root = tmp_path / "PsyNeuLink"
    lib = root / "psyneulink" / "library" / "models"
    ex = root / "Scripts" / "Examples"
    lib.mkdir(parents=True)
    ex.mkdir(parents=True)
    for name in library:
        (lib / name).write_text("x = 1\n")
    for name in examples:
        (ex / name).parent.mkdir(parents=True, exist_ok=True)
        (ex / name).write_text("x = 1\n")
    return root


def test_a_clean_source_has_no_clashes(tmp_path):
    root = _tree(tmp_path, library=["Cohen_Huston1994.py", "GilzenratModel.py"], examples=["Stroop.py"])
    assert model_names.find_clashes(root, REFERENCE_MODELS) == []


def test_a_planted_duplicate_is_named(tmp_path):
    root = _tree(
        tmp_path,
        library=["GilzenratModel.py"],
        examples=["gilzenratmodel.py", "Botvinick/Stroop.py", "Stroop.py"],
    )
    clashes = model_names.find_clashes(root, REFERENCE_MODELS)
    stems = {c["stem"].lower(): c for c in clashes if c["kind"] == "source"}
    assert set(stems) == {"gilzenratmodel", "stroop"}
    assert sorted(stems["stroop"]["files"]) == ["Scripts/Examples/Botvinick/Stroop.py", "Scripts/Examples/Stroop.py"]
    # The example also takes a Reference Model's name without being it.
    assert any(c["kind"] == "reference" and c["files"] == ["Scripts/Examples/gilzenratmodel.py"] for c in clashes)
    msg = model_names.describe(clashes)
    assert "Stroop" in msg and "gilzenratmodel.py" in msg


def test_the_install_log_gets_a_warning_line(tmp_path):
    root = _tree(tmp_path, examples=["A.py", "sub/a.py"])
    lines: list[str] = []
    model_names.report(root, lines.append)
    assert len(lines) == 1 and lines[0].startswith("Warning: Model files share a name")
    assert "Scripts/Examples/sub/a.py" in lines[0]


def test_the_page_is_told_about_the_active_source(tmp_path, monkeypatch):
    root = _tree(tmp_path, examples=["Dup.py", "more/Dup.py"])
    monkeypatch.setattr(routes, "active_psyneulink_package_dir", lambda: root / "psyneulink")
    body = client.get("/api/psyneulink/name-clashes").json()
    assert [c["stem"] for c in body["clashes"]] == ["Dup"]
    assert body["key"]
    assert "Dup" in body["message"]
