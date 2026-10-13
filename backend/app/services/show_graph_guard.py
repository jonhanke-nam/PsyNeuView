"""Neutralise ``show_graph`` across the whole Composition hierarchy. (#1090)

A model file that calls ``comp.show_graph()`` at module level makes PsyNeuLink
render a Graphviz PDF, which macOS then opens in Preview — so loading a model
buries the app behind a window nobody asked for. PsyNeuView draws the graph
itself, so the call is redundant here by construction.

#608 suppressed this by patching ``pnl.Composition.show_graph``. That is not
enough: ``AutodiffComposition`` defines its own ``show_graph``, and a subclass's
own method shadows the patched base. ``EMComposition`` inherits from it, which
is why an EM model still threw ``EM_Composition.pdf`` over the app.

So patch every class in the hierarchy that defines the method itself, not just
the root.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


def _all_subclasses(cls: type) -> list[type]:
    """Every subclass of ``cls``, recursively, each appearing once.

    ``__subclasses__`` is only one level deep, and the hierarchy that matters
    here is three deep (Composition -> AutodiffComposition -> EMComposition).
    """
    seen: dict[int, type] = {}
    stack = [cls]
    while stack:
        current = stack.pop()
        for sub in current.__subclasses__():
            if id(sub) not in seen:
                seen[id(sub)] = sub
                stack.append(sub)
    return list(seen.values())


def classes_defining_show_graph(root: type) -> list[type]:
    """Classes in ``root``'s hierarchy that define ``show_graph`` themselves.

    Membership in ``__dict__`` is the point: a class that merely inherits the
    method needs no patch, and patching one would create an attribute that has
    to be deleted rather than restored. Classes that define it are exactly the
    ones whose own method would otherwise shadow a patched ancestor.
    """
    candidates = [root] + _all_subclasses(root)
    return [cls for cls in candidates if "show_graph" in cls.__dict__]


def suppress_show_graph(composition_class: type) -> list[Callable[[], None]]:
    """Replace ``show_graph`` with a no-op across the hierarchy.

    Returns restore callables, to be run in a ``finally``. Each restores the
    class's own original method, so a class that inherited the method before
    is not left holding one of its own afterwards.
    """
    def noop(self: Any, *args: Any, **kwargs: Any) -> None:
        return None

    restore_fns: list[Callable[[], None]] = []
    for cls in classes_defining_show_graph(composition_class):
        original = cls.__dict__["show_graph"]
        try:
            setattr(cls, "show_graph", noop)
        except (AttributeError, TypeError):
            # A class that refuses attribute assignment. Nothing to restore,
            # and one stubborn class must not stop us patching the rest.
            logger.debug("could not suppress show_graph on %s", cls.__name__)
            continue
        restore_fns.append(
            (lambda c, fn: lambda: setattr(c, "show_graph", fn))(cls, original)
        )
    return restore_fns
