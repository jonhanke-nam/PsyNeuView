"""Tests for app.services.test_extractor.

The extractor converts a pytest test method into a standalone .py. Three
layers of coverage:

1. Parametrize parser shapes — single arg, multi-arg string, list-of-strings,
   and module/class constant lookup.
2. End-to-end extraction of the concrete Phase 2 target
   (TestExecution.test_simple_execution_without_learning from
   PsyNeuLink/tests/composition/test_emcomposition.py) — the file PsyNeuView
   actually needs to load. Skipped if PsyNeuLink isn't available next to
   PsyNeuView on disk.
3. Negative cases — unsupported fixtures, missing target.
"""

import ast
import textwrap
from pathlib import Path

import pytest

from app.services.test_extractor import (
    ExtractionError,
    discover_tests,
    extract_test,
)


def _extract_from_source(source: str, qualified_name: str, tmp_path: Path) -> str:
    """Drop ``source`` to a temp file and run the extractor against it."""
    src_path = tmp_path / "src.py"
    src_path.write_text(source)
    return extract_test(src_path, qualified_name)


def test_single_arg_parametrize(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize("x", [1, 2, 3])
            def test_a(self, x):
                assert x > 0
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "x = 1" in out
    assert "assert x > 0" in out


def test_multi_arg_string_parametrize(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize("a, b", [(1, 2), (3, 4)])
            def test_a(self, a, b):
                assert a + b > 0
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "a = 1" in out
    assert "b = 2" in out


def test_list_of_strings_arg_names(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize(["a", "b"], [(1, 2)])
            def test_a(self, a, b):
                pass
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "a = 1" in out
    assert "b = 2" in out


def test_multiple_parametrize_decorators(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize("x", [10, 20])
            @pytest.mark.parametrize("y", ["a", "b"])
            def test_a(self, x, y):
                pass
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "x = 10" in out
    assert "y = 'a'" in out


def test_class_level_constant_shadows_module(tmp_path):
    """If two classes both define ``ARGS``, extraction must pick the one in
    the target's own class — otherwise we'd splice the wrong arg names in."""
    source = textwrap.dedent('''
        import pytest

        class TestOther:
            ARGS = "p"

        class TestMine:
            ARGS = "x, y"
            @pytest.mark.parametrize(ARGS, [(1, 2)])
            def test_a(self, x, y):
                pass
    ''')
    out = _extract_from_source(source, "TestMine.test_a", tmp_path)
    assert "x = 1" in out
    assert "y = 2" in out


def test_module_level_constant_for_values(tmp_path):
    source = textwrap.dedent('''
        import pytest

        VALUES = [10, 20, 30]

        class T:
            @pytest.mark.parametrize("x", VALUES)
            def test_a(self, x):
                pass
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "x = 10" in out


def test_pytest_skip_is_rewritten(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize("x", [1])
            def test_a(self, x):
                if x < 0:
                    pytest.skip("negatives not supported")
                assert x >= 0
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    assert "pytest.skip" not in out
    assert "SKIPPED" in out
    assert "sys.exit(0)" in out


def test_unsupported_fixture_errors(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            def test_a(self, tmp_path):
                pass
    ''')
    with pytest.raises(ExtractionError, match="tmp_path"):
        _extract_from_source(source, "T.test_a", tmp_path)


def test_missing_method_errors(tmp_path):
    source = textwrap.dedent('''
        class T:
            def test_a(self):
                pass
    ''')
    with pytest.raises(ExtractionError, match="could not find"):
        _extract_from_source(source, "T.does_not_exist", tmp_path)


def test_output_is_syntactically_valid_python(tmp_path):
    source = textwrap.dedent('''
        import pytest

        class T:
            @pytest.mark.parametrize("x, y", [(1, 2)])
            def test_a(self, x, y):
                z = x + y
                assert z == 3
    ''')
    out = _extract_from_source(source, "T.test_a", tmp_path)
    # Round-trip through ast.parse — guarantees the generator emits valid Python.
    ast.parse(out)


# ---- End-to-end: the concrete target PsyNeuView actually needs ---------

CONCRETE_TARGET = (
    Path(__file__).resolve().parents[4]
    / "PsyNeuLink"
    / "tests"
    / "composition"
    / "test_emcomposition.py"
)


@pytest.mark.skipif(
    not CONCRETE_TARGET.exists(),
    reason="PsyNeuLink checkout not present next to PsyNeuView on this machine",
)
def test_extract_emcomposition_target(tmp_path):
    """The Phase 2 acceptance criterion: this exact test must extract cleanly."""
    out = extract_test(
        CONCRETE_TARGET,
        "TestExecution.test_simple_execution_without_learning",
    )

    ast.parse(out)
    # All 14 args (minus self) should appear as assignments — three from the
    # decorator stack: 12-name args_names, learn_field_weights, exec_mode.
    for name in (
        "test_num", "memory_template", "memory_fill", "memory_capacity",
        "memory_decay_rate", "field_weights", "concatenate_queries",
        "normalize_memories", "softmax_gain", "storage_prob", "inputs",
        "expected_retrieval", "learn_field_weights", "exec_mode",
    ):
        assert f"{name} = " in out, f"expected '{name} = ...' in extracted output"

    # The skip in the method body must be converted, not preserved.
    assert "pytest.skip" not in out
    assert "SKIPPED" in out


# ---- Discovery -----------------------------------------------------------


def test_discover_finds_class_methods_and_module_level(tmp_path):
    """A single file with one test class and one module-level test function
    surfaces both — class-bound tests carry the class name, module-level
    tests carry ``None`` for ``class_name``."""
    (tmp_path / "tests" / "composition").mkdir(parents=True)
    (tmp_path / "tests" / "composition" / "test_x.py").write_text(
        textwrap.dedent('''
            import pytest

            class TestThings:
                def test_one(self): pass
                def test_two(self): pass
                def helper(self): pass  # not a test, must be ignored

            def test_module_level(): pass
            def regular_function(): pass  # not a test, must be ignored
        ''')
    )

    refs = discover_tests(tmp_path)

    qualified = sorted(r.qualified_name for r in refs)
    assert qualified == ["TestThings.test_one", "TestThings.test_two", "test_module_level"]


def test_discover_skips_unparseable_files(tmp_path):
    """A mid-edit file with a syntax error must not break the whole walk."""
    (tmp_path / "tests" / "composition").mkdir(parents=True)
    (tmp_path / "tests" / "composition" / "test_broken.py").write_text("def test_a(:")
    (tmp_path / "tests" / "composition" / "test_ok.py").write_text(
        "def test_ok(): pass\n"
    )

    refs = discover_tests(tmp_path)

    assert [r.qualified_name for r in refs] == ["test_ok"]


def test_discover_missing_subdir_raises(tmp_path):
    """If the source tree doesn't have the expected test subdir, fail loudly —
    the frontend should surface this rather than silently presenting an empty list."""
    with pytest.raises(FileNotFoundError):
        discover_tests(tmp_path)


@pytest.mark.skipif(
    not CONCRETE_TARGET.exists(),
    reason="PsyNeuLink checkout not present next to PsyNeuView on this machine",
)
def test_discover_finds_em_baseline():
    """The standing #249 baseline must appear in discovery results against the
    actual installed PsyNeuLink. Without this, the Phase 3 dropdown couldn't
    surface the test a user referenced."""
    source_tree = CONCRETE_TARGET.resolve().parents[2]  # .../PsyNeuLink/
    refs = discover_tests(source_tree)

    em_refs = [
        r for r in refs
        if r.file.name == "test_emcomposition.py"
        and r.qualified_name == "TestExecution.test_simple_execution_without_learning"
    ]
    assert len(em_refs) == 1, (
        f"expected exactly one match for the EM baseline; got {len(em_refs)}"
    )
