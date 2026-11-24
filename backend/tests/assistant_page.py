"""The app's own page, as the assistant's tests see it (#381).

Every assistant page route needs this launch's page secret, and a request
that changes something needs an ``Origin``. ``conftest.py`` fixes the secret
for the test run; ``page_client`` sends both, as the real page does.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.assistant import page_secret

#: The page secret for the whole test run (conftest.py sets it).
PAGE_SECRET = "test-page-secret-0123456789abcdefghijklmnop"


def page_headers(base_url: str = "http://127.0.0.1") -> dict[str, str]:
    """What the app's page sends: its own site as ``Origin``, and the secret."""
    return {"origin": base_url.rstrip("/"), page_secret.HEADER: PAGE_SECRET}


def page_client(base_url: str = "http://127.0.0.1", **kwargs) -> TestClient:
    from app.main import app

    headers = {**page_headers(base_url), **kwargs.pop("headers", {})}
    return TestClient(app, base_url=base_url, headers=headers, **kwargs)
