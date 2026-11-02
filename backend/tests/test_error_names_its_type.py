"""An error from a model names its exception type, and its line (#165).

The show_graph tab showed only ``'TD_Learning_Figure_5A'``: a KeyError's text
is just the key, and the worker reported ``str(e)``.
"""

import json

from app.services import sandbox_worker as worker

RAISES = '''
lookup = {}
value = lookup["missing"]
'''


def test_a_key_error_names_its_type():
    assert worker.exception_text(KeyError("TD_Learning_Figure_5A")) == "KeyError: 'TD_Learning_Figure_5A'"


def test_an_exception_without_a_message_is_its_type():
    assert worker.exception_text(StopIteration()) == "StopIteration"


def test_the_model_file_and_its_line_are_named(tmp_path):
    path = tmp_path / "raises.py"
    path.write_text(RAISES)
    try:
        exec(compile(RAISES, str(path), "exec"), {})
    except KeyError as e:
        text = worker.exception_text(e, str(path))
    assert text == "The model file raised KeyError: 'missing' (line 3)"


def test_a_task_that_fails_says_what_and_where(tmp_path):
    """Through the worker, as the page's show_graph request goes."""
    path = tmp_path / "raises.py"
    path.write_text(RAISES)
    out = json.loads(worker._handle_one_task(json.dumps({
        "task": "show_graph",
        "params": {"file_path": str(path), "composition_name": "c", "options": {}, "format": "dot"},
    })))
    assert "KeyError" in out["error"], out["error"]
    assert "line 3" in out["error"], out["error"]
