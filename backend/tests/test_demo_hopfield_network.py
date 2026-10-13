"""The Hopfield demo recalls what the course's walkthrough says it does (#49).

The walkthrough runs the notebook's noisy Z (four pixels wrong) and says all
four flip back in one update and Z then stays; runs A's top over Z's bottom
and says it goes to Z, the nearer letter; then stores four letters and says
the same noisy Z settles on X instead, a row at a time. This pins those
claims, running the demo the way the app does, so a PsyNeuLink change fails
here by name.
"""

import importlib.util
import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model

DEMO = Path(__file__).parent.parent / "demos" / "hopfield_network.py"


def _module(path=DEMO):
    spec = importlib.util.spec_from_file_location("hopfield_network_check", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M = _module()


def _trials(path, cue_set):
    """Each trial's 25 outputs, rounded: the Run tab's per-trial values."""
    rows = [list(map(int, r)) for r in getattr(M, cue_set)[M.hopfield]]
    result = run_model(str(path), "hopfield_network", {"hopfield": rows}, use_sandbox=False)
    assert "error" not in result, result
    outputs = [np.asarray(t["output"], dtype=float).ravel() for t in result["results"]]
    # Steep enough to be a step: every unit is +1 or -1, not just near it.
    for out in outputs:
        assert np.allclose(np.abs(out), 1, atol=1e-6)
    # The Run tab shows hopfield's own value: it is the input node *and* the
    # answer, so its log must come back.
    assert len(result["logs"]["hopfield"]["trials"]) == len(rows)
    return [np.rint(out).astype(int).tolist() for out in outputs]


def test_the_weights_are_the_notebooks_rule_with_a_zero_diagonal():
    w = np.asarray(M.hopfield.matrix.base)
    expected = (np.outer(M.A, M.A) + np.outer(M.Z, M.Z)) / 2
    np.fill_diagonal(expected, 0)
    assert np.allclose(w, expected)
    assert np.allclose(w, w.T)


def test_the_cue_is_the_notebooks_own_noisy_z():
    # 2_hopfield_networks.ipynb: seed 42, one add_noise(Z) to plot, then
    # add_noise(Z, noise_level=.3) as the test pattern.
    def add_noise(pattern, noise_level=0.2):
        random_pattern = np.random.choice([-1, 1], size=pattern.shape)
        noise_mask = np.random.rand(pattern.shape[0]) < noise_level
        noisy = pattern.copy()
        noisy[noise_mask] = random_pattern[noise_mask]
        return noisy

    np.random.seed(42)
    add_noise(M.Z)
    assert add_noise(M.Z, noise_level=0.3).tolist() == M.noisy_Z_pixels
    assert np.flatnonzero(np.asarray(M.noisy_Z_pixels) != M.Z).tolist() == [6, 11, 14, 18]


def test_the_noisy_z_comes_back_as_z_in_one_update_and_stays():
    trials = _trials(DEMO, "noisy_Z")
    assert len(trials) == 6
    assert trials[0] == M.noisy_Z_pixels
    for t in trials[1:]:
        assert t == M.Z.tolist()


def test_a_cue_between_the_letters_goes_to_the_nearer_one():
    cue = np.asarray(M.A_over_Z_pixels)
    assert int((cue != M.A).sum()) == 10
    assert int((cue != M.Z).sum()) == 5
    for t in _trials(DEMO, "A_over_Z")[1:]:
        assert t == M.Z.tolist()


@pytest.fixture
def four_letters(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    source = path.read_text()
    assert "training_set = [A, Z]" in source
    path.write_text(source.replace("training_set = [A, Z]", "training_set = [A, Z, X, O]"))
    return path


def test_with_four_letters_the_noisy_z_settles_on_x_a_row_at_a_time(four_letters):
    trials = [np.asarray(t) for t in _trials(four_letters, "noisy_Z")]
    Z, X = M.Z, M.X
    rows = lambda v: v.reshape(5, 5)  # noqa: E731
    # Update 1: X's top row on a Z.
    assert (rows(trials[1])[0] == rows(X)[0]).all()
    assert (rows(trials[1])[1:] == rows(Z)[1:]).all()
    # Update 2: all X but the bottom row, which is still Z's.
    assert (rows(trials[2])[:4] == rows(X)[:4]).all()
    assert (rows(trials[2])[4] == rows(Z)[4]).all()
    # From update 3 on: X, a different memory.
    for t in trials[3:]:
        assert (t == X).all()
