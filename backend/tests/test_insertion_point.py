"""Where a new node gets written. (#1129)

Found by surveying PsyNeuLink's own example scripts. Two separate faults, and
the one named in the issue turned out not to be the one that bit.
"""

import ast

import pytest

from app.services.file_writer import _add_node, _find_section

# Reduced from PsyNeuLink's Scripts/Debug/Predator-Prey Sebastian REDUCED.py.
# The essentials: a comment mentioning "Mechanisms" *inside* a function, a
# multi-line call after it, and a file ending in an indented block.
PREDATOR_PREY_SHAPE = '''import psyneulink as pnl

player = pnl.TransferMechanism(name="player")
predator = pnl.TransferMechanism(name="predator")

agent_comp = pnl.Composition(name="PREY")
agent_comp.add_node(player)


def main():
    # Perceptual Mechanisms
    results = agent_comp.run(
        inputs={player: [[1.0]],
                predator: [[2.0]]},
        context="x",
    )
    print(results)


if RUN:
    if __name__ == "__main__":
        main()
'''


class TestBannerMatching:
    def test_a_comment_mentioning_the_word_is_not_a_banner(self):
        """`# Perceptual Mechanisms`, inside a function, is not the Mechanisms
        section. Treating it as one made everything down to the next banner
        look like that section, so a node was inserted into the middle of a
        multi-line call and the file stopped parsing."""
        assert _find_section(PREDATOR_PREY_SHAPE, "Mechanisms") == (-1, -1)

    def test_a_real_banner_still_matches(self):
        src = "# Mechanisms\na = pnl.TransferMechanism()\n\n# Compositions\n"
        start, _ = _find_section(src, "Mechanisms")
        assert start >= 0

    def test_a_decorated_banner_still_matches(self):
        # Banners in the standard format carry ruled lines and asterisks.
        src = "# ***** Mechanisms *****\na = pnl.TransferMechanism()\n"
        assert _find_section(src, "Mechanisms")[0] >= 0

    def test_a_banner_with_a_description_still_matches(self):
        # Real files write `# Projections (with hand-set weight matrices)`, so
        # requiring an exact match was too strict — it broke the one format the
        # editor fully supports.
        src = "# Projections (with hand-set weight matrices)\na = 1\n"
        assert _find_section(src, "Projections")[0] >= 0

    def test_an_indented_comment_is_never_a_banner(self):
        src = "def f():\n    # Mechanisms\n    pass\n"
        assert _find_section(src, "Mechanisms") == (-1, -1)


class TestInsertionPoint:
    def _add(self, src):
        return _add_node(src, {"var_name": "probe_x", "type": "TransferMechanism", "params": {}})

    def test_the_predator_prey_shape_still_parses(self):
        """The regression. This shape used to produce `unexpected indent`."""
        out = self._add(PREDATOR_PREY_SHAPE)
        ast.parse(out)

    def test_the_node_lands_before_the_composition(self):
        # A node must exist before the Composition that references it, and it
        # reads better beside the other declarations than after everything.
        out = self._add(PREDATOR_PREY_SHAPE)
        lines = out.splitlines()
        node = next(i for i, l in enumerate(lines) if "probe_x = pnl" in l)
        comp = next(i for i, l in enumerate(lines) if "pnl.Composition(" in l)
        assert node < comp

    def test_it_does_not_land_inside_a_function(self):
        out = self._add(PREDATOR_PREY_SHAPE)
        tree = ast.parse(out)
        top_level = {
            getattr(s.targets[0], "id", None)
            for s in tree.body if isinstance(s, ast.Assign)
        }
        assert "probe_x" in top_level, "the node was written into a nested scope"

    def test_a_file_with_no_composition_still_works(self):
        src = "import psyneulink as pnl\n\na = pnl.TransferMechanism(name='a')\n"
        out = self._add(src)
        ast.parse(out)
        assert "probe_x" in out

    def test_a_banner_file_still_inserts_into_its_section(self):
        # The real standardized format rules its sections with `====`, which is
        # how the end of one is found. My first version of this fixture used a
        # bare `# Compositions` and failed for that reason, not because of the
        # change under test.
        src = (
            "# ===========\n"
            "# Mechanisms\n"
            "# ===========\n"
            "a = pnl.TransferMechanism(name='a')\n"
            "\n"
            "# ===========\n"
            "# Compositions\n"
            "# ===========\n"
            "comp = pnl.Composition()\n"
        )
        out = self._add(src)
        ast.parse(out)
        lines = out.splitlines()
        node = next(i for i, l in enumerate(lines) if "probe_x = pnl" in l)
        banner = next(i for i, l in enumerate(lines) if l.strip() == "# Compositions")
        assert node < banner, "should stay inside the Mechanisms section"
