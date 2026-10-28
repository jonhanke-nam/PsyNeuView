#!/usr/bin/env python3
"""Build the tutorial review book: every walkthrough step on one page (#1414).

For each step of each guided walkthrough (frontend/src/walkthroughs/*.yaml) the
book shows its screenshot, the instruction on the bar, the caption, the exact
words the narrator speaks (after the pronunciation dictionary), a player to
hear them, what the ring points at, and warnings worth a reviewer's eye.
Each step card has a stable id (``<walkthrough>--<step>``) so review comments
can name it.

Usage (from the repo root)::

    python3 scripts/tutorial-review-book.py --out /tmp/review-book
    python3 scripts/tutorial-review-book.py --out /tmp/review-book --only ego,td

Inputs it reads, all from the repo:

- the walkthroughs and ``pronunciations.yaml`` in ``frontend/src/walkthroughs/``;
- recorded narration, if the repo has any (``narration-manifest.json`` and
  ``frontend/public/narration/``, #1407);
- step screenshots, as the tutorial specs write them:
  ``docs/tutorials/assets/tour/<id>-step-N.png`` (``step-N.png`` for the
  demo) from ``tour-demo.tutorial.spec.ts``, and
  ``docs/tutorials/assets/orientation/<id>-step-N.png`` from
  ``orientation.tutorial.spec.ts`` (not committed; run that spec first to
  include them).

Without recordings, the book renders a preview of each step on macOS with
``say``, in the voice the app picks by default (Karen, else Daniel), at the
narration rate, with the dictionary's respellings applied. These previews go
only into the output folder; they are never committed. Elsewhere, or with
``--no-audio``, the book has no players.

Screenshots are shrunk to JPEG (``--shot-width``) with ``sips`` on macOS so the
book stays small enough to publish; elsewhere they are copied as PNG. Audio is
written as ``.mp4`` (AAC), which an Artifact can serve; ``.m4a`` it can't.
Needs Python 3 and PyYAML only.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
WALKTHROUGHS = Path("frontend/src/walkthroughs")
NARRATION = Path("frontend/public/narration")
SHOT_DIRS = (Path("docs/tutorials/assets/tour"), Path("docs/tutorials/assets/orientation"))

# A reader takes about 2.5 words a second. A narrator speaks faster (3.5–4.5);
# a recording faster than MAX_SPOKEN_RATE has lost words.
WORDS_PER_SECOND = 2.5
MAX_SPOKEN_RATE = 5.5
LONG_CAPTION_WORDS = 30

# The app's default narration voices, best first (GOOD_VOICES in
# frontend/src/utils/narration.ts), and its rate: NARRATION_RATE 0.95 of a
# typical 175 words a minute.
PREVIEW_VOICES = ("Karen", "Daniel")
PREVIEW_RATE_WPM = 166

# The same rule as trickyWords() in frontend/src/utils/pronunciation.ts.
TRICKY = re.compile(r"(?<![\w-])(?:[A-Z][A-Z0-9]+(?:[-_][A-Z0-9]+)*|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*)(?![\w-])")


# --------------------------------------------------------------------------
# Reading the walkthroughs


@dataclass
class Step:
    index: int
    id: str
    instruct: str
    say: str
    anchor: dict
    done: dict
    act: dict
    pointer: bool
    say_phonemes: str | None = None
    shot: Path | None = None
    recording: Path | None = None
    spoken: str | None = None
    audio_seconds: float | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class Walkthrough:
    id: str
    title: str
    group: str
    order: tuple
    minutes: int | None
    model: str | None
    course: str | None
    steps: list[Step]


def clean(text) -> str:
    """Folded YAML text as one line, the way the bar shows it."""
    return " ".join(str(text or "").split())


def group_of(raw: dict) -> tuple[str, tuple]:
    if raw.get("orientation") is not None or str(raw.get("id", "")).startswith("orientation-"):
        return "PsyNeuView First Steps", (0, float(raw.get("orientation") or 99))
    if raw.get("psyneulink") is not None:
        return "PsyNeuLink Tutorials", (2, int(raw["psyneulink"]))
    if raw.get("course") is not None:
        return "Cognitive Neuroscience Course", (3, tuple(int(p) for p in str(raw["course"]).split(".")))
    return "Getting started", (1, 0)


def load_walkthroughs(folder: Path) -> list[Walkthrough]:
    found = []
    for path in sorted(folder.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text()) or {}
        if not isinstance(raw, dict) or not raw.get("steps") or not raw.get("id"):
            continue  # pronunciations.yaml and anything else that isn't a walkthrough
        group, order = group_of(raw)
        steps = [
            Step(
                index=i,
                id=str(s.get("id", f"step-{i + 1}")),
                instruct=clean(s.get("instruct")),
                say=clean(s.get("say")),
                anchor=s.get("anchor") or {},
                done=s.get("done") or {},
                act=s.get("act") or {},
                pointer=bool(s.get("pointer")),
                say_phonemes=clean(s.get("say_phonemes")) or None,
            )
            for i, s in enumerate(raw["steps"])
        ]
        found.append(Walkthrough(
            id=str(raw["id"]), title=clean(raw.get("title")), group=group, order=order,
            minutes=raw.get("minutes"), model=raw.get("model"),
            course=str(raw["course"]) if raw.get("course") is not None else None, steps=steps,
        ))
    return sorted(found, key=lambda w: (w.order, w.id))


def load_dictionary(path: Path) -> tuple[list[dict], set[str]]:
    raw = yaml.safe_load(path.read_text()) if path.exists() else {}
    raw = raw or {}
    return list(raw.get("words") or []), set(raw.get("reads_fine") or [])


# --------------------------------------------------------------------------
# Matching steps to their screenshots, recordings and warnings


def screenshot_name(walkthrough_id: str, index: int) -> str:
    """The file a tutorial spec writes for step ``index`` (0-based)."""
    prefix = "" if walkthrough_id == "demo" else f"{walkthrough_id}-"
    return f"{prefix}step-{index + 1}.png"


def find_screenshot(root: Path, walkthrough_id: str, index: int) -> Path | None:
    name = screenshot_name(walkthrough_id, index)
    for folder in SHOT_DIRS:
        candidate = root / folder / name
        if candidate.exists():
            return candidate
    return None


def tricky_words(text: str) -> list[str]:
    return [m.group(0) for m in TRICKY.finditer(text)]


def spoken_text(text: str, words: list[dict]) -> str:
    """The text as a live voice reads it: each dictionary word respelt.

    The same rule as spokenText() in frontend/src/utils/pronunciation.ts:
    whole, case-sensitive words, longest first.
    """
    for w in sorted(words, key=lambda w: len(w["word"]), reverse=True):
        if w.get("say"):
            text = re.sub(rf"(?<![\w-]){re.escape(w['word'])}(?![\w-])", lambda _m, say=w["say"]: say, text)
    return text


def undecided_words(text: str, words: list[dict], reads_fine: set[str]) -> list[str]:
    known = {w["word"] for w in words} | reads_fine
    seen = []
    for w in tricky_words(text):
        if w not in known and w not in seen:
            seen.append(w)
    return seen


def audio_seconds(path: Path) -> float | None:
    """Duration from macOS ``afinfo``; None where it isn't available."""
    if not shutil.which("afinfo"):
        return None
    try:
        out = subprocess.run(["afinfo", str(path)], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"estimated duration:\s*([\d.]+)", out)
    return float(m.group(1)) if m else None


