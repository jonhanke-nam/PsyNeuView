"""A ``psyneulink/`` folder left in site-packages no longer breaks every load (#1396).

Switching to a local checkout uninstalled the old PsyNeuLink, but pip removes
only what it installed: a layout PsyNeuView had saved inside the package kept
``site-packages/psyneulink/library/models/.psyneuview/`` alive. With no
``__init__.py`` that folder imports as an empty namespace package, found
before the editable install's finder, so ``import psyneulink`` had no
``Composition`` and every model failed to load.
"""
import subprocess
import sys
import textwrap
from pathlib import Path

from app.services import managed_layouts as ml

SIDECAR = Path("psyneulink/library/models/.psyneuview/Giallanza2024_EGO_Study2.pnlview.json")


def _leftover_site(tmp_path: Path) -> Path:
    site = tmp_path / "site-packages"
    f = site / SIDECAR
    f.parent.mkdir(parents=True)
    f.write_text('{"positions": {"STATE": [1, 2]}}')
    pyc = site / "psyneulink" / "core" / "__pycache__" / "x.cpython-313.pyc"
    pyc.parent.mkdir(parents=True)
    pyc.write_bytes(b"\0")
    return site


def _checkout(tmp_path: Path) -> Path:
    """An editable checkout: a real package, reached only through a finder."""
    root = tmp_path / "checkout"
    (root / "psyneulink").mkdir(parents=True)
    (root / "psyneulink" / "__init__.py").write_text("Composition = object\n")
    return root


def _import_like_an_editable_install(site: Path, checkout: Path) -> str:
    """Import psyneulink the way the model runner does after the switch:
    site-packages on the path, the checkout behind a finder at the end of
    sys.meta_path (where setuptools puts an editable install's). -S keeps
    this environment's own site-packages, and its PsyNeuLink, out of it."""
    code = textwrap.dedent(f"""
        import importlib.machinery, importlib.util, sys
        class EditableFinder:
            @classmethod
            def find_spec(cls, name, path=None, target=None):
                if name == "psyneulink":
                    return importlib.util.spec_from_file_location(
                        name, {str(checkout / 'psyneulink' / '__init__.py')!r},
                        submodule_search_locations=[{str(checkout / 'psyneulink')!r}])
                return None
        sys.meta_path.append(EditableFinder)
        sys.path.insert(0, {str(site)!r})
        import psyneulink
        print(hasattr(psyneulink, "Composition"))
    """)
    out = subprocess.run([sys.executable, "-I", "-S", "-c", code], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_the_leftover_folder_shadows_the_checkout_until_cleared(tmp_path):
    site = _leftover_site(tmp_path)
    checkout = _checkout(tmp_path)
    assert _import_like_an_editable_install(site, checkout) == "False"  # the bug

    record = ml.clear_leftover_packages(site_dirs=[site], destination=tmp_path / "layouts")

    assert not (site / "psyneulink").exists()
    assert _import_like_an_editable_install(site, checkout) == "True"
    assert record["ok"] is True
    assert record["cleared"] == [str(site / "psyneulink")]


def test_the_layout_is_kept_not_deleted(tmp_path):
    site = _leftover_site(tmp_path)
    record = ml.clear_leftover_packages(site_dirs=[site], destination=tmp_path / "layouts")

    kept = Path(record["kept_in"]) / SIDECAR
    assert kept.read_text() == '{"positions": {"STATE": [1, 2]}}'
    assert kept.is_relative_to(tmp_path / "layouts" / ml.LEFTOVER_DIRNAME)
    assert [m["to"] for m in record["moved"]] == [str(kept)]  # the .pyc isn't kept
    assert ml.last_migration() is None or ml.last_migration() != record  # its own key


def test_a_real_package_and_a_clean_environment_are_left_alone(tmp_path):
    site = tmp_path / "site-packages"
    (site / "psyneulink").mkdir(parents=True)
    (site / "psyneulink" / "__init__.py").write_text("")
    (site / "psyneulink" / "x.pnlview.json").write_text("{}")
    assert ml.clear_leftover_packages(site_dirs=[site], destination=tmp_path / "layouts") is None
    assert (site / "psyneulink" / "x.pnlview.json").exists()

    empty = tmp_path / "empty-site"
    empty.mkdir()
    assert ml.clear_leftover_packages(site_dirs=[empty], destination=tmp_path / "layouts") is None


def test_a_file_that_cannot_be_moved_stays_and_is_reported(tmp_path, monkeypatch):
    site = _leftover_site(tmp_path)

    def failing_copy(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(ml, "_copy_file", failing_copy)
    record = ml.clear_leftover_packages(site_dirs=[site], destination=tmp_path / "layouts")

    assert (site / SIDECAR).exists()
    assert record["ok"] is False
    assert record["failures"][0]["error"] == "disk full"


def test_off_while_tests_redirect_the_layouts_folder():
    # conftest sets PSYNEUVIEW_LAYOUTS_DIR: the real site-packages is never touched.
    assert ml.fixed_by_env()
    assert ml.clear_leftover_packages_here() is None
