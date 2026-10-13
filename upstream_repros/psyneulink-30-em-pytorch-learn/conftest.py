"""Test isolation for this folder — mirrors PsyNeuLink's own conftest.

Running the vendored upstream EGO test and our #30 repro in one `pytest`
invocation otherwise leaks state between them:

- **Name registry:** building several models in one process makes PsyNeuLink
  append ``-N`` suffixes to duplicate mechanism names (e.g. ``STATE`` ->
  ``STATE-1``), which breaks name-based node lookups. PsyNeuLink's own suite
  clears the registries between tests; we do the same.
- **Seed:** the upstream EGO test is marked ``pytorch`` and expects a seeded
  torch, exactly as PsyNeuLink's conftest provides.

With this, ``pytest`` over the whole folder is order-independent.
"""

import numpy as np

from psyneulink import clear_registry, primary_registries

try:
    from psyneulink import set_global_seed
except Exception:  # pragma: no cover - older PsyNeuLink
    set_global_seed = None


def pytest_runtest_setup(item):
    seed = 0
    np.random.seed(seed)
    if set_global_seed is not None:
        set_global_seed(seed)
    if "pytorch" in item.keywords:
        import torch

        torch.manual_seed(seed)


def pytest_runtest_teardown(item):
    for registry in primary_registries:
        clear_registry(registry)