def attach(root: Path, walkthroughs: list[Walkthrough], manifest: dict, words: list[dict],
           reads_fine: set[str], measure_audio: bool = True) -> None:
    """Fill in each step's screenshot, spoken text, recording and warnings.

    With no manifest the repo has no recorded narration: the app reads the
    captions in the system voice, so a missing recording is not a warning.
    """
    for w in walkthroughs:
        for s in w.steps:
            s.shot = find_screenshot(root, w.id, s.index)
            entry = manifest.get(f"{w.id}/{s.id}")
            s.spoken = entry.get("spoken") if entry else (spoken_text(narrated(s), words) or None)
            if entry:
                rec = root / NARRATION / entry["file"]
                s.recording = rec if rec.exists() else None
            if s.recording and measure_audio:
                s.audio_seconds = audio_seconds(s.recording)
            s.warnings = step_warnings(s, entry, words, reads_fine, recorded=bool(manifest))


def narrated(s: Step) -> str:
    """What the narrator reads: the caption, or the instruction when there is none."""
    return s.say or s.instruct


def step_warnings(s: Step, entry: dict | None, words: list[dict], reads_fine: set[str],
                  recorded: bool = True) -> list[str]:
    out = []
    text = narrated(s)
    if not s.say:
        out.append("No caption: the narrator reads the whole instruction." if s.instruct
                   else "No caption or instruction: nothing is narrated.")
    if text and entry is None and recorded:
        out.append("No recording: narration falls back to the system voice.")
    elif entry is not None:
        if clean(entry.get("text")) != text:
            out.append("Recording is stale: the text changed since it was recorded.")
        if s.recording is None:
            out.append(f"Recording file is missing: {entry.get('file')}.")
    if s.shot is None:
        out.append("No screenshot for this step.")
    if not s.anchor:
        out.append("No anchor: the ring has nothing to point at.")
    unknown = undecided_words(text, words, reads_fine)
    if unknown:
        out.append("Not in the pronunciation dictionary: " + ", ".join(unknown) + ".")
    n_words = len(text.split())
    if n_words > LONG_CAPTION_WORDS:
        out.append(f"Long narration: {n_words} words.")
    if s.audio_seconds and n_words / s.audio_seconds > MAX_SPOKEN_RATE:
        out.append("The recording is too short for its text; words may be missing.")
    return out


