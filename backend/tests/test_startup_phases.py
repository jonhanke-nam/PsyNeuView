"""The start-up phase report the Mac app parses (PsyNeuView-MacApp#232).

One ``PNV-START <phase> <event> [elapsed=…] [detail=…]`` line per event on
stdout, flushed at once, plus a plain line in the log. The Mac app is built
against this exact format, so the formatter, the context manager and the
order the lifespan emits them in are each pinned here.
"""

import io
import logging
import os
import sys
import time

import pytest

from app.services import startup_phases as sp

# --- the formatter: pure --------------------------------------------------


class TestFormatLine:
    def test_begin_is_prefix_phase_event(self):
        assert sp.format_line("migrate", "begin") == "PNV-START migrate begin"

    def test_end_carries_elapsed_to_one_decimal(self):
        assert sp.format_line("migrate", "end", elapsed=12.34) == "PNV-START migrate end elapsed=12.3"
        assert sp.format_line("migrate", "end", elapsed=2) == "PNV-START migrate end elapsed=2.0"

    def test_a_negative_elapsed_is_clamped_to_zero(self):
        assert sp.format_line("x", "end", elapsed=-0.4) == "PNV-START x end elapsed=0.0"

    def test_detail_is_url_encoded_with_nothing_kept_safe(self):
        line = sp.format_line("pnl-update", "skip", detail="no update ready")
        assert line == "PNV-START pnl-update skip detail=no%20update%20ready"
        line = sp.format_line("x", "end", elapsed=1.0, detail="a=b&c /d\n~é")
        # Unreserved characters (letters, digits, - _ . ~) pass through as is.
        assert line == "PNV-START x end elapsed=1.0 detail=a%3Db%26c%20%2Fd%0A~%C3%A9"
        # Whatever the text, the line splits into fields on single spaces.
        assert line.split(" ")[:3] == ["PNV-START", "x", "end"]
        assert "\n" not in line

    def test_elapsed_comes_before_detail(self):
        assert sp.format_line("x", "end", elapsed=0.5, detail="d") == "PNV-START x end elapsed=0.5 detail=d"

    def test_invalid_event_or_phase_is_refused(self):
        with pytest.raises(ValueError):
            sp.format_line("x", "done")
        with pytest.raises(ValueError):
            sp.format_line("two words", "begin")
        with pytest.raises(ValueError):
            sp.format_line("", "begin")


# --- emit: stdout + log, never raises ------------------------------------


def _capture_app_log(caplog):
    """The ``app`` logger doesn't propagate to the root (see ``app.main``), so
    attach caplog's handler to it directly."""
    import app.main  # noqa: F401 — applies _configure_app_logging()

    app_logger = logging.getLogger("app")
    app_logger.addHandler(caplog.handler)
    return app_logger


class TestEmit:
    def test_writes_one_flushed_line_to_stdout_and_a_plain_line_to_the_log(self, capsys, caplog):
        app_logger = _capture_app_log(caplog)
        try:
            with caplog.at_level(logging.INFO, logger="app.services.startup_phases"):
                line = sp.emit("import-psyneulink", "end", elapsed=23.46)
        finally:
            app_logger.removeHandler(caplog.handler)
        assert line == "PNV-START import-psyneulink end elapsed=23.5"
        assert capsys.readouterr().out == line + "\n"
        assert any("Loading PsyNeuLink in the model runner: done in 23.5s" in r.getMessage() for r in caplog.records)

    def test_a_broken_stdout_does_not_stop_the_start(self, monkeypatch):
        class Broken(io.TextIOBase):
            def write(self, s):
                raise OSError("stdout is gone")

        monkeypatch.setattr(sys, "stdout", Broken())
        assert sp.emit("migrate", "begin") == "PNV-START migrate begin"

    def test_a_bad_event_is_logged_not_raised(self, capsys):
        assert sp.emit("migrate", "nope") is None
        assert capsys.readouterr().out == ""


# --- the context manager --------------------------------------------------


def _lines(capsys):
    return [l for l in capsys.readouterr().out.splitlines() if l.startswith("PNV-START ")]


