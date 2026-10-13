"""Guard: GitHub auth is resolved at startup, off the main thread (#563).

``github_auth.get_auth()`` shells out to ``gh auth token`` and probes
api.github.com, which can take seconds. It caches, so the cost is paid exactly
once — the question is *when*. Before this fix nothing called it during startup,
so the first caller was the Settings dialog, and opening Settings sat on
"Loading…" while the probe ran.

The lifespan now warms it in a daemon thread. Two things have to hold: the warm
actually happens (or the cost moves back onto the first Settings open), and it
happens off the main thread (or it just moves the stall to server startup).
"""

import asyncio
import threading


def test_lifespan_warms_github_auth_off_the_main_thread(monkeypatch):
    import app.main as main
    from app.services import github_auth

    # The PsyNeuLink warm worker is the other half of lifespan and is far too
    # heavy for a unit test; this test is only about the auth warm. The
    # update check is left out too: its scheduler's first tick talks to
    # GitHub on a thread that outlives the lifespan, and would record its
    # result in whichever test's preferences file is current by then.
    from app.services import pnl_updates

    monkeypatch.setattr(main, "_get_warm_worker", lambda **kwargs: None)
    monkeypatch.setattr(pnl_updates, "run_at_start", lambda: {"install": "skipped", "detail": "", "pulled": 0})

    called = threading.Event()
    resolved_on: list[str] = []

    def fake_get_auth():
        resolved_on.append(threading.current_thread().name)
        called.set()
        return None

    monkeypatch.setattr(github_auth, "get_auth", fake_get_auth)

    async def run_lifespan():
        async with main.lifespan(main.app):
            pass

    asyncio.run(run_lifespan())

    assert called.wait(timeout=10), (
        "startup never resolved GitHub auth — the `gh auth token` shell-out and "
        "api.github.com probe will land on the first Settings-dialog open (#563)"
    )
    assert resolved_on[0] != "MainThread", (
        f"GitHub auth resolved on {resolved_on[0]!r}; warming it on the main "
        "thread just moves the stall from the Settings dialog to startup (#563)"
    )
