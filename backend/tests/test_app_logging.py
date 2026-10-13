"""Guard: the app's own loggers must actually be emitted (#864).

uvicorn configures only its ``uvicorn.*`` loggers, so before this was fixed
every ``app.*`` ``logger.info(...)`` — the per-load ``[perf]`` timing lines and
the ``Warm worker timed out … restarting`` warnings — was silently dropped,
leaving slow/wedged loads with zero persistent evidence. These tests make that
regression detectable.
"""

import logging


def test_app_logger_has_a_sink():
    """Importing the app must attach a handler to the ``app`` logger at <=INFO,
    so [perf] (INFO-level) and warning lines are not swallowed."""
    import app.main  # noqa: F401 — import applies _configure_app_logging()

    app_logger = logging.getLogger("app")
    assert app_logger.handlers, (
        "app logger has no handler — [perf] timing and worker-restart warnings "
        "would be silently dropped (#864)"
    )
    assert app_logger.level <= logging.INFO


def test_child_perf_records_reach_the_handler():
    """A child logger's INFO record (how [perf] lines are emitted) must
    propagate to the app handler."""
    import app.main  # noqa: F401

    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record.getMessage())

    app_logger = logging.getLogger("app")
    cap = _Capture()
    app_logger.addHandler(cap)
    try:
        logging.getLogger("app.services.sandbox").info("[perf] probe line")
    finally:
        app_logger.removeHandler(cap)

    assert any("[perf] probe line" in m for m in captured), (
        "app.* INFO records don't reach the app handler — timing logs are lost"
    )


def test_configure_is_idempotent():
    """Re-running config (``--reload`` re-imports, repeated test imports) must
    not stack duplicate handlers."""
    from app.main import _configure_app_logging

    app_logger = logging.getLogger("app")
    for _ in range(3):
        _configure_app_logging()
    ours = [h for h in app_logger.handlers if getattr(h, "_psyneuview", False)]
    assert len(ours) == 1, f"expected exactly one app handler, got {len(ours)}"
