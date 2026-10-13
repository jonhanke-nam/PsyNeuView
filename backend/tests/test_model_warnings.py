"""Showing what PsyNeuLink said about a model that ran fine (#1101).

A successful run could still have something worth knowing, and there was no way
to see it: on the warm-worker path stderr is drained to a log with no task
boundaries, so a run that succeeded reported nothing at all.

The split here is category plus origin, and the reason is worth recording,
because the obvious alternative does not work. Filtering by whether a warning
points at the user's file looks right and fails completely: PsyNeuLink raises
warnings without `stacklevel`, so every one of them — including the substantive
one about an unreachable learning target — reports a filename inside
PsyNeuLink. Provenance names the library that complained, never the line that
caused it.
"""

from app.services.model_warnings import collect, describe, split


class _W:
    """Stands in for warnings.WarningMessage."""

    def __init__(self, message, category, filename, lineno=1):
        self.message = message
        self.category = category
        self.filename = filename
        self.lineno = lineno


PNL = "/Users/x/psyneulink/library/compositions/autodiffcomposition.py"
PNL_EM = "/Users/x/psyneulink/library/compositions/emcomposition/emcomposition.py"
LIB = "/venv/lib/python3.13/site-packages/matplotlib/_fontconfig_pattern.py"
SCHED = "/venv/lib/python3.13/site-packages/graph_scheduler/condition.py"


class TestClassification:
    def test_a_psyneulink_userwarning_is_shown(self):
        # The one that matters, verbatim from a real model.
        w = describe(_W(
            "The target (STATE) specified for a SAMPLE (PREDICTION) in the "
            "'targets' argument of the constructor for 'EGO' appears before it",
            UserWarning, PNL, 1920))
        assert w["is_model"] is True
        assert w["category"] == "UserWarning"
        assert w["lineno"] == 1920

    def test_a_library_deprecation_is_not(self):
        assert describe(_W("'parseString' deprecated", DeprecationWarning, LIB))["is_model"] is False

    def test_a_library_futurewarning_is_not(self):
        assert describe(_W("functools.partial", FutureWarning, SCHED))["is_model"] is False

    def test_category_alone_is_not_enough(self):
        # A UserWarning from a library is still the library's business.
        assert describe(_W("some lib notice", UserWarning, LIB))["is_model"] is False

    def test_origin_alone_is_not_enough(self):
        # A deprecation inside PsyNeuLink is still housekeeping.
        assert describe(_W("old api", DeprecationWarning, PNL))["is_model"] is False


class TestSplit:
    def _real_shape(self):
        """The 35 warnings one real model raises, in the same proportions."""
        out = []
        for i in range(14):
            out.append(_W(f"'parseString' deprecated {i}", DeprecationWarning, LIB))
        for i in range(10):
            out.append(_W(f"functools.partial {i}", FutureWarning, SCHED))
        # Ten BeforeNCalls notices, which PsyNeuLink raises twice per node.
        for node in ("STATE", "PREVIOUS STATE [QUERY]", "PREVIOUS STATE [WEIGHT]",
                     "CONTEXT [QUERY]", "CONTEXT [WEIGHT]"):
            for _ in range(2):
                out.append(_W(f"BeforeNCalls(({node}), 1) is dependent on it",
                              UserWarning, PNL_EM))
        out.append(_W(
            "The target (STATE) specified for a SAMPLE (PREDICTION) in the "
            "'targets' argument of the constructor for 'EGO' appears before it "
            "in the same pathway without a learnable Projection between them",
            UserWarning, PNL, 1920))
        return collect(out)

    def test_the_real_proportions(self):
        shown, others = split(self._real_shape())
        assert others == 24
        # 11 modeller warnings, but the BeforeNCalls come in identical pairs.
        assert len(shown) == 6

    def test_the_substantive_one_survives(self):
        shown, _ = split(self._real_shape())
        assert any("'targets' argument" in w["message"] for w in shown)

    def test_duplicates_are_collapsed(self):
        dup = collect([_W("same notice", UserWarning, PNL)] * 5)
        shown, others = split(dup)
        assert len(shown) == 1
        assert others == 0

    def test_nothing_to_say_is_represented_as_nothing(self):
        assert split([]) == ([], 0)

    def test_only_library_noise_shows_nothing_but_still_counts(self):
        shown, others = split(collect([_W("dep", DeprecationWarning, LIB)] * 3))
        assert shown == []
        assert others == 3


class TestThroughTheRunEndpoint:
    """A successful run reports what PsyNeuLink said about the model. (#1101)

    Worth an end-to-end test rather than only unit ones, because the first
    version of this silently produced nothing: the worker tried to import
    app.services.model_warnings to classify, and it runs as a script in a
    subprocess where `app` does not resolve. The ImportError was swallowed and
    every run reported no warnings — the same failure mode as #1090. The worker
    now serialises only, and the route classifies.
    """

    def test_a_run_that_succeeds_still_reports_its_warnings(self, tmp_path):
        from fastapi.testclient import TestClient

        from app.main import app

        model = tmp_path / "m.py"
        model.write_text(
            "import psyneulink as pnl\n"
            'a = pnl.TransferMechanism(name="a")\n'
            'b = pnl.TransferMechanism(name="b")\n'
            'comp = pnl.Composition(name="C", pathways=[a, b])\n'
            "comp.scheduler.add_condition(b, pnl.BeforeNCalls(b, 1))\n"
        )
        resp = TestClient(app).post("/api/model/run", json={
            "file_path": str(model),
            "composition_name": "comp",
            "inputs": {"a": [[1.0]]},
        })
        assert resp.status_code == 200, resp.text
        warnings_block = resp.json().get("model_warnings")
        assert warnings_block is not None, "a successful run reported nothing"
        assert any(
            "BeforeNCalls" in w["message"] for w in warnings_block["shown"]
        ), warnings_block
        # And the library noise was counted, not shown.
        assert warnings_block["others"] >= 0
        assert all(w["category"] == "UserWarning" for w in warnings_block["shown"])