# --------------------------------------------------------------------------
# Writing the book


def copy_assets(walkthroughs: list[Walkthrough], out: Path, shot_width: int) -> None:
    shots = out / "shots"
    audio = out / "audio"
    shots.mkdir(parents=True, exist_ok=True)
    can_shrink = bool(shutil.which("sips")) and shot_width > 0
    for w in walkthroughs:
        for s in w.steps:
            if s.shot:
                dest = shots / (f"{w.id}--{s.id}.jpg" if can_shrink else f"{w.id}--{s.id}.png")
                if can_shrink:
                    subprocess.run(
                        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "72",
                         "--resampleWidth", str(shot_width), str(s.shot), "--out", str(dest)],
                        capture_output=True, check=True,
                    )
                else:
                    shutil.copyfile(s.shot, dest)
                s.shot = dest.relative_to(out)
            if s.recording:
                # Same AAC audio; .mp4 because an Artifact won't serve .m4a.
                dest = audio / w.id / (s.recording.stem + ".mp4")
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(s.recording, dest)
                s.recording = dest.relative_to(out)


def pick_preview_voice(installed: list[str]) -> str | None:
    """The voice the app would pick among the standard ones; None for the system default."""
    for name in PREVIEW_VOICES:
        if name in installed:
            return name
    return None


def installed_voices() -> list[str]:
    try:
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.split("  ")[0].strip() for line in out.splitlines() if line.strip()]


def render_previews(walkthroughs: list[Walkthrough], out: Path, voice: str | None,
                    rate: int = PREVIEW_RATE_WPM) -> int:
    """Speak each unrecorded step with macOS ``say`` into ``out/audio`` as AAC .mp4.

    Returns how many were made. Needs ``say`` and ``afconvert`` (macOS).
    """
    if not (shutil.which("say") and shutil.which("afconvert")):
        return 0
    made = 0
    with tempfile.TemporaryDirectory() as tmp:
        for w in walkthroughs:
            for s in w.steps:
                if s.recording or not s.spoken:
                    continue
                aiff = Path(tmp) / "step.aiff"
                dest = out / "audio" / w.id / f"{s.id}.mp4"
                dest.parent.mkdir(parents=True, exist_ok=True)
                cmd = ["say", "-r", str(rate), "-o", str(aiff)] + (["-v", voice] if voice else [])
                # [[ ]] phoneme markup is for recordings only; a live voice reads plain text.
                text = re.sub(r"\[\[.*?\]\]", "", s.spoken)
                try:
                    subprocess.run(cmd + ["--", text], capture_output=True, check=True, timeout=120)
                    subprocess.run(["afconvert", "-f", "mp4f", "-d", "aac", "-b", "48000", str(aiff), str(dest)],
                                   capture_output=True, check=True, timeout=120)
                except (OSError, subprocess.SubprocessError):
                    continue
                s.recording = dest.relative_to(out)
                s.audio_seconds = audio_seconds(dest)
                made += 1
    return made


