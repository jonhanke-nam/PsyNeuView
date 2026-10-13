"""The built page is served so an update can't be hidden by a cached copy (#2)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend_files import IMMUTABLE, REVALIDATE, FrontendFiles, cache_control_for


def _client(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<script src='/assets/index-abc123.js'></script>")
    (tmp_path / "build-info.json").write_text("{}")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/", FrontendFiles(directory=str(tmp_path), html=True), name="frontend")
    return TestClient(app)


def test_index_html_is_always_revalidated(tmp_path):
    c = _client(tmp_path)
    for url in ("/", "/index.html", "/build-info.json"):
        r = c.get(url)
        assert r.status_code == 200, url
        assert r.headers["cache-control"] == REVALIDATE, url


def test_hashed_assets_are_kept_for_good(tmp_path):
    r = _client(tmp_path).get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == IMMUTABLE


def test_revalidation_answer_keeps_the_header(tmp_path):
    c = _client(tmp_path)
    etag = c.get("/").headers["etag"]
    r = c.get("/", headers={"if-none-match": etag})
    assert r.status_code == 304
    assert r.headers["cache-control"] == REVALIDATE


def test_cache_control_for_paths():
    assert cache_control_for("assets/x.js") == IMMUTABLE
    assert cache_control_for("./assets/x.css") == IMMUTABLE
    assert cache_control_for("index.html") == REVALIDATE
    assert cache_control_for(".") == REVALIDATE


def test_the_app_mounts_the_page_with_these_headers():
    import app.main as main

    mounts = [r for r in main.app.routes if getattr(r, "name", None) == "frontend"]
    if mounts:  # only when frontend/dist exists in this checkout
        assert isinstance(mounts[0].app, FrontendFiles)
