"""Tests for /video_audio: which way a file is downloaded, ffmpeg progress parsing,
and one real probe + transcode of a generated clip (skipped without ffmpeg).

Runnable two ways:
  * pytest tests/test_video_audio.py
  * python tests/test_video_audio.py     (no pytest needed — a tiny runner at the end)
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.tools.video_audio import (  # noqa: E402
    FFMPEG,
    _probe,
    _transcode,
    download_route,
    parse_progress_seconds,
    video_in,
)

MB = 1024 * 1024


def test_small_files_use_the_bot_api():
    assert download_route(5 * MB, mtproto_ready=False) == "bot_api"
    assert download_route(20 * MB, mtproto_ready=True) == "bot_api"


def test_unknown_size_tries_the_bot_api():
    assert download_route(None, mtproto_ready=False) == "bot_api"


def test_over_20_mb_needs_mtproto():
    assert download_route(20 * MB + 1, mtproto_ready=True) == "mtproto"
    assert download_route(60 * MB, mtproto_ready=False) == "needs_setup"


def test_over_100_mb_is_refused_either_way():
    assert download_route(100 * MB + 1, mtproto_ready=True) == "too_big"
    assert download_route(100 * MB + 1, mtproto_ready=False) == "too_big"
    assert download_route(100 * MB, mtproto_ready=True) == "mtproto"


def test_progress_lines():
    assert parse_progress_seconds("out_time_us=12500000\n") == 12.5
    assert parse_progress_seconds("out_time_ms=3000000") == 3.0
    assert parse_progress_seconds("out_time_us=N/A") is None
    assert parse_progress_seconds("progress=continue") is None


def _message(**fields):
    base = {"video": None, "video_note": None, "document": None}
    base.update(fields)
    return SimpleNamespace(**base)


def test_video_in_recognises_each_kind():
    video = SimpleNamespace(file_name="trip.mp4")
    assert video_in(_message(video=video)) == (video, "trip.mp4")

    note = SimpleNamespace()
    assert video_in(_message(video_note=note)) == (note, "video note")

    as_file = SimpleNamespace(mime_type="video/x-matroska", file_name="talk.mkv")
    assert video_in(_message(document=as_file)) == (as_file, "talk.mkv")


def test_video_in_ignores_other_documents():
    pdf = SimpleNamespace(mime_type="application/pdf", file_name="a.pdf")
    assert video_in(_message(document=pdf)) is None
    assert video_in(_message()) is None


def _have_ffmpeg() -> bool:
    return Path(FFMPEG).exists()


def _make_clip(path: Path, *, audio: bool) -> None:
    args = [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25"]
    if audio:
        args += ["-f", "lavfi", "-i", "sine=frequency=440"]
    args += ["-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        args += ["-c:a", "aac", "-shortest"]
    # ffmpeg picks the container from the extension; the bot's own download is
    # extensionless ("source"), which ffmpeg reads fine, so rename to match it.
    clip = path.with_suffix(".mp4")
    subprocess.run([*args, str(clip)], check=True)
    clip.rename(path)


def test_probe_and_transcode_a_real_clip():
    if not _have_ffmpeg():
        print("      (skipped: no ffmpeg)")
        return
    with tempfile.TemporaryDirectory() as tmp:
        source, target = Path(tmp) / "source", Path(tmp) / "audio.mp3"
        _make_clip(source, audio=True)

        duration, has_audio = asyncio.run(_probe(source))
        assert has_audio
        assert 3.5 < duration < 4.5, duration

        state = {"percent": 0.0}
        asyncio.run(_transcode(source, target, 128, duration, state))
        assert target.stat().st_size > 10_000
        assert state["percent"] > 90, state
        out_duration, out_audio = asyncio.run(_probe(target))
        assert out_audio and 3.5 < out_duration < 4.5


def test_probe_spots_a_silent_video():
    if not _have_ffmpeg():
        print("      (skipped: no ffmpeg)")
        return
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source"
        _make_clip(source, audio=False)
        _, has_audio = asyncio.run(_probe(source))
        assert not has_audio


def _main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  ok  {test.__name__}")
        except AssertionError as error:
            failed += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
