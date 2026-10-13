"""`/catalog-sources` returns the resolved source dir for each Open-menu catalog (#853).

Powers the catalog header tooltips so each section's provenance is exact.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.api.routes import REFERENCE_DIR, DEMOS_DIR

client = TestClient(app)


def test_catalog_sources_shape_and_repo_paths():
    resp = client.get("/api/catalog-sources")
    assert resp.status_code == 200
    data = resp.json()

    assert set(data.keys()) == {
        "references",
        "demos",
        "library",
        "examples",
        "myModels",
        "pnlGit",
        "pnl",
    }

    # Repo-local catalogs resolve to their known dirs.
    assert data["references"] == str(REFERENCE_DIR)
    assert data["demos"] == str(DEMOS_DIR)
    assert isinstance(data["myModels"], str) and data["myModels"]

    # PsyNeuLink-sourced catalogs are absolute paths when available, else None
    # (a pip-installed PsyNeuLink ships no Scripts/ for the live examples).
    for key in ("library", "examples"):
        assert data[key] is None or (
            isinstance(data[key], str) and data[key].startswith("/")
        )

    # pnlGit: git provenance of the active PsyNeuLink clone (branch/commit/behind),
    # or None on a non-git (pip) install. `behind` is an int (>= 0) when present.
    git = data["pnlGit"]
    assert git is None or (
        set(git.keys()) == {"repo", "branch", "commit", "behind"}
        and (git["behind"] is None or (isinstance(git["behind"], int) and git["behind"] >= 0))
    )
