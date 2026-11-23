"""Apply an operating-system sandbox to the current process (#311).

The model runner calls :func:`apply` on itself
before any model code runs, with a policy the server built
(``os_sandbox.py``). From then on the kernel, not Python, refuses what the
policy doesn't allow, in this process and every process it starts:

- **macOS:** a Seatbelt profile, through ``sandbox_init``, the call
  ``sandbox-exec`` makes. Rendered from the policy by :func:`render_sbpl`.
- **Linux** (WSL2, containers and CI included): Landlock for files and
  programs, and a seccomp filter that refuses creating sockets.

This file is the boundary's own code, so it uses nothing outside the
standard library and is loaded by path, as the import guard is. Nothing
here decides *what* is allowed; that is the server's policy. A policy that
can't be applied raises :class:`SandboxUnavailable`, and the caller must
then refuse the task: a run is never silently unsandboxed.

Run as a script (``python -I os_sandbox_apply.py --probe <dir>``) it checks
that a sandbox can be applied here and prints what it found, as JSON. The
server runs that once to report the state in Settings and About.

The policy (all paths are real paths, as the server resolved them)::

    {
      "version": 1,
      "read_deny":   [...],  # files and folders that may not be read or changed
      "write_allow": [...],  # the only places that may be written
      "write_deny":  [...],  # never written, even inside write_allow
      "exec_allow":  [...],  # the only programs that may be started
      "scratch": "...",      # the task's own folder: TMPDIR, caches, cwd-free
      "network": false,
    }
"""

from __future__ import annotations

import ctypes
import ctypes.util
import json
import os
import platform
import signal
import sys

POLICY_VERSION = 1

#: The variable a worker started for one task reads its policy from.
POLICY_ENV = "PSYNEUVIEW_OS_SANDBOX_POLICY"

#: Set in the environment once a policy is applied, so processes the model
#: starts can see they are inside (they are, whatever they do with it).
APPLIED_ENV = "PSYNEUVIEW_OS_SANDBOX_APPLIED"

_applied: dict | None = None


class SandboxUnavailable(RuntimeError):
    """No sandbox could be applied; the task must not run."""


def applied() -> dict | None:
    """What :func:`apply` did in this process, or None if nothing yet."""
    return _applied


# ── macOS: Seatbelt ─────────────────────────────────────────────────────────

#: Mach services a PsyNeuLink runner needs (found by the containment
#: experiment, 2026-11-03). Everything else, LaunchServices and Apple
#: events included, stays refused: those are ways to start a program
#: outside the sandbox.
_MACH_SERVICES = (
    "com.apple.system.logger",
    "com.apple.system.notification_center",
    "com.apple.SecurityServer",
)


def _sb_str(path: str) -> str:
    """A path as an SBPL string literal."""
    return '"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _sb_filters(paths) -> str:
    """``(subpath …)`` for each path: a folder and everything in it, or a
    file (``subpath`` matches the file itself too)."""
    return " ".join(f"(subpath {_sb_str(p)})" for p in paths)


