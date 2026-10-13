"""Every PsyNeuLink library model loads AND runs via the native run path (#892).

The "library" catalog is the live models from the installed PsyNeuLink
(``psyneulink/library/models/``). A user loads one and clicks **Run Model**,
which calls ``executor.run_model`` through the sandbox worker — the same path
this test drives. It caught nothing before because coverage only spanned the 10
*bundled* reference models, not the library catalog; the library EGO
(factory-only, name-shadowed by a string constant) rendered but returned
"Composition 'EGO' not found" on run.

Each model must resolve its composition by display name (as the UI sends it) and
produce per-trial results. Uses the worker path (``use_sandbox=True``) because
the factory/gc materialization that makes these models runnable lives there.
"""

from pathlib import Path

import pytest


def _library_models_dir() -> Path | None:
    try:
        import psyneulink
    except ImportError:
        return None
    d = Path(psyneulink.__file__).resolve().parent / "library" / "models"
    return d if d.exists() else None


_DIR = _library_models_dir()
_MODELS = (
    sorted(p for p in _DIR.glob("*.py") if p.name != "__init__.py") if _DIR else []
)


@pytest.mark.skipif(not _MODELS, reason="PsyNeuLink library models not available")
@pytest.mark.parametrize("path", _MODELS, ids=lambda p: p.name)
def test_library_model_loads_and_runs(path: Path):
    from app.services.executor import run_model
    from app.services.introspector import load_and_introspect

    intro = load_and_introspect(str(path))
    assert not intro.get("error"), f"{path.name} failed to load: {intro.get('error')}"
    comps = intro.get("compositions", [])
    assert comps, f"{path.name}: no composition introspected"

    # The display name the Run panel would send.
    comp_name = comps[0]["name"]
    result = run_model(str(path), comp_name, {})  # worker path — what Run Model calls

    err = str(result.get("error") or "")
    assert "not found" not in err, (
        f"{path.name}: composition '{comp_name}' not resolvable on run "
        f"(factory/name-shadow regression, #892): {err}"
    )
    assert result.get("results"), (
        f"{path.name}: run by display name produced no results: {err or result}"
    )
