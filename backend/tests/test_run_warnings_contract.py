"""Warnings travel beside a run failure, not inside it (#1101).

A user's run failed and they were shown ten lines of UserWarnings with no reason
anywhere. #1105 stopped the warnings masquerading as the error; this checks the
other half — that they are still reachable rather than merely counted.

The contract matters as much as the feature: `detail` stays a plain string when
there are no warnings, because every other caller reads it as one.
"""

from app.services.sandbox import _run_cold


class _Result:
    def __init__(self, returncode, stderr, stdout=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout


WARNY = (
    "/p/emcomposition.py:3041: UserWarning: BeforeNCalls(...) is dependent on X\n"
    "  self.scheduler.add_condition(node, condition)\n"
    "/p/autodiff.py:1920: UserWarning: The target (STATE) specified for a SAMPLE\n"
    "  warnings.warn(warning_msg)\n"
)


def _run(monkeypatch, stderr, tmp_path):
    """Drive the cold-start path, which is where stderr is summarised.

    run_in_sandbox goes through a warm worker first and only falls back to a
    subprocess, so patching subprocess.run there reaches nothing.
    """
    import subprocess

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _Result(1, stderr))
    return _run_cold("introspect", {"file_path": str(tmp_path / "m.py")}, 30)


def test_warnings_are_carried_beside_the_error(monkeypatch, tmp_path):
    out = _run(monkeypatch, WARNY + "ValueError: the real reason\n", tmp_path)
    assert "ValueError: the real reason" in out["error"]
    assert out["warnings_suppressed"] == 2
    assert "BeforeNCalls" in out["warnings"]
    # And they are not folded into the message, which is what buried it before.
    assert "BeforeNCalls" not in out["error"]


def test_no_warnings_means_no_extra_fields(monkeypatch, tmp_path):
    """The plain case must stay plain, or every caller has to learn a new shape."""
    out = _run(monkeypatch, "ValueError: plain failure\n", tmp_path)
    assert "warnings" not in out
    assert "warnings_suppressed" not in out


def test_a_failure_with_only_warnings_still_carries_them(monkeypatch, tmp_path):
    """The reported shape: no traceback at all."""
    out = _run(monkeypatch, WARNY, tmp_path)
    assert "only warnings" in out["error"]
    assert out["warnings_suppressed"] == 2
    assert "BeforeNCalls" in out["warnings"]