def render_sbpl(policy: dict) -> str:
    """The Seatbelt profile for ``policy``.

    Seatbelt applies the **last** rule that matches, so the order is the
    meaning: allow reading, then take back what may not be read; allow the
    writes, then take back the protected places; and the unapproved files
    last of all, so nothing earlier can give them back. Paths are matched
    as the file system spells them, so a different case or accent form of a
    denied path is still denied (checked in ``test_os_sandbox.py``).
    """
    home = policy.get("home") or ""
    lines = [
        "(version 1)",
        ";; PsyNeuView model runner (#311). Generated; see docs/ai-assistant/os-sandbox.md.",
        "(deny default)",
        ";; Reading: everything except what is taken back below.",
        "(allow file-read*)",
    ]
    if policy.get("other_users_root") and home:
        root = policy["other_users_root"]
        lines += [
            ";; Other people's home folders.",
            f"(deny file-read* (regex {_sb_str('^' + _re_escape(root) + '/[^/]+/')}))",
            f"(allow file-read* (subpath {_sb_str(home)}) (subpath {_sb_str(root + '/Shared')}))",
        ]
        if policy.get("read_allow"):
            lines.append(f"(allow file-read* {_sb_filters(policy['read_allow'])})")
    # Their contents, not their metadata: stat still answers, so the import
    # guard (in Python, first) still sees that the file is there and gives
    # its "review this first" message; reading it is what the kernel refuses.
    # A folder's listing is its content, so a denied folder can't be listed.
    if policy.get("read_deny"):
        lines += [";; Secrets, and files the assistant wrote that nobody has approved.",
                  f"(deny file-read-data file-read-xattr {_sb_filters(policy['read_deny'])})"]
    lines += [
        ";; Writing: only the task's own folder and the declared output folders.",
        "(allow file-write* " + _sb_filters(policy.get("write_allow") or []) + ")" if policy.get("write_allow") else ";; (no write folders)",
        '(allow file-write-data file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    ]
    if policy.get("write_deny"):
        lines += [";; Never written: the review record, the app, PsyNeuLink, the Python install.",
                  f"(deny file-write* {_sb_filters(policy['write_deny'])})"]
    if policy.get("write_deny_files"):
        lines += [";; Files the assistant wrote, approved or not: not changed by a model.",
                  f"(deny file-write* {_sb_filters(policy['write_deny_files'])})"]
    if policy.get("no_move"):
        lines += [";; The folders holding a protected file: not renamed or removed (a move would",
                  ";; carry the file out from under its rule).",
                  "(deny file-write-unlink file-write-mode file-write-owner file-write-flags "
                  + " ".join(f"(literal {_sb_str(d)})" for d in policy["no_move"]) + ")",
                  "(deny file-write-create " + " ".join(f"(literal {_sb_str(d)})" for d in policy["no_move"]) + ")",
                  ";; Nor cloned (clonefile copies a folder with everything in it to a new path).",
                  "(deny file-clone " + _sb_filters(policy["no_move"]) + ")"]
    for folder in policy.get("no_autorun_in") or []:
        if folder == policy.get("scratch"):
            continue
        base = "^" + _re_escape(folder.rstrip("/")) + "/"
        names = "|".join(_re_escape(n) for n in AUTORUN_NAMES)
        lines += [";; No hidden files or folders, nor files tools run by themselves.",
                  f"(deny file-write* (regex {_sb_str(base + '(.*/)?[.][^/]*(/.*)?$')}))",
                  f"(deny file-write* (regex {_sb_str(base + '(.*/)?(' + names + ')$')}))",
                  f"(deny file-write* (regex {_sb_str(base + '.*[.](' + '|'.join(AUTORUN_SUFFIXES) + ')$')}))",
                  ";; No new file without an extension: Finder runs such a file if it is executable.",
                  f"(deny file-write-create (require-all (subpath {_sb_str(folder)}) (regex {_sb_str('/[^/.]+$')}) "
                  "(vnode-type REGULAR-FILE)))"]
    for folder in policy.get("no_code_in") or []:
        base = "^" + _re_escape(folder.rstrip("/")) + "/"
        lines += [";; No new code beside the model: a later Python could run it unreviewed.",
                  f"(deny file-write* (regex {_sb_str(base + '.*[.](py|pyc|pyo|pyw|pth|so|dylib|pyd)$')}))",
                  f"(deny file-write* (regex {_sb_str(base + '(.*/)?(sitecustomize|usercustomize)([.].*)?$')}))"]
    if policy.get("read_deny"):
        lines += [";; Last, so no allow above can give them back: not read, written, renamed or linked.",
                  f"(deny file-read-data file-read-xattr file-write* {_sb_filters(policy['read_deny'])})"]
    lines += [
        ";; Programs: forking is allowed (the runner forks, Graphviz is a child);",
        ";; starting a program is limited to Python and Graphviz. No shells.",
        "(allow process-fork)",
    ]
    if policy.get("exec_allow"):
        lines.append("(allow process-exec " + _sb_filters(policy["exec_allow"]) + ")")
    lines += [
        "(allow signal (target same-sandbox))",
        "(allow process-info* (target same-sandbox))",
        "(allow sysctl-read)",
        "(allow mach-lookup " + " ".join(f"(global-name {_sb_str(s)})" for s in _MACH_SERVICES) + ")",
        '(allow ipc-posix-shm-read-data (ipc-posix-name-regex #"^/tmp/com\\.apple\\.csseed\\."))',
        "(allow ipc-posix-sem)",
        "(allow ipc-posix-shm (ipc-posix-name-regex #\"^/psm_\") (ipc-posix-name-regex #\"^/mp-\"))",
        ";; No network at all: no sockets to other machines, this one, or local services.",
        "(deny network*)",
    ]
    return "\n".join(lines) + "\n"


#: Files other tools run on their own when they meet them.
AUTORUN_NAMES = ("Makefile", "makefile", "GNUmakefile", "justfile", "Justfile", "package.json", "conftest.py",
                 "setup.py", "setup.cfg", "pyproject.toml", "tox.ini", "noxfile.py", "sitecustomize.py",
                 "usercustomize.py", "Rakefile", "Gemfile", "Taskfile.yml", "Dockerfile", "docker-compose.yml",
                 "CMakeLists.txt", "build.gradle", "build.gradle.kts", "meson.build", "BUILD", "WORKSPACE")


#: Suffixes of files that run, or carry code that runs, when opened or
#: imported (case is folded by the file system's matching on macOS volumes
#: that ignore case; listed lower-case and upper-case here too).
AUTORUN_SUFFIXES = ("pth", "command", "sh", "bash", "zsh", "csh", "fish", "tool", "zip", "pyz", "egg", "whl",
                    "app", "workflow", "scpt", "applescript", "terminal", "fileloc", "webloc", "inetloc",
                    "desktop", "PTH", "COMMAND", "SH", "ZIP", "PYZ", "TERMINAL")


def _re_escape(s: str) -> str:
    out = []
    for ch in s:
        out.append("\\" + ch if ch in ".^$*+?()[]{}|\\" else ch)
    return "".join(out)


def _libsandbox():
    for name in ("/usr/lib/libsandbox.1.dylib", ctypes.util.find_library("sandbox")):
        if not name:
            continue
        try:
            lib = ctypes.CDLL(name, use_errno=True)
            fn = lib.sandbox_init
            fn.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
            fn.restype = ctypes.c_int
            return lib
        except (OSError, AttributeError):
            continue
    return None


def _apply_macos(policy: dict) -> dict:
    lib = _libsandbox()
    if lib is None:
        raise SandboxUnavailable("macOS sandbox library (libsandbox) not found")
    profile = render_sbpl(policy)
    err = ctypes.c_char_p()
    rc = lib.sandbox_init(profile.encode("utf-8"), 0, ctypes.byref(err))
    if rc != 0:
        msg = err.value.decode("utf-8", "replace") if err.value else "unknown error"
        try:
            lib.sandbox_free_error(err)
        except Exception:
            pass
        raise SandboxUnavailable(f"sandbox_init refused the profile: {msg}")
    return {
        "mechanism": "seatbelt",
        "enforced": ["files", "programs", "network"],
        "not_enforced": ["memory and time limits (the task timeout applies)"],
    }


# ── Linux: Landlock + seccomp ───────────────────────────────────────────────

_NR = {
    # Landlock's numbers are the same on every architecture.
    "landlock_create_ruleset": 444,
    "landlock_add_rule": 445,
    "landlock_restrict_self": 446,
}
_SECCOMP_ARCH = {
    # machine: (AUDIT_ARCH, socket, io_uring_setup, memfd_create, execveat, x32 flag)
    "x86_64": (0xC000003E, 41, 425, 319, 322, True),
    "aarch64": (0xC00000B7, 198, 425, 279, 281, False),
    "arm64": (0xC00000B7, 198, 425, 279, 281, False),
}

# Landlock filesystem rights, by the ABI that introduced them.
LL_EXECUTE = 1 << 0
LL_WRITE_FILE = 1 << 1
LL_READ_FILE = 1 << 2
LL_READ_DIR = 1 << 3
LL_REMOVE_DIR = 1 << 4
LL_REMOVE_FILE = 1 << 5
LL_MAKE_CHAR = 1 << 6
LL_MAKE_DIR = 1 << 7
LL_MAKE_REG = 1 << 8
LL_MAKE_SOCK = 1 << 9
LL_MAKE_FIFO = 1 << 10
LL_MAKE_BLOCK = 1 << 11
LL_MAKE_SYM = 1 << 12
LL_REFER = 1 << 13  # ABI 2
LL_TRUNCATE = 1 << 14  # ABI 3
LL_NET_BIND_TCP = 1 << 0  # ABI 4
LL_NET_CONNECT_TCP = 1 << 1
LL_SCOPE_ABSTRACT_UNIX = 1 << 0  # ABI 6
LL_SCOPE_SIGNAL = 1 << 1

#: Folders whose programs a model can't read (so the loader can't start them).
LINUX_PROGRAM_DIRS = ("/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/local/bin", "/usr/local/sbin",
                      "/usr/libexec", "/usr/lib/git-core")

_LL_FILE_RIGHTS = LL_EXECUTE | LL_WRITE_FILE | LL_READ_FILE | LL_TRUNCATE
_LL_READ = LL_READ_FILE | LL_READ_DIR
_LL_WRITE = (LL_WRITE_FILE | LL_REMOVE_DIR | LL_REMOVE_FILE | LL_MAKE_DIR | LL_MAKE_REG
             | LL_MAKE_SOCK | LL_MAKE_FIFO | LL_MAKE_SYM | LL_REFER | LL_TRUNCATE)


class _RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64),
                ("handled_access_net", ctypes.c_uint64),
                ("scoped", ctypes.c_uint64)]


