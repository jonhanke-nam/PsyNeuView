"""The standing code scan (#243): each check finds its pattern and lets the
allowed forms through, and tracked findings are matched to their issues."""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "code_scan.py"
spec = importlib.util.spec_from_file_location("code_scan", SCRIPT)
code_scan = importlib.util.module_from_spec(spec)
sys.modules["code_scan"] = code_scan
spec.loader.exec_module(code_scan)


@pytest.fixture
def repo(tmp_path):
    """A throwaway git repo; ``add(path, text)`` commits a file to it."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)

    def add(rel: str, text: str) -> None:
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
        subprocess.run(["git", "-C", str(tmp_path), "add", rel], check=True)

    r = code_scan.Repo("Test", tmp_path)
    r.add = add
    return r


def found(repo, check_id):
    repo._files = None
    return [f for f in code_scan.scan([repo], {check_id})]


def test_case_collision(repo, tmp_path):
    repo.add("a/SettingsSearch.tsx", "x")
    # Two names differing in case can't both exist on a Mac disk; index both.
    blob = subprocess.run(["git", "-C", str(tmp_path), "hash-object", "-w", "--stdin"],
                          input="y", capture_output=True, text=True, check=True).stdout.strip()
    subprocess.run(["git", "-C", str(tmp_path), "update-index", "--add", "--cacheinfo",
                    f"100644,{blob},a/settingsSearch.tsx"], check=True)
    [f] = found(repo, "case-collision")
    assert f.severity == "high" and "capitals" in f.message


def test_pip_not_uv(repo):
    repo.add("backend/app/a.py", 'subprocess.run([py, "-m", "pip", "install", "x"])\n')
    repo.add("backend/app/b.py", '# uv does the install\nrun([uv, "pip", "install", "x"])\n')
    repo.add("backend/app/c.py", '# pip fallback when uv is missing\nrun([py, "-m", "pip", "install", "x"])\n')
    assert [f.path for f in found(repo, "pip-not-uv")] == ["backend/app/a.py"]


def test_uv_sources_psyneulink(repo):
    repo.add("backend/pyproject.toml", '[project]\nname = "x"\n\n[tool.uv.sources]\npsyneulink = { git = "https://x" }\n')
    [f] = found(repo, "uv-sources-psyneulink")
    assert f.line == 5


def test_old_name(repo):
    repo.add("docs/setup.md", "Settings live in ~/.psynewview.json\n")
    repo.add("docs/rename.md", "Moved ~/.psynewview.json to ~/.psyneuview.json\n")
    repo.add("docs/both.md", "Reads PSYNEUVIEW_CONFIG_FILE and PSYNEWVIEW_WORKING_DIR\n")
    repo.add("docs/ok.md", "<!-- code-scan: ok, lists both for cleanup -->\nRemoves psynewview_* files\n")
    repo.add("docs/legacy.md", "The legacy file ~/.psynewview.json is still read\n")
    repo.add("backend/app/services/env_names.py", "OLD = 'PSYNEWVIEW_'\n")
    assert sorted(f.path for f in found(repo, "old-name")) == ["docs/both.md", "docs/setup.md"]


def test_platform_sniff(repo):
    repo.add("frontend/src/a.ts", "const mac = /Mac/.test(navigator.platform);\n")
    repo.add("frontend/src/b.ts", "// navigator.platform disagrees with the user agent\n")
    assert [f.path for f in found(repo, "platform-sniff")] == ["frontend/src/a.ts"]


def test_shell_true(repo):
    repo.add("backend/app/a.py", "subprocess.run(f'git {x}', shell=True)\n")
    [f] = found(repo, "shell-true")
    assert f.severity == "high"


def test_todo_without_issue(repo):
    repo.add("frontend/src/a.ts", "// TODO: tidy this\n// TODO(#12): tidy that\nconst s = 'pnl.XXX(...)';\n")
    assert [f.line for f in found(repo, "todo-without-issue")] == [1]


def test_a_finding_keeps_its_id_when_lines_move(repo):
    repo.add("frontend/src/a.ts", "// TODO: tidy this\n")
    [before] = found(repo, "todo-without-issue")
    repo._cache.clear()
    repo.add("frontend/src/a.ts", "\n\n// TODO: tidy this\n")
    [after] = found(repo, "todo-without-issue")
    assert after.line == 3 and after.id == before.id


def test_tracked_findings_are_matched_to_their_issue(repo):
    repo.add("frontend/src/a.ts", "// TODO: tidy this\n")
    [f] = found(repo, "todo-without-issue")
    code_scan.match_tracked([f], [{"number": 9, "body": f"Fixes scan:{f.id}"}, {"number": 10, "body": "other"}])
    assert f.tracked_by == [9]
    report = code_scan.report_markdown([f], code_scan.dt.date(2026, 11, 17))
    assert "tracked by #9" in report and "New: 0 high, 0 medium, 0 low" in report


def test_fail_on_high_only_for_new_findings(repo, tmp_path, monkeypatch):
    repo.add("backend/app/a.py", "subprocess.run(cmd, shell=True)\n")
    monkeypatch.setattr(code_scan, "ROOT", tmp_path)
    args = ["--no-issues", "--macapp", str(tmp_path / "none"), "--report-dir", str(tmp_path / "out")]
    assert code_scan.main(args + ["--fail-on", "high"]) == 1
    assert code_scan.main(args) == 0
    assert list((tmp_path / "out").glob("*.md"))


def test_this_repo_has_no_new_high_findings():
    """The guard CI relies on: PsyNeuView itself is clean of high findings."""
    repo = code_scan.Repo("PsyNeuView", SCRIPT.parent.parent)
    high = [f for f in code_scan.scan([repo]) if f.severity == "high"]
    assert high == [], high
