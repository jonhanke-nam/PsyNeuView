"""Shared test utilities."""

import re

import pytest

# For the test of the real-preferences-file guard below (#1292).
pytest_plugins = ["pytester"]


@pytest.fixture(autouse=True)
def _clear_pnl_registries():
    """Reset PsyNeuLink's global name registries before each test.

    Loading the same model file more than once per process re-registers its
    mechanisms, so PsyNeuLink appends a ``-N`` instance suffix (``STATE`` ->
    ``STATE-1``). That leaks across tests: a test asserting on the bare name
    passes alone but fails once an earlier test has loaded the same model. The
    live app never sees this (each run loads in a fresh sandbox subprocess), so
    clearing the registries per test makes the suite order-independent.
    """
    try:
        import psyneulink as pnl
    except ImportError:
        yield
        return
    for registry in pnl.primary_registries:
        pnl.clear_registry(registry)
    yield


@pytest.fixture(autouse=True)
def _isolate_user_preferences(tmp_path, monkeypatch):
    """Point every test at a throwaway preferences file (#1025).

    Without this, any test that sets a persisted preference — the global
    sidecar-placement default, install or file history — writes to the
    developer's real ``~/.psynewview.json``. Isolation used to be opt-in, per
    test, by patching one module's constant; a test that forgot, or patched the
    wrong one of the four modules sharing the file, wrote to the real one.
    A test that needs the real default path can still ``delenv`` it.
    """
    from app.services.app_config import CONFIG_ENV

    monkeypatch.setenv(CONFIG_ENV, str(tmp_path / "user-prefs.json"))
    # And no PsyNeuLink update checks (#9). A test that starts the app with its
    # lifespan (TestClient) started the check scheduler, whose first check
    # finished a network round trip later, inside some other test, and wrote
    # `pnl_update_state` to whatever preferences file was current: the real one,
    # when that test had unset the override. Tests of the checks themselves
    # call them directly, or set this back.
    monkeypatch.setenv("PSYNEUVIEW_PNL_UPDATE_CHECKS", "0")
    yield


def _real_preferences_snapshot() -> bytes | None:
    from app.services.app_config import DEFAULT_CONFIG_FILE

    try:
        return DEFAULT_CONFIG_FILE.read_bytes()
    except FileNotFoundError:
        return None
    except OSError:
        return b"<unreadable>"


@pytest.fixture(autouse=True)
def _guard_real_preferences_file(request):
    """Fail any test that changes the developer's real ``~/.psynewview.json`` (#1292).

    The isolation above keeps the app's own writers away from it, but a test
    that unsets the override, or code that finds the file some other way,
    still can: a placeholder ``owner/repo`` source was found recorded in a
    real preferences file, written by a test while #1025 was being worked
    on. The file is snapshotted before and after each test, so the test that
    wrote it is the one that fails, by name.
    """
    from app.services.app_config import DEFAULT_CONFIG_FILE

    before = _real_preferences_snapshot()
    yield
    after = _real_preferences_snapshot()
    assert after == before, (
        f"{request.node.nodeid} changed the real preferences file {DEFAULT_CONFIG_FILE}. "
        "Tests must write a temporary file: the conftest sets PSYNEUVIEW_CONFIG_FILE "
        "for every test, so a test that unsets it must not write preferences. "
        "(If PsyNeuView itself was running and changed the file during the run, "
        "run the test again.)"
    )


@pytest.fixture(autouse=True)
def _isolate_working_copies(tmp_path, monkeypatch):
    """Point every test at a throwaway working-copies folder (#1319).

    Opening a Reference Model, a Demo or a PsyNeuLink Example writes a working
    copy. That used to land in ``backend/`` (untidy, but inside the checkout);
    now it goes to ``~/.psyneuview/working-copies`` — the developer's real
    home — unless redirected. A test about the default location itself can
    still ``delenv`` this and patch ``Path.home``.
    """
    from app.services.working_copies import WORKING_DIR_ENV

    monkeypatch.setenv(WORKING_DIR_ENV, str(tmp_path / "working-copies"))
    yield


@pytest.fixture(autouse=True)
def _isolate_managed_layouts(tmp_path, monkeypatch):
    """Point every test at a throwaway layouts folder (#1321).

    A layout saved for a model inside a managed clone or a read-only
    PsyNeuLink install goes to ``~/.psyneuview/layouts`` — the developer's
    real home — unless redirected. While the variable is set the startup
    migration is also off, so no test can move real files into a temp dir.
    A test about the default location itself can still ``delenv`` this and
    patch ``Path.home``.
    """
    from app.services.managed_layouts import LAYOUTS_DIR_ENV

    monkeypatch.setenv(LAYOUTS_DIR_ENV, str(tmp_path / "layouts"))
    yield


@pytest.fixture(autouse=True, scope="session")
def _disable_show_graph():
    # Library model files (e.g. GilzenratModel.py) call Composition.show_graph()
    # at module scope, which on macOS opens a Preview window via Graphviz and
    # blocks the suite indefinitely. Patch globally for the session.
    try:
        import psyneulink as pnl
    except ImportError:
        yield
        return
    original = pnl.Composition.show_graph
    pnl.Composition.show_graph = lambda self, *args, **kwargs: None
    try:
        yield
    finally:
        pnl.Composition.show_graph = original


def clean_name(name: str) -> str:
    """Strip PsyNeuLink's -N instance suffix from a name."""
    return re.sub(r"-\d+$", "", name)


def find_node(nodes: list, base_name: str) -> dict:
    """Find a node whose name matches base_name (ignoring -N suffix)."""
    for n in nodes:
        if clean_name(n["name"]) == base_name:
            return n
    raise KeyError(f"Node '{base_name}' not found in {[n['name'] for n in nodes]}")


def find_projection(projections: list, base_name: str) -> dict:
    """Find a projection whose name matches base_name (ignoring -N suffix)."""
    for p in projections:
        if clean_name(p["name"]) == base_name:
            return p
    raise KeyError(f"Projection '{base_name}' not found")
