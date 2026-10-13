"""PsyNeuView must not write a model it cannot read (#1102).

A user's file arrived at the parser missing a comma their own copy has. The
server's version was never saved, so what removed it can no longer be
established — but the class of failure can be made impossible to miss.

#1106 fixed one cause. This checks the result instead of trusting the method,
so the next cause is caught whatever it is.
"""

import ast
from pathlib import Path

import pytest

from app.services.file_writer import (
    apply_parameter_change,
    save_source,
    write_generated_source,
)

MODEL = '''import psyneulink as pnl

a = pnl.TransferMechanism(
    name="a",
    gain=1.0,
)

comp = pnl.Composition(name="C")
comp.add_node(a)
'''


class TestGeneratedWrites:
    def test_valid_source_is_written(self, tmp_path):
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        write_generated_source(p, MODEL.replace("gain=1.0", "gain=2.0"))
        assert "gain=2.0" in p.read_text()

    def test_invalid_source_is_refused(self, tmp_path):
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        with pytest.raises(ValueError) as e:
            write_generated_source(p, "a = pnl.Thing(\n", operation="change the graph")
        assert "change the graph" in str(e.value)
        assert "left unchanged" in str(e.value)

    def test_the_file_is_untouched_when_refused(self, tmp_path):
        """The point of the guard: damage never reaches disk."""
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        with pytest.raises(ValueError):
            write_generated_source(p, "def broken(:\n    pass\n")
        assert p.read_text() == MODEL

    def test_the_message_names_the_line(self, tmp_path):
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        with pytest.raises(ValueError) as e:
            write_generated_source(p, "x = 1\ny = (\n")
        assert "line" in str(e.value)

    def test_it_says_this_is_our_bug(self, tmp_path):
        # The user did not do anything wrong, and should not go hunting.
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        with pytest.raises(ValueError) as e:
            write_generated_source(p, "!!!")
        assert "not in your model" in str(e.value)


class TestUserSavesAreNotGuarded:
    def test_half_written_code_can_still_be_saved(self, tmp_path):
        """A person editing must be able to save mid-thought.

        The distinction is who composed the text, not whether it parses.
        """
        p = tmp_path / "m.py"
        p.write_text(MODEL)
        half_written = "a = pnl.TransferMechanism(\n    name=\n"
        save_source(str(p), half_written)
        assert p.read_text() == half_written


class TestAgainstARealCorruption:
    def test_a_write_that_would_corrupt_is_refused(self, tmp_path, monkeypatch):
        """Simulate a writer bug of the #1106 kind and check the guard holds.

        Rather than reintroduce the paren-counting bug, this forces the
        composed result to be broken and asserts the file survives — the
        property that matters regardless of which writer goes wrong.
        """
        import app.services.file_writer as fw

        p = tmp_path / "m.py"
        p.write_text(MODEL)

        # Make the block rewriter emit something unparseable, as a buggy
        # boundary calculation would.
        monkeypatch.setattr(
            fw, "_replace_direct_param",
            lambda block, name, value: block + "\n)  # stray close\n",
        )

        with pytest.raises(ValueError, match="invalid Python"):
            apply_parameter_change(str(p), "a", "gain", "2.0")

        assert p.read_text() == MODEL
        ast.parse(p.read_text())
