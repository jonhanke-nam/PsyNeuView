#!/usr/bin/env python3
"""What PsyNeuView's tests cover: build the What's tested pages (#319).

The pages are built from the code, so they can't go stale:

- browser tests (Playwright): every ``frontend/e2e/**/*.spec.ts``, its test
  titles, their ``@ci`` tags and, for a spec that isn't in CI, the
  ``Not in CI:`` line in its header saying why;
- frontend unit tests (vitest): every ``frontend/src/**/*.test.ts`` and its
  ``it``/``test`` titles;
- backend tests (pytest): every ``backend/tests/**/test_*.py``, its test
  functions and their docstrings.

Each file is put in a feature area by its name (``AREAS`` below), and each
test is marked with its layer, whether CI runs it, and the issues it names.

Two inputs are measurements rather than code, kept as small snapshots in
``docs/testing-coverage/`` and refreshed by hand when re-measured:

- ``coverage.json``: line and branch coverage. Refresh with
  ``--coverage backend/coverage.json frontend/coverage/coverage-summary.json``
  after running both suites with coverage (the page says how).
- ``show-graph-agreement.json``: the show_graph agreement scores. Refresh with
  ``--agreement frontend/test-results/show-graph-agreement/agreement.json``
  after the full batch of ``e2e/show-graph-agreement.spec.ts``.

The pages are not committed (#380): every pull request that touched a test
rewrote them, so they all conflicted with each other. The docs build makes
them (``scripts/mkdocs_hooks.py`` calls :func:`pages`), and the Frontend
workflow builds them with ``--check`` and keeps them as an artifact.

Usage::

    python3 scripts/test_map.py            # write the pages to build/test-map/
    python3 scripts/test_map.py --check    # the same, but fail if a spec is unaccounted for (CI)

Standard library only, so CI can run it without installing anything.
"""

from __future__ import annotations

import argparse
import ast
import datetime as _dt
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / "frontend" / "e2e"
SRC = ROOT / "frontend" / "src"
BACKEND_TESTS = ROOT / "backend" / "tests"
# The pages, by their path in the docs site (docs/). Written to OUT_DIR when
# run by hand; the docs build adds them to the site without writing them.
DOC = "testing-coverage.md"
DOC_ALL = "testing-coverage-tests.md"
OUT_DIR = ROOT / "build" / "test-map"
DATA = ROOT / "docs" / "testing-coverage"
COVERAGE = DATA / "coverage.json"
AGREEMENT = DATA / "show-graph-agreement.json"

