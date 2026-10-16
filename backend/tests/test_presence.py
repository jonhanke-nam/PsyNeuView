"""Presence tracking for the shared hosted instance (#1082).

The point of these is the distinction the feature lives or dies on: presence is
about *people*, not connections. A count of open sockets would report one person
with two tabs as two people, which is worse than reporting nothing.
"""

import pytest

from app.services import presence
from app.services.presence import Registry


@pytest.fixture(autouse=True)
def _hosted(monkeypatch):
    """Presence only means anything where several people share an instance."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    presence.registry.clear()
    yield
    presence.registry.clear()


# ── Identity ─────────────────────────────────────────────────────────────


def test_reads_the_proxy_header():
    assert presence.identity_from_headers({"x-forwarded-user": "alex"}) == "alex"


def test_accepts_the_other_header_spellings():
    # oauth2-proxy uses different names depending on how it is configured, and
    # other proxies use REMOTE_USER; trying only one would silently yield no
    # identity and no presence.
    for header in (
        "x-auth-request-user",
        "x-forwarded-email",
        "x-auth-request-email",
        "x-remote-user",
        "remote-user",
    ):
        assert presence.identity_from_headers({header: "alex"}) == "alex"


def test_no_proxy_means_no_identity():
    """Not a failure — it means nothing is authenticating anyone, so any
    presence we reported would be invented."""
    assert presence.identity_from_headers({}) is None
    assert presence.identity_from_headers({"x-forwarded-user": "   "}) is None


def test_email_is_shown_as_its_local_part():
    assert presence.label_for("alex@example.edu") == "alex"
    assert presence.label_for("a-github-handle") == "a-github-handle"


# ── People, not connections ──────────────────────────────────────────────


def test_one_person_with_two_tabs_is_one_peer():
    """The mistake this module exists to avoid."""
    r = Registry()
    r.register("tab-1", "alex")
    r.register("tab-2", "alex")
    assert [p.identity for p in r.peers()] == ["alex"]
    assert r.connection_count("alex") == 2


def test_your_own_second_tab_is_not_company():
    r = Registry()
    r.register("tab-1", "alex")
    r.register("tab-2", "alex")
    assert r.others("tab-1") == []


def test_someone_else_is_company():
    r = Registry()
    r.register("mine", "jonhanke-nam")
    r.register("theirs", "alex")
    assert [p.label for p in r.others("mine")] == ["alex"]


def test_closing_one_tab_does_not_remove_the_person():
    r = Registry()
    r.register("tab-1", "alex")
    r.register("tab-2", "alex")
    r.register("mine", "casey")
    r.unregister("tab-1")
    assert [p.label for p in r.others("mine")] == ["alex"]
    r.unregister("tab-2")
    assert r.others("mine") == []


def test_peers_are_ordered_stably():
    """So the indicator doesn't reshuffle on every update."""
    r = Registry()
    for who in ("zoe", "adam", "Mia"):
        r.register(f"c-{who}", who)
    assert [p.label for p in r.peers()] == ["adam", "Mia", "zoe"]


def test_unidentified_connections_are_not_invented_as_peers():
    r = Registry()
    r.register("anon", None)
    assert r.peers() == []


def test_unregister_is_forgiving():
    Registry().unregister("never-seen")


# ── What the client is told ──────────────────────────────────────────────


def test_alone_and_cannot_tell_are_different_answers(monkeypatch):
    """"Nobody else is here" is reassuring; "we cannot tell" is a reason to be
    careful. The UI must not conflate them, so the payload must not either."""
    alone = presence.snapshot_for("mine")
    assert alone == {"type": "presence", "available": True, "others": []}

    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "local")
    cannot_tell = presence.snapshot_for("mine")
    assert cannot_tell["available"] is False


def test_snapshot_names_the_others():
    presence.registry.register("mine", "casey")
    presence.registry.register("theirs", "alex")
    assert presence.snapshot_for("mine")["others"] == ["alex"]


@pytest.mark.parametrize("mode,expected", [
    ("local", False), ("mac_app", False), ("container", True), ("hosted", True),
])
def test_presence_only_matters_where_people_share_an_instance(monkeypatch, mode, expected):
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", mode)
    assert presence.is_meaningful() is expected


# ── Through the real WebSocket endpoint ──────────────────────────────────


def test_two_people_see_each_other_over_the_socket(monkeypatch):
    """End to end: the proxy's header reaches the handler and each client is
    told about the *other* one."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    with client.websocket_connect("/ws", headers={"x-forwarded-user": "casey"}) as a:
        assert a.receive_json() == {"type": "presence", "available": True, "others": []}
        with client.websocket_connect("/ws", headers={"x-forwarded-user": "alex"}) as b:
            # Arrival is announced to both, each from their own point of view.
            assert b.receive_json()["others"] == ["casey"]
            assert a.receive_json()["others"] == ["alex"]


def test_a_second_tab_does_not_look_like_a_colleague(monkeypatch):
    """The failure mode that would make the feature counterproductive."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    with client.websocket_connect("/ws", headers={"x-forwarded-user": "casey"}) as a:
        a.receive_json()
        with client.websocket_connect("/ws", headers={"x-forwarded-user": "casey"}) as b:
            assert b.receive_json()["others"] == []
            assert a.receive_json()["others"] == []


def test_local_deployments_are_told_presence_is_unavailable(monkeypatch):
    """Rather than "nobody is here", which would be a claim we cannot support."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "local")
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "presence"
        assert msg["available"] is False
