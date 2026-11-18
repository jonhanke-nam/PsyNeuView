"""show_graph's picture as show_graph's own PDF and PNG draw it (#190).

show_graph names its colours ("green", "red", "purple", ...), and Graphviz
keeps a name as it is when it writes an SVG. The PDF and PNG show_graph
writes draw each name with its X11 value, but a browser reads the same name
in an SVG with its CSS value, and the two differ for two of its names: X11
green is #00ff00, CSS green is #008000; X11 purple is #a020f0, CSS purple is
#800080. So the show_graph tab, which shows that SVG, drew INPUT nodes and
controllers darker than show_graph's own picture, and than the app's graph,
whose outlines are show_graph's green (#00ff00) and purple (#a020f0).

The tab's picture is redrawn here with the X11 value where the two differ,
so the tab, the graph and show_graph's PDF agree. Every other colour show_graph
names reads the same both ways, so only these two are redrawn.
"""

from __future__ import annotations

import re

# Colour name -> the value Graphviz's PDF and PNG draw it with, for the names
# a browser would otherwise read differently.
GRAPHVIZ_COLOURS: dict[str, str] = {
    "green": "#00ff00",
    "purple": "#a020f0",
}

# Bumped whenever the way the picture is redrawn changes, so a picture kept
# in show_graph_cache before the change is not shown again (#22).
PICTURE_VERSION = 2

# A colour as an SVG attribute: stroke="green", fill="green". Only the
# attribute value, never the text of a node whose name happens to be a
# colour name.
_COLOUR_ATTR = re.compile(
    r'\b(stroke|fill|stop-color)="(' + "|".join(map(re.escape, GRAPHVIZ_COLOURS)) + r')"'
)


def as_graphviz_draws_it(svg: str) -> str:
    """``svg`` with each named colour Graphviz's PDF would draw differently
    replaced by that value."""
    return _COLOUR_ATTR.sub(lambda m: f'{m.group(1)}="{GRAPHVIZ_COLOURS[m.group(2)]}"', svg)