# Feature areas, in the order the page shows them. A test file goes in the
# first area whose pattern matches its name (path relative to its layer's
# folder, without the extension). Keep the patterns specific: a file in the
# wrong area is a wrong answer on a page people trust.
AREAS: list[tuple[str, str, str]] = [
    (
        "tutorials",
        "Tutorials and guided walkthroughs",
        r"tutorial|^tour|[-_/]tour|narration|walkthrough|orientation|pronunciation|menus-above-walkthrough",
    ),
    ("assistant", "AI assistant", r"assistant|runner[-_]guard|os[-_]sandbox"),
    (
        "showgraph",
        "Matching show_graph",
        r"show[-_]?graph|showgraph|layoutagreement|gsc|roleranks|layout-default-show-graph|io-role-rows|scheduling-arrows",
    ),
    (
        "pointer",
        "Dragging and pointer interaction",
        r"drag|pointer|click|hit-areas|place-component|drag-to-connect|connecthandles|connecttargets|edge-bend|curve-handle|curvehandles|arrow-drag|"
        r"edge-shaping|graphcursor|portchooser|selection-menu|arrow-menus|menus-in-window|insertion_point|"
        r"add_projection_placement|editor-drag",
    ),
    (
        "building",
        "Building models in the UI",
        r"connection_|file_writer|broken_projections|dangling|function_dropdown|typeahead|component-icons|"
        r"componenticons|components-panel|insertion|place|modulatory|learn-pathway|pathway_learning|"
        r"enable_learning|generated_nodes|learning-nodes",
    ),
    (
        "sync",
        "Editing: code and graph in step",
        r"external[-_]edit|live-preview|livepreview|preview|reopen|watch|structural|code_view|sourcediff|"
        r"linediff|pnl_call_rendering|declaration|definition|quick_check|star_import|one_name|node-name|"
        r"reference-model-editing|syncstate|write_guard|inspector|optimisticupdate|code_watcher|"
        r"stale_save|apply-only|inline_node|edit_lock|model-lock|lock-in|reference_edit|working_cop|"
        r"converter|introspector|edge_route_persistence|labels|output_labels|value-grid|valuegrid",
    ),
    (
        "equivalence",
        "Same results whichever way a model runs (equivalence, MDF)",
        r"equivalence|canonicalization|mdf|format_version|snapshot_id",
    ),
    (
        "running",
        "Running, learning and debugging",
        r"run|learn|execut|sandbox|worker|debugger|stepping|input_?sets|inputsets|pytorch|autodiff|jobs|"
        r"^demo_|simple_stroop|reference_models_runnable|library_models_runnable|stderr|driver_error|"
        r"error_names|error_replies|stroop-lc-reference|busy|timeline|whats-running|runecho|learnplan",
    ),
    (
        "saving",
        "Saving, history and undo",
        r"save|autosave|history|undo|sidecar|protection|copy|bundle|file_types|changes-since|flushbuffer|"
        r"activitysaver|previewbreak",
    ),
    (
        "macapp",
        "Mac app bridges and what's running",
        r"mac|app-update|appupdate|about|running_?from|runningfrom|reveal|project[-_]folder|deployment|"
        r"presence|startup_phases|leftover|active_psyneulink",
    ),
    (
        "settings",
        "Settings, PsyNeuLink versions and sources",
        r"setting|pnl|install|clone|source|keep-pnl|checkout|release|version|updates|freshness|health|"
        r"app_config|shortcuts/|keyboard|blank-screen|view-only-tags|github_auth|branch_lookup|"
        r"local_folder|local-checkout|disk_source|migrate|tutorialsmenu|textsize|text-size|edgelinestore|"
        r"nodeoutlinestore|graphlegendstore|fitbuttonstyle|layoutspacingstore|graphlayoutdefault",
    ),
    (
        "style",
        "Look and style conventions",
        r"style|colou?r|outline|shape|arrowheads|line-width|icons|legend|nodebox|reactflow-credit|"
        r"text-proportion|dialog|toolbar",
    ),
    (
        "layout",
        "Layout, views and compositions",
        r"layout|fit|view|frame|composition|nested|flat|cim|edge|lanes|spline|viewport|offscreen|wide|"
        r"occlusion|panels|ports|show-ports|graph-fills|positions|prune|canvaslayers|outermost",
    ),
    (
        "opening",
        "Opening models, catalogs and the library",
        r"open|catalog|library|github|load|example|drop|import|recent|reference|lineage|fixtures|"
        r"psyneulink_examples|file_history|locations|where-things-live|model_dirs",
    ),
    ("shell", "App shell, diagnostics and everything else", r"."),
]

# Files whose name would put them in the wrong area, by the stem used above.
OVERRIDES: dict[str, str] = {
    "editor-drag-select": "sync",
    "sidecar-placement": "saving",
    "sidecarplacement": "saving",
    "sidecar_placement": "saving",
    "utils/sidecarplacement": "saving",
    "utils/cimplacement": "layout",
    "components-panel-start-setting": "settings",
    "stores/componentspanelstart": "settings",
    "open-menu-source-labels": "opening",
    "value-grid": "running",
    "utils/valuegrid": "running",
    "stores/valueviewstore": "running",
    "worker_orphan_watchdog": "running",
    "utils/prunepositions": "layout",
    "utils/runningfrom": "macapp",
    "whats-running": "macapp",
    "running_from": "macapp",
    "e2edistfreshness": "shell",
    "utils/curvesmoothness": "layout",
    "utils/iorows": "showgraph",
    "stores/holdlastgoodgraph": "sync",
    "stores/nodeelementsdefault": "settings",
    "catalog_sources": "opening",
    "e2e_pnl_install_override": "shell",
    "version_mismatch": "opening",
    "version_only_diff": "shell",
    "stores/errorreveal": "shell",
    "modelloadview": "opening",
    "components/layout/blankscreen": "settings",
    "stores/viewonlytagsstore": "settings",
    "learning-nodes-run-inspector": "running",
    "connection_into_composition": "building",
    "connection_modulatory": "building",
    "connection_options": "building",
    "insertion_point": "building",
    "add_projection_placement": "building",
}

ISSUE = re.compile(r"(?<![\w/&])#(\d{1,5})\b")
LAYER_NAMES = {"e2e": "Browser (Playwright)", "tutorial": "Tutorial walkthrough", "vitest": "Frontend unit (vitest)", "pytest": "Backend (pytest)"}
NOT_IN_CI = re.compile(r"Not in CI:\s*(slow|needs a network|superseded|broken|measurement|pictures only|local only|should be added)\b[:\s—-]*(.*)", re.I)


@dataclass
class Test:
    title: str
    ci: bool
    issues: list[str]