def _path_beneath_attr(access: int, fd: int):
    """``struct landlock_path_beneath_attr``: a u64 and an s32, packed (12 bytes)."""
    import struct
    return ctypes.create_string_buffer(struct.pack("=Qi", access, fd), 12)


class _SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_uint16), ("jt", ctypes.c_uint8), ("jf", ctypes.c_uint8), ("k", ctypes.c_uint32)]


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_uint16), ("filter", ctypes.POINTER(_SockFilter))]


def _libc():
    return ctypes.CDLL(None, use_errno=True)


def _syscall(libc, nr: int, *args) -> int:
    libc.syscall.restype = ctypes.c_long
    return libc.syscall(ctypes.c_long(nr), *args)


def landlock_abi() -> int:
    """The Landlock ABI version the kernel offers, or 0 if none (too old,
    or Landlock not enabled at boot)."""
    if not sys.platform.startswith("linux"):
        return 0
    try:
        libc = _libc()
        v = _syscall(libc, _NR["landlock_create_ruleset"], None, ctypes.c_size_t(0), ctypes.c_uint32(1))
        return int(v) if v > 0 else 0
    except Exception:
        return 0


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def cover(root: str, excluded: list[str]) -> tuple[list[str], list[str]]:
    """Landlock rules only *allow*, beneath a folder. To allow ``root``
    except some paths inside it, allow every entry along the way that
    isn't one of them. Returns ``(whole, ancestors)``: paths to allow with
    everything beneath, and the folders above an excluded path, which get
    listing only. Symbolic links are skipped: what they lead to is covered,
    or not, under its own real path."""
    whole: list[str] = []
    ancestors: list[str] = []

    def walk(p: str) -> None:
        if any(p == e for e in excluded):
            return
        inside = [e for e in excluded if _under(e, p) and e != p]
        if not inside:
            whole.append(p)
            return
        if not os.path.isdir(p) or os.path.islink(p):
            return
        ancestors.append(p)
        try:
            names = os.listdir(p)
        except OSError:
            return
        for name in names:
            child = os.path.join(p, name)
            if os.path.islink(child):
                continue
            walk(child)

    walk(root)
    return whole, ancestors