class TestPhase:
    def test_begin_then_end_with_elapsed(self, capsys):
        with sp.phase("migrate"):
            time.sleep(0.05)
        begin, end = _lines(capsys)
        assert begin == "PNV-START migrate begin"
        assert end.startswith("PNV-START migrate end elapsed=")
        assert float(end.rsplit("=", 1)[1]) >= 0.0

    def test_skip_inside_the_block_replaces_end(self, capsys):
        with sp.phase("pnl-update") as p:
            p.skip("no update ready")
        assert _lines(capsys) == [
            "PNV-START pnl-update begin",
            "PNV-START pnl-update skip detail=no%20update%20ready",
        ]

    def test_fail_inside_the_block_is_an_end_marked_failed(self, capsys):
        with sp.phase("pnl-update") as p:
            p.fail("the install did not finish")
        _, end = _lines(capsys)
        assert end.startswith("PNV-START pnl-update end elapsed=")
        assert end.endswith(" detail=failed%3A%20the%20install%20did%20not%20finish")

    def test_an_exception_still_emits_end_with_detail_failed_and_is_reraised(self, capsys):
        with pytest.raises(RuntimeError, match="boom"), sp.phase("migrate"):
            raise RuntimeError("boom")
        begin, end = _lines(capsys)
        assert begin == "PNV-START migrate begin"
        assert end.startswith("PNV-START migrate end elapsed=")
        assert end.endswith(" detail=failed")

    def test_a_second_finish_is_ignored(self, capsys):
        with sp.phase("migrate") as p:
            p.end("first")
            p.skip("second")
        assert len(_lines(capsys)) == 2

    def test_ready_reports_the_whole_start(self, capsys):
        sp.ready()
        (line,) = _lines(capsys)
        assert line.startswith("PNV-START ready end elapsed=")
        assert float(line.rsplit("=", 1)[1]) >= 0.0


# --- the warm worker's one-shot ready callback ----------------------------


class _FakeProc:
    """Stands in for the worker subprocess: real pipes, so the selector-based
    handshake in ``WarmWorker._start`` runs unchanged."""

    pid = 4242

    def __init__(self, ready_line: str | None):
        r, w = os.pipe()
        self.stdout = os.fdopen(r, "r")
        self._w = os.fdopen(w, "w")
        if ready_line is not None:
            self._w.write(ready_line + "\n")
            self._w.flush()
        er, ew = os.pipe()
        self.stderr = os.fdopen(er, "r")
        os.close(ew)
        self.stdin = io.StringIO()
        self.killed = False

    def poll(self):
        return 1 if self.killed else None

    def kill(self):
        self.killed = True
        self._w.close()

    def wait(self, timeout=None):
        return 0


class TestWarmWorkerOnReady:
    def test_called_once_when_the_child_signals_ready_and_not_on_restart(self, monkeypatch):
        from app.services import sandbox

        procs = [_FakeProc("###READY###"), _FakeProc("###READY###")]
        monkeypatch.setattr(sandbox.subprocess, "Popen", lambda *a, **k: procs.pop(0))
        calls = []
        worker = sandbox.WarmWorker(on_ready=lambda ok, elapsed: calls.append((ok, elapsed)))
        assert calls and calls[0][0] is True and calls[0][1] >= 0.0
        worker.restart()
        assert len(calls) == 1, "a restart must not look like a second start to the phase report"
        assert worker.is_alive()
        worker._proc.kill()

    def test_called_with_ok_false_when_the_child_never_answers(self, monkeypatch):
        from app.services import sandbox

        monkeypatch.setattr(sandbox, "WORKER_READY_TIMEOUT", 0.2)
        monkeypatch.setattr(sandbox.subprocess, "Popen", lambda *a, **k: _FakeProc(None))
        calls = []
        worker = sandbox.WarmWorker(on_ready=lambda ok, elapsed: calls.append(ok))
        assert calls == [False]
        assert not worker.is_alive()

    def test_a_failing_callback_does_not_break_the_worker(self, monkeypatch):
        from app.services import sandbox

        monkeypatch.setattr(sandbox.subprocess, "Popen", lambda *a, **k: _FakeProc("###READY###"))

        def bad(ok, elapsed):
            raise RuntimeError("the report broke")

        worker = sandbox.WarmWorker(on_ready=bad)
        assert worker.is_alive()
        worker._proc.kill()


