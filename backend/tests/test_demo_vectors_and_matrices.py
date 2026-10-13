"""The Vectors and Matrices demo computes what the course's walkthrough says (#45).

The walkthrough has the learner check vector_c by hand: the notebook's b gives
[50, 122], its B gives the columns of A B, the identity gives the weights back,
changing one weight from 1 to 10 moves only the first output (to 113), and
slope 2 on vector_b doubles everything. This pins those numbers, running the
demo the way the app does, and makes the two edits the way the Inspector does,
so a PsyNeuLink change, or a writer that breaks the multi-line matrix, fails
here by name.
"""

import shutil
from pathlib import Path

import numpy as np
import pytest

from app.services.executor import run_model
from app.services.file_writer import apply_parameter_change
from app.services.model_dirs import _format_label

DEMO = Path(__file__).parent.parent / "demos" / "vectors_and_matrices.py"
IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def _outputs(path, rows):
    result = run_model(str(path), "vectors_and_matrices", {"vector_b": rows}, use_sandbox=False)
    assert "error" not in result, result
    return [np.asarray(t["output"], dtype=float).ravel().tolist() for t in result["results"]]


def test_the_menu_calls_it_vectors_and_matrices():
    # The walkthrough opens it by this label.
    assert _format_label(DEMO.stem) == "Vectors and Matrices"


def test_a_times_b_is_50_and_122():
    assert _outputs(DEMO, [[7, 8, 9]]) == [[50, 122]]


def test_two_trials_are_the_columns_of_a_times_b():
    assert _outputs(DEMO, [[7, 8, 9], [10, 11, 12]]) == [[50, 122], [68, 167]]


def test_the_identity_gives_the_weights_back_a_row_at_a_time():
    assert _outputs(DEMO, IDENTITY) == [[1, 4], [2, 5], [3, 6]]


@pytest.fixture
def copy(tmp_path):
    path = tmp_path / DEMO.name
    shutil.copy(DEMO, path)
    return path


def test_one_weight_changed_moves_only_the_first_output(copy):
    # The Inspector's "Projection Parameters" row, over a matrix written
    # across three lines.
    apply_parameter_change(str(copy), "matrix_A", "matrix", "[[10,4],[2,5],[3,6]]", "mechanism")
    assert "[[10,4],[2,5],[3,6]]" in copy.read_text()
    assert _outputs(copy, [[7, 8, 9]]) == [[113, 122]]


def test_slope_two_doubles_every_number(copy):
    apply_parameter_change(str(copy), "matrix_A", "matrix", "[[10,4],[2,5],[3,6]]", "mechanism")
    apply_parameter_change(str(copy), "vector_b", "slope", "2", "function")
    assert _outputs(copy, IDENTITY) == [[20, 8], [4, 10], [6, 12]]