def _apply_linux(policy: dict) -> dict:
    abi = landlock_abi()
    if abi < 1:
        raise SandboxUnavailable("Landlock is not available in this kernel (Linux 5.13+ with Landlock enabled)")
    libc = _libc()
    handled_fs = (LL_EXECUTE | LL_WRITE_FILE | LL_READ_FILE | LL_READ_DIR | LL_REMOVE_DIR | LL_REMOVE_FILE
                  | LL_MAKE_CHAR | LL_MAKE_DIR | LL_MAKE_REG | LL_MAKE_SOCK | LL_MAKE_FIFO | LL_MAKE_BLOCK | LL_MAKE_SYM)
    if abi >= 2:
        handled_fs |= LL_REFER
    if abi >= 3:
        handled_fs |= LL_TRUNCATE
    attr = _RulesetAttr(handled_fs, 0, 0)
    size = 8
    enforced = ["files", "programs"]
    not_enforced = ["memory and time limits (the task timeout applies)"]
    if abi >= 4 and not policy.get("network"):
        attr.handled_access_net = LL_NET_BIND_TCP | LL_NET_CONNECT_TCP
        size = 16
    if abi >= 6:
        attr.scoped = LL_SCOPE_ABSTRACT_UNIX | LL_SCOPE_SIGNAL
        size = 24
        enforced.append("signals to processes outside")
    else:
        not_enforced.append("signals to the user's other processes (needs Landlock ABI 6, Linux 6.12)")
    ruleset = _syscall(libc, _NR["landlock_create_ruleset"], ctypes.byref(attr), ctypes.c_size_t(size), ctypes.c_uint32(0))
    if ruleset < 0:
        raise SandboxUnavailable(f"landlock_create_ruleset failed: {os.strerror(ctypes.get_errno())}")

    def add(path: str, access: int) -> None:
        try:
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        except OSError:
            return
        try:
            if not os.path.isdir(path):
                access &= _LL_FILE_RIGHTS
            access &= handled_fs
            if not access:
                return
            rule = _path_beneath_attr(access, fd)
            if _syscall(libc, _NR["landlock_add_rule"], ctypes.c_int(ruleset), ctypes.c_int(1), rule, ctypes.c_uint32(0)) < 0:
                raise SandboxUnavailable(f"landlock_add_rule {path}: {os.strerror(ctypes.get_errno())}")
        finally:
            os.close(fd)

    try:
        read_deny = [os.path.realpath(p) for p in policy.get("read_deny") or []]
        # The folders of programs aren't readable: the dynamic loader must be
        # allowed to run (the kernel runs it for every program), and given a
        # readable program it would start it (``ld-linux.so /bin/sh``). The
        # allowed programs get their own read right below.
        read_deny += sorted({os.path.realpath(d) for d in LINUX_PROGRAM_DIRS if os.path.isdir(d)})
        whole, ancestors = cover("/", read_deny)
        for p in whole:
            add(p, _LL_READ)
        for p in ancestors:
            add(p, LL_READ_DIR)
        # Writing is granted around the protected places only, not around
        # the unapproved files: those get no read right from the cover of
        # "/" above, so a model may overwrite or remove one (its own text
        # then, still unapproved by its hash) but never read it, and Landlock
        # refuses moving or linking it somewhere readable (that would gain a
        # right). This keeps a folder holding an unapproved file writable.
        write_deny = [os.path.realpath(p) for p in (policy.get("write_deny") or [])]
        for root in policy.get("write_allow") or []:
            w_whole, _ = cover(os.path.realpath(root), write_deny)
            for p in w_whole:
                add(p, _LL_WRITE)
        for dev in ("/dev/null", "/dev/zero", "/dev/tty", "/dev/full"):
            add(dev, LL_READ_FILE | LL_WRITE_FILE)
        if os.path.isdir("/dev/shm"):
            add("/dev/shm", _LL_READ | _LL_WRITE)
        for p in policy.get("exec_allow") or []:
            add(p, LL_EXECUTE | LL_READ_FILE)
        # Landlock needs no_new_privs (or CAP_SYS_ADMIN) to restrict itself.
        if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
            raise SandboxUnavailable(f"PR_SET_NO_NEW_PRIVS failed: {os.strerror(ctypes.get_errno())}")
        if _syscall(libc, _NR["landlock_restrict_self"], ctypes.c_int(ruleset), ctypes.c_uint32(0)) < 0:
            raise SandboxUnavailable(f"landlock_restrict_self failed: {os.strerror(ctypes.get_errno())}")
    finally:
        os.close(ruleset)

    if not policy.get("network"):
        _seccomp_no_sockets(libc)
        enforced.append("network")
    return {"mechanism": f"landlock-abi{abi}+seccomp", "enforced": enforced, "not_enforced": not_enforced}


