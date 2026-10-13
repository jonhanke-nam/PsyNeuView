"""#1382: a function-built Composition must be found even when it reuses a freed id.

Loading a model whose Composition is built inside a function (the library's
MontagueDayanSejnowski96 does this) relies on a fallback: scan
``gc.get_objects()`` for Compositions that were not alive before the load. The
"before" snapshot used to keep only ``id()`` values. ``gc.get_objects()`` also
returns garbage that has not been collected yet, such as the Compositions of a
model loaded earlier in the same process. If that garbage was freed during the
new load, Python could put the new Composition at the same address, so its id
was already in the snapshot and it was skipped. The load then reported no
Composition at all, with only the model driver's ``KeyError`` as the error.

That is what made ``test_library_model_runs[MontagueDayanSejnowski96.py]``
fail now and then on the Python 3.14 CI job. The tests below set it up on
purpose: leave uncollected Compositions behind, then load a model that frees
them and builds its own Composition inside a function. On Python 3.14 the new
Composition reliably reuses a freed address, so without the fix the snapshot,
introspector and run-path tests fail. (Python 3.13 happens not to reuse the
address here, so there only the snapshot test catches the old behaviour.) The
sandbox worker re-runs a failing model statement by statement, which builds a
second Composition after the garbage is gone, so its test is coverage rather
than a reproduction.
"""

import gc
import weakref

import pytest

pnl = pytest.importorskip("psyneulink")

# Frees the caller's garbage, then builds the Composition inside a function
# whose driver raises after the (no-op'd) run, like MontagueDayanSejnowski96.
FUNCTION_BUILT_MODEL = '''\
import gc
import psyneulink as pnl

gc.collect()


def build():
    a = pnl.ProcessingMechanism(name="A")
    comp = pnl.Composition(name="Built", pathways=[a])
    comp.run()
    raise KeyError(comp.name)


comp = build()
'''


@pytest.fixture
def model_path(tmp_path):
    path = tmp_path / "function_built.py"
    path.write_text(FUNCTION_BUILT_MODEL)
    return str(path)


def _load_after_leaving_garbage(load):
    """Call ``load()`` while 200 unreachable Compositions await collection.

    The collector is off until the model's own ``gc.collect()``, so the
    snapshot sees the garbage and the model frees it just before building.
    """
    gc.collect()
    gc.disable()
    try:
        garbage = [pnl.Composition(name=f"Earlier{i}") for i in range(200)]
        del garbage
        for registry in pnl.primary_registries:
            pnl.clear_registry(registry)
        return load()
    finally:
        gc.enable()


def test_snapshot_keeps_earlier_compositions_alive():
    """The snapshot must hold the objects, so none can be freed mid-load."""
    from app.services.sandbox_worker import _composition_snapshot

    comp = pnl.Composition(name="Earlier")
    ref = weakref.ref(comp)
    snapshot = _composition_snapshot()
    assert id(comp) in snapshot
    del comp
    for registry in pnl.primary_registries:
        pnl.clear_registry(registry)
    gc.collect()
    assert ref() is not None, "snapshot kept only the id; the object could be freed and its id reused"
    del snapshot


def test_introspector_finds_function_built_composition(model_path):
    from app.services.introspector import load_and_introspect

    result = _load_after_leaving_garbage(
        lambda: load_and_introspect(model_path, use_sandbox=False)
    )
    names = [c["name"] for c in result["compositions"]]
    assert names == ["Built"], f"introspection said: {result.get('error')!r}"


def test_sandbox_worker_finds_function_built_composition(model_path):
    from app.services.sandbox_worker import task_introspect

    result = _load_after_leaving_garbage(
        lambda: task_introspect({"file_path": model_path})
    )
    names = [c["name"] for c in result.get("compositions", [])]
    assert names == ["Built"], f"sandbox worker said: {result.get('error')!r}"


def test_run_path_binds_function_built_composition(model_path):
    """The run path binds the Composition onto the module by the same scan (#859)."""
    from app.services.executor import get_input_nodes

    result = _load_after_leaving_garbage(
        lambda: get_input_nodes(model_path, "Built", use_sandbox=False)
    )
    assert "error" not in result, f"get_input_nodes said: {result.get('error')!r}"
    assert [n["name"] for n in result["inputNodes"]] == ["A"]