@dataclass
class TestFile:
    path: str  # relative to the repo root
    layer: str  # e2e | tutorial | vitest | pytest
    summary: str
    tests: list[Test] = field(default_factory=list)
    area: str = ""
    ci: bool = False
    issues: list[str] = field(default_factory=list)
    not_in_ci: tuple[str, str] | None = None


def area_of(name: str) -> str:
    key = name.lower()
    if key in OVERRIDES:
        return OVERRIDES[key]
    for area, _, pattern in AREAS:
        if re.search(pattern, key):
            return area
    return "shell"


def issues_in(text: str) -> list[str]:
    seen: list[str] = []
    for m in ISSUE.finditer(text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def first_sentence(text: str) -> str:
    """The first paragraph of a header comment, on one line, cut at its first sentence."""
    para = []
    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            if para:
                break
            continue
        para.append(line)
    s = " ".join(para)
    m = re.match(r"(.+?[.!?])(\s|$)", s)
    s = m.group(1) if m else s
    return s if len(s) <= 220 else s[:217].rstrip() + "…"


# ---------------------------------------------------------------- TypeScript


def ts_header(src: str) -> str:
    """The spec's leading comment: a /** */ block or a run of // lines (imports may come first)."""
    body = re.sub(r"^(\s*import[^;]*;\s*)+", "", src)
    m = re.match(r"\s*/\*\*?(.*?)\*/", body, re.S)
    if m:
        return "\n".join(re.sub(r"^\s*\* ?", "", l) for l in m.group(1).splitlines())
    lines = []
    for line in body.lstrip().splitlines():
        if line.strip().startswith("//"):
            lines.append(re.sub(r"^\s*// ?", "", line))
        elif lines or line.strip():
            break
    return "\n".join(lines)


def _strip_ts_comments(src: str) -> str:
    """Comments blanked out (kept the same length), so braces and calls in them don't count."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
        elif src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


TS_CALL = re.compile(
    # `test`, `it`, `describe`, and the fixtures' own names (readOnlyTest, mutatingTest, …).
    r"(?<![.\w])(?P<kind>(?:test|it|\w+Test)(?:\.describe(?:\.serial|\.parallel)?)?|describe)"
    r"(?:\.(?:only|skip|fixme|each\([^)]*\)))?\(\s*(?P<q>[\"'`])(?P<title>(?:\\.|(?!(?P=q)).)*)(?P=q)\s*,(?P<opts>\s*\{[^{}]*tag\s*:[^{}]*\})?",
    re.S,
)


def ts_tests(src: str) -> list[tuple[str, bool]]:
    """(title, tagged @ci) for each test, a describe's title and tag carried to the tests inside it."""
    code = _strip_ts_comments(src)
    depth_at: list[int] = []  # brace depth at each char start, computed lazily below
    depth = 0
    depths = [0] * (len(code) + 1)
    i, n = 0, len(code)
    while i < n:
        c = code[i]
        if c in "\"'`":
            j = i + 1
            while j < n and code[j] != c:
                j += 2 if code[j] == "\\" else 1
            for k in range(i, min(j + 1, n)):
                depths[k] = depth
            i = j + 1
            continue
        depths[i] = depth
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    del depth_at
    stack: list[tuple[int, str, bool]] = []  # (depth inside the describe, title, @ci)
    out: list[tuple[str, bool]] = []
    for m in TS_CALL.finditer(code):
        d = depths[m.start()]
        while stack and stack[-1][0] > d:
            stack.pop()
        title = m.group("title").replace("\\'", "'").replace('\\"', '"')
        tagged = bool(m.group("opts") and "@ci" in m.group("opts")) or "@ci" in title
        if "describe" in m.group("kind"):
            stack.append((d + 1, title, tagged))
            continue
        inherited = any(t for _, _, t in stack)
        prefix = " › ".join(t for _, t, _ in stack)
        out.append((f"{prefix} › {title}" if prefix else title, tagged or inherited))
    return out


def collect_e2e() -> list[TestFile]:
    files: list[TestFile] = []
    for p in sorted(E2E.rglob("*.spec.ts")):
        if "node_modules" in p.parts:
            continue
        rel = p.relative_to(E2E).as_posix()
        src = p.read_text()
        header = ts_header(src)
        tutorial = rel.startswith("tutorials/")
        layer = "tutorial" if tutorial else "e2e"
        local = rel.endswith(".local.spec.ts")
        # The tutorials job runs everything under e2e/tutorials; the e2e job
        # runs the @ci tests (`--grep "@ci\b"`), bar *.local.spec.ts, which
        # playwright.config.ts ignores.
        file_ci = tutorial or not local
        tf = TestFile(path=f"frontend/e2e/{rel}", layer=layer, summary=first_sentence(header))
        file_issues = issues_in(header.split("\n\n")[0]) or issues_in(rel)
        for title, tagged in ts_tests(src):
            ci = file_ci and (tutorial or tagged)
            tf.tests.append(Test(title, ci, issues_in(title) or file_issues))
        tf.ci = any(t.ci for t in tf.tests) if tf.tests else file_ci
        tf.issues = file_issues
        # Only the header counts (#392): a "Not in CI:" further down, in a
        # test's comment or a string, is not the file saying why.
        m = NOT_IN_CI.search(header)
        if m:
            tf.not_in_ci = (m.group(1).lower(), m.group(2).strip().rstrip("."))
        tf.area = area_of(rel.replace(".spec.ts", ""))
        files.append(tf)
    return files


def collect_vitest() -> list[TestFile]:
    files: list[TestFile] = []
    for p in sorted(SRC.rglob("*.test.ts")):
        rel = p.relative_to(SRC).as_posix()
        src = p.read_text()
        header = ts_header(src)
        file_issues = issues_in(header.split("\n\n")[0])
        tf = TestFile(path=f"frontend/src/{rel}", layer="vitest", summary=first_sentence(header), ci=True)
        for title, _ in ts_tests(src):
            tf.tests.append(Test(title, True, issues_in(title) or file_issues))
        tf.issues = file_issues
        tf.area = area_of(rel.replace(".test.ts", ""))
        files.append(tf)
    return files


# --------------------------------------------------------------------- Python


def _marked_skip(node: ast.AST) -> bool:
    for d in getattr(node, "decorator_list", []):
        text = ast.unparse(d)
        if re.search(r"mark\.(skip|xfail)\b", text) and "skipif" not in text:
            return True
    return False


def collect_pytest() -> list[TestFile]:
    files: list[TestFile] = []
    for p in sorted(BACKEND_TESTS.rglob("test_*.py")):
        rel = p.relative_to(BACKEND_TESTS).as_posix()
        tree = ast.parse(p.read_text())
        doc = ast.get_docstring(tree) or ""
        file_issues = issues_in(doc.split("\n\n")[0])
        tf = TestFile(path=f"backend/tests/{rel}", layer="pytest", summary=first_sentence(doc), ci=True)

        def visit(body, prefix=""):
            for node in body:
                if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
                    visit(node.body, f"{node.name}.")
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
                    d = ast.get_docstring(node) or ""
                    line = first_sentence(d)
                    title = f"{prefix}{node.name}" + (f": {line}" if line else "")
                    # A skip or xfail mark: CI collects it but doesn't hold it to passing.
                    tf.tests.append(Test(title, not _marked_skip(node), issues_in(node.name + " " + d) or file_issues))

        visit(tree.body)
        tf.issues = file_issues
        tf.area = area_of(rel.replace(".py", "").removeprefix("test_"))
        files.append(tf)
    return files


# ------------------------------------------------------------- measurements


def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


def git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short=10", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        return "unknown"


def _pct(covered: int, total: int) -> float | None:
    return round(100 * covered / total, 1) if total else None


def snapshot_coverage(backend_json: Path, frontend_json: Path) -> dict:
    """Shrink coverage.py's JSON and vitest's json-summary to what the page shows."""
    b = json.loads(backend_json.read_text())
    f = json.loads(frontend_json.read_text())

    def b_folder(path: str) -> str:
        parts = Path(path).parts
        return "/".join(parts[: 2 if len(parts) > 2 else 1]) if parts[0] == "app" else parts[0]

    groups: dict[str, list[int]] = {}
    b_files = []
    for path, d in b["files"].items():
        s = d["summary"]
        key = b_folder(path)
        g = groups.setdefault(key, [0, 0, 0, 0])
        g[0] += s["covered_lines"]
        g[1] += s["num_statements"]
        g[2] += s.get("covered_branches", 0)
        g[3] += s.get("num_branches", 0)
        b_files.append(
            {
                "file": f"backend/{path}",
                "lines": _pct(s["covered_lines"], s["num_statements"]),
                "statements": s["num_statements"],
                "branches": _pct(s.get("covered_branches", 0), s.get("num_branches", 0)),
            }
        )
    bt = b["totals"]
    backend = {
        "lines": _pct(bt["covered_lines"], bt["num_statements"]),
        "statements": bt["num_statements"],
        "branches": _pct(bt.get("covered_branches", 0), bt.get("num_branches", 0)),
        "folders": {
            k: {"lines": _pct(v[0], v[1]), "statements": v[1], "branches": _pct(v[2], v[3])}
            for k, v in sorted(groups.items())
        },
        "files": b_files,
    }

    fgroups: dict[str, list[int]] = {}
    f_files = []
    for path, d in f.items():
        if path == "total":
            continue
        rel = Path(path).as_posix().split("/frontend/src/", 1)[-1]
        parts = rel.split("/")
        key = "/".join(parts[:2]) if parts[0] == "components" and len(parts) > 2 else (parts[0] if len(parts) > 1 else "src (top level)")
        g = fgroups.setdefault(key, [0, 0, 0, 0])
        g[0] += d["lines"]["covered"]
        g[1] += d["lines"]["total"]
        g[2] += d["branches"]["covered"]
        g[3] += d["branches"]["total"]
        f_files.append(
            {
                "file": f"frontend/src/{rel}",
                "lines": _pct(d["lines"]["covered"], d["lines"]["total"]),
                "statements": d["lines"]["total"],
                "branches": _pct(d["branches"]["covered"], d["branches"]["total"]),
            }
        )
    ft = f["total"]
    frontend = {
        "lines": _pct(ft["lines"]["covered"], ft["lines"]["total"]),
        "statements": ft["lines"]["total"],
        "branches": _pct(ft["branches"]["covered"], ft["branches"]["total"]),
        "folders": {
            k: {"lines": _pct(v[0], v[1]), "statements": v[1], "branches": _pct(v[2], v[3])}
            for k, v in sorted(fgroups.items())
        },
        "files": f_files,
    }
    for side in (backend, frontend):
        side["files"].sort(key=lambda x: x["file"])
    return {
        "measured": _dt.date.today().isoformat(),
        "commit": git_commit(),
        "backend": backend,
        "frontend": frontend,
    }


def snapshot_agreement(agreement_json: Path, thresholds: dict) -> dict:
    rows = json.loads(agreement_json.read_text())
    keep = []
    for r in rows:
        keep.append(
            {
                "model": r["model"],
                "view": r["view"],
                "nodes": [r.get("matched", 0), r.get("nodes", 0)],
                "rows": [r["rows"]["agree"], r["rows"]["pairs"]],
                "order": [r["order"]["agree"], r["order"]["pairs"]],
                "courses": [r["courses"]["drawn"], r["courses"]["showGraph"]],
                "missing": r["courses"]["missing"],
                "overlaps": len(r.get("overlaps", [])),
                "cut_off": len(r.get("cutOff", [])),
                "error": r.get("error"),
            }
        )
    return {"measured": _dt.date.today().isoformat(), "commit": git_commit(), "thresholds": thresholds, "results": keep}


# --------------------------------------------------------------------- page


def esc(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ").replace("<", "&lt;").replace(">", "&gt;")


def issue_links(issues: list[str]) -> str:
    return ", ".join(f"#{n}" for n in issues[:4]) + (" …" if len(issues) > 4 else "")


def share(pair: list[int]) -> str:
    agree, total = pair
    return "100%" if total == 0 else f"{100 * agree / total:.0f}%"


def render(files: list[TestFile], coverage: dict | None, agreement: dict | None) -> str:
    out: list[str] = []
    w = out.append
    by_layer: dict[str, list[TestFile]] = {}
    for f in files:
        by_layer.setdefault(f.layer, []).append(f)

    w("# What's tested")
    w("")
    w("<!-- Generated by scripts/test_map.py from the test files themselves; do not edit by hand.")
    w("     Built by the docs build and the Frontend workflow; not committed (#380). -->")
    w("")
    w(
        "PsyNeuView's automated tests, feature by feature: what each area's tests check, at which layer, "
        "whether CI runs them on every pull request, and the issue each one guards. Below that are the "
        "coverage numbers, how well the canvas agrees with PsyNeuLink's own `show_graph`, the browser "
        "tests CI doesn't run and why, and the known gaps. For how the suites and CI fit together, see "
        "[Testing & CI](testing.md)."
    )
    w("")
    w("## At a glance")
    w("")
    w("| Layer | Files | Tests | Run by CI on every pull request |")
    w("|---|---|---|---|")
    for layer in ("e2e", "tutorial", "vitest", "pytest"):
        fs = by_layer.get(layer, [])
        n = sum(len(f.tests) for f in fs)
        nci = sum(1 for f in fs for t in f.tests if t.ci)
        w(f"| {LAYER_NAMES[layer]} | {len(fs)} | {n} | {nci} tests in {sum(1 for f in fs if f.ci)} files |")
    w("")
    w(
        "A browser test runs in CI when the test (or the `describe` around it) is tagged `@ci`; every "
        "tutorial walkthrough runs in the tutorials job; every unit and backend test runs, bar those "
        "marked skip or expected-to-fail."
    )
    w("")

    # ---- by area
    w("## Feature map")
    w("")
    w("| Area | Browser | Tutorial | Unit (vitest) | Backend (pytest) | Tests in CI |")
    w("|---|---|---|---|---|---|")
    for area, label, _ in AREAS:
        fs = [f for f in files if f.area == area]
        if not fs:
            w(f"| {label} | – | – | – | – | **no tests** |")
            continue
        cells = []
        for layer in ("e2e", "tutorial", "vitest", "pytest"):
            lf = [f for f in fs if f.layer == layer]
            cells.append(f"{len(lf)} files, {sum(len(f.tests) for f in lf)} tests" if lf else "–")
        n = sum(len(f.tests) for f in fs)
        nci = sum(1 for f in fs for t in f.tests if t.ci)
        w(f"| [{label}](#{area}) | " + " | ".join(cells) + f" | {nci} of {n} |")
    w("")
    for area, label, _ in AREAS:
        fs = [f for f in files if f.area == area]
        w(f'<a id="{area}"></a>')
        w("")
        w(f"### {label}")
        w("")
        if not fs:
            w("No tests yet.")
            w("")
            continue
        w("| File | Layer | Tests | In CI | Issues | What it checks |")
        w("|---|---|---|---|---|---|")
        order = {"e2e": 0, "tutorial": 1, "vitest": 2, "pytest": 3}
        for f in sorted(fs, key=lambda f: (order[f.layer], f.path)):
            nci = sum(1 for t in f.tests if t.ci)
            ci = "yes" if f.tests and nci == len(f.tests) else ("no" if nci == 0 else f"{nci} of {len(f.tests)}")
            w(
                f"| `{f.path.split('/')[-1]}` | {LAYER_NAMES[f.layer].split(' (')[0]} | {len(f.tests)} | {ci} | "
                f"{issue_links(f.issues)} | {esc(f.summary)} |"
            )
        w("")
        browser = [f for f in sorted(fs, key=lambda f: (order[f.layer], f.path)) if f.layer in ("e2e", "tutorial")]
        if not browser:
            continue
        w("<details><summary>Every browser and tutorial test in this area</summary>")
        w("")
        w("| Test | File | Layer | In CI | Issue |")
        w("|---|---|---|---|---|")
        for f in browser:
            for t in f.tests:
                w(
                    f"| {esc(t.title)} | `{f.path.split('/')[-1]}` | {LAYER_NAMES[f.layer].split(' (')[0]} | "
                    f"{'yes' if t.ci else 'no'} | {issue_links(t.issues[:1])} |"
                )
        w("")
        w("</details>")
        w("")
    w(
        "Every unit and backend test, one by one, is in [the full list](testing-coverage-tests.md)."
    )
    w("")

    # ---- coverage
    w("## Coverage")
    w("")
    if not coverage:
        w("Not measured yet.")
    else:
        b, fe = coverage["backend"], coverage["frontend"]
        w(
            f"Measured {coverage['measured']} at commit `{coverage['commit']}`. Browser tests don't measure "
            "code coverage; the feature map above is their measure."
        )
        w("")
        w("| | Lines | Branches | Statements |")
        w("|---|---|---|---|")
        w(f"| Backend (`app/`, pytest) | {b['lines']}% | {b['branches']}% | {b['statements']} |")
        w(f"| Frontend (`src/`, vitest) | {fe['lines']}% | {fe['branches']}% | {fe['statements']} |")
        w("")
        w(
            "The frontend's branch figure counts only branches in files the unit tests load, so it reads "
            "high; its line figure is the honest one. The React components are tested in the browser, "
            "which this number doesn't see."
        )
        w("")
        for name, side in (("Backend", b), ("Frontend", fe)):
            w(f"<details><summary>{name} by folder</summary>")
            w("")
            w("| Folder | Lines | Branches | Statements |")
            w("|---|---|---|---|")
            for k, v in side["folders"].items():
                if not v["statements"]:
                    continue
                br = "–" if v["branches"] is None else f"{v['branches']}%"
                w(f"| `{k}` | {v['lines']}% | {br} | {v['statements']} |")
            w("")
            w("</details>")
            w("")
        w("### Least covered, of the larger modules")
        w("")
        w(
            "The 20 modules with the lowest line coverage among the larger ones: backend modules of 150 "
            "statements or more, and frontend logic (stores, utils, hooks, shortcuts) of 100 or more. The "
            "React components under `components/` are left out: the browser tests exercise them, which "
            "this measure can't see, so nearly all of them read 0%."
        )
        w("")
        for name, side in (("Backend", b), ("Frontend", fe)):
            floor = 150 if side is b else 100
            big = [
                x for x in side["files"]
                if x["statements"] >= floor and "/components/" not in x["file"] and not x["file"].endswith(".tsx")
            ]
            big.sort(key=lambda x: (x["lines"] or 0, -x["statements"]))
            w(f"**{name}**")
            w("")
            w("| Module | Lines | Branches | Statements |")
            w("|---|---|---|---|")
            for x in big[:20]:
                br = "–" if x["branches"] is None else f"{x['branches']}%"
                w(f"| `{x['file']}` | {x['lines']}% | {br} | {x['statements']} |")
            w("")

    # ---- show_graph agreement
    w("## Agreement with show_graph")
    w("")
    if not agreement:
        w("Not measured yet.")
    else:
        res = agreement["results"]
        th = agreement["thresholds"]
        perfect = [
            r for r in res if not r["error"] and r["nodes"][0] == r["nodes"][1] and share(r["rows"]) == "100%" and share(r["order"]) == "100%"
        ]
        w(
            f"`e2e/show-graph-agreement.spec.ts` opens every bundled model in every view, lays it out "
            f"Like show_graph, and scores the canvas against show_graph's own picture. Full batch measured "
            f"{agreement['measured']} at commit `{agreement['commit']}`: **{len(perfect)} of {len(res)}** "
            "views agree fully on nodes, rows and order."
        )
        w("")
        w(f"**What CI holds it to.** {th['ci']}")
        w("")
        w(
            "Nodes: show_graph's nodes the canvas draws. Rows: pairs of nodes whose above, level or below "
            "relation agrees. Order: pairs on one show_graph row whose left-to-right order agrees. Courses: "
            "edges drawn along show_graph's own course."
        )
        w("")
        below = [r for r in res if r not in perfect]
        if below:
            w("**Below 100%**, and why:")
            w("")
            w("| Model | View | Nodes | Rows | Order | Courses | Why |")
            w("|---|---|---|---|---|---|---|")
            for r in below:
                w(
                    f"| {r['model'].removesuffix('.py')} | {esc(r['view'])} | {r['nodes'][0]}/{r['nodes'][1]} | "
                    f"{share(r['rows'])} | {share(r['order'])} | {r['courses'][0]}/{r['courses'][1]} | "
                    f"{esc(agreement.get('why', {}).get(r['model'] + ' — ' + r['view'], r['error'] or ''))} |"
                )
            w("")
        w("<details><summary>Every model and view</summary>")
        w("")
        w("| Model | View | Nodes | Rows | Order | Courses | Overlaps | Cut off |")
        w("|---|---|---|---|---|---|---|---|")
        for r in res:
            w(
                f"| {r['model'].removesuffix('.py')} | {esc(r['view'])} | {r['nodes'][0]}/{r['nodes'][1]} | "
                f"{share(r['rows'])} | {share(r['order'])} | {r['courses'][0]}/{r['courses'][1]} | "
                f"{r['overlaps']} | {r['cut_off']} |"
            )
        w("")
        w("</details>")
        w("")

    # ---- not in CI
    w("## Browser tests CI doesn't run")
    w("")
    nonci = [f for f in by_layer.get("e2e", []) if not f.ci]
    partial = [f for f in by_layer.get("e2e", []) if f.ci and any(not t.ci for t in f.tests)]
    w(
        f"{len(nonci)} browser spec files aren't in CI at all. Each says why in a `Not in CI:` line in its "
        "header; this table is read from those lines. (Every tutorial runs, in the tutorials job.)"
    )
    w("")
    w("| Spec | Why | Detail |")
    w("|---|---|---|")
    for f in nonci:
        why, detail = f.not_in_ci or ("**not given**", "")
        w(f"| `{f.path.split('/')[-1]}` | {why} | {esc(detail)} |")
    w("")
    if partial:
        w("Spec files in CI that hold tests CI skips (untagged, or a measurement run only on request):")
        w("")
        for f in partial:
            skipped = [t.title for t in f.tests if not t.ci]
            w(f"- `{f.path.split('/')[-1]}`: {esc('; '.join(skipped))}")
        w("")

    # ---- how to run
    w("## Running each layer locally")
    w("")
    w("```bash")
    w("# Backend (from backend/, with its .venv)")
    w(".venv/bin/python -m pytest tests -n auto")
    w("# ... with coverage, then fold in what the model-runner processes wrote as they")
    w("# exited (after pytest-cov's own report), and write backend/coverage.json")
    w(".venv/bin/python -m pytest tests -n auto --cov --cov-report=")
    w(".venv/bin/python -m coverage combine --append && .venv/bin/python -m coverage json")
    w("")
    w("# Frontend unit tests (from frontend/)")
    w("npm test")
    w("npm run test:coverage        # writes frontend/coverage/coverage-summary.json")
    w("")
    w("# Browser tests (from frontend/; builds, then starts its own backend on a free port)")
    w("npm run test:e2e:ci          # what the e2e check runs on a pull request")
    w("npx playwright test e2e/drag-to-connect.spec.ts   # one spec")
    w("npx playwright test e2e/tutorials                 # the tutorials job")
    w("npx playwright test e2e/show-graph-agreement.spec.ts -g 'every bundled'  # the full agreement batch")
    w("")
    w("# This page (from the repo root; writes build/test-map/, or see it in the docs site: mkdocs serve)")
    w("python3 scripts/test_map.py")
    w("python3 scripts/test_map.py --coverage backend/coverage.json frontend/coverage/coverage-summary.json")
    w("python3 scripts/test_map.py --agreement frontend/test-results/show-graph-agreement/agreement.json")
    w("```")
    w("")

    # ---- gaps
    w("## Known gaps")
    w("")
    gaps = DATA / "gaps.md"
    if gaps.exists():
        w(gaps.read_text().strip())
    empty = [label for area, label, _ in AREAS if not any(f.area == area for f in files)]
    if empty:
        w("")
        w("Areas with no tests on this branch: " + ", ".join(empty) + ".")
    w("")
    return "\n".join(out)


def render_all(files: list[TestFile]) -> str:
    """Every test, by area and file, with its layer, whether CI runs it and its issue."""
    out = [
        "# What's tested: every test",
        "",
        "<!-- Generated by scripts/test_map.py; do not edit by hand. -->",
        "",
        "Every automated test, by feature area and file: **CI** means it runs on every pull request; "
        "an issue number is the one the test names (or its file does). The summary, coverage and gaps "
        "are on [What's tested](testing-coverage.md).",
        "",
    ]
    order = {"e2e": 0, "tutorial": 1, "vitest": 2, "pytest": 3}
    for area, label, _ in AREAS:
        fs = sorted((f for f in files if f.area == area), key=lambda f: (order[f.layer], f.path))
        if not fs:
            continue
        out += [f"## {label}", ""]
        for f in fs:
            out += [f"**`{f.path}`** ({LAYER_NAMES[f.layer]})", ""]
            for t in f.tests:
                tags = ["CI" if t.ci else "not in CI"] + ([f"#{t.issues[0]}"] if t.issues else [])
                out.append(f"- {esc(t.title)} · {' · '.join(tags)}")
            out.append("")
    return "\n".join(out)


def unaccounted(files: list[TestFile]) -> list[str]:
    """Browser specs CI doesn't run that don't say why (frontend/src/ciSpecs.test.ts checks the same)."""
    return [
        f"{f.path}: not in CI, and its header has no 'Not in CI: <why>' line"
        for f in files
        if f.layer == "e2e" and not f.ci and not f.not_in_ci
    ]


def pages() -> tuple[dict[str, str], list[str]]:
    """The What's tested pages, by docs path, and the problems found building them."""
    files = collect_e2e() + collect_vitest() + collect_pytest()
    page = render(files, load_json(COVERAGE), load_json(AGREEMENT)) + "\n"
    return {DOC: page, DOC_ALL: render_all(files) + "\n"}, unaccounted(files)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="fail if a browser spec is neither in CI nor says why (CI)")
    ap.add_argument("--out", type=Path, default=OUT_DIR, help=f"where to write the pages (default {OUT_DIR.relative_to(ROOT)})")
    ap.add_argument("--coverage", nargs=2, metavar=("BACKEND_JSON", "FRONTEND_SUMMARY_JSON"), type=Path)
    ap.add_argument("--agreement", type=Path, metavar="AGREEMENT_JSON")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    if args.coverage:
        COVERAGE.write_text(json.dumps(snapshot_coverage(*args.coverage), indent=1) + "\n")
    if args.agreement:
        old = load_json(AGREEMENT) or {}
        thresholds = old.get("thresholds") or {"ci": ""}
        snap = snapshot_agreement(args.agreement, thresholds)
        if "why" in old:
            snap["why"] = old["why"]
        AGREEMENT.write_text(json.dumps(snap, indent=1, ensure_ascii=False) + "\n")

    built, problems = pages()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, text in built.items():
        (args.out / name).write_text(text)
    for p in problems:
        print(f"test-map: {'' if args.check else 'warning: '}{p}")
    print(f"wrote {', '.join(built)} to {args.out}")
    return 1 if (args.check and problems) else 0


if __name__ == "__main__":
    sys.exit(main())
