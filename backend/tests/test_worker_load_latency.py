"""Worker-path load-latency budget (#864).

#860's ``test_reference_model_load_latency`` times introspection in isolation;
this guards the *full request path* — endpoint → warm worker → response →
``timings`` — through ``TestClient``, which is where a worker wedge or an
event-loop stall actually surfaces. It also adds the specific regression from
#864: a small model loaded right after a heavy one must stay fast (the "a heavy
load poisons the single serial worker" symptom that showed up as ~32s loads).
"""

import time

import pytest
from fastapi.testclient import TestClient

from app.api.routes import REFERENCE_DIR, REFERENCE_MODELS
from app.main import app

# Module-scope so the parametrized cases share one warm worker, mirroring how the
# live backend reuses a single worker across loads.
client = TestClient(app)

# Warm introspection is ~0.5–3s (EGO ~2s). The budget sits well under the 30s
# INTROSPECT_TIMEOUT so a wedge / near-timeout trips it, with headroom for a cold
# worker + slow CI.
BUDGET_S = 25


def _present(name: str) -> bool:
    return (REFERENCE_DIR / f"{name}.py").exists()


def _load(name: str):
    return client.post("/api/reference-models/load", json={"name": name})


@pytest.mark.parametrize("name", [e["name"] for e in REFERENCE_MODELS])
def test_worker_load_latency(name):
    """Every bundled reference model loads through the warm worker within budget,
    so a worker-path regression (wedge, ballooning introspection) is caught."""
    if not _present(name):
        pytest.skip(f"{name} not present")
    t0 = time.time()
    resp = _load(name)
    dt = time.time() - t0
    assert resp.status_code == 200, f"{name} load failed: {resp.status_code} {resp.text[:200]}"
    body = resp.json()
    assert not (body.get("model") or {}).get("error"), (
        f"{name}: {(body.get('model') or {}).get('error')}"
    )
    assert dt <= BUDGET_S, (
        f"{name} load took {dt:.1f}s (> {BUDGET_S}s budget) — worker-path regression"
    )
    # The timings instrumentation (#867) must be present so the always-on
    # breakdown can't silently regress to null.
    assert body.get("timings"), f"{name}: response missing `timings` block"


def test_small_model_stays_fast_after_heavy():
    """A small model loaded right after a heavy one (EGO) must stay fast — guards
    the 'heavy load poisons the single serial worker' regression (#864)."""
    heavy, small = "Giallanza2024_ego_study2", "MontagueDayanSejnowski96"
    if not (_present(heavy) and _present(small)):
        pytest.skip("heavy/small reference model not present")

    assert _load(heavy).status_code == 200  # warm + load the heavy model first
    t0 = time.time()
    resp = _load(small)
    dt = time.time() - t0
    assert resp.status_code == 200, f"small load failed: {resp.status_code} {resp.text[:200]}"
    # Small models introspect in <2s warm; 12s catches poisoning (which showed as
    # ~32s) without tripping on ordinary CI variance.
    SMALL_AFTER_HEAVY_BUDGET_S = 12
    assert dt <= SMALL_AFTER_HEAVY_BUDGET_S, (
        f"small model took {dt:.1f}s right after a heavy load "
        f"(> {SMALL_AFTER_HEAVY_BUDGET_S}s) — worker poisoning regression"
    )
