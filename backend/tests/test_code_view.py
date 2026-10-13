"""Writers must not be fooled by parentheses inside comments or strings (#1102).

Found while investigating a user's report. The writers located constructor
boundaries by counting every parenthesis in a line, comments included, so a
comment like `# the default is 1.0, see docs)` closed a call that was never
opened there. The writer then inserted its closing paren mid-constructor and
left the remaining arguments orphaned — an ordinary parameter edit turning a
working model into one that does not parse.
"""

import ast
import tempfile
from pathlib import Path

import pytest

from app.services.code_view import code_only_lines, code_only_text
from app.services.file_writer import apply_parameter_change


class TestCodeView:
    def test_blanks_a_comment_but_keeps_the_line_length(self):
        # Offsets computed against the view must index the original exactly.
        src = "x = f(1)   # a stray ) here\ny = 2\n"
        out = code_only_lines(src)
        assert len(out[0]) == len("x = f(1)   # a stray ) here")
        assert ")" in out[0][:8]          # the real one survives
        assert out[0].count(")") == 1     # the one in the comment does not

    def test_blanks_a_string_body(self):
        src = 'x = "a ) b"\n'
        assert code_only_lines(src)[0].count(")") == 0

    def test_handles_a_multi_line_string(self):
        src = 'x = """\nnot ) code\n"""\ny = f(1)\n'
        out = code_only_lines(src)
        assert out[1].count(")") == 0
        assert out[3].count(")") == 1

    def test_unparseable_source_is_returned_untouched(self):
        # Mid-edit files must not make the writers refuse to work.
        src = "def broken(:\n    pass\n"
        assert code_only_lines(src) == src.splitlines()

    def test_code_only_text_preserves_length(self):
        for src in ("x = f(1)  # )\n", "x = 1", "", "a\nb\n", 'x = "("\n'):
            assert len(code_only_text(src)) == len(src), repr(src)


MODEL = '''import psyneulink as pnl

a = pnl.TransferMechanism(
    name="a",
    gain=1.0,{comment}
    bias=0.0,
)

comp = pnl.Composition(name="C")
comp.add_node(a)
'''

COMMENTS = [
    pytest.param("", id="no-comment"),
    pytest.param("   # default is 1.0 (see docs)", id="balanced"),
    pytest.param("   # default is 1.0, see docs)", id="unbalanced-close"),
    pytest.param("   # default is 1.0 (really", id="unbalanced-open"),
    pytest.param("   # a) b) c)", id="several-unbalanced"),
]

OPS = [
    pytest.param("clip", "(0, 5)", id="insert-new-param"),
    pytest.param("bias", "9.9", id="edit-later-param"),
    pytest.param("gain", "3.0", id="edit-the-commented-param"),
]


@pytest.mark.parametrize("comment", COMMENTS)
@pytest.mark.parametrize("param,value", OPS)
def test_edits_never_produce_unparseable_python(comment, param, value):
    """The property that matters: a write must leave valid Python behind."""
    src = MODEL.format(comment=comment)
    f = tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w")
    f.write(src)
    f.close()
    try:
        out = apply_parameter_change(f.name, "a", param, value)
        ast.parse(out)  # the assertion
    finally:
        Path(f.name).unlink(missing_ok=True)


def test_the_original_corruption(tmp_path):
    """Pins the exact failure, so it cannot come back quietly."""
    src = MODEL.format(comment="   # default is 1.0, see docs)")
    p = tmp_path / "m.py"
    p.write_text(src)

    out = apply_parameter_change(str(p), "a", "clip", "(0, 5)")

    ast.parse(out)
    # bias must still be inside the call, not orphaned after a premature ')'.
    body = ast.parse(out).body
    call = next(n for n in body if isinstance(n, ast.Assign)
                and getattr(n.targets[0], "id", None) == "a").value
    kwargs = {k.arg for k in call.keywords}
    assert {"name", "gain", "bias", "clip"} <= kwargs