def _seccomp_no_sockets(libc) -> None:
    """A seccomp filter: ``socket()`` (every family, local ones included),
    ``io_uring_setup`` (which can make sockets), ``memfd_create`` and
    ``execveat`` (running a program that isn't a file Landlock can see)
    fail with EPERM; every other call is allowed. ``socketpair`` stays, so
    pipes between a process and its own children keep working.

    A network namespace (``unshare(CLONE_NEWNET)``) would be the other
    way, but it needs unprivileged user namespaces, which Ubuntu 24.04
    restricts by default; seccomp needs only no_new_privs, set above."""
    arch = _SECCOMP_ARCH.get(platform.machine())
    if arch is None:
        raise SandboxUnavailable(f"no seccomp filter for this architecture ({platform.machine()})")
    audit_arch, nr_socket, nr_uring, nr_memfd, nr_execveat, x32 = arch
    LD_W_ABS, JEQ, JGE, RET = 0x20, 0x15, 0x35, 0x06
    ALLOW, DENY = 0x7FFF0000, 0x00050000 | 1  # SECCOMP_RET_ERRNO | EPERM
    deny_nrs = [nr_socket, nr_uring, nr_memfd, nr_execveat]
    prog: list[tuple[int, int, int, int]] = [(LD_W_ABS, 0, 0, 4)]
    # Another architecture's calls (32-bit compatibility) are refused.
    n_after = 1 + (1 if x32 else 0) + len(deny_nrs) + 1
    prog.append((JEQ, 0, n_after, audit_arch))
    prog.append((LD_W_ABS, 0, 0, 0))
    if x32:
        n = len(deny_nrs) + 1
        prog.append((JGE, n, 0, 0x40000000))
    for i, nr in enumerate(deny_nrs):
        prog.append((JEQ, len(deny_nrs) - i, 0, nr))
    prog.append((RET, 0, 0, ALLOW))
    prog.append((RET, 0, 0, DENY))
    arr = (_SockFilter * len(prog))(*[_SockFilter(c, t, f, k) for c, t, f, k in prog])
    fprog = _SockFprog(len(prog), arr)
    # PR_SET_SECCOMP, SECCOMP_MODE_FILTER
    if libc.prctl(22, 2, ctypes.byref(fprog), 0, 0) != 0:
        raise SandboxUnavailable(f"seccomp filter refused: {os.strerror(ctypes.get_errno())}")


