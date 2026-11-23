"""The palette's role colours match PsyNeuLink's show_graph EXACTLY (#306, #190).

The owner's design decision: show_graph is the gold standard for what colour
a role is, and PsyNeuView's role colours match it exactly. This test keeps
the two in step. It reads show_graph's defaults from PsyNeuLink itself
(``ShowGraph.__init__``'s colour arguments, by ``inspect.signature``),
resolves each name the way Graphviz draws it in the PDF and PNG show_graph
writes (its X11 colour scheme), and compares with the palette tokens read
from ``frontend/src/styles/palette.css``:

    argument                   show_graph  X11      palette token
    input_color                green       #00ff00  --pnv-role-input
    output_color               red         #ff0000  --pnv-role-output
    control_color              blue        #0000ff  --pnv-role-control
    controller_color           purple      #a020f0  --pnv-role-controller
    learning_color             orange      #ffa500  --pnv-role-learning
    probe_color                pink        #ffc0cb  --pnv-role-probe
    input_and_output_color     brown       #a52a2a  --pnv-role-singleton
    default_node_color         black       #000000  --pnv-role-internal (+ feedback-sender, cycle)
    inactive_projection_color  red         #ff0000  --pnv-projection-inactive

Every ``*_color`` argument ShowGraph has must be either compared here or
listed in UNMATCHED with the reason, so when PsyNeuLink adds or renames one
the test fails and names it.

The one exception to "exactly" is the role TEXT tokens (``--pnv-role-*-text``):
show_graph draws no text in a role's colour, so they are darker for
legibility (frontend/src/styles/showGraphColours.test.ts checks their hue).
Its partner there also holds palette.css to a checked-in copy of this table,
so a frontend-only change cannot drift either.
"""

from __future__ import annotations

import inspect
import re
import shutil
from pathlib import Path

import pytest

PALETTE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "styles" / "palette.css"

# show_graph's keyword -> the palette tokens drawn in that colour.
MATCHED = {
    "input_color": ["--pnv-role-input"],
    "output_color": ["--pnv-role-output"],
    "control_color": ["--pnv-role-control"],
    "controller_color": ["--pnv-role-controller"],
    "learning_color": ["--pnv-role-learning"],
    "probe_color": ["--pnv-role-probe"],
    "input_and_output_color": ["--pnv-role-singleton"],
    "default_node_color": ["--pnv-role-internal", "--pnv-role-feedback-sender", "--pnv-role-cycle"],
    "inactive_projection_color": ["--pnv-projection-inactive"],
}
# show_graph's ``*_color`` arguments with no palette token to match, and why.
UNMATCHED = {
    "active_color": "not a colour: 'bold', the style show_graph gives an active node",
    "composition_color": (
        "PsyNeuView draws a nested composition as a frame with its own --pnv-composition-* "
        "set, not as a role-coloured node; open question on #306"
    ),
}

# Graphviz's X11 scheme (graphviz.org/doc/info/colors.html) for the names
# show_graph uses, used only when the Graphviz programs are not on the
# machine to ask.
X11 = {
    "green": "#00ff00", "red": "#ff0000", "blue": "#0000ff", "purple": "#a020f0",
    "orange": "#ffa500", "pink": "#ffc0cb", "brown": "#a52a2a", "black": "#000000",
}


def show_graph_defaults() -> dict[str, str]:
    """show_graph's default colour names, read from PsyNeuLink itself."""
    try:
        from psyneulink.core.compositions.showgraph import ShowGraph
    except Exception as e:  # noqa: BLE001 - any failure here must be loud
        pytest.fail(f"PsyNeuLink's ShowGraph could not be imported: {e!r}")
    params = inspect.signature(ShowGraph.__init__).parameters
    defaults = {}
    for kw in MATCHED:
        p = params.get(kw)
        if p is None or not isinstance(p.default, str):
            pytest.fail(f"ShowGraph.__init__ has no string default for {kw!r}: has show_graph changed?")
        defaults[kw] = p.default
    return defaults


def palette_tokens() -> dict[str, str]:
    """``--pnv-role-*`` and ``--pnv-projection-*`` -> six-digit hex, read from palette.css."""
    if not PALETTE.is_file():
        pytest.fail(f"palette.css not found at {PALETTE}; is the frontend checked out beside backend/?")
    text = PALETTE.read_text(encoding="utf-8")
    tokens = {}
    for name, value in re.findall(r"(--pnv-(?:role|projection)-[a-z-]+)\s*:\s*([^;]+);", text):
        value = value.strip().lower()
        if re.fullmatch(r"#[0-9a-f]{3}", value):
            value = "#" + "".join(ch * 2 for ch in value[1:])
        tokens[name] = value
    if not tokens:
        pytest.fail(f"no --pnv-role-* tokens found in {PALETTE}")
    return tokens


def as_graphviz_draws(name: str) -> str:
    """``name`` as the PDF and PNG show_graph writes draw it: six-digit hex.

    Asks Graphviz itself when its programs are installed (``/x11/<name>``
    makes it write the resolved value instead of the name), else the table.
    """
    if shutil.which("dot"):
        import graphviz as gv

        svg = gv.Source(f'digraph {{ a [color="/x11/{name}"] }}').pipe(format="svg").decode()
        found = re.findall(r'<ellipse[^>]*stroke="(#[0-9a-fA-F]{6})"', svg)
        if not found:
            pytest.fail(f"Graphviz did not write a hex value for /x11/{name}: {svg[:400]}")
        return found[0].lower()
    if name not in X11:
        pytest.fail(f"no X11 value known for show_graph's {name!r} and no `dot` to ask")
    return X11[name]


@pytest.mark.parametrize(
    "keyword,token", [(kw, tok) for kw, toks in sorted(MATCHED.items()) for tok in toks]
)
def test_palette_matches_show_graph(keyword, token):
    name = show_graph_defaults()[keyword]
    expected = as_graphviz_draws(name)
    actual = palette_tokens().get(token)
    assert actual is not None, f"{token} is not defined in {PALETTE}"
    assert actual == expected, (
        f"{token} is {actual}, but show_graph's {keyword}={name!r} draws as {expected} "
        f"in its PDF and PNG; role colours match show_graph exactly, by design (#306). "
        f"Change palette.css and frontend/src/styles/showGraphColours.test.ts together."
    )


def test_every_show_graph_colour_argument_is_accounted_for():
    """A colour argument PsyNeuLink adds or renames fails here, by name."""
    try:
        from psyneulink.core.compositions.showgraph import ShowGraph
    except Exception as e:  # noqa: BLE001 - any failure here must be loud
        pytest.fail(f"PsyNeuLink's ShowGraph could not be imported: {e!r}")
    upstream = {kw for kw in inspect.signature(ShowGraph.__init__).parameters if kw.endswith("_color")}
    known = set(MATCHED) | set(UNMATCHED)
    assert not upstream - known, (
        f"show_graph has colour argument(s) {sorted(upstream - known)} that PsyNeuView does not "
        f"account for: add each to MATCHED (with its palette token) or UNMATCHED (with why) (#306)"
    )
    assert not known - upstream, (
        f"show_graph no longer has colour argument(s) {sorted(known - upstream)}: renamed or "
        f"removed upstream? Update MATCHED/UNMATCHED and the palette (#306)"
    )


@pytest.mark.skipif(shutil.which("dot") is None, reason="needs the Graphviz programs")
def test_x11_table_agrees_with_graphviz():
    """The fallback table says what Graphviz says, for every name it lists."""
    for name, value in X11.items():
        assert as_graphviz_draws(name) == value, name
