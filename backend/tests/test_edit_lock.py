"""The view-only canvas lock (#1116).

From the design discussion: "The canvas is an editor, but we should be able to lock it so it's only a
view as well."

The lock is enforced in the API, not the UI. Hiding buttons is a hint; refusing
the request is a lock.
"""

import pytest

from app.services import edit_lock
from app.services.layout import load_layout, save_layout

MODEL = """import psyneulink as pnl

a = pnl.TransferMechanism(name="a")
comp = pnl.Composition(name="C")
comp.add_node(a)
"""


@pytest.fixture
def model(tmp_path):
    p = tmp_path / "m.py"
    p.write_text(MODEL)
    return str(p)


class TestDefaults:
    def test_an_unmarked_model_is_editable(self, model):
        # Locking must be opt-in: nothing existing becomes read-only by upgrade.
        assert edit_lock.edit_mode(model) == "editable"
        assert edit_lock.is_view_only(model) is False

    def test_a_model_with_no_sidecar_at_all_is_editable(self, model):
        assert load_layout(model) is None
        assert edit_lock.is_view_only(model) is False


class TestSettingTheMode:
    def test_marking_view_only(self, model):
        assert edit_lock.set_edit_mode(model, "viewOnly") == "viewOnly"
        assert edit_lock.is_view_only(model) is True

    def test_unmarking(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        edit_lock.set_edit_mode(model, "editable")
        assert edit_lock.is_view_only(model) is False

    def test_an_unknown_mode_is_refused(self, model):
        with pytest.raises(ValueError, match="unknown edit mode"):
            edit_lock.set_edit_mode(model, "readonly")


class TestTheLockSurvivesLayoutSaves:
    """The trap this nearly fell into.

    save_layout rebuilds the sidecar from a whitelist of known keys, so
    anything not carried forward is silently dropped. A lock written without
    that carry-forward would vanish the first time someone dragged a node —
    worse than no lock, because the user would believe it was on.
    """

    def test_dragging_a_node_does_not_clear_the_lock(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        save_layout(model, positions={"a": {"x": 10, "y": 20}})
        assert edit_lock.is_view_only(model) is True

    def test_a_viewport_save_does_not_clear_it(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        save_layout(model, viewport={"x": 0, "y": 0, "zoom": 1.5})
        assert edit_lock.is_view_only(model) is True

    def test_the_lock_does_not_clobber_layout(self, model):
        save_layout(model, positions={"a": {"x": 1, "y": 2}})
        edit_lock.set_edit_mode(model, "viewOnly")
        assert (load_layout(model) or {}).get("positions") == {"a": {"x": 1, "y": 2}}

    def test_unlocking_leaves_layout_intact(self, model):
        save_layout(model, positions={"a": {"x": 1, "y": 2}})
        edit_lock.set_edit_mode(model, "viewOnly")
        edit_lock.set_edit_mode(model, "editable")
        assert (load_layout(model) or {}).get("positions") == {"a": {"x": 1, "y": 2}}


class TestTheGuard:
    def test_an_editable_model_passes(self, model):
        edit_lock.guard(model)  # must not raise

    def test_a_locked_model_is_refused(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        with pytest.raises(edit_lock.ModelIsViewOnly) as e:
            edit_lock.guard(model)
        # The message has to say what to do instead, not just "no" — and
        # since #1320 that is unlocking, not "edit the code directly".
        assert "Unlock this model" in str(e.value)
        assert "view only" in str(e.value)
        assert "Edit the code directly" not in str(e.value)


class TestThroughTheAPI:
    """Enforced at the route, so the lock holds however the request arrives."""

    def _client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)

    def test_a_structural_change_is_refused_on_a_locked_model(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        resp = self._client().post("/api/model/structural-change", json={
            "file_path": model,
            "changes": {"action": "add_node", "var_name": "b",
                        "type": "TransferMechanism", "params": {}},
        })
        assert resp.status_code == 409, resp.text
        assert "view only" in resp.json()["detail"]

    def test_the_file_is_untouched_when_refused(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        before = open(model).read()
        self._client().post("/api/model/structural-change", json={
            "file_path": model,
            "changes": {"action": "add_node", "var_name": "b",
                        "type": "TransferMechanism", "params": {}},
        })
        assert open(model).read() == before

    def test_a_parameter_edit_is_refused_with_the_same_answer(self, model):
        """The inspector's writes meet the lock inside the writer, not at the
        route, and used to come back as a 500 with no message (#1309). Now
        every refused write answers 409 and says how to unlock."""
        edit_lock.set_edit_mode(model, "viewOnly")
        before = open(model).read()
        resp = self._client().post("/api/model/update-param", json={
            "file_path": model, "var_name": "a", "param_name": "gain",
            "new_value": "2.0",
        })
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["reason"] == "model_view_only"
        assert "view only" in body["detail"]
        assert "Unlock this model" in body["detail"]
        assert open(model).read() == before

    def test_an_unlocked_model_still_accepts_edits(self, model):
        resp = self._client().post("/api/model/structural-change", json={
            "file_path": model,
            "changes": {"action": "add_node", "var_name": "b",
                        "type": "TransferMechanism", "params": {}},
        })
        assert resp.status_code == 200, resp.text
        assert "b = pnl.TransferMechanism" in open(model).read()

    def test_the_mode_round_trips_through_the_endpoints(self, model):
        c = self._client()
        assert c.get("/api/model/edit-mode", params={"file_path": model}).json()["mode"] == "editable"
        assert c.post("/api/model/edit-mode", json={"file_path": model, "mode": "viewOnly"}).json()["mode"] == "viewOnly"
        assert c.get("/api/model/edit-mode", params={"file_path": model}).json()["mode"] == "viewOnly"

    def test_setting_the_mode_on_a_missing_file_is_404(self, tmp_path):
        resp = self._client().post("/api/model/edit-mode", json={
            "file_path": str(tmp_path / "nope.py"), "mode": "viewOnly"})
        assert resp.status_code == 404


class TestTheWriterRefusesToo:
    """The lock holds below the API, not only at it. (#1116)

    Found while verifying 0.5.8: a check that called apply_structural_change
    directly sailed past the lock, because the guard sat only at the route.
    That matched the design and the shipped behaviour was correct — the route
    is how the app reaches the writer — but "enforced at the boundary" is a
    weaker promise than "enforced at the write", and the difference is exactly
    the kind that rots when someone adds a writer later.

    The guard now sits in write_generated_source, which every generated write
    already funnels through, so it covers all of them and any future one.
    """

    def test_a_structural_change_is_refused_without_going_through_the_api(self, model):
        from app.services.file_writer import apply_structural_change

        edit_lock.set_edit_mode(model, "viewOnly")
        before = open(model).read()
        with pytest.raises(edit_lock.ModelIsViewOnly):
            apply_structural_change(model, {
                "action": "add_node", "var_name": "b",
                "type": "TransferMechanism", "params": {},
            })
        assert open(model).read() == before

    def test_a_parameter_change_is_refused_too(self, model):
        from app.services.file_writer import apply_parameter_change

        edit_lock.set_edit_mode(model, "viewOnly")
        with pytest.raises(edit_lock.ModelIsViewOnly):
            apply_parameter_change(model, "a", "gain", "2.0")

    def test_a_rename_is_refused_too(self, model):
        from app.services.file_writer import apply_node_rename

        edit_lock.set_edit_mode(model, "viewOnly")
        with pytest.raises(edit_lock.ModelIsViewOnly):
            apply_node_rename(model, "a", "renamed", existing_names=[])

    def test_an_unlocked_model_is_unaffected(self, model):
        from app.services.file_writer import apply_structural_change

        apply_structural_change(model, {
            "action": "add_node", "var_name": "b",
            "type": "TransferMechanism", "params": {},
        })
        assert "b = pnl.TransferMechanism" in open(model).read()

    def test_a_code_editor_save_is_refused_too(self, model):
        """The lock covers the code editor (#1320).

        Until #1320 save_source was left unguarded, so a locked model still
        accepted anything typed into its code. For a teaching lock that was
        the most direct way left to change the model, so the writer refuses
        it now, and the file is untouched.
        """
        from app.services.file_writer import save_source

        edit_lock.set_edit_mode(model, "viewOnly")
        with pytest.raises(edit_lock.ModelIsViewOnly):
            save_source(model, "# edited by hand\n")
        assert open(model).read() == MODEL

    def test_unlocking_makes_the_code_saveable_again(self, model):
        from app.services.file_writer import save_source

        edit_lock.set_edit_mode(model, "viewOnly")
        edit_lock.set_edit_mode(model, "editable")
        save_source(model, "# edited by hand\n")
        assert open(model).read() == "# edited by hand\n"


class TestTheCodeEditorSave:
    """The code editor's save meets the lock at the route (#1320), with the
    same 409 ``model_view_only`` answer as every other refused write, and
    the things the lock is not about still work: layout saves, and a copy."""

    def _client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)

    def test_save_source_on_a_locked_model_is_409(self, model):
        edit_lock.set_edit_mode(model, "viewOnly")
        resp = self._client().post("/api/model/save-source", json={
            "file_path": model, "source": "# edited by hand\n", "base_source": MODEL,
        })
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["reason"] == "model_view_only"
        assert "code editor" in body["detail"]
        assert "Unlock this model" in body["detail"]
        assert open(model).read() == MODEL

    def test_save_source_works_again_once_unlocked(self, model):
        c = self._client()
        edit_lock.set_edit_mode(model, "viewOnly")
        assert c.post("/api/model/edit-mode", json={"file_path": model, "mode": "editable"}).status_code == 200
        resp = c.post("/api/model/save-source", json={
            "file_path": model, "source": MODEL + "# edited by hand\n", "base_source": MODEL,
        })
        assert resp.status_code == 200, resp.text
        assert open(model).read().endswith("# edited by hand\n")

    def test_layout_only_changes_stay_allowed(self, model):
        """Dragging a node or zooming is layout, not the model: still fine."""
        edit_lock.set_edit_mode(model, "viewOnly")
        resp = self._client().post("/api/model/save-layout", json={
            "file_path": model, "positions": {"a": {"x": 5, "y": 6}},
            "viewport": {"x": 0, "y": 0, "zoom": 2.0},
        })
        assert resp.status_code == 200, resp.text
        sidecar = load_layout(model) or {}
        assert sidecar["positions"] == {"a": {"x": 5, "y": 6}}
        assert edit_lock.is_view_only(model), "a layout save must not drop the lock"

    def test_save_a_copy_as_stays_allowed_and_the_copy_is_unlocked(self, model, tmp_path):
        edit_lock.set_edit_mode(model, "viewOnly")
        copies = tmp_path / "copies"
        resp = self._client().post("/api/models/save-as", json={
            "file_name": "m_copy.py", "directory": str(copies), "source": MODEL,
        })
        assert resp.status_code == 200, resp.text
        copy = copies / "m_copy.py"
        assert copy.read_text() == MODEL
        assert edit_lock.is_view_only(str(copy)) is False
