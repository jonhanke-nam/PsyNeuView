"""A protection line in the model's own .py (#1346, part 2).

``# PsyNeuView: protected`` opens a model read only, and the usual unlock
works and is remembered for that file on this computer;
``# PsyNeuView: protected permanently`` is read only with no unlock in
PsyNeuView. The rules combine with part 1's in one order, enforced in the
backend:

1. where the file lives (a managed PsyNeuLink, or your checkout protected);
2. protected permanently;
3. protected, unless unlocked here, or the per-model lock;
4. otherwise editable.

The preferences file is a throwaway (conftest), so unlocks recorded here
never reach the developer's real one.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import edit_lock, file_writer, pnl_source_guard, protection_line
from app.services.app_config import app_config_path
from app.services.layout import load_layout
from tests.test_pnl_source_guard import _install

client = TestClient(app)

BODY = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n"
HEADER = "# PsyNeuLink Model File\n# Format Version: 1.0\n"
PROTECTED = HEADER + "# PsyNeuView: protected\n\n" + BODY
PERMANENT = HEADER + "# PsyNeuView: protected permanently\n\n" + BODY


# ── detection ────────────────────────────────────────────────────────────

class TestDetection:
    @pytest.mark.parametrize("line", [
        "# PsyNeuView: protected",
        "#PsyNeuView:protected",
        "# psyneuview: PROTECTED",
        "  #   PsyNeuView  :   protected   ",
        "# PSYNEUVIEW: Protected\t",
    ])
    def test_protected_variants(self, line):
        assert protection_line.level_in_source(HEADER + line + "\n" + BODY) == "protected"

    @pytest.mark.parametrize("line", [
        "# PsyNeuView: protected permanently",
        "#psyneuview:protected PERMANENTLY",
        "#  PsyNeuView :  protected     permanently  ",
    ])
    def test_permanent_variants(self, line):
        assert protection_line.level_in_source(HEADER + line + "\n" + BODY) == "permanent"

    def test_first_line_of_the_file(self):
        assert protection_line.level_in_source("# PsyNeuView: protected\n" + BODY) == "protected"

    def test_after_blank_lines_and_a_shebang(self):
        src = "#!/usr/bin/env python\n\n# PsyNeuLink Model File\n\n# PsyNeuView: protected\n" + BODY
        assert protection_line.level_in_source(src) == "protected"

    def test_no_line_means_unprotected(self):
        assert protection_line.level_in_source(HEADER + BODY) is None
        assert protection_line.level_in_source("") is None

    def test_after_the_first_line_of_code_it_is_ignored(self):
        # A commented-out example in the middle of a model must not count.
        src = HEADER + BODY + "# PsyNeuView: protected permanently\n"
        assert protection_line.level_in_source(src) is None

    def test_in_a_docstring_it_is_ignored(self):
        src = '"""\n# PsyNeuView: protected\n"""\n' + BODY
        assert protection_line.level_in_source(src) is None

    @pytest.mark.parametrize("line", [
        "# PsyNeuView: protect",
        "# PsyNeuView: protected, please",
        "# PsyNeuView: permanently protected",
        "# PsyNeuLink: protected",
        "# PsyNeuView protected",
        "PsyNeuView: protected",
    ])
    def test_near_misses_are_not_protection(self, line):
        assert protection_line.level_in_source(HEADER + line + "\n" + BODY) is None

    def test_both_lines_the_stricter_wins(self):
        src = HEADER + "# PsyNeuView: protected\n# PsyNeuView: protected permanently\n" + BODY
        assert protection_line.level_in_source(src) == "permanent"
        src = HEADER + "# PsyNeuView: protected permanently\n# PsyNeuView: protected\n" + BODY
        assert protection_line.level_in_source(src) == "permanent"

    def test_an_unreadable_file_is_not_protected(self, tmp_path):
        assert protection_line.level(tmp_path / "missing.py") is None


