"""The What's tested page reads the test files correctly (#319).

`scripts/test_map.py` builds the What's tested pages from the test files. Its
one easy mistake is marking a browser test in or out of CI wrongly, which the
page would then state as fact; these pin how it reads titles and `@ci` tags.
"""

import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "test_map.py"
_spec = importlib.util.spec_from_file_location("test_map", SCRIPT)
test_map = importlib.util.module_from_spec(_spec)
sys.modules["test_map"] = test_map
_spec.loader.exec_module(test_map)


def test_a_describe_tag_reaches_the_tests_inside_it_only():
    src = """
test.describe("drag to connect (#253)", { tag: "@ci" }, () => {
  test("a to b", async () => { if (x) { y(); } });
  test("into two inputs", async () => {});
});
test("outside the describe", async () => {});
"""
    assert test_map.ts_tests(src) == [
        ("drag to connect (#253) › a to b", True),
        ("drag to connect (#253) › into two inputs", True),
        ("outside the describe", False),
    ]


def test_fixture_names_and_tag_lists_count():
    src = """
readOnlyTest("one", { tag: ["@smoke", "@ci"] }, async () => {});
mutatingTest.describe("group", () => {
  mutatingTest("two", async () => {});
});
freshProfileTest("three @ci", async () => {});
"""
    assert test_map.ts_tests(src) == [("one", True), ("group › two", False), ("three @ci", True)]


def test_calls_in_comments_and_strings_are_not_tests():
    src = """
// test("commented out", { tag: "@ci" }, () => {});
/* describe("also commented", () => {}) */
const s = 'test("inside a string")';
it("real", () => {});
"""
    assert test_map.ts_tests(src) == [("real", False)]


def test_issue_numbers_skip_colours_and_urls():
    assert test_map.issues_in("click never connects (#317), not #3197e5 or a/b#12") == ["317"]


def test_area_overrides_win_over_name_patterns():
    # "drag" would put it with pointer interaction; it is about the code editor.
    assert test_map.area_of("editor-drag-select") == "sync"
    assert test_map.area_of("drag-to-connect-stage2") == "pointer"
    assert test_map.area_of("show-graph-agreement") == "showgraph"


def test_the_pages_build_and_every_spec_is_accounted_for():
    """What the Frontend workflow and the docs build run, so a backend-only change sees it too.

    The pages aren't committed (#380), so there is no "is it current" to check:
    they must build, and every browser spec must be in CI or say why not.
    """
    pages, problems = test_map.pages()
    assert problems == []
    assert set(pages) == {"testing-coverage.md", "testing-coverage-tests.md"}
    assert "## Feature map" in pages["testing-coverage.md"]
    assert "backend/tests/test_test_map.py" in pages["testing-coverage-tests.md"]


def test_a_spec_is_in_ci_by_its_tag_alone(tmp_path, monkeypatch):
    """No list of CI files (#380): the @ci tag decides, and *.local specs never run in CI."""
    e2e = tmp_path / "e2e"
    e2e.mkdir()
    (e2e / "tagged.spec.ts").write_text('test.describe("a", { tag: "@ci" }, () => { test("one", async () => {}); });\n')
    (e2e / "untagged.spec.ts").write_text('// Not in CI: slow: takes an hour.\ntest("two", async () => {});\n')
    (e2e / "mine.local.spec.ts").write_text('// Not in CI: local only: needs PyCharm.\ntest("three @ci", async () => {});\n')
    monkeypatch.setattr(test_map, "E2E", e2e)
    ci = {f.path.split("/")[-1]: f.ci for f in test_map.collect_e2e()}
    assert ci == {"tagged.spec.ts": True, "untagged.spec.ts": False, "mine.local.spec.ts": False}
    assert test_map.unaccounted(test_map.collect_e2e()) == []


def test_only_a_not_in_ci_line_in_the_header_counts(tmp_path, monkeypatch):
    """A "Not in CI:" further down, in a test's comment or a string, doesn't excuse the spec (#392)."""
    e2e = tmp_path / "e2e"
    e2e.mkdir()
    why = "Not in CI: slow: takes an hour."
    (e2e / "header.spec.ts").write_text(f'/**\n * A spec.\n *\n * {why}\n */\ntest("a", async () => {{}});\n')
    (e2e / "after-imports.spec.ts").write_text(f'import {{ test }} from "./test-base";\n\n// {why}\ntest("a", async () => {{}});\n')
    (e2e / "in-a-test.spec.ts").write_text(f'/** A spec. */\ntest("a", async () => {{\n  // {why}\n}});\n')
    (e2e / "in-a-string.spec.ts").write_text(f'// A spec.\n\nconst note = "{why}";\ntest("a", async () => {{}});\n')
    monkeypatch.setattr(test_map, "E2E", e2e)
    files = test_map.collect_e2e()
    reasons = {f.path.split("/")[-1]: f.not_in_ci for f in files}
    assert reasons["header.spec.ts"] == ("slow", "takes an hour")
    assert reasons["after-imports.spec.ts"] == ("slow", "takes an hour")
    assert reasons["in-a-test.spec.ts"] is None
    assert reasons["in-a-string.spec.ts"] is None
    assert sorted(p.split(":")[0].split("/")[-1] for p in test_map.unaccounted(files)) == ["in-a-string.spec.ts", "in-a-test.spec.ts"]