# ── Both ────────────────────────────────────────────────────────────────────


def prepare_scratch(policy: dict) -> None:
    """Point temporary files and library caches into the task's folder,
    which is the only place besides the output folders it may write."""
    scratch = policy.get("scratch")
    if not scratch:
        return
    os.makedirs(scratch, mode=0o700, exist_ok=True)
    for var, sub in (("TMPDIR", ""), ("TMP", ""), ("TEMP", ""), ("MPLCONFIGDIR", "matplotlib"),
                     ("NUMBA_CACHE_DIR", "numba"), ("XDG_CACHE_HOME", "cache")):
        path = os.path.join(scratch, sub) if sub else scratch
        os.makedirs(path, exist_ok=True)
        os.environ[var] = path
    import tempfile
    tempfile.tempdir = scratch
    # Python's bytecode cache is left where it is: read from the existing
    # __pycache__ folders (a prefix would mean recompiling PsyNeuLink and
    # torch on every one-shot run); writing new ones is refused and Python
    # carries on without them.


def apply(policy: dict) -> dict:
    """Sandbox this process (and everything it starts) by ``policy``.

    Once per process: a sandbox can't be widened or replaced afterwards, so
    a second call raises. Raises :class:`SandboxUnavailable` if no sandbox
    can be applied; the caller must not run the task then."""
    global _applied
    if _applied is not None:
        raise SandboxUnavailable("this process is already sandboxed; a task with a new policy needs a fresh process")
    if not isinstance(policy, dict) or policy.get("version") != POLICY_VERSION:
        raise SandboxUnavailable("sandbox policy missing or of an unknown version")
    prepare_scratch(policy)
    if sys.platform == "darwin":
        info = _apply_macos(policy)
    elif sys.platform.startswith("linux"):
        info = _apply_linux(policy)
    else:
        raise SandboxUnavailable(f"no sandbox for this platform ({sys.platform})")
    info["key"] = policy.get("key")
    _applied = info
    os.environ[APPLIED_ENV] = info["mechanism"]
    return info


def apply_from_env() -> dict | None:
    """Apply the policy in :data:`POLICY_ENV`, if there is one. A worker
    started for a single task (a pool worker, a Learn job) calls this first
    thing. Raises if the policy is there but can't be applied."""
    raw = os.environ.pop(POLICY_ENV, "")
    if not raw:
        return None
    try:
        policy = json.loads(raw)
    except ValueError as e:
        raise SandboxUnavailable(f"sandbox policy unreadable: {e}") from e
    return apply(policy)


# ── Processes that outlive their task ───────────────────────────────────────


def become_subreaper() -> bool:
    """Linux: make this process (the fork server's parent) the one orphans
    of its children are handed to, even after ``setsid``, so
    :func:`end_survivors` can find them. No-op elsewhere."""
    if not sys.platform.startswith("linux"):
        return False
    try:
        return _libc().prctl(36, 1, 0, 0, 0) == 0  # PR_SET_CHILD_SUBREAPER
    except Exception:
        return False