class TestStripForACopy:
    def test_strips_either_level_and_keeps_everything_else(self):
        assert protection_line.strip_from_source(PROTECTED) == HEADER + "\n" + BODY
        assert protection_line.strip_from_source(PERMANENT) == HEADER + "\n" + BODY

    def test_leaves_a_line_below_the_header_alone(self):
        src = HEADER + BODY + "# PsyNeuView: protected\n"
        assert protection_line.strip_from_source(src) == src

    def test_keeps_crlf_line_endings(self):
        src = "# PsyNeuLink Model File\r\n# PsyNeuView: protected\r\nx = 1\r\n"
        assert protection_line.strip_from_source(src) == "# PsyNeuLink Model File\r\nx = 1\r\n"


# ── rules for a file of yours ───────────────────────────────────────────

def _file(tmp_path, text, name="m.py"):
    p = tmp_path / name
    p.write_text(text)
    return p


def _save(model, text="# edited\n"):
    base = model.read_text()
    return client.post("/api/model/save-source", json={
        "file_path": str(model), "source": base + text, "base_source": base,
    })


def _mode(model):
    resp = client.get("/api/model/edit-mode", params={"file_path": str(model)})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _set(model, mode):
    return client.post("/api/model/edit-mode", json={"file_path": str(model), "mode": mode})


def _structural(model):
    return client.post("/api/model/structural-change", json={
        "file_path": str(model),
        "changes": {"action": "add_node", "var_name": "B", "type": "TransferMechanism", "params": {}},
    })