def e(text) -> str:
    return html.escape(str(text), quote=True)


def spoken_html(spoken: str, caption: str, words: list[dict]) -> str:
    """The spoken words, with respellings and phoneme markup marked."""
    out = e(spoken)
    out = re.sub(r"\[\[(.*?)\]\]", lambda m: f'<mark class="ph" title="phonemes">[[{m.group(1)}]]</mark>', out)
    for w in words:
        if w["word"] in caption and w.get("say") and w["say"] != w["word"]:
            out = re.sub(rf"(?<![\w-]){re.escape(e(w['say']))}(?![\w-])",
                         lambda m, word=w["word"]: f'<mark title="said for {e(word)}">{m.group(0)}</mark>', out)
    return out


def fmt_seconds(seconds: float | None) -> str:
    return "" if seconds is None else f"{seconds:.1f} s"


def anchor_text(anchor: dict) -> str:
    if "testid" in anchor:
        return f"testid {anchor['testid']}"
    if "node" in anchor:
        return f"node {anchor['node']}"
    return ", ".join(f"{k} {v}" for k, v in anchor.items()) or "none"


def step_card(w: Walkthrough, s: Step, words: list[dict]) -> str:
    card_id = f"{w.id}--{s.id}"
    shot = (f'<button class="shot" type="button" data-full="{e(s.shot)}" aria-label="Enlarge screenshot of step {s.index + 1}">'
            f'<img src="{e(s.shot)}" alt="Step {s.index + 1} of {e(w.title)}" loading="lazy" width="1200" height="750"></button>'
            if s.shot else '<div class="shot missing">No screenshot</div>')
    read_s = len(narrated(s).split()) / WORDS_PER_SECOND if narrated(s) else None
    timing = []
    if read_s:
        timing.append(f"reads in ~{read_s:.1f} s")
    if s.audio_seconds:
        timing.append(f"audio {fmt_seconds(s.audio_seconds)}")
    parts = [
        f'<article class="step" id="{e(card_id)}">',
        shot,
        '<div class="text">',
        f'<p class="label"><span class="num">Step {s.index + 1}</span> <code>{e(card_id)}</code></p>',
        f'<p class="instruct">{e(s.instruct) if s.instruct else "<span class=dim>No instruction text</span>"}</p>',
        f'<p class="caption">{e(s.say)}</p>' if s.say else '<p class="caption dim">No caption: the instruction is narrated.</p>',
    ]
    if s.spoken:
        parts.append(f'<p class="spoken"><span class="k">Spoken</span> {spoken_html(s.spoken, narrated(s), words)}</p>')
    if s.recording:
        parts.append(f'<audio controls preload="none" src="{e(s.recording)}"></audio>')
    meta = [f"<dt>Ring</dt><dd>{e(anchor_text(s.anchor))}{' · pointer' if s.pointer else ''}</dd>"]
    if s.done:
        meta.append(f"<dt>Done when</dt><dd>{e(', '.join(f'{k} {v}' for k, v in s.done.items()))}</dd>")
    if s.act:
        meta.append(f"<dt>Does</dt><dd>{e(', '.join(f'{k} {v}' for k, v in s.act.items()))}</dd>")
    if timing:
        meta.append(f"<dt>Timing</dt><dd>{e(' · '.join(timing))}</dd>")
    parts.append(f'<dl class="meta">{"".join(meta)}</dl>')
    if s.warnings:
        parts.append('<ul class="warn">' + "".join(f"<li>{e(x)}</li>" for x in s.warnings) + "</ul>")
    parts.append("</div></article>")
    return "\n".join(p for p in parts if p)


