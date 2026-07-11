"""/youtube_audio — prompt for a YouTube link, return its audio."""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import yt_dlp
from telegram import Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

log = logging.getLogger(__name__)

AWAITING_KEY = "awaiting"
AWAITING_YOUTUBE_URL = "youtube_audio_url"
JOB_RUNNING_KEY = "youtube_audio_running"

# Telegram refuses bot uploads over 50 MB, so anything above this cannot be
# delivered no matter how well the conversion goes.
MAX_UPLOAD_BYTES = 49 * 1024 * 1024

# Aim below the hard limit: the estimate below is bitrate x duration, which ignores
# the container and ID3 tags, and a file that lands at 49.5 MB is a wasted transcode.
SIZE_BUDGET_BYTES = 45 * 1024 * 1024

# Rather than refuse long videos, drop quality until they fit. Speech survives 64
# kbps mono perfectly well, so a 3-hour talk is still deliverable.
BITRATE_LADDER_KBPS = (192, 160, 128, 96, 64, 48, 32)

# Below this, mono buys more quality per bit than stereo does.
MONO_AT_OR_BELOW_KBPS = 64

# Used when the video reports no duration; the post-conversion size check is the
# backstop if the guess turns out too generous.
FALLBACK_BITRATE_KBPS = 128


def estimate_size_bytes(bitrate_kbps: int, duration_seconds: int) -> int:
    # 1 kbps = 1000 bits/s = 125 bytes/s.
    return bitrate_kbps * 125 * duration_seconds


def choose_bitrate(duration_seconds: int) -> int | None:
    """Highest bitrate whose output should fit the budget, or None if none does."""
    if duration_seconds <= 0:
        return FALLBACK_BITRATE_KBPS
    for bitrate in BITRATE_LADDER_KBPS:
        if estimate_size_bytes(bitrate, duration_seconds) <= SIZE_BUDGET_BYTES:
            return bitrate
    return None

# yt-dlp supports well over a thousand sites, several of which would happily
# fetch from internal addresses. Restricting the host keeps the bot pointed at
# YouTube and nothing else.
ALLOWED_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
)

PROGRESS_EDIT_INTERVAL_SECONDS = 3.0
BAR_WIDTH = 20

# Pinned rather than left to PATH: /snap/bin shadows /usr/bin, and the snap build of
# ffmpeg ships no runnable ffprobe, which yt-dlp needs to read the source codec.
FFMPEG_LOCATION = "/usr/bin"


class InvalidYoutubeUrl(ValueError):
    """The text the user sent is not a YouTube video link."""


#: Set once at startup by main(); None when no cookies are configured.
COOKIE_FILE: str | None = None


def set_cookie_file(path: str | None) -> None:
    global COOKIE_FILE
    COOKIE_FILE = path


def _apply_cookies(options: dict[str, Any]) -> None:
    """Both the metadata probe and the download need the jar; YouTube gates both."""
    if COOKIE_FILE:
        options["cookiefile"] = COOKIE_FILE


def parse_youtube_url(raw: str) -> str:
    """Validate and canonicalise a YouTube link, or raise InvalidYoutubeUrl."""
    text = raw.strip()
    if not text:
        raise InvalidYoutubeUrl("That is empty.")

    # People paste links without a scheme; assume https rather than reject.
    if "://" not in text:
        text = f"https://{text}"

    try:
        parsed = urlparse(text)
    except ValueError:
        raise InvalidYoutubeUrl("That is not a URL.") from None

    if parsed.scheme not in ("http", "https"):
        raise InvalidYoutubeUrl("Only http(s) links are accepted.")

    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise InvalidYoutubeUrl("That is not a YouTube link. Only YouTube URLs are accepted.")

    if host.endswith("youtu.be"):
        video_id = parsed.path.lstrip("/").split("/")[0]
    else:
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]
        if not video_id and parsed.path.startswith(("/shorts/", "/live/", "/embed/")):
            parts = [part for part in parsed.path.split("/") if part]
            video_id = parts[1] if len(parts) > 1 else ""

    # Video IDs are 11 chars of [A-Za-z0-9_-]; anything else is not a video link
    # (a channel or a search page, most likely).
    if not video_id or not all(c.isalnum() or c in "_-" for c in video_id):
        raise InvalidYoutubeUrl("I could not find a video ID in that link.")

    return f"https://www.youtube.com/watch?v={video_id}"


