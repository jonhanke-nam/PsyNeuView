"""Reporting why a run failed, not what it warned about (#1101).

A user ran the EGO model on the hosted demo and got a red block headed
"Script execution failed:" whose entire contents were UserWarnings from
emcomposition.py, ending mid-sentence in a warnings.warn(...) call. Nothing in
it said why the run failed.
"""

from app.services.stderr_summary import count_warnings, strip_warnings, summarize


# Taken from his screenshot — the shape matters more than the exact text: a
# warning header naming a file and line, then the echoed source beneath it.
REPORTED_STDERR = """\
/usr/local/lib/python3.13/site-packages/psyneulink/library/compositions/emcomposition.py:3041: UserWarning: BeforeNCalls(ProcessingMechanism CONTEXT [QUERY], 1) is dependent on (ProcessingMechanism CONTEXT [QUERY]), but you are assigning (ProcessingMechanism CONTEXT [QUERY]) as its owner. This may result in infinite loops or unknown behavior.
  self.scheduler.add_condition(node, condition)
/usr/local/lib/python3.13/site-packages/psyneulink/library/compositions/emcomposition.py:3043: UserWarning: BeforeNCalls(ProcessingMechanism CONTEXT [WEIGHT], 1) is dependent on (ProcessingMechanism CONTEXT [WEIGHT]), but you are assigning (ProcessingMechanism CONTEXT [WEIGHT]) as its owner. This may result in infinite loops or unknown behavior.
  self.scheduler.add_condition(node, condition)
/usr/local/lib/python3.13/site-packages/psyneulink/library/compositions/autodiffcomposition.py:1920: UserWarning: The target (STATE) specified for a SAMPLE (PREDICTION) in the 'targets' argument of the constructor for 'EGO' appears before it in the same pathway without a learnable Projection between them.
  warnings.warn(warning_msg + f"without a learnable Projection between them)"
"""

TRACEBACK = """\
Traceback (most recent call last):
  File "/models/ego.py", line 241, in <module>
    EGO_comp.run(inputs=inputs)
  File "/site-packages/psyneulink/core/compositions/composition.py", line 100, in run
    raise CompositionError("no inputs")
psyneulink.core.compositions.composition.CompositionError: no inputs
"""


class TestWarningsAreNotTheError:
    def test_all_warnings_does_not_masquerade_as_an_error(self):
        """The exact case the user hit."""
        out = summarize(REPORTED_STDERR)
        assert "UserWarning" not in out
        assert "warnings.warn" not in out
        assert "only warnings" in out

    def test_userwarning_is_dropped_not_just_futurewarning(self):
        # Naming categories one at a time is what let UserWarning through.
        assert strip_warnings(REPORTED_STDERR.splitlines()) == []

    def test_every_warning_category_is_dropped(self):
        for cat in ("UserWarning", "DeprecationWarning", "FutureWarning",
                    "RuntimeWarning", "PendingDeprecationWarning"):
            line = f"/p/m.py:10: {cat}: something"
            assert strip_warnings([line, "  code_here()"]) == []

    def test_the_echoed_source_line_goes_with_its_warning(self):
        # Dropping only the header leaves orphans like `warnings.warn(...)`,
        # which is most of what made the block unreadable.
        lines = ["/p/m.py:10: UserWarning: x", "  warnings.warn('x')", "real output"]
        assert strip_warnings(lines) == ["real output"]

    def test_an_unindented_line_after_a_warning_is_kept(self):
        # Only the indented echo belongs to the warning.
        lines = ["/p/m.py:10: UserWarning: x", "ValueError: the actual problem"]
        assert strip_warnings(lines) == ["ValueError: the actual problem"]


class TestTracebackWins:
    def test_a_traceback_is_shown_in_full(self):
        out = summarize(TRACEBACK)
        assert out.startswith("Traceback (most recent call last):")
        assert "CompositionError: no inputs" in out

    def test_a_traceback_survives_a_flood_of_warnings(self):
        # The original bug: [-10:] clipped the traceback off the end.
        out = summarize(REPORTED_STDERR + TRACEBACK)
        assert "CompositionError: no inputs" in out
        assert "UserWarning" not in out

    def test_the_last_traceback_wins(self):
        first = TRACEBACK.replace("no inputs", "first failure")
        out = summarize(first + TRACEBACK)
        assert "no inputs" in out
        assert "first failure" not in out

    def test_a_long_traceback_keeps_its_tail(self):
        # The exception type and message are the last lines and matter most.
        frames = "\n".join(f'  File "/f{i}.py", line {i}, in fn\n    call{i}()' for i in range(60))
        long = f"Traceback (most recent call last):\n{frames}\nValueError: the real reason"
        out = summarize(long, max_lines=20)
        assert "ValueError: the real reason" in out
        assert "more frames" in out
        assert len(out.splitlines()) <= 21


