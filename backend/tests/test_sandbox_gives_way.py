"""Work nobody is waiting for lets user-requested work go first (#175).

The worker takes one task at a time. The probe of every PsyNeuLink example
sends dozens of tasks in a row, and a model opened meanwhile had to queue
behind each of them. Tasks sent from inside ``giving_way()`` now wait,
before each one, for any user-requested task to finish; the task already
running is never cut short.
"""

import threading
import time

from app.services import sandbox


class _FakeWorker:
    """Answers one task at a time, in the order the lock hands them out."""

    def __init__(self):
        self.order: list[str] = []
        self.holds: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def send_task(self, task, params, timeout):
        with self._lock:
            who = params["who"]
            self.order.append(who)
            hold = self.holds.get(who)
            if hold is not None:
                hold.wait(5)
            return {"ok": True}


def _wait_until(predicate, seconds=5.0):
    deadline = time.time() + seconds
    while not predicate():
        assert time.time() < deadline, "condition never came true"
        time.sleep(0.01)


def test_a_user_task_arriving_mid_probe_runs_before_the_probe_continues(monkeypatch):
    worker = _FakeWorker()
    monkeypatch.setattr(sandbox, "_get_warm_worker", lambda *a, **k: worker)
    first_step_released = threading.Event()
    worker.holds["probe-1"] = first_step_released

    def probe():
        with sandbox.giving_way():
            for i in (1, 2, 3):
                sandbox.run_in_sandbox("introspect", {"who": f"probe-{i}"}, timeout=5)

    probe_thread = threading.Thread(target=probe)
    probe_thread.start()
    # The probe's first step is running; a user opens a model meanwhile.
    _wait_until(lambda: worker.order == ["probe-1"])
    user_thread = threading.Thread(
        target=lambda: sandbox.run_in_sandbox("run", {"who": "user"}, timeout=5)
    )
    user_thread.start()
    _wait_until(lambda: sandbox._user_tasks == 1)

    first_step_released.set()
    user_thread.join(5)
    probe_thread.join(5)
    assert not user_thread.is_alive() and not probe_thread.is_alive()
    # The running step finishes, the user's task goes next, the probe resumes.
    assert worker.order == ["probe-1", "user", "probe-2", "probe-3"]
    assert sandbox._user_tasks == 0


def test_giving_way_is_per_thread_and_restored(monkeypatch):
    assert sandbox.gives_way() is False
    with sandbox.giving_way():
        assert sandbox.gives_way() is True
        seen_in_other_thread = []
        t = threading.Thread(target=lambda: seen_in_other_thread.append(sandbox.gives_way()))
        t.start()
        t.join(5)
        assert seen_in_other_thread == [False]
    assert sandbox.gives_way() is False


def test_without_giving_way_tasks_are_counted_as_the_users(monkeypatch):
    worker = _FakeWorker()
    monkeypatch.setattr(sandbox, "_get_warm_worker", lambda *a, **k: worker)
    seen = []
    original = worker.send_task

    def send_task(task, params, timeout):
        seen.append(sandbox._user_tasks)
        return original(task, params, timeout)

    worker.send_task = send_task
    sandbox.run_in_sandbox("introspect", {"who": "user"}, timeout=5)
    assert seen == [1]
    assert sandbox._user_tasks == 0
