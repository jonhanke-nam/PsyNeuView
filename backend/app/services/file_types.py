"""File-type classification for user-supplied files.

PsyNeuView accepts several file formats (PsyNeuLink Python sources, project
bundles, MDF JSON / YAML). MDF in particular shares the generic `.json` /
`.yaml` extensions with other JSON / YAML payloads, so a robust classifier
is needed: extension is a fast hint, content is authoritative.

This module is the single source of truth for "what is this file?" — every
route that accepts user file input should call ``classify_file()`` rather
than checking extensions inline.

See ``docs/file-conventions.md`` for the full naming convention.
"""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class FileType(str, Enum):
    """Recognized file types accepted by PsyNeuView."""

    PNL_PYTHON = "pnl_python"
    """A PsyNeuLink Python source file (``.py``)."""

    PNLPROJECT = "pnlproject"
    """A PsyNeuView project bundle (``.pnlproject``, zip with ``manifest.json``)."""

    MDF_JSON = "mdf_json"
    """An MDF model serialized as JSON (canonical extension ``.mdf.json``;
    bare ``.json`` accepted if content is valid MDF)."""

    MDF_YAML = "mdf_yaml"
    """An MDF model serialized as YAML (canonical extension ``.mdf.yaml`` /
    ``.mdf.yml``; bare ``.yaml`` / ``.yml`` accepted if content is valid MDF)."""

    UNKNOWN = "unknown"
    """File could not be classified — caller should reject."""


@dataclass
class Classification:
    """Result of classifying a file."""

    file_type: FileType
    warnings: list[str] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.file_type is not FileType.UNKNOWN and self.error is None


# --- Extension classification ---

_PY_EXT = (".py",)
_PNLPROJECT_EXT = (".pnlproject",)
_MDF_JSON_EXTS = (".mdf.json",)
_MDF_YAML_EXTS = (".mdf.yaml", ".mdf.yml")
_BARE_JSON_EXTS = (".json",)
_BARE_YAML_EXTS = (".yaml", ".yml")


def _ends_with_any(name: str, suffixes: tuple[str, ...]) -> bool:
    name = name.lower()
    return any(name.endswith(s) for s in suffixes)


def _classify_by_extension(filename: str) -> tuple[FileType | None, bool]:
    """Return (best-guess file type from extension, is_compound_mdf_hint).

    ``best_guess`` is None when the extension is unrecognized.
    ``is_compound_mdf_hint`` is True when the extension explicitly claims MDF
    (e.g. ``.mdf.json``); these cases must content-verify and a parse failure
    is a hard error rather than a fallthrough.
    """
    name = filename.lower()
    if _ends_with_any(name, _PY_EXT):
        return FileType.PNL_PYTHON, False
    if _ends_with_any(name, _PNLPROJECT_EXT):
        return FileType.PNLPROJECT, False
    # Compound MDF extensions must be checked BEFORE the bare ones, since
    # ``.mdf.json`` also ends with ``.json``.
    if _ends_with_any(name, _MDF_JSON_EXTS):
        return FileType.MDF_JSON, True
    if _ends_with_any(name, _MDF_YAML_EXTS):
        return FileType.MDF_YAML, True
    if _ends_with_any(name, _BARE_JSON_EXTS):
        return FileType.MDF_JSON, False  # candidate, content-sniff to confirm
    if _ends_with_any(name, _BARE_YAML_EXTS):
        return FileType.MDF_YAML, False
    return None, False


# --- Content sniffing ---

def _looks_like_pnlproject(path: Path) -> bool:
    """Cheap structural check for a project bundle: a zip with ``manifest.json``."""
    try:
        with zipfile.ZipFile(path, "r") as zf:
            return "manifest.json" in zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False


def _looks_like_mdf(path: Path) -> bool:
    """Authoritative MDF check: delegate to ``modeci_mdf.utils.load_mdf``.

    The MDF library auto-detects JSON vs YAML by extension and parses the
    content. If it returns a Model without raising, the file is valid MDF.
    """
    try:
        from modeci_mdf.utils import load_mdf  # type: ignore[import-not-found]
    except ImportError:
        # If MDF isn't installed, nothing can be classified as MDF.
        return False

    try:
        load_mdf(str(path))
        return True
    except Exception:
        return False


