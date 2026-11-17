#!/usr/bin/env python3
"""Standing code scan (#243): checks for problems no single PR shows.

Runs every check over PsyNeuView and, when it is next to it, PsyNeuView-MacApp,
and writes a dated report to .planning/code-scan/ (gitignored). Each check is
one function registered with ``@check``; it yields findings with a file, a
line, a severity and a one-line fix. A finding already tracked by an open
``code-scan`` issue (its body carries the finding's ``scan:<id>``) is listed
as tracked, not as new.

    python3 scripts/code_scan.py                     # scan, write the report
    python3 scripts/code_scan.py --fail-on high      # exit 1 on a new high finding
    python3 scripts/code_scan.py --json              # findings as JSON on stdout
    python3 scripts/code_scan.py --macapp ../PsyNeuView-MacApp --no-issues

New checks come from bugs that turned out to be patterns: when a fix could
recur, add its check here and tick it on #243. A deliberate exception is
marked `code-scan: ok` (with the reason) on the line or the line above.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

ROOT = Path(__file__).resolve().parent.parent
SEVERITIES = ("high", "medium", "low")


@dataclass
class Repo:
    """A repo to scan: its working tree, or (``ref``) a commit of it, so a
    stale local checkout can be scanned as its branch is now."""

    name: str
    root: Path
    ref: str | None = None
    _files: list[str] | None = field(default=None, repr=False)
    _cache: dict[str, str] = field(default_factory=dict, repr=False)

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.root), *args], capture_output=True, text=True, check=True,
        ).stdout

    def files(self) -> list[str]:
        """Tracked files, as paths relative to the repo."""
        if self._files is None:
            out = self._git("ls-tree", "-r", "-z", "--name-only", self.ref) if self.ref else self._git("ls-files", "-z")
            self._files = [f for f in out.split("\0") if f]
        return self._files

    def read(self, rel: str) -> str:
        if rel not in self._cache:
            try:
                if self.ref:
                    self._cache[rel] = self._git("show", f"{self.ref}:{rel}")
                else:
                    self._cache[rel] = (self.root / rel).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError, subprocess.CalledProcessError):
                self._cache[rel] = ""
        return self._cache[rel]


@dataclass
class Finding:
    check: str
    severity: str
    repo: str
    path: str
    line: int
    message: str
    fix: str
    text: str = ""
    id: str = ""
    tracked_by: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.id:
            # Stable across line moves: the check, the file, and the line's text.
            key = f"{self.check}|{self.repo}|{self.path}|{self.text.strip()}"
            self.id = hashlib.sha1(key.encode()).hexdigest()[:10]


@dataclass
class Check:
    id: str
    severity: str
    title: str
    run: Callable[[Repo], Iterable[Finding]]


CHECKS: list[Check] = []


def check(id: str, severity: str, title: str):
    assert severity in SEVERITIES
    def register(fn: Callable[[Repo, Check], Iterable[Finding]]):
        c = Check(id, severity, title, lambda repo: fn(repo, c))
        CHECKS.append(c)
        return fn
    return register


def _find(c: Check, repo: Repo, path: str, line: int, text: str, message: str, fix: str) -> Finding:
    return Finding(c.id, c.severity, repo.name, path, line, message, fix, text=text)


def _lines(repo: Repo, rel: str) -> Iterator[tuple[int, str]]:
    for n, line in enumerate(repo.read(rel).splitlines(), 1):
        yield n, line


def _is_comment(line: str) -> bool:
    return line.lstrip().startswith(("//", "*", "/*", "#"))


def _code_files(repo: Repo, suffixes: tuple[str, ...], under: tuple[str, ...] = ()) -> list[str]:
    return [
        f for f in repo.files()
        if f.endswith(suffixes) and (not under or f.startswith(under))
    ]


# --- Checks -------------------------------------------------------------------


@check("case-collision", "high", "Two files whose names differ only in capitals")
def _case_collision(repo: Repo, c: Check) -> Iterator[Finding]:
    """macOS's file system treats them as one file and Linux as two, so a
    checkout on a Mac silently loses one (#271: SettingsSearch.tsx and
    settingsSearch.ts)."""
    seen: dict[str, str] = {}
    for f in repo.files():
        other = seen.setdefault(f.lower(), f)
        if other != f:
            yield _find(c, repo, f, 1, f"{other}|{f}",
                        f"'{f}' and '{other}' differ only in capitals",
                        "rename one so the names differ by more than case")


# Installs use uv (#244, MacApp#53, #249). A pip-style argument list is fine
# when it is uv's (`uv pip install …`), and pip itself is allowed as the
# fallback beside uv: either way uv is named within a few lines. Otherwise
# it must be labelled a fallback.
# Arguments that run pip ("pip", "install" …, or "-m", "pip"). A path to a
# venv's pip alone isn't a run: setup checks it exists (python -m venv makes it).
_PIP_CALL = re.compile(r"""["']pip3?["'],\s*["'](?:install|uninstall)["']|["']-m["'],\s*["']pip["']""")


@check("pip-not-uv", "medium", "An install that runs pip where uv should")
def _pip_not_uv(repo: Repo, c: Check) -> Iterator[Finding]:
    for f in _code_files(repo, (".py", ".swift"), ("backend/app/", "Sources/", "PsyNeuView/", "scripts/")):
        lines = repo.read(f).splitlines()
        for i, line in enumerate(lines):
            if not _PIP_CALL.search(line):
                continue
            near = " ".join(lines[max(0, i - 6): i + 7])
            if re.search(r"\buv\b|uvPath|\.uv\b|bundledUv|fallback", near, re.I):
                continue
            yield _find(c, repo, f, i + 1, line,
                        "runs pip directly",
                        "install with uv (`uv pip install --python …`), keeping pip only as a labelled fallback")


@check("uv-sources-psyneulink", "high", "pyproject pins PsyNeuLink through [tool.uv.sources]")
def _uv_sources(repo: Repo, c: Check) -> Iterator[Finding]:
    """`uv pip install -e backend/` obeys it and replaces the PsyNeuLink every
    Settings switch and the Mac app chose (#249)."""
    rel = "backend/pyproject.toml"
    in_sources = False
    for n, line in _lines(repo, rel):
        s = line.strip()
        if s.startswith("["):
            in_sources = s == "[tool.uv.sources]"
            continue
        if in_sources and re.match(r"psyneulink\s*=", s):
            yield _find(c, repo, rel, n, line,
                        "PsyNeuLink is pinned through [tool.uv.sources]",
                        "remove it; the chosen PsyNeuLink is installed separately")


# The product's one name (#258). The old spelling may appear only where it is
# read for compatibility or migrated away: those files, their tests, and lines
# that say they are about the old name.
_OLD_NAME = re.compile(r"psynewview|psyneuveiw|psyneu_view", re.I)
_OLD_NAME_FILES = re.compile(
    r"(^|/)(env_names\.py|app_config\.py|migrateStorageNames(\.test)?\.ts|AppIdentity\.swift"
    r"|PagePreferences\.swift|code_scan\.py)$|(^|/)tests?/|Tests?/|\.test\.tsx?$|CHANGELOG|^docs/releases/"
)
_OLD_NAME_CONTEXT = re.compile(r"legacy|compat|old|migrat|renam|moved|through \d|before|was |earlier|fallback", re.I)


@check("old-name", "low", "The product's old spelling outside its compatibility code")
def _old_name(repo: Repo, c: Check) -> Iterator[Finding]:
    for f in repo.files():
        if _OLD_NAME_FILES.search(f):
            continue
        if not f.endswith((".py", ".ts", ".tsx", ".swift", ".sh", ".md", ".yml", ".yaml", ".json", ".plist", ".toml")):
            continue
        lines = repo.read(f).splitlines()
        for i, line in enumerate(lines):
            n = i + 1
            context = " ".join(lines[max(0, i - 2): i + 1])
            if _OLD_NAME.search(line) and not _OLD_NAME_CONTEXT.search(context):
                yield _find(c, repo, f, n, line,
                            "uses the old spelling of the product's name",
                            "use PsyNeuView (env vars PSYNEUVIEW_*); old names are read only in env_names / the migrations")


@check("platform-sniff", "medium", "Platform judged from navigator.platform")
def _platform_sniff(repo: Repo, c: Check) -> Iterator[Finding]:
    """The graph library judges "is it a Mac" from the user agent; a check on
    navigator.platform can disagree with it (#261: on the Linux CI runner, a
    page told it was on a Mac got Mac keys from one and not the other)."""
    for f in _code_files(repo, (".ts", ".tsx"), ("frontend/src/",)):
        if f.endswith((".test.ts", ".test.tsx")):
            continue
        for n, line in _lines(repo, f):
            if "navigator.platform" in line and not _is_comment(line):
                yield _find(c, repo, f, n, line,
                            "judges the platform from navigator.platform",
                            "judge it as the graph library does, from navigator.userAgent")


@check("shell-true", "high", "A shell command built from a string")
def _shell_true(repo: Repo, c: Check) -> Iterator[Finding]:
    for f in _code_files(repo, (".py",), ("backend/app/", "scripts/")):
        for n, line in _lines(repo, f):
            if re.search(r"shell\s*=\s*True", line):
                yield _find(c, repo, f, n, line,
                            "runs a command through the shell",
                            "pass an argument list without shell=True, so no input can become a command")


@check("todo-without-issue", "low", "A TODO or FIXME with no issue number")
def _todo(repo: Repo, c: Check) -> Iterator[Finding]:
    for f in _code_files(repo, (".py", ".ts", ".tsx", ".swift"), ("backend/app/", "frontend/src/", "Sources/", "PsyNeuView/")):
        for n, line in _lines(repo, f):
            if re.search(r"\b(TODO|FIXME)\b|\bXXX:", line) and not re.search(r"#\d+", line):
                yield _find(c, repo, f, n, line,
                            "a TODO with no issue",
                            "file an issue and put its number on the line, or do it now")


# --- Running and reporting ------------------------------------------------------


ALLOW_MARKER = "code-scan: ok"


def _allowed(repo: Repo, f: Finding) -> bool:
    """A deliberate exception: `code-scan: ok` on the line or the one above."""
    lines = repo.read(f.path).splitlines()
    return any(ALLOW_MARKER in lines[n - 1] for n in (f.line, f.line - 1) if 0 < n <= len(lines))


def scan(repos: list[Repo], only: set[str] | None = None) -> list[Finding]:
    findings: list[Finding] = []
    for c in CHECKS:
        if only and c.id not in only:
            continue
        for repo in repos:
            findings.extend(f for f in c.run(repo) if not _allowed(repo, f))
    order = {s: i for i, s in enumerate(SEVERITIES)}
    findings.sort(key=lambda f: (order[f.severity], f.check, f.repo, f.path, f.line))
    return findings


def open_scan_issues(slugs: list[str]) -> list[dict]:
    """Open `code-scan` issues in each repo, with their bodies, via gh."""
    if not shutil.which("gh"):
        return []
    issues: list[dict] = []
    for slug in slugs:
        r = subprocess.run(
            ["gh", "issue", "list", "-R", slug, "--label", "code-scan", "--state", "open",
             "--limit", "200", "--json", "number,title,body"],
            capture_output=True, text=True,
        )
        if r.returncode == 0:
            issues.extend(json.loads(r.stdout or "[]"))
    return issues


def match_tracked(findings: list[Finding], issues: list[dict]) -> None:
    """A finding is tracked by any open issue whose body names `scan:<id>`."""
    for f in findings:
        tag = f"scan:{f.id}"
        f.tracked_by = [i["number"] for i in issues if tag in (i.get("body") or "")]


def report_markdown(findings: list[Finding], when: dt.date) -> str:
    new = [f for f in findings if not f.tracked_by]
    counts = {s: sum(1 for f in new if f.severity == s) for s in SEVERITIES}
    out = [
        f"# Code scan, {when.isoformat()}",
        "",
        f"New: {counts['high']} high, {counts['medium']} medium, {counts['low']} low. "
        f"Already tracked: {len(findings) - len(new)}. Checks run: {len(CHECKS)}. (#243)",
        "",
        "To track a finding, put its `scan:<id>` in the body of a `code-scan` issue.",
    ]
    by_check: dict[str, list[Finding]] = {}
    for f in findings:
        by_check.setdefault(f.check, []).append(f)
    titles = {c.id: c for c in CHECKS}
    for cid, fs in by_check.items():
        c = titles[cid]
        out += ["", f"## {c.title} (`{cid}`, {c.severity})", "", f"Fix: {fs[0].fix}", ""]
        for f in fs:
            mark = f"tracked by #{', #'.join(map(str, f.tracked_by))}" if f.tracked_by else "**new**"
            out.append(f"- `{f.repo}:{f.path}:{f.line}`: {f.message}. {mark}. `scan:{f.id}`")
    if not findings:
        out += ["", "Nothing found."]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--macapp", type=Path, default=ROOT.parent / "PsyNeuView-MacApp",
                    help="the Mac app checkout to scan as well, if present")
    ap.add_argument("--macapp-ref", default="origin/jonhanke-devel",
                    help="scan the Mac app at this ref (its branch as pushed), not its working tree; '' for the working tree")
    ap.add_argument("--check", action="append", help="run only these checks (repeatable)")
    ap.add_argument("--no-issues", action="store_true", help="don't look up tracking issues with gh")
    ap.add_argument("--fail-on", choices=SEVERITIES, help="exit 1 on a new finding this severe or worse")
    ap.add_argument("--json", action="store_true", help="print the findings as JSON")
    ap.add_argument("--report-dir", type=Path, default=ROOT / ".planning" / "code-scan")
    ap.add_argument("--list", action="store_true", help="list the checks and exit")
    args = ap.parse_args(argv)

    if args.list:
        for c in CHECKS:
            print(f"{c.id:24} {c.severity:7} {c.title}")
        return 0

    repos = [Repo("PsyNeuView", ROOT)]
    if (args.macapp / ".git").exists():
        mac = args.macapp.resolve()
        ref = args.macapp_ref or None
        if ref and subprocess.run(["git", "-C", str(mac), "rev-parse", "--verify", "-q", ref],
                                  capture_output=True).returncode != 0:
            print(f"Mac app: no {ref} here; scanning its working tree", file=sys.stderr)
            ref = None
        repos.append(Repo("PsyNeuView-MacApp", mac, ref))
    findings = scan(repos, set(args.check) if args.check else None)
    if not args.no_issues:
        match_tracked(findings, open_scan_issues(["jonhanke-nam/PsyNeuView", "jonhanke-nam/PsyNeuView-MacApp"]))

    today = dt.date.today()
    report = report_markdown(findings, today)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    path = args.report_dir / f"{today.isoformat()}.md"
    path.write_text(report)

    if args.json:
        print(json.dumps([asdict(f) for f in findings], indent=2))
    else:
        print(report.split("\n\n")[1])
        print(f"Report: {path}")

    if args.fail_on:
        worst = SEVERITIES.index(args.fail_on)
        failing = [f for f in findings if not f.tracked_by and SEVERITIES.index(f.severity) <= worst]
        if failing:
            for f in failing:
                print(f"NEW {f.severity}: {f.repo}:{f.path}:{f.line} {f.message} (scan:{f.id})", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
