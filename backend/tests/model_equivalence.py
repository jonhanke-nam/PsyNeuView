"""Are two model files the same PsyNeuLink model? A test helper (#319).

A model built in PsyNeuView's graph and one typed as code should be the same
composition, and run the same. This loads each file in a fresh Python process
(PsyNeuLink's name registries are global, so two models in one process would
rename each other's nodes), describes the outermost composition, runs it, and
compares the two descriptions:

- nodes: name, type, the composition they sit in, their function's type and
  key parameters, and their input ports;
- projections: type, sender, receiver and the receiver's port, plus the
  sender's port for a pathway projection, and the matrix, or whether learning
  is on. A projection into a nested composition counts as one into the inner
  node it delivers to, however PsyNeuLink routes it through the
  composition's interface; the interfaces' own projections are left out.
  A projection's own name is left out: the graph names the ones it writes,
  hand-written code usually doesn't;
- results: the outermost composition run on the same inputs, a vector of
  2.0 into every element of each input node, for two trials.

Used by the backend tests and, as a script, by the browser tests
(e2e/ui-text-equivalence.spec.ts)::

    python tests/model_equivalence.py compare a.py b.py   # prints JSON; exit 1 if they differ
    python tests/model_equivalence.py describe a.py       # prints one model's description
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Function parameters compared when the function has them.
KEY_PARAMS = (
    "gain", "bias", "offset", "slope", "intercept", "rate", "noise", "leak",
    "threshold", "scale", "integration_rate", "starting_value", "drift_rate",
)
TRIALS = 2
# Not 1: a control or gating signal of 1 leaves most parameters as they were,
# so a missing one would run the same.
INPUT_VALUE = 2.0


def _plain(value):
    """A parameter value as JSON: numbers rounded, arrays as lists."""
    import numpy as np

    if isinstance(value, (bool, str)) or value is None:
        return value
    if isinstance(value, (int, float, np.integer, np.floating)):
        return round(float(value), 9)
    try:
        arr = np.asarray(value, dtype=float)
    except (TypeError, ValueError):
        return type(value).__name__
    return np.round(arr, 9).tolist()


def describe(path: str) -> dict:
    """Load ``path`` here, in this process, and describe and run its outermost composition."""
    import runpy

    import numpy as np
    import psyneulink as pnl

    ns = runpy.run_path(str(path), run_name="__pnv_equivalence__")
    comps = [v for v in ns.values() if isinstance(v, pnl.Composition)]
    if not comps:
        raise ValueError(f"{path}: no Composition at the top level of the file")
    inner_ids = {id(n) for c in comps for n in c.nodes if isinstance(n, pnl.Composition)}
    comp = next(c for c in comps if id(c) not in inner_ids)

    # Run first: PsyNeuLink completes a composition (its interface projections,
    # the matrices it assigns) when it first runs.
    inputs = {
        n: [np.full(np.shape(v), INPUT_VALUE).tolist() for v in n.defaults.variable]
        for n in comp.get_nodes_by_role(pnl.NodeRole.INPUT)
    }
    comp.run(inputs=inputs, num_trials=TRIALS)
    results = [[_plain(v) for v in trial] for trial in comp.results]

    nodes: list[dict] = []
    ports: list = []  # every port whose incoming projections are recorded

    def walk(c, where: str):
        for cim in (c.input_CIM, c.parameter_CIM, c.output_CIM):
            ports.extend(cim.input_ports)
        for n in c.nodes:
            if isinstance(n, pnl.Composition):
                nodes.append({"name": n.name, "type": "Composition", "in": where})
                walk(n, f"{where}/{n.name}")
                continue
            fn = getattr(n, "function", None)
            params = {}
            for k in KEY_PARAMS:
                if fn is not None and hasattr(fn.defaults, k):
                    params[k] = _plain(getattr(fn.defaults, k))
            nodes.append(
                {
                    "name": n.name,
                    "type": type(n).__name__,
                    "in": where,
                    "function": type(fn).__name__ if fn is not None else None,
                    "params": params,
                    "input_ports": [p.name for p in n.input_ports],
                    "input_shapes": [list(np.shape(v)) for v in n.defaults.variable],
                }
            )
            ports.extend(list(n.input_ports) + list(n.parameter_ports) + list(n.output_ports))

    walk(comp, comp.name)

    from psyneulink.core.components.mechanisms.processing.compositioninterfacemechanism import (
        CompositionInterfaceMechanism as CIM,
    )

    def delivered_to(port) -> list:
        """Where a projection into ``port`` ends up, past any composition's interface.

        Into a nested composition, PsyNeuLink routes a projection through that
        composition's input interface, and it builds the route differently for
        `pathways=[[a, inner]]` than for a projection drawn to the inner node
        itself. Both deliver to the same inner port, and that is what is
        compared. Into the outermost output interface: nowhere, so nothing.
        """
        if not isinstance(port.owner, CIM):
            return [port]
        out = []
        for cim_in, cim_out in port.owner.port_map.values():
            if cim_in is port:
                for eff in cim_out.efferents:
                    out.extend(delivered_to(eff.receiver))
        return out

    projections: list[dict] = []
    keys: set[str] = set()
    seen: set[int] = set()
    queue = list(ports)
    while queue:
        port = queue.pop()
        # Only input ports have pathway afferents; PsyNeuLink raises on the others.
        path = list(port.path_afferents) if isinstance(port, pnl.InputPort) else []
        for proj in path + list(port.mod_afferents):
            if id(proj) in seen:
                continue
            seen.add(id(proj))
            if isinstance(proj, pnl.MappingProjection):
                # A learning projection trains this projection's matrix.
                queue.extend(proj.parameter_ports)
            # From an interface: the far half of a route resolved below, or the
            # outside world's input. Either way, not a projection anyone drew.
            if isinstance(proj.sender.owner, CIM):
                continue
            mapping = isinstance(proj, pnl.MappingProjection)  # a ProxyProjection is one
            for receiver in delivered_to(proj.receiver):
                rec = {
                    "type": "MappingProjection" if mapping else type(proj).__name__,
                    "sender": proj.sender.owner.name,
                    "receiver": receiver.owner.name,
                    "receiver_port": receiver.name,
                }
                if mapping:
                    rec["sender_port"] = proj.sender.name
                    rec["matrix"] = _plain(proj.parameters.matrix.get(comp))
                if isinstance(proj, pnl.LearningProjection):
                    rec["learning_enabled"] = _plain(proj.parameters.learning_enabled.get(comp))
                key = json.dumps(rec, sort_keys=True)
                if key not in keys:
                    keys.add(key)
                    projections.append(rec)


    nodes.sort(key=lambda d: (d["in"], d["name"]))
    projections.sort(key=lambda d: json.dumps(d, sort_keys=True))
    return {"composition": comp.name, "nodes": nodes, "projections": projections, "results": results}


def describe_fresh(path: str) -> dict:
    """``describe``, in a fresh Python process."""
    proc = subprocess.run(
        [sys.executable, __file__, "describe", str(path)], capture_output=True, text=True, timeout=300
    )
    if proc.returncode != 0:
        raise RuntimeError(f"describing {path} failed:\n{proc.stderr[-4000:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def differences(a: dict, b: dict, *, tolerance: float = 1e-9) -> list[str]:
    """What differs between two descriptions, in words; empty when they are the same model."""
    import numpy as np

    out: list[str] = []
    if a["composition"] != b["composition"]:
        out.append(f"outermost composition: {a['composition']!r} vs {b['composition']!r}")
    an = {(n["in"], n["name"]): n for n in a["nodes"]}
    bn = {(n["in"], n["name"]): n for n in b["nodes"]}
    for key in sorted(an.keys() - bn.keys()):
        out.append(f"node only in the first: {key[1]} in {key[0]}")
    for key in sorted(bn.keys() - an.keys()):
        out.append(f"node only in the second: {key[1]} in {key[0]}")
    for key in sorted(an.keys() & bn.keys()):
        for field in ("type", "function", "params", "input_ports", "input_shapes"):
            if an[key].get(field) != bn[key].get(field):
                out.append(f"node {key[1]}: {field} {an[key].get(field)!r} vs {bn[key].get(field)!r}")
    ap = sorted(json.dumps(p, sort_keys=True) for p in a["projections"])
    bp = sorted(json.dumps(p, sort_keys=True) for p in b["projections"])
    for p in sorted(set(ap) - set(bp)):
        out.append(f"projection only in the first: {p}")
    for p in sorted(set(bp) - set(ap)):
        out.append(f"projection only in the second: {p}")
    try:
        same = len(a["results"]) == len(b["results"]) and all(
            len(x) == len(y) and all(np.allclose(u, v, atol=tolerance) for u, v in zip(x, y))
            for x, y in zip(a["results"], b["results"])
        )
    except ValueError:
        same = False
    if not same:
        out.append(f"results: {a['results']!r} vs {b['results']!r}")
    return out


def compare(path_a: str, path_b: str) -> dict:
    a, b = describe_fresh(path_a), describe_fresh(path_b)
    diffs = differences(a, b)
    return {"equal": not diffs, "differences": diffs, "a": a, "b": b}


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "describe":
        print(json.dumps(describe(argv[1])))
        return 0
    if len(argv) == 3 and argv[0] == "compare":
        result = compare(argv[1], argv[2])
        print(json.dumps(result))
        return 0 if result["equal"] else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    # Run as a script: make `app` importable the way the tests see it.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.exit(main(sys.argv[1:]))