def _explain_failure(error: Exception) -> str:
    """Say what actually went wrong.

    A blanket "private, age-gated, or removed" once sent us hunting the wrong
    problem when YouTube was in fact refusing the host's IP.
    """
    text = str(error).lower()

    if "sign in to confirm" in text or "not a bot" in text:
        return (
            "❌ YouTube is refusing this host as a bot.\n\n"
            "It blocks datacenter IPs and wants a signed-in session. Cookies need to "
            "be configured (YOUTUBE_COOKIES_B64), or the bot has to run from a "
            "residential IP."
        )
    if "private video" in text:
        return "❌ That video is private."
    if "age" in text and "confirm" in text:
        return "❌ That video is age-restricted and needs a signed-in session."
    if "unavailable" in text or "removed" in text or "does not exist" in text:
        return "❌ That video is unavailable or has been removed."
    return "❌ Could not read that video."


def _render_bar(percent: float) -> str:
    filled = int(round(percent / 100 * BAR_WIDTH))
    filled = max(0, min(BAR_WIDTH, filled))
    return "█" * filled + "░" * (BAR_WIDTH - filled)


def _render_progress(state: dict[str, Any]) -> str:
    title = state.get("title") or "video"
    phase = state["phase"]

    if phase == "downloading":
        percent = state.get("percent", 0.0)
        return f"⬇️ Downloading — {title}\n[{_render_bar(percent)}] {percent:.0f}%"
    if phase == "converting":
        # ffmpeg reports no percentage here, so a full bar with a clear label beats
        # a fake number that would sit still.
        return f"🎧 Converting to MP3 — {title}\n[{_render_bar(100)}] almost there"
    if phase == "uploading":
        return f"📤 Uploading — {title}"
    return f"⏳ Working — {title}"


def _fetch_metadata(url: str) -> dict[str, Any]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
    }
    _apply_cookies(options)
    with yt_dlp.YoutubeDL(options) as ydl:
        return ydl.extract_info(url, download=False)  # type: ignore[return-value]


def _download_audio(
    url: str, target_dir: Path, state: dict[str, Any], bitrate_kbps: int
) -> Path:
    """Blocking: run yt-dlp. Called in a worker thread."""

    def progress_hook(event: dict[str, Any]) -> None:
        if event.get("status") == "downloading":
            total = event.get("total_bytes") or event.get("total_bytes_estimate")
            downloaded = event.get("downloaded_bytes") or 0
            if total:
                state["percent"] = min(100.0, downloaded / total * 100)
            state["phase"] = "downloading"
        elif event.get("status") == "finished":
            state["phase"] = "converting"

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(target_dir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        # Progress reaches the user through progress_hooks; yt-dlp's own console
        # bar would otherwise spam the bot's logs.
        "noprogress": True,
        "ffmpeg_location": FFMPEG_LOCATION,
        "progress_hooks": [progress_hook],
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(bitrate_kbps),
            }
        ],
    }

    if bitrate_kbps <= MONO_AT_OR_BELOW_KBPS:
        options["postprocessor_args"] = {"extractaudio": ["-ac", "1"]}

    _apply_cookies(options)

    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.extract_info(url, download=True)

    produced = sorted(target_dir.glob("*.mp3"))
    if not produced:
        raise RuntimeError("Conversion produced no audio file.")
    return produced[0]


