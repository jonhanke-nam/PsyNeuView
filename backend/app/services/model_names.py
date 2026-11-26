"""Model file names that clash in a PsyNeuLink source (#422).

PsyNeuView names a model by its file name. Two model files in the same
PsyNeuLink whose names differ only in case, or are the same in two folders,
can't both be told apart that way, and on a Mac (where the file system ignores
case) they are the same file. Nor may a PsyNeuLink model take the file name of
a Reference Model unless it is declared as that model (``library`` in
``REFERENCE_MODELS``).

:func:`find_clashes` looks for both in a PsyNeuLink tree: the Library
(``psyneulink/library/models``) and the examples (``Scripts/Examples``).
It is run when a source is cloned or switched to (``install_manager``), which
writes a warning in the install log, and by ``/api/psyneulink/name-clashes``,
which the page asks after a switch to show a one-time notice and record it in
the activity log. It never picks one of the clashing files over the other;
it only says which they are.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, TypedDict

logger = logging.getLogger(__name__)


class Clash(TypedDict):
    #: The shared name, without ``.py``, as the first file spells it.
    stem: str
    #: The clashing files, relative to the PsyNeuLink tree.
    files: list[str]
    #: "source": two files in this PsyNeuLink; "reference": one takes a
    #: Reference Model's name without being declared as that model.
    kind: str


def model_files(root: Path) -> list[Path]:
    """The model files of a PsyNeuLink tree (a checkout's root, or the folder
    that holds the ``psyneulink`` package): its Library and its examples."""
    found: list[Path] = []
    for folder, pattern in ((root / "psyneulink" / "library" / "models", "*.py"),
                            (root / "Scripts" / "Examples", "**/*.py")):
        if not folder.is_dir():
            continue
        found += [p for p in sorted(folder.glob(pattern)) if p.is_file() and not p.stem.startswith("__")]
    return found


def find_clashes(root: Path, references: Iterable[dict]) -> list[Clash]:
    """Every clash in the PsyNeuLink tree at ``root``; empty when there is none.

    ``references`` is ``REFERENCE_MODELS``: each a ``name`` and, when it is a
    pinned copy of a Library model, ``library``.
    """
    files = model_files(root)
    by_name: dict[str, list[Path]] = {}
    for f in files:
        by_name.setdefault(f.stem.lower(), []).append(f)

    def rel(p: Path) -> str:
        try:
            return str(p.relative_to(root))
        except ValueError:
            return str(p)

    clashes: list[Clash] = []
    for group in by_name.values():
        if len(group) > 1:
            clashes.append({"stem": group[0].stem, "files": [rel(p) for p in group], "kind": "source"})

    library = root / "psyneulink" / "library" / "models"
    for ref in references:
        declared = (ref.get("library") or "").lower()
        for f in by_name.get(ref["name"].lower(), []):
            is_declared_library_model = f.parent == library and f.stem.lower() == declared
            if not is_declared_library_model:
                clashes.append({"stem": ref["name"], "files": [rel(f)], "kind": "reference"})
    return clashes


def describe(clashes: list[Clash]) -> str:
    """One sentence naming the clashes, for the install log and the notice."""
    parts = []
    for c in clashes:
        if c["kind"] == "source":
            parts.append(f"{c['stem']} ({', '.join(c['files'])})")
        else:
            parts.append(f"{c['stem']} ({c['files'][0]} has a Reference Model's name)")
    return "Model files share a name in this PsyNeuLink: " + "; ".join(parts) + "."


def report(root: Path, on_line=None) -> list[Clash]:
    """Check ``root`` and write a warning line when anything clashes. Never raises."""
    try:
        from app.api.routes import REFERENCE_MODELS

        clashes = find_clashes(root, REFERENCE_MODELS)
    except Exception as e:  # noqa: BLE001 — a check must not fail an install
        logger.warning("model names: couldn't check %s: %s", root, e)
        return []
    if clashes:
        line = f"Warning: {describe(clashes)}"
        logger.warning(line)
        if on_line:
            on_line(line)
    return clashes
