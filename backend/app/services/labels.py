"""Read sidecar .labels.yaml files for semantic-label overlays (#361).

Sidecar format:

    # model.labels.yaml — semantic labels for vector dimensions.
    #
    # Top-level keys are node names. Each node optionally has:
    #   - a bare `element_names: [...]` shorthand (applies to the default
    #     input AND output port — common case for shape-preserving
    #     mechanisms like TransferMechanism)
    #   - explicit `input_ports` / `output_ports` mappings for finer control.

    word_hidden:
      element_names: [red_word, green_word]

    output:
      output_ports:
        OutputPort-0:
          element_names: [response_red, response_green]

This module is Layer 3 of the three-layer label plan (#356). It does not
affect PsyNeuLink execution; PsyNeuView reads it only at render time, and
the resolver in the frontend merges these labels over any model-intrinsic
labels (Layer 1 — future PsyNeuLink API) when both are present.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.services.sidecar_index import variant_filename
from app.services.sidecar_placement import ensure_parent, resolve_path


def labels_path(model_path: str, variant: str | None = None) -> Path:
    """Return the sidecar path for ``model_path``'s labels.

    ``foo/bar.py`` → ``foo/bar.labels.yaml``. Matches the layout sidecar
    convention (``.pnlview.json``); a model may also carry named variants
    ``foo/bar.<name>.labels.yaml`` (#479); ``None``/``"Default"`` is the
    unsuffixed file.

    Resolved through :mod:`sidecar_placement` alongside the layout sidecar:
    lateral next to the ``.py`` when a lateral file exists, else the hidden
    ``.psyneuview/`` dot-folder (#927), and redirected out of tree for a managed
    clone so it can't dirty the clone's git working tree (#349, #478).
    """
    p = Path(model_path)
    return resolve_path(model_path, variant_filename(p.stem, ".labels.yaml", variant))


def load_labels(model_path: str, variant: str | None = None) -> dict[str, Any] | None:
    """Load the sidecar labels file if it exists, else ``None``.

    Returns the parsed YAML structure as-is — the frontend resolver does
    all the lookup / normalization work. Malformed YAML returns ``None``
    rather than raising; a broken sidecar should never break model load.
    """
    path = labels_path(model_path, variant)
    if not path.exists():
        return None
    try:
        data = yaml.safe_load(path.read_text())
    except (yaml.YAMLError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def save_labels(
    model_path: str, labels: dict[str, Any], variant: str | None = None
) -> None:
    """Write the sidecar labels file for ``model_path`` (#404).

    Writes the supplied dict as YAML next to the .py model file. Creates
    the file if it doesn't exist; overwrites if it does. The caller is
    responsible for the full structure — this is not a merge.

    Empty dict deletes the file so it doesn't sit around as an empty
    sidecar polluting the project directory.
    """
    path = labels_path(model_path, variant)
    if not labels:
        if path.exists():
            path.unlink()
        return
    # ``sort_keys=False`` preserves the user's mental ordering of nodes
    # (and lets the file be diff-friendly when only one node's labels
    # changed). ``default_flow_style=False`` keeps the block-style YAML
    # the existing fixtures use.
    ensure_parent(path).write_text(
        yaml.safe_dump(labels, sort_keys=False, default_flow_style=False)
    )
