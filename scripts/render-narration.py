"""Render the recorded narration clips (#159).

Reads, on stdin, the clips the app needs (``npm run narration:list``: each
one's voice, file and words) and makes each missing one with Kokoro, a free
voice model (Apache 2.0) run on this computer: no account, no key. Clips
already there are kept, and clips no caption needs any more are removed, so
the folder always matches the captions. Run from ``frontend/``::

    npm run narration:render

The model (about 350 MB) is downloaded once, to ``~/.psyneuview/kokoro`` or
``$PSYNEUVIEW_KOKORO_DIR``, and checked against its known hash. Clips are AAC
in an .m4a file, made with macOS's ``afconvert`` (or ``ffmpeg`` elsewhere).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
# Kokoro's own pace; Settings' speaking rate is applied when a clip plays.
SPEED = 1.0
BITRATE = "40000"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def model_dir() -> Path:
    """The model files, downloaded and checked the first time."""
    folder = Path(os.environ.get("PSYNEUVIEW_KOKORO_DIR", Path.home() / ".psyneuview" / "kokoro"))
    folder.mkdir(parents=True, exist_ok=True)
    for name, expected in MODEL_FILES.items():
        path = folder / name
        if path.exists() and sha256(path) == expected:
            continue
        print(f"Downloading {name} …", file=sys.stderr)
        part = path.with_suffix(path.suffix + ".part")
        # curl, not urllib: some Python installs on macOS have no CA certificates.
        if shutil.which("curl"):
            subprocess.run(["curl", "-fsSL", "-o", str(part), MODEL_URL + name], check=True)
        else:
            urllib.request.urlretrieve(MODEL_URL + name, part)
        if sha256(part) != expected:
            part.unlink()
            sys.exit(f"{name}: the download does not match its known hash; not using it.")
        part.replace(path)
    return folder


def to_aac(wav: Path, out: Path) -> None:
    if shutil.which("afconvert"):
        cmd = ["afconvert", "-f", "m4af", "-d", "aac", "-b", BITRATE, str(wav), str(out)]
    elif shutil.which("ffmpeg"):
        cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", BITRATE, str(out)]
    else:
        sys.exit("Needs afconvert (macOS) or ffmpeg to make the .m4a clips.")
    subprocess.run(cmd, check=True)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: render-narration.py OUT_DIR < clips.json")
    out_dir = Path(sys.argv[1])
    clips = json.load(sys.stdin)

    wanted = {clip["file"] for clip in clips}
    voices = {clip["voice"] for clip in clips}
    removed = 0
    for voice in voices:
        for old in (out_dir / voice).glob("*.m4a"):
            if f"{voice}/{old.name}" not in wanted:
                old.unlink()
                removed += 1

    missing = [clip for clip in clips if not (out_dir / clip["file"]).exists()]
    print(f"{len(clips)} clips: {len(missing)} to make, {removed} no longer needed removed.", file=sys.stderr)
    if not missing:
        return

    import soundfile
    from kokoro_onnx import Kokoro

    folder = model_dir()
    kokoro = Kokoro(str(folder / "kokoro-v1.0.onnx"), str(folder / "voices-v1.0.bin"))
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        for n, clip in enumerate(missing, 1):
            samples, rate = kokoro.create(clip["words"], voice=clip["kokoro"], speed=SPEED, lang="en-us")
            soundfile.write(wav, samples, rate)
            out = out_dir / clip["file"]
            out.parent.mkdir(parents=True, exist_ok=True)
            to_aac(wav, out)
            print(f"[{n}/{len(missing)}] {clip['file']}", file=sys.stderr)


if __name__ == "__main__":
    main()
