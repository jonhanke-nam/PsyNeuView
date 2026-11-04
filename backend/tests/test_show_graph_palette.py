"""The palette's role colours agree with PsyNeuLink's show_graph (#190).

The owner's policy: the red, green and purple on OUTPUT, INPUT and controller
nodes must be the ones show_graph draws. Nothing else checked that. The e2e
check of node outlines pins the hex values by hand, so it would keep passing if
PsyNeuLink changed its colours, or if both sides drifted together.

This reads show_graph's defaults from PsyNeuLink itself (``ShowGraph``'s
``input_color``, ``output_color`` and ``controller_color``), resolves each name
the way Graphviz draws it in the PDF and PNG show_graph writes (its X11 colour
scheme), and compares with ``--pnv-role-input``, ``--pnv-role-output`` and
``--pnv-role-controller`` read from ``frontend/src/styles/palette.css``. Red,
green and purple are enforced.

The other roles are reported, not enforced. Orange and pink are deliberately
darker than show_graph's, so they read on white (#196); the rest happen to
agree. As of this writing:

    role              show_graph  PDF/PNG (X11)  browser (CSS)  palette
    control           blue        #0000ff        #0000ff        #0000ff
    learning          orange      #ffa500        #ffa500        #ff8c00
    probe             pink        #ffc0cb        #ffc0cb        #ff69b4
    input and output  brown       #a52a2a        #a52a2a        #a52a2a
    ordinary          black       #000000        #000000        #000000

``test_other_roles_are_reported`` prints the live table (``pytest -s``).
"""

from __future__ import annotations

import inspect
import re
import shutil
from pathlib import Path

import pytest

PALETTE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "styles" / "palette.css"

# show_graph's keyword -> the palette token for that role.
ENFORCED = {
    "input_color": "--pnv-role-input",
    "output_color": "--pnv-role-output",
    "controller_color": "--pnv-role-controller",
}
REPORTED = {
    "control_color": "--pnv-role-control",
    "learning_color": "--pnv-role-learning",
    "probe_color": "--pnv-role-probe",
    "input_and_output_color": "--pnv-role-singleton",
    "default_node_color": "--pnv-role-internal",
}

# Graphviz's X11 scheme (graphviz.org/doc/info/colors.html) for the names
# show_graph uses, used only when the Graphviz programs are not on the
# machine to ask. CSS's values for the same names, for the report.
X11 = {
    "green": "#00ff00", "red": "#ff0000", "blue": "#0000ff", "purple": "#a020f0",
    "orange": "#ffa500", "pink": "#ffc0cb", "brown": "#a52a2a", "black": "#000000",
}
CSS = {**X11, "green": "#008000", "purple": "#800080"}


def show_graph_defaults() -> dict[str, str]:
    """show_graph's default colour names, read from PsyNeuLink itself."""
    try:
        from psyneulink.core.compositions.showgraph import ShowGraph
    except Exception as e:  # noqa: BLE001 - any failure here must be loud
        pytest.fail(f"PsyNeuLink's ShowGraph could not be imported: {e!r}")
    params = inspect.signature(ShowGraph.__init__).parameters
    defaults = {}
    for kw in {**ENFORCED, **REPORTED}:
        p = params.get(kw)
        if p is None or not isinstance(p.default, str):
            pytest.fail(f"ShowGraph.__init__ has no string default for {kw!r}: has show_graph changed?")
        defaults[kw] = p.default
    return defaults


def palette_tokens() -> dict[str, str]:
    """``--pnv-role-*`` -> six-digit hex, read from palette.css."""
    if not PALETTE.is_file():
        pytest.fail(f"palette.css not found at {PALETTE}; is the frontend checked out beside backend/?")
    text = PALETTE.read_text(encoding="utf-8")
    tokens = {}
    for name, value in re.findall(r"(--pnv-role-[a-z-]+)\s*:\s*([^;]+);", text):
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


@pytest.mark.parametrize("keyword,token", sorted(ENFORCED.items()))
def test_palette_matches_show_graph(keyword, token):
    name = show_graph_defaults()[keyword]
    expected = as_graphviz_draws(name)
    actual = palette_tokens().get(token)
    assert actual is not None, f"{token} is not defined in {PALETTE}"
    assert actual == expected, (
        f"{token} is {actual}, but show_graph's {keyword}={name!r} draws as {expected} "
        f"in its PDF and PNG; the policy is that these match exactly (#190)."
    )


@pytest.mark.skipif(shutil.which("dot") is None, reason="needs the Graphviz programs")
def test_x11_table_agrees_with_graphviz():
    """The fallback table says what Graphviz says, for every name it lists."""
    for name, value in X11.items():
        assert as_graphviz_draws(name) == value, name


def test_other_roles_are_reported():
    """The roles the policy does not cover: shown, never failed on."""
    defaults = show_graph_defaults()
    tokens = palette_tokens()
    rows = ["role                    show_graph  PDF/PNG   browser   palette"]
    for keyword, token in REPORTED.items():
        name = defaults[keyword]
        rows.append(
            f"{keyword[:-6].replace('_', ' '):<23} {name:<11} "
            f"{as_graphviz_draws(name):<9} {CSS.get(name, '?'):<9} {tokens.get(token, '?')}"
        )
    print("\nshow_graph's other role colours (not enforced):\n" + "\n".join(rows))
