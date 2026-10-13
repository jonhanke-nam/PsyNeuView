"""Who else is connected to this instance (#1082).

A hosted PsyNeuView is one shared workspace: one filesystem, one PsyNeuLink
worker, one set of saved models. Two people using it at once see each other's
files, and a run by one blocks the other. Nothing in the UI says so, so the
first sign of trouble is usually a file changing underneath somebody.

This makes that visible *before* the collision.

**Identity, not arithmetic.** The obvious implementation — count the open
WebSockets — is wrong, because one person with two tabs counts as two.
Reporting "2 people connected" when it is one person with a stale tab is worse
than reporting nothing: a colleague would hold off for someone who isn't there.
So presence is keyed on *who*, and when we cannot tell who, we say so rather
than guess.

The identity comes from the authenticating proxy in front of the app
(oauth2-proxy sets ``X-Forwarded-User``). There is no identity without a proxy,
which is also why presence is meaningless in ``local`` / ``mac_app`` — there
is no second person to be present.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from app.services import deployment_mode

# Headers an authenticating proxy may use for the signed-in user, best first.
# oauth2-proxy sets the X-Forwarded-* pair by default and the X-Auth-Request-*
# pair under --set-xauthrequest; other proxies commonly set REMOTE_USER.
_IDENTITY_HEADERS = (
    "x-forwarded-user",
    "x-auth-request-user",
    "x-forwarded-email",
    "x-auth-request-email",
    "x-remote-user",
    "remote-user",
)


@dataclass(frozen=True)
class Peer:
    """One connected person — not one connection."""

    #: Stable key used to deduplicate a person's several tabs.
    identity: str
    #: What to show a human. An email is trimmed to its local part, since
    #: "alex" reads better than "alex@example.edu" in a status line.
    label: str


def identity_from_headers(headers: Mapping[str, str]) -> str | None:
    """The authenticated user per the proxy, or ``None`` when unidentified.

    ``None`` is a real answer, not a failure: it means nothing in front of this
    app is authenticating anyone, so any presence we reported would be a guess.
    """
    for name in _IDENTITY_HEADERS:
        # Starlette header maps are case-insensitive; be tolerant of plain
        # dicts too, since tests and other callers pass those.
        value = headers.get(name) or headers.get(name.title())
        if value and value.strip():
            return value.strip()
    return None


def label_for(identity: str) -> str:
    """Display form of an identity — the local part of an email, else as-is."""
    return identity.split("@", 1)[0] if "@" in identity else identity


def is_meaningful() -> bool:
    """Whether presence is worth showing in this deployment at all.

    On a developer's own machine there is no second person, so an indicator
    would be noise. It only earns its place where several people share one
    instance.
    """
    return deployment_mode.is_remote()


class Registry:
    """Tracks which connections belong to which person.

    Keyed by connection object rather than identity, so a person's tabs are
    counted once but their disconnects are tracked individually — closing one
    of two tabs must not remove them from the list.
    """

    def __init__(self) -> None:
        self._by_connection: dict[object, Peer] = {}

    def register(self, connection: object, identity: str | None) -> None:
        """Record a connection. Unidentified connections are tracked as
        present-but-anonymous so they still count toward "someone is here"."""
        if identity is None:
            return
        self._by_connection[connection] = Peer(identity, label_for(identity))

    def unregister(self, connection: object) -> None:
        self._by_connection.pop(connection, None)

    def peers(self) -> list[Peer]:
        """Everyone connected, one entry per person, in a stable order."""
        unique: dict[str, Peer] = {}
        for peer in self._by_connection.values():
            unique.setdefault(peer.identity, peer)
        return sorted(unique.values(), key=lambda p: p.label.lower())

    def others(self, connection: object) -> list[Peer]:
        """Everyone except whoever is on the other end of ``connection``.

        Excludes by *identity*, so a person's own second tab never shows up as
        company — the mistake this whole module exists to avoid.
        """
        mine = self._by_connection.get(connection)
        return [p for p in self.peers() if mine is None or p.identity != mine.identity]

    def connection_count(self, identity: str) -> int:
        """How many connections one person has open. Diagnostics only."""
        return sum(1 for p in self._by_connection.values() if p.identity == identity)

    def clear(self) -> None:
        self._by_connection.clear()


#: Process-wide registry. One backend process serves one instance.
registry = Registry()


def snapshot_for(connection: object, peers: Iterable[Peer] | None = None) -> dict:
    """The presence payload to send to one client.

    ``available`` distinguishes "nobody else is here" from "we cannot tell",
    which the UI must not conflate — the first is reassuring, the second is a
    reason to be careful.
    """
    if not is_meaningful():
        return {"type": "presence", "available": False, "others": []}
    others = list(peers) if peers is not None else registry.others(connection)
    return {
        "type": "presence",
        "available": True,
        "others": [p.label for p in others],
    }
