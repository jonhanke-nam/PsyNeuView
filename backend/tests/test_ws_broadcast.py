"""Broadcasts while windows come and go (#305).

Every send to a client is awaited, so another window can connect or leave
while a broadcast is part-way through its list. The loop must not trip over
that ("Set changed size during iteration"), the windows still connected must
all get the update, and a window that leaves mid-broadcast is dropped once.

Timing is driven by events the tests control: a fake socket's send waits on a
gate that the test opens, so the ordering is exact rather than slept into.
"""

import asyncio

import pytest
from fastapi import WebSocketDisconnect

from app.api import ws as ws_module
from app.services import presence


class FakeSocket:
    """Just enough of a WebSocket for the handler and the broadcasts."""

    def __init__(self, user: str, started: asyncio.Event | None = None):
        self.user = user
        self.headers = {"x-forwarded-user": user}
        self.sent: list[dict] = []
        # While set, sends go straight through; clear it to make them wait.
        self.gate = asyncio.Event()
        self.gate.set()
        # Set when a send to this socket begins (and, if given, a shared one).
        self.sending = asyncio.Event()
        self._started = started
        self.listening = asyncio.Event()
        self.closed = False
        self._inbox: asyncio.Queue = asyncio.Queue()

    async def send_json(self, message: dict) -> None:
        self.sending.set()
        if self._started is not None:
            self._started.set()
        await self.gate.wait()
        if self.closed:
            raise RuntimeError("socket is closed")
        self.sent.append(message)

    async def receive_text(self) -> str:
        self.listening.set()
        item = await self._inbox.get()
        if item is None:
            raise WebSocketDisconnect()
        return item

    def disconnect(self) -> None:
        self.closed = True
        self._inbox.put_nowait(None)

    def __repr__(self) -> str:
        return f"FakeSocket({self.user})"


class CountingSet(set):
    """A set that counts how often each member is actually removed."""

    def __init__(self):
        super().__init__()
        self.removals: dict[object, int] = {}
        self.removed: dict[object, asyncio.Event] = {}

    def _note(self, item) -> None:
        self.removals[item] = self.removals.get(item, 0) + 1
        self.removed.setdefault(item, asyncio.Event()).set()

    def discard(self, item) -> None:
        if item in self:
            self._note(item)
        super().discard(item)

    def remove(self, item) -> None:
        if item in self:
            self._note(item)
        super().remove(item)

    def difference_update(self, *others) -> None:
        for other in others:
            for item in list(other):
                self.discard(item)

    def removed_event(self, item) -> asyncio.Event:
        return self.removed.setdefault(item, asyncio.Event())


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Hosted mode, so presence is real; and a fresh client set per test."""
    monkeypatch.setenv("PSYNEUVIEW_DEPLOYMENT_MODE", "container")
    monkeypatch.setattr(ws_module, "_connected_clients", CountingSet())
    presence.registry.clear()
    yield
    presence.registry.clear()


async def _serve(sock: FakeSocket) -> None:
    """The /ws endpoint: run the handler, a disconnect being a normal end."""
    try:
        await ws_module.handle_websocket(sock)
    except WebSocketDisconnect:
        pass


def _join(sock: FakeSocket) -> None:
    """What the handler does on connect, without its own broadcast."""
    ws_module._connected_clients.add(sock)
    presence.registry.register(sock, sock.user)


def _leave(sock: FakeSocket) -> None:
    """What the handler does on disconnect, without its own broadcast."""
    sock.closed = True
    ws_module._connected_clients.discard(sock)
    presence.registry.unregister(sock)


def test_a_window_connecting_mid_broadcast_does_not_break_it():
    """The reported failure: a connect while a send is still waiting."""

    async def scenario():
        started = asyncio.Event()
        alex, casey = FakeSocket("alex", started), FakeSocket("casey", started)
        for s in (alex, casey):
            s.gate.clear()
            _join(s)

        broadcast = asyncio.create_task(ws_module._broadcast_presence())
        await started.wait()  # the loop is now parked on its first send
        _join(FakeSocket("dana"))
        for s in (alex, casey):
            s.gate.set()
        await broadcast  # raised RuntimeError before the fix

        # Both windows there at the start still got their update.
        assert len(alex.sent) == 1 and len(casey.sent) == 1

    asyncio.run(scenario())


def test_a_window_leaving_mid_broadcast_does_not_break_it():
    async def scenario():
        started = asyncio.Event()
        alex, casey, dana = (FakeSocket(u, started) for u in ("alex", "casey", "dana"))
        for s in (alex, casey, dana):
            s.gate.clear()
            _join(s)

        broadcast = asyncio.create_task(ws_module._broadcast_presence())
        await started.wait()
        _leave(dana)
        for s in (alex, casey, dana):
            s.gate.set()
        await broadcast

        # The windows still connected all got the update; the one that left
        # is gone and stays gone, removed once.
        assert len(alex.sent) == 1 and len(casey.sent) == 1
        assert dana not in ws_module._connected_clients
        assert ws_module._connected_clients.removals[dana] == 1

    asyncio.run(scenario())


def test_leaving_during_a_slow_broadcast_end_to_end():
    """Through the real handler: one window is slow to receive, a new one
    arrives (starting a broadcast that waits on the slow one), and another
    leaves while it waits. Nothing crashes, the leaver is removed exactly
    once, and everyone still here ends up told it has gone."""

    async def scenario():
        clients = ws_module._connected_clients
        alex, casey, dana = FakeSocket("alex"), FakeSocket("casey"), FakeSocket("dana")
        handlers = {}
        for s in (alex, casey, dana):
            handlers[s] = asyncio.create_task(_serve(s))
            await s.listening.wait()

        # Alex is now slow to receive anything.
        alex.gate.clear()
        alex.sending.clear()

        # Eli arrives; the arrival broadcast parks on Alex.
        eli = FakeSocket("eli")
        handlers[eli] = asyncio.create_task(_serve(eli))
        await alex.sending.wait()

        # Dana leaves while that broadcast is still waiting.
        dana.disconnect()
        await clients.removed_event(dana).wait()

        # Alex catches up; both broadcasts finish.
        alex.gate.set()
        await handlers[dana]  # its departure broadcast has finished
        # Eli's arrival broadcast has finished: either its handler is now
        # listening, or the broadcast crashed it (the bug).
        listening = asyncio.create_task(eli.listening.wait())
        await asyncio.wait({listening, handlers[eli]}, return_when=asyncio.FIRST_COMPLETED)
        listening.cancel()
        if handlers[eli].done():
            handlers[eli].result()  # re-raises what crashed it
            pytest.fail("the arrival broadcast ended Eli's handler")

        assert clients.removals[dana] == 1
        assert dana not in clients
        assert set(clients) == {alex, casey, eli}
        for s in (alex, casey, eli):
            assert s.sent, f"{s!r} got no presence update"
            assert "dana" not in s.sent[-1]["others"], f"{s!r} still sees dana"
        assert sorted(eli.sent[-1]["others"]) == ["alex", "casey"]

        for s in (alex, casey, eli):
            s.disconnect()
        await asyncio.gather(*handlers.values())
        assert not clients

    asyncio.run(scenario())
