"""show_graph's picture as show_graph's own PDF and PNG draw it (#190, #424).

show_graph names its colours ("green", "purple", "grey", ...). Graphviz's
PDF and PNG draw a name with its value in Graphviz's X11 table, but when it
writes an SVG it keeps any name SVG also knows, and a browser then reads it
from the SVG/CSS table. The two tables disagree on several names: X11 green
is #00ff00, CSS green #008000; purple #a020f0 against #800080; gray and grey
#c0c0c0 against #808080; maroon #b03060 against #800000. So a show_graph
picture shown as SVG drew colours show_graph never draws.

``as_graphviz_draws_it`` rewrites every colour name in an SVG to its hex
value in Graphviz's X11 table, before the SVG leaves the server. The table is
``graphviz_x11_colours.json``, shared with the e2e sheet helper
(frontend/e2e/graphvizColours.ts), which lays out SVG in the browser itself.

Rewritten: the ``fill``, ``stroke``, ``color`` and ``stop-color`` attributes,
and the same properties in an inline ``style``. Names match whatever their
case (Graphviz keeps "GREEN" as written) and include grey/gray and the
numbered X11 variants (gray50, green4). Hex values, ``none``,
``transparent`` and ``url(#...)`` gradients are left as they are, and so is
the text of a node whose name happens to be a colour.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# Colour name (lower case) -> the hex value Graphviz's PDF and PNG draw it with.
GRAPHVIZ_COLOURS: dict[str, str] = json.loads(
    (Path(__file__).with_name("graphviz_x11_colours.json")).read_text()
)["colours"]

# Bumped whenever the way the picture is redrawn changes, so a picture kept
# in show_graph_cache before the change is not shown again (#22).
PICTURE_VERSION = 3

_PROPERTIES = r"(?:stop-color|fill|stroke|color)"

# A colour attribute: stroke="green", fill='Gray50'. Not preceded by a letter
# or a dash, so stop-color's "color" and fill-opacity are not mistaken for it.
_COLOUR_ATTR = re.compile(r'(?<![\w-])(' + _PROPERTIES + r')(\s*=\s*)(["\'])([A-Za-z][A-Za-z0-9]*)\3')

# An inline style, and a colour declaration inside one: style="fill: green;".
_STYLE_ATTR = re.compile(r'(?<![\w-])(style\s*=\s*)(["\'])(.*?)\2', re.S)
_STYLE_DECL = re.compile(r'(?<![\w-])(' + _PROPERTIES + r')(\s*:\s*)([A-Za-z][A-Za-z0-9]*)(?=\s*(?:;|!|$))')


def x11_hex(name: str) -> str | None:
    """The hex value Graphviz draws ``name`` with, or None if it is not one of its colour names."""
    return GRAPHVIZ_COLOURS.get(name.lower())


def _attr(m: re.Match) -> str:
    value = x11_hex(m.group(4))
    return m.group(0) if value is None else f"{m.group(1)}{m.group(2)}{m.group(3)}{value}{m.group(3)}"


def _decl(m: re.Match) -> str:
    value = x11_hex(m.group(3))
    return m.group(0) if value is None else f"{m.group(1)}{m.group(2)}{value}"


def _style(m: re.Match) -> str:
    return f"{m.group(1)}{m.group(2)}{_STYLE_DECL.sub(_decl, m.group(3))}{m.group(2)}"


def as_graphviz_draws_it(svg: str) -> str:
    """``svg`` with every colour name replaced by the hex value Graphviz's
    PDF draws it with."""
    svg = _COLOUR_ATTR.sub(_attr, svg)
    if "style" in svg:
        svg = _STYLE_ATTR.sub(_style, svg)
    return svg