class _ProcBsdInfo(ctypes.Structure):
    _fields_ = [("pbi_flags", ctypes.c_uint32), ("pbi_status", ctypes.c_uint32), ("pbi_xstatus", ctypes.c_uint32),
                ("pbi_pid", ctypes.c_uint32), ("pbi_ppid", ctypes.c_uint32), ("pbi_uid", ctypes.c_uint32),
                ("pbi_gid", ctypes.c_uint32), ("pbi_ruid", ctypes.c_uint32), ("pbi_rgid", ctypes.c_uint32),
                ("pbi_svuid", ctypes.c_uint32), ("pbi_svgid", ctypes.c_uint32), ("rfu_1", ctypes.c_uint32),
                ("pbi_comm", ctypes.c_char * 16), ("pbi_name", ctypes.c_char * 32), ("pbi_nfiles", ctypes.c_uint32),
                ("pbi_pgid", ctypes.c_uint32), ("pbi_pjobc", ctypes.c_uint32), ("e_tdev", ctypes.c_uint32),
                ("e_tpgid", ctypes.c_uint32), ("pbi_nice", ctypes.c_int32), ("pbi_start_tvsec", ctypes.c_uint64),
                ("pbi_start_tvusec", ctypes.c_uint64)]


#: The variable that marks every process of a task on Linux (and the
#: workers the server starts on both platforms): ``<run token>:<task id>``.
#: The run token is random per server, so it can't be guessed, and a model
#: can't put it into another process's environment.
MARK_ENV = "PSYNEUVIEW_TASK_MARK"
_NO_REPORT = 0x40000000
_FILTER_PATH = 1


def _sandbox_lib():
    sb = _libsandbox()
    if sb is not None:
        sb.sandbox_check.restype = ctypes.c_int
        sb.sandbox_check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    return sb


def _denies(sb, pid: int, path: str) -> bool:
    return sb.sandbox_check(pid, b"file-read-data", _FILTER_PATH | _NO_REPORT, ctypes.c_char_p(path.encode())) == 1


def _macos_marked(run_mark: str, control: str, live_marks: list[str]) -> list[int]:
    """Processes under one of this server's task profiles (macOS): their
    sandbox refuses reading the run's own random mark file, and allows
    reading a control file next to it (so a deny-everything profile isn't
    taken for ours). The profile is inherited through fork, exec and
    setsid, and can't be removed or put onto another process. A process
    still refusing a live task's mark belongs to a task running now."""
    try:
        libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    except OSError:
        return []
    sb = _sandbox_lib()
    if sb is None:
        return []
    n = libproc.proc_listallpids(None, 0)
    if n <= 0:
        return []
    arr = (ctypes.c_int * (n * 2))()
    n = libproc.proc_listallpids(arr, ctypes.sizeof(arr))
    uid, me, out = os.getuid(), os.getpid(), []
    for pid in arr[:max(0, n)]:
        if pid <= 1 or pid == me:
            continue
        info = _ProcBsdInfo()
        if libproc.proc_pidinfo(pid, 3, ctypes.c_uint64(0), ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info):
            continue
        if info.pbi_uid != uid or sb.sandbox_check(pid, None, 0) != 1:
            continue
        if not _denies(sb, pid, run_mark) or _denies(sb, pid, control):
            continue
        if any(_denies(sb, pid, m) for m in live_marks):
            continue
        # Stopped the moment it is found: a process that forks and exits
        # every few milliseconds would be gone by the end of the scan.
        try:
            os.kill(pid, signal.SIGSTOP)
        except OSError:
            pass
        out.append(pid)
    return out


def _linux_marked(token: str, live_ids: set[str]) -> list[int]:
    """Processes carrying this server's mark in the environment they
    started with (Linux): ``MARK_ENV=<token>:<task id>`` for a task not
    running now."""
    want = f"{MARK_ENV}={token}:".encode()
    uid, me, out = os.getuid(), os.getpid(), []
    try:
        names = os.listdir("/proc")
    except OSError:
        return []
    for name in names:
        if not name.isdigit() or int(name) == me:
            continue
        try:
            if os.stat(f"/proc/{name}").st_uid != uid:
                continue
            with open(f"/proc/{name}/environ", "rb") as f:
                env = f.read()
        except OSError:
            continue
        i = env.find(want)
        if i < 0:
            continue
        task = env[i + len(want):].split(b"\0", 1)[0].decode("ascii", "replace")
        if task not in live_ids:
            try:
                os.kill(int(name), signal.SIGSTOP)  # at once (see _macos_marked)
            except OSError:
                pass
            out.append(int(name))
    return out


