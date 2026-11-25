"""Every CI job that runs backend pytest or browser tests installs Graphviz (#433).

The backend draws the show_graph tab's picture with Graphviz's ``dot``
program, and the tests that need it skip where it is missing. A job that ran
them without Graphviz would skip them silently, so each such job is checked
here for an apt install of ``graphviz``.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"

# A step that runs one of these runs tests that may need Graphviz.
RUNS_TESTS = re.compile(r"^[^#\n]*(-m pytest\b|playwright test\b|npm run test:e2e)", re.M)
INSTALLS_GRAPHVIZ = re.compile(r"apt-get install\b[^\n]*\bgraphviz\b")


def _test_jobs():
    for path in sorted(WORKFLOWS.glob("*.yml")):
        jobs = (yaml.safe_load(path.read_text()) or {}).get("jobs") or {}
        for name, job in jobs.items():
            runs = "\n".join(str(step.get("run", "")) for step in job.get("steps") or [])
            if RUNS_TESTS.search(runs):
                yield pytest.param(runs, id=f"{path.name}:{name}")


JOBS = list(_test_jobs())


def test_the_test_jobs_are_found():
    """The search finds the backend and browser jobs, so the check below means something."""
    ids = {p.id for p in JOBS}
    assert {"backend-tests.yml:backend-tests", "e2e.yml:shard", "tutorials.yml:tutorials"} <= ids, ids


@pytest.mark.parametrize("runs", JOBS)
def test_job_installs_graphviz(runs):
    assert INSTALLS_GRAPHVIZ.search(runs), "this job runs tests but installs no Graphviz (apt-get install graphviz)"