CSS = """
:root{--ground:#F5F7FA;--surface:#FFFFFF;--ink:#18202C;--muted:#5A6577;--line:#DCE2EA;
--accent:#2E6DB0;--accent-tint:#E6EEF8;--warn:#9A4416;--warn-tint:#FBEEE4;--mark:#FFF1B8;
--font:"IBM Plex Sans",-apple-system,"Segoe UI",Roboto,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#11151C;--surface:#1A1F28;--ink:#E4E9F0;
--muted:#9BA6B7;--line:#2C3440;--accent:#84B4E8;--accent-tint:#1C2A3B;--warn:#E9A06B;--warn-tint:#33231A;--mark:#4A3F12;color-scheme:dark}}
:root[data-theme="dark"]{--ground:#11151C;--surface:#1A1F28;--ink:#E4E9F0;--muted:#9BA6B7;--line:#2C3440;
--accent:#84B4E8;--accent-tint:#1C2A3B;--warn:#E9A06B;--warn-tint:#33231A;--mark:#4A3F12;color-scheme:dark}
body{background:var(--ground);color:var(--ink);font:15px/1.5 var(--font);padding-inline:16px}
.wrap{max-width:1240px;margin:0 auto;display:grid;grid-template-columns:230px minmax(0,1fr);gap:32px;padding-block:24px 64px}
header.top{grid-column:1/-1;display:grid;gap:4px}
h1{font-size:26px;font-weight:600;margin:0;text-wrap:balance}
.sub{color:var(--muted);margin:0;max-width:70ch}
nav{position:sticky;top:calc(env(safe-area-inset-top,0px) + 16px);align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:13px}
nav h2{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 4px;font-weight:600}
nav a{display:flex;justify-content:space-between;gap:8px;padding:3px 6px;border-radius:4px;color:var(--ink);text-decoration:none}
nav a:hover,nav a:focus-visible{background:var(--accent-tint)}
nav .n{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
nav .w{color:var(--warn)}
main{display:grid;gap:48px;min-width:0}
section.wt>header{display:grid;gap:2px;margin-bottom:16px;border-bottom:1px solid var(--line);padding-bottom:10px}
section.wt h2{font-size:21px;font-weight:600;margin:0;text-wrap:balance}
.facts{color:var(--muted);font-size:13px;margin:0;font-variant-numeric:tabular-nums}
.steps{display:grid;gap:16px}
.step{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:20px;background:var(--surface);
border:1px solid var(--line);border-radius:6px;padding:16px;scroll-margin-top:16px}
.step:target{outline:2px solid var(--accent);outline-offset:2px}
.shot{display:block;padding:0;border:1px solid var(--line);border-radius:4px;background:var(--ground);cursor:zoom-in;overflow:hidden}
.shot img{display:block;width:100%;height:auto}
.shot.missing{display:grid;place-items:center;min-height:140px;color:var(--muted);cursor:default;font-size:13px}
.text{display:grid;gap:8px;align-content:start;min-width:0}
.label{margin:0;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.num{font-weight:600}
code{font-family:var(--mono);font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.instruct{margin:0}
.caption{margin:0;font-style:italic;color:var(--accent)}
.spoken{margin:0;font-family:var(--mono);font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.spoken .k{font-family:var(--font);font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}
mark{background:var(--mark);color:var(--ink);border-radius:2px;padding:0 2px}
audio{width:100%;max-width:360px;height:32px}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0;font-size:13px}
.meta dt{color:var(--muted)}.meta dd{margin:0;overflow-wrap:anywhere}
.warn{margin:0;padding:8px 12px 8px 28px;background:var(--warn-tint);color:var(--warn);border-radius:4px;font-size:13px}
.dim{color:var(--muted)}
.box{position:fixed;inset:0;background:rgba(10,14,20,.86);display:grid;place-items:center;padding:16px;z-index:10;cursor:zoom-out}
.box img{max-height:100%;max-width:100%;border-radius:4px}
@media (max-width:860px){.wrap{grid-template-columns:1fr}nav{position:static;max-height:none}.step{grid-template-columns:1fr}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
"""

SCRIPT = """
document.addEventListener('click',function(ev){var b=ev.target.closest('.shot[data-full]');if(!b)return;
var box=document.createElement('div');box.className='box';var img=document.createElement('img');img.src=b.dataset.full;img.alt='';
box.appendChild(img);box.tabIndex=-1;box.addEventListener('click',function(){box.remove();b.focus();});
box.addEventListener('keydown',function(k){if(k.key==='Escape'){box.remove();b.focus();}});document.body.appendChild(box);box.focus();});
"""


