"""Tests for app.services.source_history.

Covers the four properties that matter for the typeahead in #251:
1. Selections come back newest-first.
2. Re-selecting an existing (repo, ref) pair bumps it to the top, doesn't
   duplicate.
3. The history is capped — old entries fall off.
4. Existing keys in ``.psynewview.json`` (like ``model_dirs``) are
   preserved across writes; malformed files don't crash reads.
"""

import json
from pathlib import Path

import pytest

from app.services import source_history


@pytest.fixture
def config_path(tmp_path) -> Path:
    """Each test gets its own throwaway config file — never touch ~/.psynewview.json."""
    return tmp_path / ".psynewview.json"


def test_record_creates_file(config_path):
    source_history.record_selection(
        "PrincetonUniversity/PsyNeuLink", "devel", config_file=config_path
    )
    assert config_path.exists()
    data = json.loads(config_path.read_text())
    assert data["source_history"][0]["repo"] == "PrincetonUniversity/PsyNeuLink"
    assert data["source_history"][0]["ref"] == "devel"


def test_newest_first(config_path):
    source_history.record_selection("a/a", "x", config_file=config_path)
    source_history.record_selection("b/b", "y", config_file=config_path)
    source_history.record_selection("c/c", "z", config_file=config_path)

    entries = source_history.list_selections(config_file=config_path)
    assert [(e["repo"], e["ref"]) for e in entries] == [
        ("c/c", "z"), ("b/b", "y"), ("a/a", "x"),
    ]


def test_dedupe_bumps_to_top(config_path):
    source_history.record_selection("a/a", "x", config_file=config_path)
    source_history.record_selection("b/b", "y", config_file=config_path)
    source_history.record_selection("a/a", "x", config_file=config_path)

    entries = source_history.list_selections(config_file=config_path)
    assert [(e["repo"], e["ref"]) for e in entries] == [("a/a", "x"), ("b/b", "y")]


def test_different_ref_same_repo_kept_separately(config_path):
    source_history.record_selection("a/a", "main", config_file=config_path)
    source_history.record_selection("a/a", "devel", config_file=config_path)

    entries = source_history.list_selections(config_file=config_path)
    assert [(e["repo"], e["ref"]) for e in entries] == [("a/a", "devel"), ("a/a", "main")]


def test_cap_evicts_oldest(config_path, monkeypatch):
    monkeypatch.setattr(source_history, "MAX_ENTRIES", 3)
    for i in range(5):
        source_history.record_selection(f"x/{i}", "r", config_file=config_path)

    entries = source_history.list_selections(config_file=config_path)
    assert len(entries) == 3
    assert [e["repo"] for e in entries] == ["x/4", "x/3", "x/2"]


def test_empty_or_whitespace_inputs_ignored(config_path):
    source_history.record_selection("", "devel", config_file=config_path)
    source_history.record_selection("a/a", "  ", config_file=config_path)
    source_history.record_selection("   ", "", config_file=config_path)

    assert source_history.list_selections(config_file=config_path) == []


def test_preserves_other_config_keys(config_path):
    config_path.write_text(json.dumps({"model_dirs": ["/foo", "/bar"]}))
    source_history.record_selection("a/a", "main", config_file=config_path)

    data = json.loads(config_path.read_text())
    assert data["model_dirs"] == ["/foo", "/bar"]
    assert data["source_history"][0]["repo"] == "a/a"


def test_malformed_file_is_treated_as_empty(config_path):
    config_path.write_text("{ not valid json")
    assert source_history.list_selections(config_file=config_path) == []
    # And we can still record over it — writes succeed.
    source_history.record_selection("a/a", "main", config_file=config_path)
    assert source_history.list_selections(config_file=config_path)[0]["repo"] == "a/a"


def test_history_is_a_non_list_value_is_treated_as_empty(config_path):
    config_path.write_text(json.dumps({"source_history": "not a list"}))
    assert source_history.list_selections(config_file=config_path) == []


