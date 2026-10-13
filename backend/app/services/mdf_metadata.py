"""Bridge between PsyNeuView's ``.pnlview.json`` sidecar and MDF's free-form
``metadata`` field (issue #86).

When PsyNeuView exports MDF, we embed visual/layout state under
``metadata.psyneuview.*`` so the file round-trips back to PsyNeuView with
positions intact. Foreign MDF (without the namespace) is ignored — the
sidecar is simply not written, and the frontend falls back to Dagre.

Schema:

```jsonc
{
  "metadata": {
    "psyneuview": {
      "version": 1,
      "layout":   { "<node_id>": {"x": 120.0, "y": 80.0} },
      "viewport": { "x": 0, "y": 0, "zoom": 1 }
    }
  }
}
```

``version`` is bumped on incompatible schema changes; readers MUST treat
unknown versions as foreign MDF (no restoration).
"""

from __future__ import annotations

import re

PSYNEUVIEW_METADATA_VERSION = 1

# PsyNeuLink appends two flavors of duplicate-instance suffix that we have
# to canonicalize away when matching sidecar keys to live names:
#   * ``_<digits>`` — added by ``generate_script_from_mdf`` when the var
#     name already exists in the global Component registry on MDF import.
#   * ``-<digits>`` — added by PsyNeuLink itself to ``mech.name`` when a
#     same-named instance is created in the same process (showing up in
#     introspection output).
# Either may appear, sometimes stacked (``foo_1-2``); strip both repeatedly.
_SESSION_SUFFIX_RE = re.compile(r"[-_]\d+$")


def _canonical(name: str) -> str:
    prev = None
    while prev != name:
        prev = name
        name = _SESSION_SUFFIX_RE.sub("", name)
    return name


def remap_layout_to_live_names(layout: dict, live_names: list[str]) -> dict:
    """Map sidecar position keys onto the imported model's live node names.

    PsyNeuLink appends a session-instance suffix (``_1``, ``_2``…) when
    re-instantiating MDF, so sidecar keys from the source model don't
    line up with the re-imported model's nodes. We canonicalize both
    sides (strip trailing ``_<digits>``) and pair them up.

    A live name with no canonical match is left without a position
    (frontend falls back to its default placement). A sidecar key with
    no live counterpart is dropped — it referred to a node that didn't
    survive the round-trip.
    """
    if not layout or not live_names:
        return {}
    by_canonical = {_canonical(k): k for k in layout}
    out: dict = {}
    for live in live_names:
        original = by_canonical.get(_canonical(live))
        if original is not None:
            out[live] = layout[original]
    return out


def build_psyneuview_metadata(sidecar: dict | None) -> dict | None:
    """Build the ``metadata.psyneuview`` block from a ``.pnlview.json`` sidecar.

    Returns ``None`` if the sidecar is empty or has no positions to embed,
    so callers can skip injecting metadata entirely.
    """
    if not sidecar:
        return None
    positions = sidecar.get("positions")
    if not positions:
        return None
    block: dict = {
        "version": PSYNEUVIEW_METADATA_VERSION,
        "layout": positions,
    }
    viewport = sidecar.get("viewport")
    if viewport:
        block["viewport"] = viewport
    return block


def extract_psyneuview_metadata(mdf_text: str, fmt: str) -> dict | None:
    """Extract ``metadata.psyneuview`` from raw MDF text.

    Returns ``None`` when the file isn't parseable as MDF, lacks the
    namespace, or carries an unknown ``version``. The version check is the
    forward-compatibility guard from the schema.
    """
    from modeci_mdf.mdf import Model

    try:
        if fmt == "yaml":
            model = Model.from_yaml(mdf_text)
        elif fmt == "json":
            model = Model.from_json(mdf_text)
        else:
            return None
    except Exception:
        return None

    md = getattr(model, "metadata", None) or {}
    if not isinstance(md, dict):
        return None
    pv = md.get("psyneuview")
    if not isinstance(pv, dict):
        return None
    if pv.get("version") != PSYNEUVIEW_METADATA_VERSION:
        return None
    return pv