def _linux_children() -> list[int]:
    """This process's children (the fork server's parent: a subreaper, so
    every orphan of its tasks, whatever session it moved to)."""
    me, out = os.getpid(), []
    for path in (f"/proc/{me}/task/{me}/children",):
        try:
            with open(path) as f:
                out.extend(int(x) for x in f.read().split())
        except (OSError, ValueError):
            pass
    return out


def end_processes(find, time_limit: float = 10.0, reap: bool = False) -> int:
    """End every process ``find()`` returns, by pid only, never by process
    group or session (#311, U1): each found process is stopped at once (a
    stopped process can't fork), then killed; rounds go on until three in
    a row find nothing, within ``time_limit`` seconds. Returns how many
    were ended."""
    import signal
    import time

    ended, empty = 0, 0
    deadline = time.monotonic() + time_limit
    while time.monotonic() < deadline and empty < 3:
        pids = find()
        if not pids:
            empty += 1
            continue
        empty = 0
        for pid in pids:
            try:
                os.kill(pid, signal.SIGSTOP)
            except OSError:
                pass
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
                ended += 1
            except OSError:
                pass
        if reap:
            _reap_children()
    if time.monotonic() >= deadline:
        sys.stderr.write("[sandbox] processes a task left kept coming back until the sweep's time limit\n")
    if reap:
        _reap_children()
    return ended


def end_own_children(time_limit: float = 1.0) -> int:
    """Linux, the fork server's parent after a task: every child it still
    has is a leftover of its tasks (it runs none now)."""
    if not sys.platform.startswith("linux"):
        return 0
    return end_processes(_linux_children, time_limit=time_limit, reap=True)


def _reap_children() -> None:
    while True:
        try:
            done, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if not done:
            return


# ── The probe ───────────────────────────────────────────────────────────────


def probe(workdir: str) -> dict:
    """Apply a small policy here and check that it holds: a file that may
    not be read is refused, a write outside the scratch folder is refused,
    and a socket can't be opened. Runs in a process of its own (it
    sandboxes the process it runs in)."""
    workdir = os.path.realpath(workdir)
    secret = os.path.join(workdir, "secret.txt")
    with open(secret, "w") as f:
        f.write("x")
    scratch = os.path.join(workdir, "scratch")
    policy = {"version": POLICY_VERSION, "read_deny": [secret], "write_allow": [scratch],
              "write_deny": [], "exec_allow": [os.path.realpath(sys.executable)], "scratch": scratch,
              "network": False, "home": os.path.expanduser("~")}
    out: dict = {"platform": sys.platform, "machine": platform.machine(), "release": platform.release()}
    if sys.platform.startswith("linux"):
        out["landlock_abi"] = landlock_abi()
    try:
        info = apply(policy)
    except SandboxUnavailable as e:
        out.update(ok=False, reason=str(e))
        return out
    checks = {}
    try:
        open(secret).read()
        checks["read_denied"] = False
    except OSError:
        checks["read_denied"] = True
    try:
        with open(os.path.join(workdir, "outside.txt"), "w") as f:
            f.write("x")
        checks["write_denied"] = False
    except OSError:
        checks["write_denied"] = True
    # Seatbelt lets a socket be made and refuses the connect; seccomp
    # refuses the socket. Either is a PermissionError; "connection refused"
    # (nothing listening) would mean the network was reachable.
    checks["network_denied"] = False
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.settimeout(1)
            s.connect(("127.0.0.1", 9))
        finally:
            s.close()
    except PermissionError:
        checks["network_denied"] = True
    except OSError:
        pass
    try:
        with open(os.path.join(scratch, "inside.txt"), "w") as f:
            f.write("x")
        checks["scratch_writable"] = True
    except OSError:
        checks["scratch_writable"] = False
    ok = all(checks.values())
    out.update(ok=ok, mechanism=info["mechanism"], enforced=info["enforced"],
               not_enforced=info["not_enforced"], checks=checks)
    if not ok:
        out["reason"] = "the sandbox was applied but didn't hold: " + ", ".join(k for k, v in checks.items() if not v)
    return out


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--probe":
        print(json.dumps(probe(sys.argv[2])))
    else:
        print("usage: os_sandbox_apply.py --probe <empty folder>", file=sys.stderr)
        sys.exit(2)