def test_history_entry_missing_fields_is_dropped(config_path):
    config_path.write_text(json.dumps({"source_history": [
        {"repo": "a/a"},                                   # no ref
        {"ref": "main"},                                   # no repo
        {"repo": "b/b", "ref": "devel", "selected_at": 1}, # valid
        "not a dict",                                      # not a dict
    ]}))
    entries = source_history.list_selections(config_file=config_path)
    assert len(entries) == 1
    assert entries[0]["repo"] == "b/b"


def test_list_repos_dedupes_in_selection_order(config_path):
    source_history.record_selection("a/a", "main", config_file=config_path)
    source_history.record_selection("b/b", "devel", config_file=config_path)
    source_history.record_selection("a/a", "feature/x", config_file=config_path)

    # a/a was touched most recently (via feature/x), so it leads.
    assert source_history.list_repos(config_file=config_path) == ["a/a", "b/b"]


def test_list_refs_for_repo_filters_and_orders(config_path):
    source_history.record_selection("a/a", "main", config_file=config_path)
    source_history.record_selection("b/b", "main", config_file=config_path)
    source_history.record_selection("a/a", "devel", config_file=config_path)

    assert source_history.list_refs_for_repo("a/a", config_file=config_path) == ["devel", "main"]
    assert source_history.list_refs_for_repo("b/b", config_file=config_path) == ["main"]
    assert source_history.list_refs_for_repo("nonexistent/x", config_file=config_path) == []


def test_atomic_write_leaves_no_tmp_files(config_path):
    source_history.record_selection("a/a", "main", config_file=config_path)
    leftover = [p for p in config_path.parent.iterdir() if p.name.startswith(".psynewview.") and p.suffix == ".tmp"]
    assert leftover == []


# ── Placeholders are never a source (#1292) ─────────────────────────────


@pytest.mark.parametrize("repo", [
    "owner/repo", "Owner/Repo", "owner/name", "org/repo", "user/repo",
    "your-org/your-repo", "<owner>/<repo>", "{owner}/{repo}", "owner/PsyNeuLink",
    "PrincetonUniversity/repo", "someone/...", "owner/repo…",
])
def test_a_placeholder_repo_is_recognised(repo):
    assert source_history.is_placeholder_repo(repo)


@pytest.mark.parametrize("repo", [
    "PrincetonUniversity/PsyNeuLink", "jonhanke-nam/PsyNeuLink", "a/a", "o/r",
    "ownerly/repository-tools", "", None,
])
def test_a_real_repo_is_not_a_placeholder(repo):
    assert not source_history.is_placeholder_repo(repo)


def test_the_placeholder_is_never_recorded(config_path):
    source_history.record_selection("owner/repo", "devel", config_file=config_path)
    assert not config_path.exists()
    source_history.record_selection("PrincetonUniversity/PsyNeuLink", "devel", config_file=config_path)
    source_history.record_selection("Owner/Repo", "main", config_file=config_path)
    assert [e["repo"] for e in source_history.list_selections(config_file=config_path)] == [
        "PrincetonUniversity/PsyNeuLink",
    ]
    assert source_history.list_repos(config_file=config_path) == ["PrincetonUniversity/PsyNeuLink"]


def test_a_placeholder_already_on_disk_is_dropped_when_read(config_path):
    """The entry found in a developer's real file (#1292): gone on the next read,
    and gone from the file on the next write."""
    config_path.write_text(json.dumps({"source_history": [
        {"repo": "owner/repo", "ref": "devel", "selected_at": 1790628017.16},
        {"repo": "jonhanke-nam/PsyNeuLink", "ref": "devel", "selected_at": 1790618749.5},
    ]}))
    assert [e["repo"] for e in source_history.list_selections(config_file=config_path)] == [
        "jonhanke-nam/PsyNeuLink",
    ]
    source_history.record_selection("PrincetonUniversity/PsyNeuLink", "master", config_file=config_path)
    on_disk = json.loads(config_path.read_text())["source_history"]
    assert "owner/repo" not in [e["repo"] for e in on_disk]