def _raw_mdf_graphs(mdf_text: str, fmt: str) -> dict:
    """The ``graphs`` of a serialized MDF model, parsed from the raw text.

    Raw parsing (not ``modeci_mdf``) so the detectors still work on files the
    MDF library itself can't load. Serialized MDF is ``{model_name:
    {"graphs": {...}}}``; a bare model dict is accepted too. ``{}`` on any
    parse failure.
    """
    try:
        if fmt == "yaml":
            import yaml

            data = yaml.safe_load(mdf_text)
        elif fmt == "json":
            import json

            data = json.loads(mdf_text)
        else:
            return {}
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    graphs: dict = {}
    for model in [data, *(v for v in data.values() if isinstance(v, dict))]:
        g = model.get("graphs")
        if isinstance(g, dict):
            graphs.update({k: v for k, v in g.items() if isinstance(v, dict)})
    return graphs


def detect_shared_nodes(mdf_text: str, fmt: str) -> list[str]:
    """Nodes that appear in more than one graph (#83).

    PsyNeuLink writes a component that two Compositions share into each
    Composition's graph under the same id. ``generate_script_from_mdf`` then
    creates it once per graph, so the imported Compositions no longer share
    it (upstream jonhanke-nam/PsyNeuLink#4). Returns "name (in g1, g2)".
    """
    holders: dict[str, list[str]] = {}
    for graph_id, graph in _raw_mdf_graphs(mdf_text, fmt).items():
        nodes = graph.get("nodes")
        if isinstance(nodes, dict):
            for node_id in nodes:
                holders.setdefault(node_id, []).append(graph_id)
    return [f"{n} (in {', '.join(g)})" for n, g in holders.items() if len(g) > 1]


def detect_nested_compositions(mdf_text: str, fmt: str) -> list[str]:
    """Names of graph nodes that are themselves serialized Compositions (#82).

    PsyNeuLink's MDF export does not flatten nested Compositions: the inner
    Composition is emitted as a single graph *node* carrying
    ``metadata.type == "Composition"`` and a non-standard nested ``nodes``
    dict, and its boundary edges are dropped. ``generate_script_from_mdf``
    then crashes on such files. Detecting the pattern up front lets us warn
    instead of surfacing a cryptic TypeError.

    Parses the raw text (not via ``modeci_mdf``) so detection still works on
    files the MDF library itself can't load. Returns ``[]`` on any parse
    failure or when no nested-composition signature is found.
    """
    found: list[str] = []
    seen: set[str] = set()
    for graph in _raw_mdf_graphs(mdf_text, fmt).values():
        nodes = graph.get("nodes")
        if not isinstance(nodes, dict):
            continue
        for node_name, node in nodes.items():
            if not isinstance(node, dict) or node_name in seen:
                continue
            md = node.get("metadata")
            md_type = md.get("type") if isinstance(md, dict) else None
            is_comp_type = isinstance(md_type, str) and md_type.endswith("Composition")
            has_inner_nodes = isinstance(node.get("nodes"), dict)
            if is_comp_type or has_inner_nodes:
                seen.add(node_name)
                found.append(node_name)
    return found


def inject_psyneuview_metadata(mdf_text: str, fmt: str, block: dict) -> str:
    """Re-serialize MDF text with a ``metadata.psyneuview`` block attached.

    Implemented as parse → mutate → serialize so behavior matches whatever
    ``get_mdf_serialized`` already produces for non-metadata paths.
    """
    from modeci_mdf.mdf import Model

    if fmt == "yaml":
        model = Model.from_yaml(mdf_text)
        existing = (getattr(model, "metadata", None) or {}) if isinstance(getattr(model, "metadata", None), dict) else {}
        model.metadata = {**existing, "psyneuview": block}
        return model.to_yaml()
    elif fmt == "json":
        model = Model.from_json(mdf_text)
        existing = (getattr(model, "metadata", None) or {}) if isinstance(getattr(model, "metadata", None), dict) else {}
        model.metadata = {**existing, "psyneuview": block}
        return model.to_json()
    else:
        raise ValueError(f"Unsupported MDF format: {fmt!r}")
