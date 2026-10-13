"""Round-trip equivalence harness for PsyNeuLink <-> MDF conversion (#88).

Pipeline exercised per model fixture:

    source .py  --exec-->  live Composition
                --get_mdf_serialized-->  MDF file (json or yaml)
                --generate_script_from_mdf-->  regenerated .py
                --exec-->  regenerated Composition

The harness asserts the regenerated model matches the original on two axes:

* **structural** — same canonical node names and the same
  (sender, receiver) projection pairs, composition by composition, as seen
  through the same introspector that powers the PsyNeuView graph view.
* **numerical** — both compositions produce the same results when run with
  identical deterministic inputs (matched across the two models by
  canonical INPUT-node name).

Names are canonicalized with ``app.services.mdf_metadata._canonical``
because both PNL's registry (``-<n>``) and ``generate_script_from_mdf``
(``_<n>``) append instance suffixes that are irrelevant to equivalence.

Known-lossy MDF gaps (#82 nested compositions, #83 conjoint components,
#84 2D MatrixTransform, #87 stateful functions) get their own fixtures
that pin the *current* failure mode via ``pytest.raises``/``xfail`` until
the gap is fixed.
"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path

import numpy as np

from app.services.introspector import load_and_introspect
from app.services.mdf_metadata import _canonical


def exec_model(path: Path):
    """Execute a model file under a unique module name; return the module."""
    name = f"mdf_harness_model_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


def top_level_compositions(module) -> list:
    """Compositions in the module that are not nested inside another one."""
    import psyneulink as pnl

    comps = [v for v in vars(module).values() if isinstance(v, pnl.Composition)]
    nested_ids = {
        id(node)
        for comp in comps
        for node in comp.nodes
        if isinstance(node, pnl.Composition)
    }
    return [c for c in comps if id(c) not in nested_ids]


def export_to_mdf(comps, mdf_path: Path, fmt: str = "json") -> Path:
    """Export one Composition (or a list of them) to an MDF file."""
    from psyneulink.core.globals.mdf import get_mdf_serialized

    if not isinstance(comps, (list, tuple)):
        comps = [comps]
    mdf_path.write_text(get_mdf_serialized(*comps, fmt=fmt))
    return mdf_path


def regenerate_script(mdf_path: Path, script_path: Path) -> Path:
    import psyneulink as pnl

    script_path.write_text(pnl.generate_script_from_mdf(str(mdf_path)))
    return script_path


def structural_signature(introspection: dict) -> dict:
    """Reduce an introspection result to a comparable canonical signature."""
    sig = {}
    for comp in introspection.get("compositions", []):
        nodes = frozenset(_canonical(n["name"]) for n in comp.get("nodes", []))
        projections = frozenset(
            (
                _canonical(p["sender"]["mechanism"]),
                _canonical(p["receiver"]["mechanism"]),
            )
            for p in comp.get("projections", [])
            if p.get("sender") and p.get("receiver")
        )
        sig[_canonical(comp["name"])] = {"nodes": nodes, "projections": projections}
    return sig


def _diff_signatures(sig_a: dict, sig_b: dict) -> str:
    lines = []
    for comp in sorted(set(sig_a) | set(sig_b)):
        if comp not in sig_a:
            lines.append(f"composition {comp!r}: only in regenerated model")
            continue
        if comp not in sig_b:
            lines.append(f"composition {comp!r}: only in original model")
            continue
        for kind in ("nodes", "projections"):
            a, b = sig_a[comp][kind], sig_b[comp][kind]
            if a != b:
                lines.append(
                    f"composition {comp!r} {kind}: "
                    f"lost {sorted(a - b)!r}, gained {sorted(b - a)!r}"
                )
    return "\n".join(lines) or "(signatures equal)"


def _input_nodes(comp) -> list:
    import psyneulink as pnl

    # NodeRole assignment is lazy: scripts built with add_node/add_projection
    # (the style generate_script_from_mdf emits) have no roles until the
    # graph is analyzed, so get_nodes_by_role would return [].
    comp._analyze_graph()
    return comp.get_nodes_by_role(pnl.NodeRole.INPUT)


def deterministic_inputs(comp) -> dict:
    """Fixed, seed-free inputs for every INPUT node, shaped from defaults."""
    return {
        node: np.asarray(node.defaults.variable, dtype=float) + 0.5
        for node in _input_nodes(comp)
    }


def run_with_matched_inputs(comp_a, comp_b, num_trials: int = 1) -> tuple:
    """Run both compositions with identical inputs; return all trial results."""
    inputs_a = deterministic_inputs(comp_a)
    by_canonical = {_canonical(node.name): val for node, val in inputs_a.items()}
    inputs_b = {}
    for node in _input_nodes(comp_b):
        key = _canonical(node.name)
        assert key in by_canonical, (
            f"Regenerated model has INPUT node {node.name!r} with no canonical "
            f"match in the original (originals: {sorted(by_canonical)})"
        )
        inputs_b[node] = by_canonical[key]
    assert len(inputs_b) == len(inputs_a), (
        f"INPUT node count differs: original {len(inputs_a)}, "
        f"regenerated {len(inputs_b)}"
    )
    comp_a.run(inputs=inputs_a, num_trials=num_trials)
    comp_b.run(inputs=inputs_b, num_trials=num_trials)
    return (
        np.asarray(comp_a.results, dtype=float),
        np.asarray(comp_b.results, dtype=float),
    )


def assert_round_trip_equivalent(
    source_path,
    tmp_path,
    *,
    structural: bool = True,
    numerical: bool = True,
    tolerance: float = 1e-8,
    fmt: str = "json",
    num_trials: int = 1,
) -> dict:
    """Round-trip ``source_path`` through MDF and assert equivalence.

    Returns a report dict with the intermediate artifact paths so failing
    tests can point at the exact MDF / regenerated script to inspect.
    """
    source_path = Path(source_path)
    tmp_path = Path(tmp_path)

    module_a = exec_model(source_path)
    comps_a = top_level_compositions(module_a)
    assert comps_a, f"No top-level Composition found in {source_path}"
    assert len(comps_a) == 1, (
        f"Harness v1 expects exactly one top-level Composition, "
        f"found {len(comps_a)} in {source_path}"
    )
    comp_a = comps_a[0]

    mdf_path = export_to_mdf(comp_a, tmp_path / f"model.{fmt}", fmt=fmt)
    script_path = regenerate_script(mdf_path, tmp_path / "regenerated_model.py")

    module_b = exec_model(script_path)
    comps_b = top_level_compositions(module_b)
    assert len(comps_b) == 1, (
        f"Regenerated script produced {len(comps_b)} top-level Compositions "
        f"(expected 1); see {script_path}"
    )
    comp_b = comps_b[0]

    report = {"mdf_path": mdf_path, "script_path": script_path}

    if structural:
        sig_a = structural_signature(
            load_and_introspect(str(source_path), use_sandbox=False)
        )
        sig_b = structural_signature(
            load_and_introspect(str(script_path), use_sandbox=False)
        )
        assert sig_a == sig_b, (
            f"Structural mismatch after MDF round-trip "
            f"(mdf: {mdf_path}, script: {script_path}):\n"
            f"{_diff_signatures(sig_a, sig_b)}"
        )
        report["signature"] = sig_a

    if numerical:
        results_a, results_b = run_with_matched_inputs(
            comp_a, comp_b, num_trials=num_trials
        )
        assert results_a.shape == results_b.shape, (
            f"Result shapes differ after MDF round-trip: "
            f"{results_a.shape} vs {results_b.shape} (script: {script_path})"
        )
        assert np.allclose(results_a, results_b, atol=tolerance), (
            f"Numerical mismatch after MDF round-trip (atol={tolerance}):\n"
            f"original:    {results_a!r}\n"
            f"regenerated: {results_b!r}\n"
            f"script: {script_path}"
        )
        report["results"] = (results_a, results_b)

    return report