class TestProtected:
    def test_opens_read_only_with_its_rule(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        st = _mode(model)
        assert st["mode"] == "viewOnly"
        assert st["rule"] == "protected"
        assert st["canUnlock"] is True
        assert "# PsyNeuView: protected" in st["message"]

    def test_save_is_refused_and_the_file_is_untouched(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        resp = _save(model)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected"
        assert model.read_text() == PROTECTED

    def test_structural_change_is_refused(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        resp = _structural(model)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected"
        assert model.read_text() == PROTECTED

    def test_generated_write_is_refused(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        with pytest.raises(edit_lock.ModelIsProtected):
            file_writer.write_generated_source(model, PROTECTED + "B = 1\n")

    def test_convert_is_refused(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        resp = client.post("/api/model/convert", json={"file_path": str(model)})
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected"

    def test_unlock_is_remembered_in_preferences_and_the_line_stays(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        resp = _set(model, "editable")
        assert resp.status_code == 200, resp.text
        assert resp.json()["mode"] == "editable"
        assert resp.json()["unlockedHere"] is True
        assert model.read_text() == PROTECTED  # the line stays
        prefs = json.loads(app_config_path().read_text())
        assert prefs[protection_line.UNLOCKED_KEY] == [str(model.resolve())]
        # Not written into the layout file: an unlock is this computer's.
        assert load_layout(str(model)) is None

    def test_unlocked_it_saves_and_stays_unlocked_after_reopening(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        _set(model, "editable")
        assert _save(model).status_code == 200
        # "Reopening" is asking again, from the stored state alone.
        assert _mode(model)["mode"] == "editable"
        assert _mode(model)["rule"] is None

    def test_locking_again_forgets_the_unlock(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        _set(model, "editable")
        resp = _set(model, "viewOnly")
        assert resp.json()["rule"] == "protected"
        assert resp.json()["unlockedHere"] is False
        assert protection_line.UNLOCKED_KEY not in json.loads(app_config_path().read_text())
        assert load_layout(str(model)) is None  # no lock written beside it
        assert _save(model).status_code == 409

    def test_unlock_is_per_file(self, tmp_path):
        a = _file(tmp_path, PROTECTED, "a.py")
        b = _file(tmp_path, PROTECTED, "b.py")
        _set(a, "editable")
        assert _mode(a)["mode"] == "editable"
        assert _mode(b)["mode"] == "viewOnly"

    def test_line_removed_on_disk_makes_it_editable(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        model.write_text(HEADER + BODY)
        assert _mode(model)["mode"] == "editable"
        assert _save(model).status_code == 200


class TestProtectedPermanently:
    def test_opens_read_only_with_no_unlock(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        st = _mode(model)
        assert st["mode"] == "viewOnly"
        assert st["rule"] == "protectedPermanently"
        assert st["canUnlock"] is False
        assert "Save a copy as" in st["message"]

    def test_save_is_refused(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        resp = _save(model)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected_permanently"
        assert model.read_text() == PERMANENT

    def test_structural_change_is_refused(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        resp = _structural(model)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected_permanently"

    def test_unlock_is_refused_and_nothing_is_remembered(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        resp = _set(model, "editable")
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected_permanently"
        assert _mode(model)["mode"] == "viewOnly"
        assert not app_config_path().exists() or protection_line.UNLOCKED_KEY not in json.loads(
            app_config_path().read_text())

    def test_an_earlier_unlock_does_not_carry_over(self, tmp_path):
        # Unlocked while it said "protected"; someone then made it permanent.
        model = _file(tmp_path, PROTECTED)
        _set(model, "editable")
        model.write_text(PERMANENT)
        assert _mode(model)["rule"] == "protectedPermanently"
        assert _save(model).status_code == 409

    def test_line_removed_on_disk_makes_it_editable(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        model.write_text(HEADER + BODY)
        assert _mode(model)["mode"] == "editable"
        assert _save(model).status_code == 200

    def test_layout_is_still_saved(self, tmp_path):
        # Moving nodes is layout, not the model: allowed as for the lock.
        model = _file(tmp_path, PERMANENT)
        resp = client.post("/api/model/save-layout", json={
            "file_path": str(model), "positions": {"A": {"x": 1, "y": 2}},
        })
        assert resp.status_code == 200, resp.text


class TestOrderWithTheLock:
    def test_permanent_outranks_the_lock(self, tmp_path):
        model = _file(tmp_path, HEADER + BODY)
        _set(model, "viewOnly")  # layout-file lock
        model.write_text(PERMANENT)
        assert _mode(model)["rule"] == "protectedPermanently"
        assert _save(model).json()["reason"] == "model_protected_permanently"

    def test_protected_outranks_the_lock_and_unlock_clears_both(self, tmp_path):
        model = _file(tmp_path, HEADER + BODY)
        _set(model, "viewOnly")
        model.write_text(PROTECTED)
        assert _mode(model)["rule"] == "protected"
        resp = _set(model, "editable")
        assert resp.json()["mode"] == "editable"
        assert (load_layout(str(model)) or {}).get("editLock") is None

    def test_unlocked_protected_file_still_obeys_a_lock(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        _set(model, "editable")
        # A lock set by someone else's layout file arrives later.
        from app.services.layout import save_layout
        save_layout(str(model), edit_lock="viewOnly")
        assert _mode(model)["rule"] == "lock"
        assert _save(model).json()["reason"] == "model_view_only"

    def test_lock_on_a_plain_file_is_unchanged(self, tmp_path):
        model = _file(tmp_path, HEADER + BODY)
        resp = _set(model, "viewOnly")
        assert resp.json()["rule"] == "lock"
        assert load_layout(str(model))["editLock"] == "viewOnly"
        assert _save(model).json()["reason"] == "model_view_only"


# ── with part 1: where the file lives comes first ──────────────────────

@pytest.fixture
def clone_root(tmp_path, monkeypatch):
    root = tmp_path / "sources"
    monkeypatch.setenv("PSYNEUVIEW_CLONE_ROOT", str(root))
    return root


@pytest.fixture
def checkout_model(tmp_path, monkeypatch, clone_root):
    return _install(monkeypatch, tmp_path / "my-psyneulink", editable=True)


@pytest.fixture
def github_model(clone_root, monkeypatch):
    return _install(monkeypatch, clone_root / "PrincetonUniversity__PsyNeuLink", editable=True)


class TestOrderWithWhereTheFileLives:
    def test_editable_checkout_permanent_line_is_refused_for_the_line(self, checkout_model):
        checkout_model.write_text(PERMANENT)
        resp = _save(checkout_model)
        assert resp.status_code == 409
        assert resp.json()["reason"] == "model_protected_permanently"

    def test_editable_checkout_protected_line_unlocks(self, checkout_model):
        checkout_model.write_text(PROTECTED)
        assert _save(checkout_model).json()["reason"] == "model_protected"
        assert _set(checkout_model, "editable").status_code == 200
        assert _save(checkout_model).status_code == 200

    def test_protected_checkout_outranks_the_line(self, checkout_model):
        checkout_model.write_text(PERMANENT)
        pnl_source_guard.set_checkout_protected(checkout_model, True)
        resp = _save(checkout_model)
        assert resp.json()["reason"] == "psyneulink_source_protected"
        resp = _structural(checkout_model)
        assert resp.json()["reason"] == "psyneulink_source_protected"

    def test_managed_outranks_the_line(self, github_model):
        github_model.write_text(PROTECTED)
        resp = _save(github_model)
        assert resp.json()["reason"] == "psyneulink_source_protected"


# ── Save a copy as… ─────────────────────────────────────────────────────

class TestSaveACopy:
    def test_save_as_copy_starts_unprotected(self, tmp_path):
        model = _file(tmp_path, PERMANENT)
        resp = client.post("/api/models/save-as", json={
            "source": PERMANENT, "file_name": "copy.py", "directory": str(tmp_path / "out"),
            "source_path": str(model),
        })
        assert resp.status_code == 200, resp.text
        copy = tmp_path / "out" / "copy.py"
        assert protection_line.level(copy) is None
        assert resp.json()["source"] == copy.read_text()
        assert model.read_text() == PERMANENT  # the original keeps its line
        assert _mode(copy)["mode"] == "editable"

    def test_save_copy_py_starts_unprotected(self, tmp_path):
        model = _file(tmp_path, PROTECTED)
        resp = client.post("/api/model/save-copy", json={
            "file_path": str(model), "fmt": "py", "file_name": "copy",
            "directory": str(tmp_path / "out"), "source": PROTECTED,
        })
        assert resp.status_code == 200, resp.text
        assert protection_line.level(tmp_path / "out" / "copy.py") is None

    def test_a_brand_new_file_is_written_as_given(self, tmp_path):
        # No source_path: not a copy, so the text is the user's to keep.
        resp = client.post("/api/models/save-as", json={
            "source": PROTECTED, "file_name": "new.py", "directory": str(tmp_path / "out"),
        })
        assert resp.status_code == 200, resp.text
        assert protection_line.level(tmp_path / "out" / "new.py") == "protected"


# ── rewrites PsyNeuView does on its own ──────────────────────────────────

STAR = HEADER + "# PsyNeuView: protected permanently\n\nfrom psyneulink import *\nA = TransferMechanism(name='A')\nC = Composition(name='C')\nC.add_node(A)\n"


class TestNoRewriteBehindTheLine:
    def test_opening_does_not_convert_star_imports(self, tmp_path):
        model = _file(tmp_path, STAR)
        resp = client.post("/api/model/load", json={"file_path": str(model)})
        assert resp.status_code == 200, resp.text
        assert model.read_text() == STAR

    def test_converting_an_unlocked_protected_file_keeps_its_line(self, tmp_path):
        model = _file(tmp_path, PROTECTED + "C = pnl.Composition(name='C')\nC.add_node(A)\n")
        _set(model, "editable")
        resp = client.post("/api/model/convert", json={"file_path": str(model), "backup": False})
        assert resp.status_code == 200, resp.text
        assert protection_line.level(model) == "protected"
        assert "# PsyNeuView: protected" in resp.json()["source"]