def render(walkthroughs: list[Walkthrough], words: list[dict], generated_from: str,
           audio_note: str = "") -> str:
    total_steps = sum(len(w.steps) for w in walkthroughs)
    total_warn = sum(len(s.warnings) for w in walkthroughs for s in w.steps)
    nav, sections, group = [], [], None
    for w in walkthroughs:
        if w.group != group:
            group = w.group
            nav.append(f"<h2>{e(group)}</h2>")
        n_warn = sum(1 for s in w.steps if s.warnings)
        label = f"{w.course} · {w.title}" if w.course else w.title
        warn = f' <span class="w">⚠{n_warn}</span>' if n_warn else ""
        nav.append(f'<a href="#{e(w.id)}"><span>{e(label)}</span><span class="n">{len(w.steps)}{warn}</span></a>')
        audio = sum(s.audio_seconds or 0 for s in w.steps)
        facts = [f"{len(w.steps)} steps"]
        if w.minutes:
            facts.append(f"~{w.minutes} min")
        if audio:
            facts.append(f"{audio:.0f} s of narration")
        if w.model:
            facts.append(f"model: {w.model}")
        facts.append(f"id {w.id}")
        cards = "\n".join(step_card(w, s, words) for s in w.steps)
        sections.append(
            f'<section class="wt" id="{e(w.id)}"><header><h2>{e(label)}</h2>'
            f'<p class="facts">{e(" · ".join(facts))}</p></header><div class="steps">{cards}</div></section>'
        )
    return f"""<title>Walkthrough Review Book</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap">
<style>{CSS}</style>
<div class="wrap">
<header class="top"><h1>Walkthrough Review Book</h1>
<p class="sub">Every step of PsyNeuView's {len(walkthroughs)} guided walkthroughs: the screenshot, the text on the bar, the caption, and the words the narrator speaks. {total_steps} steps, {total_warn} warnings. {e(audio_note)} Comment on a step by its id. Generated from {e(generated_from)}.</p></header>
<nav aria-label="Walkthroughs">{"".join(nav)}</nav>
<main>{"".join(sections)}</main>
</div>
<script>{SCRIPT}</script>
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=Path(tempfile.gettempdir()) / "tutorial-review-book",
                    help="output folder (default: a folder in the system temp dir)")
    ap.add_argument("--only", help="comma-separated walkthrough ids")
    ap.add_argument("--shot-width", type=int, default=1200, help="JPEG width for screenshots; 0 keeps PNG")
    ap.add_argument("--repo", type=Path, default=REPO)
    ap.add_argument("--no-audio", action="store_true", help="no audio players (skip recordings and previews)")
    ap.add_argument("--voice", help="macOS voice for previews (default: Karen, else Daniel, else the system voice)")
    args = ap.parse_args(argv)

    root = args.repo
    walkthroughs = load_walkthroughs(root / WALKTHROUGHS)
    if args.only:
        wanted = set(args.only.split(","))
        walkthroughs = [w for w in walkthroughs if w.id in wanted]
    words, reads_fine = load_dictionary(root / WALKTHROUGHS / "pronunciations.yaml")
    manifest_path = root / WALKTHROUGHS / "narration-manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    attach(root, walkthroughs, manifest, words, reads_fine)
    if args.no_audio:
        for w in walkthroughs:
            for s in w.steps:
                s.recording, s.audio_seconds = None, None

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    copy_assets(walkthroughs, args.out, args.shot_width)
    audio_note = "Audio: the recorded narration." if manifest and not args.no_audio else ""
    if not args.no_audio:
        voice = args.voice or pick_preview_voice(installed_voices())
        made = render_previews(walkthroughs, args.out, voice)
        if made:
            audio_note = (f"Audio: a preview in the {voice or 'system'} voice, as the app reads captions by default"
                          + (" (steps without a recording)." if manifest else "."))
        elif not manifest:
            audio_note = "No audio: previews need macOS (say and afconvert)."
    try:
        rev = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
    except OSError:
        rev = ""
    (args.out / "index.html").write_text(
        render(walkthroughs, words, f"commit {rev}" if rev else "the working tree", audio_note))

    steps = sum(len(w.steps) for w in walkthroughs)
    print(f"{len(walkthroughs)} walkthroughs, {steps} steps → {args.out / 'index.html'}")
    for w in walkthroughs:
        shots = sum(1 for s in w.steps if s.shot)
        recs = sum(1 for s in w.steps if s.recording)
        warns = sum(len(s.warnings) for s in w.steps)
        print(f"  {w.id:24} steps {len(w.steps):2}  screenshots {shots:2}  audio {recs:2}  warnings {warns}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