async def start_youtube_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Entry point: ask for the link. The reply is picked up by the dispatcher."""
    assert update.message is not None and context.user_data is not None

    if context.user_data.get(JOB_RUNNING_KEY):
        await update.message.reply_text("A conversion is already running. Wait for it to finish.")
        return

    context.user_data[AWAITING_KEY] = AWAITING_YOUTUBE_URL
    await update.message.reply_text("Send me the YouTube link.\n\n/cancel to abort.")


async def handle_youtube_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """The follow-up message, expected to be a YouTube link."""
    assert update.message is not None and update.message.text is not None
    assert context.user_data is not None

    context.user_data.pop(AWAITING_KEY, None)

    try:
        url = parse_youtube_url(update.message.text)
    except InvalidYoutubeUrl as error:
        await update.message.reply_text(f"❌ {error}\n\nRun /youtube_audio to try again.")
        return

    context.user_data[JOB_RUNNING_KEY] = True
    try:
        await _run_conversion(update, url)
    finally:
        context.user_data[JOB_RUNNING_KEY] = False


async def _run_conversion(update: Update, url: str) -> None:
    assert update.message is not None
    loop = asyncio.get_running_loop()

    status = await update.message.reply_text("⏳ Looking up the video…")

    try:
        info = await loop.run_in_executor(None, _fetch_metadata, url)
    except Exception as error:  # noqa: BLE001 - yt-dlp raises many types
        log.warning("metadata failed for %s: %s", url, error)
        await status.edit_text(_explain_failure(error))
        return

    title = info.get("title") or "video"
    duration = int(info.get("duration") or 0)

    bitrate = choose_bitrate(duration)
    if bitrate is None:
        lowest = BITRATE_LADDER_KBPS[-1]
        smallest_mb = estimate_size_bytes(lowest, duration) / 1024 / 1024
        await status.edit_text(
            f"❌ That video is {duration // 60} min long. Even at {lowest} kbps the audio "
            f"would be about {smallest_mb:.0f} MB, over Telegram's 50 MB limit for bots."
        )
        return

    state: dict[str, Any] = {"phase": "downloading", "percent": 0.0, "title": title, "done": False}

    async def push_progress() -> None:
        last = ""
        while not state["done"]:
            text = _render_progress(state)
            if text != last:
                try:
                    await status.edit_text(text)
                    last = text
                except BadRequest:
                    # "message is not modified" and friends are not worth failing over.
                    pass
            await asyncio.sleep(PROGRESS_EDIT_INTERVAL_SECONDS)

    updater = asyncio.create_task(push_progress())

    with tempfile.TemporaryDirectory(prefix="ytaudio-") as tmp:
        target_dir = Path(tmp)
        try:
            audio_path = await loop.run_in_executor(
                None, _download_audio, url, target_dir, state, bitrate
            )
        except Exception as error:  # noqa: BLE001 - yt-dlp raises many types
            log.warning("download failed for %s: %s", url, error)
            state["done"] = True
            await updater
            await status.edit_text("❌ Download or conversion failed.")
            return

        size = audio_path.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            state["done"] = True
            await updater
            await status.edit_text(
                f"❌ The audio came to {size / 1024 / 1024:.0f} MB, over Telegram's 50 MB "
                f"limit for bots. I cannot send it."
            )
            return

        state["phase"] = "uploading"
        state["done"] = True
        await updater
        try:
            await status.edit_text(_render_progress(state))
        except BadRequest:
            pass

        caption = f"🎧 {title}\n{bitrate} kbps · {size / 1024 / 1024:.1f} MB"
        if bitrate < BITRATE_LADDER_KBPS[0]:
            # Say so rather than quietly hand back worse audio than they expected.
            caption += f"\n(reduced from {BITRATE_LADDER_KBPS[0]} kbps to fit Telegram's 50 MB limit)"

        with audio_path.open("rb") as audio:
            await update.message.reply_audio(
                audio=audio,
                title=title[:64],
                duration=duration or None,
                filename=f"{title[:64]}.mp3",
                caption=caption,
                write_timeout=300,
                read_timeout=120,
            )

    await status.delete()
