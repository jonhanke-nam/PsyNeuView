"""Locking one model inside your own PsyNeuLink checkout (#1346, part 1).

Two rules can stop an edit to a PsyNeuLink file, and they combine in a fixed
order, enforced in the backend:

1. checkout protected → read only (and a managed PsyNeuLink always is);
2. checkout editable + model locked → that model read only, the rest of the
   checkout still editable;
3. otherwise editable.

When both 1 and 2 hold, the refusal names the checkout (the stricter rule,
and the first one to undo). The lock is kept in the model's layout file,
which for your own checkout lives in the checkout beside the model, so it
travels with the repo if committed.

The install is faked through its distribution metadata, as in
``test_pnl_source_guard``; the preferences file is a throwaway (conftest).
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import edit_lock, file_writer, managed_layouts, pnl_source_guard
from app.services.layout import sidecar_path
from tests.test_pnl_source_guard import MODEL, _install

client = TestClient(app)


@pytest.fixture
def clone_root(tmp_path, monkeypatch):
    root = tmp_path / "sources"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    return root


@pytest.fixture
def checkout(tmp_path, monkeypatch, clone_root):
    """Your own checkout with two library models, the second one never locked."""
    model = _install(monkeypatch, tmp_path / "my-psyneulink", editable=True)
    other = model.with_name("Other.py")
    other.write_text(MODEL)
    return model, other


@pytest.fixture
def github_model(clone_root, monkeypatch):
    return _install(monkeypatch, clone_root / "PrincetonUniversity__PsyNeuLink", editable=True)


@pytest.fixture
def pypi_model(tmp_path, monkeypatch, clone_root):
    return _install(monkeypatch, tmp_path / "site-packages", editable=False)


def _lock(model, mode="viewOnly"):
    resp = client.post("/api/model/edit-mode", json={"file_path": str(model), "mode": mode})
    assert resp.status_code == 200, resp.text
    assert resp.json()["mode"] == mode


def _protect(model, protect=True):
    resp = client.post("/api/model/pnl-source/protect", json={"file_path": str(model), "protect": protect})
    assert resp.status_code == 200, resp.text


def _save(model, text="# edited\n"):
    return client.post("/api/model/save-source", json={
        "file_path": str(model), "source": MODEL + text, "base_source": MODEL,
    })


def test_editable_and_unlocked_saves(checkout):
    model, _ = checkout
    resp = _save(model)
    assert resp.status_code == 200, resp.text
    assert model.read_text() == MODEL + "# edited\n"


def test_editable_and_locked_refuses_that_model_only(checkout):
    model, other = checkout
    _lock(model)

    resp = _save(model)
    assert resp.status_code == 409
    body = resp.json()
    assert body["reason"] == "model_view_only"
    assert "Unlock this model" in body["detail"]
    assert model.read_text() == MODEL
    # Composed writes (inspector, graph) are refused the same way.
    with pytest.raises(edit_lock.ModelIsViewOnly):
        file_writer.write_generated_source(model, MODEL + "# composed\n")
    assert model.read_text() == MODEL

    # The rest of the checkout stays editable.
    assert _save(other).status_code == 200
    assert other.read_text() == MODEL + "# edited\n"

    # Unlocking restores edits.
    _lock(model, "editable")
    assert _save(model).status_code == 200
    assert model.read_text() == MODEL + "# edited\n"


def test_protected_and_unlocked_refuses_for_the_checkout(checkout):
    model, other = checkout
    _protect(model)
    for path in (model, other):
        resp = _save(path)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "psyneulink_source_protected"
        assert path.read_text() == MODEL


def test_protected_and_locked_refuses_for_the_checkout_first(checkout):
    """The stricter rule is named: the checkout, which is the first thing to undo."""
    model, _ = checkout
    _lock(model)
    _protect(model)

    resp = _save(model)
    assert resp.status_code == 409
    assert resp.json()["reason"] == "psyneulink_source_protected"
    with pytest.raises(pnl_source_guard.PsyNeuLinkFileIsProtected):
        file_writer.write_generated_source(model, MODEL + "# composed\n")
    structural = client.post("/api/model/structural-change", json={"file_path": str(model), "changes": {"action": "remove_node", "var_name": "A"}})
    assert structural.status_code == 409
    assert structural.json()["reason"] == "psyneulink_source_protected"
    assert model.read_text() == MODEL

    # Allowing edits to the checkout leaves the lock in force: the model is
    # still read only, now for the lock.
    _protect(model, False)
    resp = _save(model)
    assert resp.status_code == 409
    assert resp.json()["reason"] == "model_view_only"
    assert model.read_text() == MODEL


def test_a_protected_checkout_can_still_be_locked_and_unlocked(checkout):
    """Locking writes the layout file, not the model, so protection doesn't stop it."""
    model, _ = checkout
    _protect(model)
    _lock(model)
    assert edit_lock.is_view_only(str(model))
    _lock(model, "editable")
    assert not edit_lock.is_view_only(str(model))
    assert model.read_text() == MODEL


def test_the_lock_lands_in_the_checkout_beside_the_model(checkout):
    """For your own checkout the layout file stays in the repo, next to the
    model (or in its hidden .psyneuview/ folder), so a committed lock travels
    with it — not under PsyNeuView's out-of-install layouts folder."""
    model, _ = checkout
    _lock(model)
    layout = sidecar_path(str(model))
    assert layout.exists()
    assert layout.parent in (model.parent, model.parent / ".psyneuview")
    assert not managed_layouts.is_managed(model)
    assert json.loads(layout.read_text())[edit_lock.LOCK_KEY] == edit_lock.VIEW_ONLY


@pytest.mark.parametrize("fixture", ["github_model", "pypi_model"])
@pytest.mark.parametrize("locked", [False, True])
def test_a_managed_psyneulink_refuses_regardless_of_the_lock(request, fixture, locked):
    model = request.getfixturevalue(fixture)
    if locked:
        _lock(model)
    resp = _save(model)
    assert resp.status_code == 409
    assert resp.json()["reason"] == "psyneulink_source_protected"
    assert model.read_text() == MODEL
