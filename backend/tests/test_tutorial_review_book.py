"""The tutorial review book matches steps to their assets and flags what a reviewer should see (#1414)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "tutorial-review-book.py"
spec = importlib.util.spec_from_file_location("tutorial_review_book", SCRIPT)
book = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = book  # its dataclasses look themselves up there
spec.loader.exec_module(book)


@pytest.fixture
def repo(tmp_path):
    """A tiny repo: one course walkthrough with three steps, a dictionary and a manifest."""
    walk = tmp_path / book.WALKTHROUGHS
    walk.mkdir(parents=True)
    (walk / "toy.yaml").write_text(
        "id: toy\ntitle: Toy model\ncourse: \"1.2\"\nsteps:\n"
        "  - id: open\n    anchor: {testid: open-menu}\n    instruct: Open it.\n    say: Open the EGO model.\n"
        "  - id: look\n    anchor: {node: STATE}\n    instruct: Look at STATE.\n    say: The GRU layer remembers.\n"
        "  - id: quiet\n    instruct: No caption here.\n"
    )
    (walk / "pronunciations.yaml").write_text(
        "words:\n  - word: EGO\n    say: Ego\n    phonemes: ˈiːɡoʊ\nreads_fine: [STATE]\n"
    )
    (walk / "narration-manifest.json").write_text(json.dumps({
        "toy/open": {"text": "Open the EGO model.", "spoken": "Open the [[ ˈiːɡoʊ ]] model.", "file": "toy/open.m4a"},
        "toy/look": {"text": "An older caption.", "spoken": "An older caption.", "file": "toy/look.m4a"},
    }))
    rec = tmp_path / book.NARRATION / "toy"
    rec.mkdir(parents=True)
    (rec / "open.m4a").write_bytes(b"x")  # look.m4a is missing on purpose
    shots = tmp_path / book.SHOT_DIRS[0]
    shots.mkdir(parents=True)
    (shots / "toy-step-1.png").write_bytes(b"x")
    return tmp_path


def built(repo):
    walkthroughs = book.load_walkthroughs(repo / book.WALKTHROUGHS)
    words, reads_fine = book.load_dictionary(repo / book.WALKTHROUGHS / "pronunciations.yaml")
    manifest = json.loads((repo / book.WALKTHROUGHS / "narration-manifest.json").read_text())
    book.attach(repo, walkthroughs, manifest, words, reads_fine, measure_audio=False)
    return walkthroughs


def test_only_walkthroughs_are_loaded_and_grouped(repo):
    walkthroughs = built(repo)
    assert [w.id for w in walkthroughs] == ["toy"]  # pronunciations.yaml is not a walkthrough
    assert walkthroughs[0].group == "Cognitive Neuroscience Course"


def test_screenshot_names_follow_the_specs():
    assert book.screenshot_name("ego", 0) == "ego-step-1.png"
    assert book.screenshot_name("demo", 1) == "step-2.png"  # tour-demo's first walkthrough has no prefix


def test_steps_find_their_screenshot_and_recording(repo):
    first, second, third = built(repo)[0].steps
    assert first.shot and first.shot.name == "toy-step-1.png"
    assert first.recording and first.recording.name == "open.m4a"
    assert first.warnings == []
    assert second.shot is None and second.recording is None


def test_warnings_name_what_a_reviewer_should_check(repo):
    _, second, third = built(repo)[0].steps
    joined = " ".join(second.warnings)
    assert "stale" in joined
    assert "missing" in joined
    assert "No screenshot" in joined
    assert "GRU" in joined  # not in the dictionary, and not listed as reading fine
    assert "STATE" not in joined.split("dictionary:")[-1]
    assert any("narrator reads the whole instruction" in w for w in third.warnings)
    assert any("No recording" in w for w in third.warnings)
    assert any("No anchor" in w for w in third.warnings)


def test_tricky_words_match_the_frontend_rule():
    # Same regex as trickyWords() in pronunciation.ts, which (like it) passes
    # over a leading-acronym name such as EMComposition.
    assert book.tricky_words("Open PsyNeuLink, then the EMComposition and DDM; ISC-CI too.") == [
        "PsyNeuLink", "DDM", "ISC-CI",
    ]


def test_the_page_marks_respellings_and_gives_each_step_an_id(repo, tmp_path):
    walkthroughs = built(repo)
    words, _ = book.load_dictionary(repo / book.WALKTHROUGHS / "pronunciations.yaml")
    page = book.render(walkthroughs, words, "a test")
    assert 'id="toy--open"' in page and 'id="toy--look"' in page
    assert '<mark class="ph"' in page
    assert "<title>Walkthrough Review Book</title>" in page


def test_a_recording_too_short_for_its_caption_is_flagged(repo):
    words, reads_fine = book.load_dictionary(repo / book.WALKTHROUGHS / "pronunciations.yaml")
    step = built(repo)[0].steps[0]
    step.audio_seconds = 1.6  # "Open the EGO model." is 4 words: 2.5 a second, fine
    assert not any("too short" in w for w in book.step_warnings(step, {"text": step.say, "file": "x"}, words, reads_fine))
    step.audio_seconds = 0.5  # 8 words a second: words are missing
    assert any("too short" in w for w in book.step_warnings(step, {"text": step.say, "file": "x"}, words, reads_fine))


def test_a_step_without_caption_is_checked_against_its_instruction(repo):
    words, reads_fine = book.load_dictionary(repo / book.WALKTHROUGHS / "pronunciations.yaml")
    third = built(repo)[0].steps[2]
    fresh = {"text": "No caption here.", "file": "toy/quiet.m4a"}
    assert not any("stale" in w for w in book.step_warnings(third, fresh, words, reads_fine))


def test_spoken_text_respells_whole_words_longest_first():
    words = [{"word": "EGO", "say": "Ego"}, {"word": "PsyNeuLink", "say": "Sigh-new-link"},
             {"word": "Psy", "say": "Sigh"}]
    assert book.spoken_text("Open EGO in PsyNeuLink, not EGOS.", words) == "Open Ego in Sigh-new-link, not EGOS."


def test_without_recordings_nothing_is_flagged_as_unrecorded(repo):
    """devel has no recorded narration: the app reads captions in the system voice."""
    (repo / book.WALKTHROUGHS / "narration-manifest.json").unlink()
    walkthroughs = book.load_walkthroughs(repo / book.WALKTHROUGHS)
    words, reads_fine = book.load_dictionary(repo / book.WALKTHROUGHS / "pronunciations.yaml")
    book.attach(repo, walkthroughs, {}, words, reads_fine, measure_audio=False)
    first, second, third = walkthroughs[0].steps
    assert first.spoken == "Open the Ego model."  # respelt, as a live voice reads it
    assert first.recording is None
    everything = " ".join(x for s in walkthroughs[0].steps for x in s.warnings)
    assert "No recording" not in everything and "stale" not in everything
    assert "GRU" in " ".join(second.warnings)  # the other checks still run
    assert any("narrator reads the whole instruction" in w for w in third.warnings)


def test_previews_use_the_apps_default_voice():
    assert book.pick_preview_voice(["Albert", "Daniel", "Karen", "Samantha"]) == "Karen"
    assert book.pick_preview_voice(["Daniel", "Samantha"]) == "Daniel"
    assert book.pick_preview_voice(["Samantha"]) is None  # the system default


def test_no_previews_without_macos_tools(repo, tmp_path, monkeypatch):
    monkeypatch.setattr(book.shutil, "which", lambda _name: None)
    walkthroughs = built(repo)
    assert book.render_previews(walkthroughs, tmp_path / "out", "Karen") == 0
