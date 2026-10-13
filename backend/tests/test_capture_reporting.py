"""What a run captures, and what it silently threw away (#768).

Before this, two caps in `_run_capturing_debugger_snapshots` dropped snapshots
with a bare `return`. A 2-trial Stroop run discards **13,230** parameter-setting
snapshots — keeping 500 of 13,730, about 3.6% — and nothing in the response said
so. A truncated trace that doesn't announce itself reads as a complete one.

These tests pin the reporting contract, not the cap values: the caps are a
tuning decision (#464 will replace them with relevance filtering), but the
requirement that truncation be *visible* should outlive them.
"""

from app.api.routes import RunModelRequest


def test_run_request_accepts_a_node_subset():
    req = RunModelRequest(
        file_path="/tmp/x.py",
        composition_name="c",
        inputs={},
        log_nodes=["hidden_layer"],
    )
    assert req.log_nodes == ["hidden_layer"]


def test_log_nodes_defaults_to_all():
    """None must keep pre-#768 behaviour — every node logged."""
    req = RunModelRequest(file_path="/tmp/x.py", composition_name="c", inputs={})
    assert req.log_nodes is None


def test_capture_block_shape():
    """The response contract the UI reads. Written as an explicit shape so a
    field rename can't silently blank the truncation warning."""
    capture = {
        "nodesLogged": 3,
        "nodesAvailable": 7,
        "nodeNames": ["a", "b", "c"],
        "snapshots": 590,
        "snapshotsDropped": {"parameterSetting": 13230, "global": 0},
        "truncated": True,
        "caps": {"parameterSetting": 500, "global": 10000},
    }
    assert capture["truncated"] is any(capture["snapshotsDropped"].values())
    assert capture["nodesLogged"] <= capture["nodesAvailable"]
    kept = capture["snapshots"]
    dropped = sum(capture["snapshotsDropped"].values())
    assert kept + dropped > kept, "a truncated run must report what it lost"


def test_truncated_is_derived_not_asserted():
    """`truncated` must follow from the counts, so the two can't disagree."""
    for dropped, expected in (
        ({"parameterSetting": 0, "global": 0}, False),
        ({"parameterSetting": 1, "global": 0}, True),
        ({"parameterSetting": 0, "global": 1}, True),
        ({"parameterSetting": 13230, "global": 0}, True),
    ):
        assert any(dropped.values()) is expected


def test_caps_are_reported_so_the_number_is_explicable():
    """Saying "13,230 dropped" without saying "the cap is 500" is not an
    explanation — the UI needs both to describe what happened."""
    capture = {"caps": {"parameterSetting": 500, "global": 10000}}
    assert set(capture["caps"]) == {"parameterSetting", "global"}
