"""The assistant's API key, kept in the OS keychain (#179).

The key never goes in the settings file, the log, a problem report, a
response, or the process environment: the model runner inherits the server's
environment, so a key there would reach every model it runs. The one reader
is the agent adapter, which fetches the key for a request and holds it in a
local variable.

On macOS the login Keychain holds it, through the ``security`` tool in its
interactive mode, so the secret travels over stdin and never on a command
line (where ``ps`` would show it). Where no secure store exists, saving is
refused rather than falling back to a plain file.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from typing import Protocol

logger = logging.getLogger(__name__)

SERVICE = "PsyNeuView AI assistant"
ACCOUNT = "api-key"


class NoSecureStore(Exception):
    """This platform has no keychain the backend knows how to use."""


class KeyStore(Protocol):
    def get(self) -> str | None: ...
    def set(self, key: str) -> None: ...
    def delete(self) -> None: ...


class MacKeychain:
    """The login Keychain, via ``security -i`` (commands over stdin)."""

    def __init__(self, service: str = SERVICE, account: str = ACCOUNT):
        self._service = service
        self._account = account

    def get(self) -> str | None:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", self._service, "-a", self._account, "-w"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0:
            return None
        key = result.stdout.rstrip("\n")
        return key or None

    def set(self, key: str) -> None:
        if "\n" in key or "\r" in key or "'" in key:
            raise ValueError("the key contains a character the keychain tool can't take")
        # -U updates an existing item; the secret is on stdin, not argv.
        script = f"add-generic-password -U -s '{self._service}' -a '{self._account}' -w '{key}'\n"
        result = subprocess.run(["security", "-i"], input=script, capture_output=True, text=True, check=False)
        if result.returncode != 0 or "error" in (result.stderr or "").lower():
            raise NoSecureStore("the Keychain refused to save the key")

    def delete(self) -> None:
        subprocess.run(
            ["security", "delete-generic-password", "-s", self._service, "-a", self._account],
            capture_output=True, text=True, check=False,
        )


class MemoryStore:
    """For tests: nothing leaves the process."""

    def __init__(self):
        self._key: str | None = None

    def get(self) -> str | None:
        return self._key

    def set(self, key: str) -> None:
        self._key = key

    def delete(self) -> None:
        self._key = None


class RefusingStore:
    """No secure store on this platform: reads find nothing, writes refuse."""

    def get(self) -> str | None:
        return None

    def set(self, key: str) -> None:
        raise NoSecureStore("no secure key store is available on this platform; the key was not saved")

    def delete(self) -> None:
        return None


_store: KeyStore | None = None


def store() -> KeyStore:
    global _store
    if _store is None:
        _store = MacKeychain() if sys.platform == "darwin" else RefusingStore()
    return _store


def use_store(replacement: KeyStore | None) -> None:
    """Swap the store (tests); ``None`` goes back to the platform default."""
    global _store
    _store = replacement


def is_set() -> bool:
    return store().get() is not None


def get_key() -> str | None:
    """Only the agent adapter should call this; the key must stay local."""
    return store().get()


def set_key(key: str) -> None:
    if not isinstance(key, str) or not key.strip():
        raise ValueError("the key is empty")
    store().set(key.strip())


def delete_key() -> None:
    store().delete()
