"""The version-mismatch warning is major.minor only (#879).

Previously any base-version difference warned, so essentially every bundled
model warned against a from-source dev build (0.19.1.0+N.gHASH). Now only a
major.minor difference warns.
"""

from app.services.sandbox_worker import _version_mismatch_warning


def test_warns_on_minor_difference():
    assert _version_mismatch_warning("0.18.0.0", "0.19.1.0") is not None


def test_warns_on_major_difference():
    assert _version_mismatch_warning("0.19.1.0", "1.0.0") is not None


def test_no_warn_on_patch_or_micro_difference():
    assert _version_mismatch_warning("0.19.0.0", "0.19.1.0") is None
    assert _version_mismatch_warning("0.19.1.0", "0.19.2.0") is None


def test_no_warn_against_dev_build_of_same_minor():
    # The real-world case that motivated #879.
    assert _version_mismatch_warning("0.19.1.0", "0.19.1.0+10.g83cc4165b7") is None
    assert _version_mismatch_warning("0.19.0", "0.19.5.0+3.gABCDEF") is None


def test_none_on_missing_or_unknown():
    assert _version_mismatch_warning("", "0.19.1.0") is None
    assert _version_mismatch_warning("0.18.0.0", "unknown") is None
    assert _version_mismatch_warning("0.18.0.0", "") is None


def test_message_names_both_versions():
    w = _version_mismatch_warning("0.18.0.0", "0.19.1.0")
    assert w and "0.18.0.0" in w and "0.19.1.0" in w
