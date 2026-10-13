"""The bundled reference-model registry must load seamlessly (#806).

Reference models are meant to be opened via the one-click picker (`loadReference`
→ `/reference-models/load`), which loads the curated vendored file directly — no
"Convert to standardized format?" prompt (that's only for arbitrary typed-path
files) and no module-level-driver warning (the vendored extracts strip the
driver). These tests pin that contract so a newly-added reference model can't
regress it:

- every entry in ``REFERENCE_MODELS`` exists on disk,
- every bundled ``reference_models/*.py`` is registered (so new ones show up in
  the picker instead of forcing users onto the typed-path flow), and
- every registered model loads with no error, no driver warning, and ≥1
  composition — i.e. seamlessly.
"""

from pathlib import Path

import pytest

from app.api.routes import REFERENCE_MODELS, REFERENCE_DIR
from app.services.introspector import load_and_introspect

_REGISTERED = [e["name"] for e in REFERENCE_MODELS]
_ON_DISK = sorted(
    p.stem for p in REFERENCE_DIR.glob("*.py") if p.name != "__init__.py"
)


def test_registered_models_exist_on_disk():
    missing = [n for n in _REGISTERED if not (REFERENCE_DIR / f"{n}.py").exists()]
    assert not missing, f"registered reference models with no file: {missing}"


def test_every_bundled_model_is_registered():
    # A new reference_models/*.py that isn't registered can only be opened via
    # typed-path (convert prompt) — register it so it's one click in the picker.
    unregistered = sorted(set(_ON_DISK) - set(_REGISTERED))
    assert not unregistered, (
        f"bundled reference models missing from REFERENCE_MODELS: {unregistered}"
    )


@pytest.mark.parametrize("name", _REGISTERED)
def test_registered_model_loads_seamlessly(name):
    path = REFERENCE_DIR / f"{name}.py"
    result = load_and_introspect(str(path))

    assert not result.get("error"), f"{name} failed to load: {result.get('error')}"

    comps = result.get("compositions") or {}
    assert comps, f"{name} exposed no composition"

    # The curated extract strips the run driver, so loading must not surface the
    # non-fatal "module-level driver raised after the no-op'd run" message —
    # which now rides the calm "notices" channel, not "warnings" (#848). Check
    # both so a regressed curation is still caught.
    driver_msgs = [
        m for m in (result.get("warnings") or []) + (result.get("notices") or [])
        if "module-level driver" in str(m) or "no value for execution_id" in str(m)
    ]
    assert not driver_msgs, f"{name} surfaced a driver message: {driver_msgs}"
