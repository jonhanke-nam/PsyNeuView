"""MkDocs hooks for the docs site (mkdocs.yml ``hooks:``).

The What's tested pages (``testing-coverage.md`` and
``testing-coverage-tests.md``) are built from the test files by
``scripts/test_map.py`` on every docs build and added to the site here, so
they are never committed and no two pull requests conflict over them (#380).
A spec that is neither in CI nor says why is reported as a warning, so the
strict build (``mkdocs build --strict``) fails on it too.
"""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path

from mkdocs.structure.files import File, Files

log = logging.getLogger("mkdocs.plugins.test_map")

_SCRIPT = Path(__file__).resolve().parent / "test_map.py"


def _test_map():
    spec = importlib.util.spec_from_file_location("test_map", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["test_map"] = mod  # dataclasses look the module up by name
    spec.loader.exec_module(mod)
    return mod


def on_files(files: Files, config) -> Files:
    pages, problems = _test_map().pages()
    for name, text in pages.items():
        old = files.get_file_from_path(name)
        if old is not None:  # a stray copy left in docs/ by hand: the built one wins
            files.remove(old)
        files.append(File.generated(config, name, content=text))
    for p in problems:
        log.warning(f"test-map: {p}")
    return files