# --- Public API ---

def classify_file(path: str | Path) -> Classification:
    """Classify a file by extension and content.

    Algorithm:
    1. Extension gives a fast classification hint.
    2. For ambiguous cases (bare ``.json`` / ``.yaml``), content-sniff to confirm.
    3. For compound-extension hints (``.mdf.json``, ``.mdf.yaml``), content-verify;
       a mismatch is an explicit error rather than a silent reclassification.
    4. ``.pnlproject`` is also content-verified (zip + manifest).

    Returns a ``Classification`` with at most one of ``file_type=UNKNOWN`` or
    ``error`` set on failure paths. Soft hints (e.g. "consider renaming") go
    in ``warnings``.
    """
    p = Path(path)
    if not p.exists():
        return Classification(FileType.UNKNOWN, error=f"File not found: {p}")
    if not p.is_file():
        return Classification(FileType.UNKNOWN, error=f"Not a regular file: {p}")

    guess, is_compound_mdf = _classify_by_extension(p.name)

    if guess is None:
        return Classification(
            FileType.UNKNOWN,
            error=(
                f"Unsupported file extension: {p.name!r}. Expected one of "
                f".py, .pnlproject, .mdf.json, .mdf.yaml, .mdf.yml, "
                f".json, .yaml, .yml."
            ),
        )

    # .py — extension is definitive (no syntax check here; downstream pipeline
    # handles parse/exec).
    if guess is FileType.PNL_PYTHON:
        return Classification(FileType.PNL_PYTHON)

    # .pnlproject — must be a real zip with a manifest.
    if guess is FileType.PNLPROJECT:
        if not _looks_like_pnlproject(p):
            return Classification(
                FileType.UNKNOWN,
                error=f"{p.name!r} has a .pnlproject extension but is not a valid project bundle.",
            )
        return Classification(FileType.PNLPROJECT)

    # MDF (JSON or YAML). Content-sniff in every case.
    if guess in (FileType.MDF_JSON, FileType.MDF_YAML):
        if _looks_like_mdf(p):
            warnings: list[str] = []
            if not is_compound_mdf:
                # Bare extension worked, but the user should be encouraged to
                # rename for clarity / future-proofing.
                canonical = ".mdf.json" if guess is FileType.MDF_JSON else ".mdf.yaml"
                warnings.append(
                    f"File {p.name!r} parsed as MDF but uses a generic extension. "
                    f"Consider renaming to use {canonical} for clarity."
                )
            return Classification(guess, warnings=warnings)

        # Content sniff failed. The error message depends on whether the
        # filename made an explicit MDF claim.
        if is_compound_mdf:
            return Classification(
                FileType.UNKNOWN,
                error=(
                    f"{p.name!r} has an MDF extension but its content could not be "
                    f"parsed as MDF. Check the file for syntax errors or schema "
                    f"mismatches."
                ),
            )
        return Classification(
            FileType.UNKNOWN,
            error=(
                f"{p.name!r} is not a recognized PsyNeuView file. Bare .json/.yaml "
                f"files are accepted only if their content is valid MDF."
            ),
        )

    # Defensive — shouldn't happen given the enum is closed.
    return Classification(FileType.UNKNOWN, error=f"Unhandled extension classification for {p.name!r}.")


def classify_upload(filename: str, content: bytes) -> Classification:
    """Classify an in-memory upload (multipart form file).

    Writes ``content`` to a temporary file and runs the same algorithm as
    :func:`classify_file`. The temporary file is cleaned up before return.
    """
    import tempfile

    suffix = Path(filename).name  # full name preserves compound extensions
    with tempfile.NamedTemporaryFile(prefix="psyneuview_upload_", suffix=f"_{suffix}", delete=False) as tf:
        tmp_path = Path(tf.name)
        tf.write(content)
    try:
        return classify_file(tmp_path)
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass
