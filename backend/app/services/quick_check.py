"""A fast static check of model code before it is run (#256).

The editor's live preview executes the model, which takes seconds; a syntax
error or an undefined name is found in milliseconds without running anything.
Found here, the preview answers at once with the error and its line, and the
model isn't run at all.

Conservative on purpose: a name the check can't see being defined must not
block a model that would run. So undefined names are reported only for a script
that defines its names in ways a static check can follow: no ``import *``, no
``globals()``, ``exec`` or ``eval``.
"""

from __future__ import annotations

import ast
from typing import Optional

_DYNAMIC_NAMES = ("globals(", "exec(", "eval(", "__builtins__", "setattr(sys.modules")


def quick_check(source: str, filename: str = "<model>") -> Optional[dict]:
    """``{"error", "line"}`` for the first problem found, else None."""
    try:
        tree = ast.parse(source, filename)
        compile(tree, filename, "exec")
    except SyntaxError as e:
        return {"error": f"{e.msg}", "line": e.lineno}
    except (ValueError, TypeError):
        return None

    if any(marker in source for marker in _DYNAMIC_NAMES):
        return None
    try:
        from pyflakes import checker, messages
    except ImportError:  # an environment without it: only the syntax check
        return None
    found = checker.Checker(tree, filename=filename)
    if any(isinstance(m, messages.ImportStarUsed) for m in found.messages):
        return None
    undefined = sorted(
        (m for m in found.messages if isinstance(m, messages.UndefinedName)),
        key=lambda m: m.lineno,
    )
    if not undefined:
        return None
    first = undefined[0]
    # Python's own words, as the full run would say it.
    return {"error": f"name '{first.message_args[0]}' is not defined", "line": first.lineno}
