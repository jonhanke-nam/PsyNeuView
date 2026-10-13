"""Tests for app.services.file_history (#258).

Mirrors test_source_history's coverage but on the (repo, ref, path)
triple shape: newest-first ordering, full-triple dedupe, per-(repo, ref)
filtering, cap eviction, malformed-file resilience, atomic write, and
coexistence with other config keys (including the sibling source_history).
"""

import json
from pathlib import Path

import pytest

from app.services import file_history


@pytest.fixture
def config_path(tmp_path) -> Path:
    """Each test gets its own throwaway config file — never touch ~/.psynewview.json."""
    return tmp_path / ".psynewview.json"


def test_record_creates_file_and_first_entry(config_path):
    file_history.record_selection(
        "PrincetonUniversity/PsyNeuLink", "devel",
        "tests/composition/test_emcomposition.py",
        config_file=config_path,
    )
    assert config_path.exists()
    data = json.loads(config_path.read_text())
    entry = data["file_history"][0]
    assert entry["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert entry["ref"] == "devel"
    assert entry["path"] == "tests/composition/test_emcomposition.py"


def test_newest_first(config_path):
    file_history.record_selection("a/a", "x", "p1.py", config_file=config_path)
    file_history.record_selection("b/b", "y", "p2.py", config_file=config_path)
    file_history.record_selection("c/c", "z", "p3.py", config_file=config_path)

    entries = file_history.list_selections(config_file=config_path)
    assert [(e["repo"], e["ref"], e["path"]) for e in entries] == [
        ("c/c", "z", "p3.py"),
        ("b/b", "y", "p2.py"),
        ("a/a", "x", "p1.py"),
    ]


def test_dedupe_on_full_triple(config_path):
    """The same (repo, ref, path) triple bumps to the top — doesn't duplicate."""
    file_history.record_selection("a/a", "x", "p.py", config_file=config_path)
    file_history.record_selection("b/b", "y", "q.py", config_file=config_path)
    file_history.record_selection("a/a", "x", "p.py", config_file=config_path)

    entries = file_history.list_selections(config_file=config_path)
    triples = [(e["repo"], e["ref"], e["path"]) for e in entries]
    assert triples == [("a/a", "x", "p.py"), ("b/b", "y", "q.py")]


def test_same_path_different_ref_kept_separately(config_path):
    """Opening the same file on a different branch is a distinct entry."""
    file_history.record_selection("a/a", "main",  "p.py", config_file=config_path)
    file_history.record_selection("a/a", "devel", "p.py", config_file=config_path)

    entries = file_history.list_selections(config_file=config_path)
    assert [(e["ref"]) for e in entries] == ["devel", "main"]


def test_same_repo_ref_different_path_kept_separately(config_path):
    file_history.record_selection("a/a", "main", "x.py", config_file=config_path)
    file_history.record_selection("a/a", "main", "y.py", config_file=config_path)

    entries = file_history.list_selections(config_file=config_path)
    assert [e["path"] for e in entries] == ["y.py", "x.py"]


def test_cap_evicts_oldest(config_path, monkeypatch):
    monkeypatch.setattr(file_history, "MAX_ENTRIES", 3)
    for i in range(5):
        file_history.record_selection("o/r", "main", f"f{i}.py", config_file=config_path)

    entries = file_history.list_selections(config_file=config_path)
    assert len(entries) == 3
    assert [e["path"] for e in entries] == ["f4.py", "f3.py", "f2.py"]


def test_empty_or_whitespace_inputs_ignored(config_path):
    file_history.record_selection("",        "main", "f.py", config_file=config_path)
    file_history.record_selection("a/a",     "",     "f.py", config_file=config_path)
    file_history.record_selection("a/a",     "main", "",     config_file=config_path)
    file_history.record_selection("   ",     "main", "f.py", config_file=config_path)
    file_history.record_selection("a/a",     "  ",   "f.py", config_file=config_path)
    file_history.record_selection("a/a",     "main", "  ",   config_file=config_path)

    assert file_history.list_selections(config_file=config_path) == []


def test_list_for_repo_ref_filters_and_orders(config_path):
    file_history.record_selection("a/a", "main",  "x.py", config_file=config_path)
    file_history.record_selection("b/b", "main",  "x.py", config_file=config_path)
    file_history.record_selection("a/a", "devel", "z.py", config_file=config_path)
    file_history.record_selection("a/a", "main",  "y.py", config_file=config_path)

    main_a = file_history.list_for_repo_ref("a/a", "main", config_file=config_path)
    assert [e["path"] for e in main_a] == ["y.py", "x.py"]

    devel_a = file_history.list_for_repo_ref("a/a", "devel", config_file=config_path)
    assert [e["path"] for e in devel_a] == ["z.py"]

    nothing = file_history.list_for_repo_ref("nope/x", "main", config_file=config_path)
    assert nothing == []


def test_preserves_other_config_keys(config_path):
    """Coexistence with source_history and model_dirs in the same file."""
    config_path.write_text(json.dumps({
        "model_dirs": ["/foo", "/bar"],
        "source_history": [
            {"repo": "a/a", "ref": "main", "selected_at": 1.0}
        ],
    }))
    file_history.record_selection("a/a", "main", "f.py", config_file=config_path)

    data = json.loads(config_path.read_text())
    assert data["model_dirs"] == ["/foo", "/bar"]
    assert data["source_history"][0]["repo"] == "a/a"
    assert data["file_history"][0]["path"] == "f.py"


def test_malformed_file_is_treated_as_empty(config_path):
    config_path.write_text("{ not valid json")
    assert file_history.list_selections(config_file=config_path) == []
    file_history.record_selection("a/a", "main", "f.py", config_file=config_path)
    assert file_history.list_selections(config_file=config_path)[0]["path"] == "f.py"


def test_non_list_history_value_is_treated_as_empty(config_path):
    config_path.write_text(json.dumps({"file_history": "not a list"}))
    assert file_history.list_selections(config_file=config_path) == []


def test_entry_missing_required_field_is_dropped(config_path):
    config_path.write_text(json.dumps({"file_history": [
        {"repo": "a/a", "ref": "main"},                                   # no path
        {"repo": "a/a", "path": "f.py"},                                  # no ref
        {"ref": "main", "path": "f.py"},                                  # no repo
        {"repo": "b/b", "ref": "devel", "path": "g.py", "selected_at": 1},  # valid
        "not a dict",
    ]}))
    entries = file_history.list_selections(config_file=config_path)
    assert len(entries) == 1
    assert entries[0]["path"] == "g.py"


def test_atomic_write_leaves_no_tmp_files(config_path):
    file_history.record_selection("a/a", "main", "f.py", config_file=config_path)
    leftover = [
        p for p in config_path.parent.iterdir()
        if p.name.startswith(".psynewview.") and p.suffix == ".tmp"
    ]
    assert leftover == []
