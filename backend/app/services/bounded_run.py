"""Run a worker and collect its output without trusting what it leaves (#311, U4).

``subprocess.run(capture_output=True)`` reads until every holder of the
pipe has closed it, and keeps everything. A process a model started can
hold the worker's output pipe after the worker exits and write without
end, which filled the server's memory. Here output is read with a size
cap, and reading stops a moment after the worker itself exits; whatever
is still writing is cut off. The worker runs in a session of its own, so
nothing it starts can join one of the user's process groups.
"""

from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time
from dataclasses import dataclass

#: The most output kept from one stream of one run.
OUTPUT_CAP = 16 * 1024 * 1024
#: How long output is still read after the worker exits.
GRACE = 0.2


@dataclass
class Result:
    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool = False
    truncated: bool = False


def run(cmd: list[str], *, input: str = "", env=None, cwd=None, timeout: float = 300,
        cap: int = OUTPUT_CAP, on_start=None) -> Result:
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env, cwd=cwd, start_new_session=True)
    if on_start is not None:
        on_start(proc)
    try:
        if input:
            proc.stdin.write(input.encode("utf-8"))
        proc.stdin.close()
    except OSError:
        pass
    return collect(proc, timeout=timeout, cap=cap)


def collect(proc: subprocess.Popen, *, timeout: float, cap: int = OUTPUT_CAP) -> Result:
    """Read ``proc``'s stdout and stderr (binary pipes) until it exits, plus
    :data:`GRACE`, keeping at most ``cap`` bytes of each."""
    bufs = {proc.stdout: bytearray(), proc.stderr: bytearray()}
    sel = selectors.DefaultSelector()
    for stream in bufs:
        if stream is not None:
            os.set_blocking(stream.fileno(), False)
            sel.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout
    stop_at = None
    timed_out = truncated = False
    try:
        while sel.get_map():
            now = time.monotonic()
            if stop_at is None and proc.poll() is not None:
                stop_at = now + GRACE
            if stop_at is not None and now > stop_at:
                break
            if now > deadline:
                timed_out = True
                break
            for key, _ in sel.select(timeout=0.05):
                try:
                    data = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                except OSError:
                    data = b""
                if not data:
                    sel.unregister(key.fileobj)
                    continue
                buf = bufs[key.fileobj]
                room = cap - len(buf)
                if room > 0:
                    buf += data[:room]
                if len(data) > room:
                    truncated = True
    finally:
        sel.close()
        for stream in bufs:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)  # its own session: only its processes
            except OSError:
                pass
            proc.kill()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
    return Result(proc.returncode, bufs[proc.stdout].decode("utf-8", "replace"),
                  bufs[proc.stderr].decode("utf-8", "replace"), timed_out, truncated)
