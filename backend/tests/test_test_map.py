"""The What's tested page reads the test files correctly (#319).

`scripts/test_map.py` builds docs/testing-coverage.md from the test files. Its
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


def test_the_published_page_is_current():
    """The same check CI's Frontend workflow runs, so a backend-only change sees it too."""
    files = test_map.collect_e2e() + test_map.collect_vitest() + test_map.collect_pytest()
    page = test_map.render(files, test_map.load_json(test_map.COVERAGE), test_map.load_json(test_map.AGREEMENT)) + "\n"
    assert test_map.DOC.read_text() == page, "run `python3 scripts/test_map.py` and commit docs/testing-coverage.md"