class TestOrdinaryCases:
    def test_a_plain_error_is_passed_through(self):
        assert "ValueError: bad" in summarize("ValueError: bad")

    def test_empty_stderr_says_unknown(self):
        assert summarize("") == "Unknown error"
        assert summarize("   \n  ") == "Unknown error"

    def test_worker_startup_noise_is_dropped(self):
        assert strip_warnings(["[perf] import_pnl 3.2s", "ValueError: bad"]) \
            == ["ValueError: bad"]

    def test_warnings_are_counted_so_the_ui_can_say_how_many(self):
        assert count_warnings(REPORTED_STDERR) == 3
        assert count_warnings(TRACEBACK) == 0


class TestThroughTheSandbox:
    """End to end, against a real failing subprocess.

    A correction worth recording: my first version of this asserted that a
    warning flood pushes the traceback out of the old ten-line tail. It does
    not — a traceback is printed last, so `[-10:]` keeps it. The guard in that
    test caught the bad premise.

    The two cases that were actually broken are below.
    """

    def _run(self, tmp_path, body):
        import subprocess
        import sys

        script = tmp_path / "noisy.py"
        script.write_text(body)
        proc = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True
        )
        assert proc.returncode != 0
        return proc.stderr

    def _old_behaviour(self, stderr):
        """What the previous code would have shown."""
        lines = [
            l for l in stderr.strip().splitlines()
            if "FutureWarning" not in l and "functools.partial" not in l
        ]
        return "\n".join(lines[-10:])

    def test_warnings_only_no_traceback(self, tmp_path):
        """The reported case: the process dies without a traceback.

        os._exit skips the traceback entirely, the same way a signal or a
        hard exit does — which is what leaves stderr holding nothing but
        warnings.
        """
        stderr = self._run(tmp_path,
            "import os, warnings\n"
            "for i in range(30):\n"
            "    warnings.warn(f'noise {i}', UserWarning)\n"
            "os._exit(1)\n"
        )
        old = self._old_behaviour(stderr)
        assert "UserWarning" in old, "the old output was warnings, as reported"

        out = summarize(stderr)
        assert "UserWarning" not in out
        assert "only warnings" in out
        assert count_warnings(stderr) == 30

    def test_a_long_traceback_keeps_its_head(self, tmp_path):
        """A deep stack: the old tail cut off the top frames and the header."""
        stderr = self._run(tmp_path,
            "import sys\n"
            "sys.setrecursionlimit(60)\n"
            "def f(n):\n"
            "    if n == 0:\n"
            "        raise ValueError('the actual reason')\n"
            "    return f(n - 1)\n"
            "f(40)\n"
        )
        old = self._old_behaviour(stderr)
        assert "Traceback (most recent call last):" not in old, (
            "the old ten-line tail should have clipped the header off"
        )

        out = summarize(stderr)
        assert out.startswith("Traceback (most recent call last):")
        assert "ValueError: the actual reason" in out
        # Python 3.13 colourises tracebacks when it thinks the output supports
        # it, which varies by environment — this assertion failed on one machine
        # and passed on another until the escapes were stripped. They must never
        # reach the user's screen.
        assert "\x1b[" not in out


class TestAnsiEscapes:
    """Colourised tracebacks must not reach the user. (#1101)

    Python 3.13 colourises tracebacks depending on how it judges the output
    stream. The escapes would be displayed verbatim in the Run panel, and they
    also break matching on the text.
    """

    COLOURED = (
        "Traceback (most recent call last):\n"
        '  File \x1b[35m"/m.py"\x1b[0m, line \x1b[35m5\x1b[0m, in \x1b[35mf\x1b[0m\n'
        "    raise ValueError('boom')\n"
        "\x1b[1;35mValueError\x1b[0m: \x1b[35mboom\x1b[0m\n"
    )

    def test_escapes_are_stripped(self):
        from app.services.stderr_summary import strip_ansi

        out = summarize(self.COLOURED)
        assert "\x1b[" not in out
        assert "ValueError: boom" in out
        assert strip_ansi("\x1b[31mred\x1b[0m") == "red"

    def test_a_colourised_warning_is_still_recognised(self):
        coloured_warning = "\x1b[33m/p/m.py:10: UserWarning: noisy\x1b[0m\n  warn()\n"
        assert count_warnings(coloured_warning) == 1
        assert "UserWarning" not in summarize(coloured_warning)