# --- the lifespan: phases in order, ready last, /health then served ------


def _phase_events(out: str) -> list[tuple[str, str]]:
    return [tuple(l.split(" ")[1:3]) for l in out.splitlines() if l.startswith("PNV-START ")]


@pytest.fixture
def quiet_lifespan(monkeypatch):
    """Keep the lifespan's heavy or networked steps out of the test: the
    GitHub auth probe, and the real warm worker (replaced by one that
    answers ready at once through the same callback the real one uses)."""
    from app import main
    from app.services import github_auth

    monkeypatch.setattr(github_auth, "get_auth", lambda: None)

    def fake_get_warm_worker(on_ready=None):
        if on_ready is not None:
            on_ready(True, 0.02)

    monkeypatch.setattr(main, "_get_warm_worker", fake_get_warm_worker)
    return main


class TestLifespan:
    def test_phases_appear_in_order_and_ready_comes_last(self, quiet_lifespan, monkeypatch, capsys):
        from fastapi.testclient import TestClient

        from app.services import pnl_updates

        monkeypatch.setattr(
            pnl_updates, "run_at_start", lambda: {"install": "skipped", "detail": "no update ready", "pulled": 0}
        )
        with TestClient(quiet_lifespan.app) as client:
            assert client.get("/health").json() == {"status": "ok"}
        out = capsys.readouterr().out
        assert _phase_events(out) == [
            ("migrate", "begin"),
            ("migrate", "end"),
            ("pnl-update", "begin"),
            ("pnl-update", "skip"),
            ("import-psyneulink", "begin"),
            ("import-psyneulink", "end"),
            ("warm-worker", "begin"),
            ("warm-worker", "end"),
            ("ready", "end"),
        ]
        lines = [l for l in out.splitlines() if l.startswith("PNV-START ")]
        assert "PNV-START pnl-update skip detail=no%20update%20ready" in lines
        assert lines[-1].startswith("PNV-START ready end elapsed=")
        for l in lines:
            if l.split(" ")[2] == "end":
                assert " elapsed=" in l, l

    def test_an_installed_update_is_an_end_with_its_detail(self, quiet_lifespan, monkeypatch, capsys):
        from fastapi.testclient import TestClient

        from app.services import pnl_updates

        monkeypatch.setattr(
            pnl_updates, "run_at_start", lambda: {"install": "installed", "detail": "Updated x @ devel.", "pulled": 0}
        )
        with TestClient(quiet_lifespan.app):
            pass
        lines = [l for l in capsys.readouterr().out.splitlines() if l.startswith("PNV-START pnl-update ")]
        assert lines[0] == "PNV-START pnl-update begin"
        assert lines[1].startswith("PNV-START pnl-update end elapsed=")
        assert lines[1].endswith(" detail=Updated%20x%20%40%20devel.")

    def test_a_failed_update_is_an_end_marked_failed(self, quiet_lifespan, monkeypatch, capsys):
        from fastapi.testclient import TestClient

        from app.services import pnl_updates

        monkeypatch.setattr(
            pnl_updates, "run_at_start", lambda: {"install": "failed", "detail": "The update couldn't start", "pulled": 0}
        )
        with TestClient(quiet_lifespan.app):
            pass
        lines = [l for l in capsys.readouterr().out.splitlines() if l.startswith("PNV-START pnl-update ")]
        assert lines[1].startswith("PNV-START pnl-update end elapsed=")
        assert " detail=failed%3A%20The%20update" in lines[1]

    def test_a_worker_already_running_is_a_skipped_import(self, quiet_lifespan, monkeypatch, capsys):
        from fastapi.testclient import TestClient

        from app.services import pnl_updates

        monkeypatch.setattr(pnl_updates, "run_at_start", lambda: {"install": "skipped", "detail": "x", "pulled": 0})
        # The singleton existed already: the getter never calls back.
        monkeypatch.setattr(quiet_lifespan, "_get_warm_worker", lambda on_ready=None: None)
        with TestClient(quiet_lifespan.app):
            pass
        events = _phase_events(capsys.readouterr().out)
        assert ("import-psyneulink", "skip") in events
        assert events[-1] == ("ready", "end")
