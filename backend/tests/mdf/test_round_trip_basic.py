"""Smoke tests for the MDF round-trip harness (#88)."""
from pathlib import Path

import pytest

pytest.importorskip("modeci_mdf")

from tests.mdf.harness import assert_round_trip_equivalent

FIXTURES = Path(__file__).parent.parent / "fixtures" / "mdf"


@pytest.mark.parametrize("fmt", ["json", "yaml"])
def test_basic_linear_round_trip(tmp_path, fmt):
    assert_round_trip_equivalent(FIXTURES / "basic_linear.py", tmp_path, fmt=fmt)
