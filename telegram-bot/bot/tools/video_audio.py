"""/video_audio — send a video (up to 100 MB), get its audio back as MP3.

Sending a video to the bot converts it straight away; the command only exists so
the feature is discoverable and listed in /hint.

Downloading is the hard part. The Bot API refuses to hand a bot any file over
20 MB, so larger videos are fetched over MTProto (Telethon), logged in with the
same bot token. That needs an api_id/api_hash from my.telegram.org; without them
the bot still converts videos up to 20 MB and explains the limit for the rest.

The audio goes back through the Bot API, whose upload cap is 50 MB, so the
bitrate is chosen from the video's length exactly as /youtube_audio does it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from pathlib import Path
from typing import Any

from telegram import Message, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.config import Config
from bot.tools.youtube_audio import (
    AWAITING_KEY,
    BITRATE_LADDER_KBPS,
    FFMPEG_LOCATION,
    JOB_RUNNING_KEY,
    MAX_UPLOAD_BYTES,
    MONO_AT_OR_BELOW_KBPS,
    PROGRESS_EDIT_INTERVAL_SECONDS,
    _render_bar,
    choose_bitrate,
    estimate_size_bytes,
)

log = logging.getLogger(__name__)

AWAITING_VIDEO = "video_audio_file"

MAX_VIDEO_BYTES = 100 * 1024 * 1024

# getFile answers "file is too big" above this; it is a Bot API rule, not ours.
BOT_API_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024

FFMPEG = f"{FFMPEG_LOCATION}/ffmpeg"
FFPROBE = f"{FFMPEG_LOCATION}/ffprobe"

_MB = 1024 * 1024


class ConversionError(Exception):
    """A failure with a message fit to show the user as-is."""


def video_in(message: Message) -> tuple[Any, str] | None:
    """(the file object, a display name) if the message carries a video, else None.

    Phones send videos as `video`; a video sent "as a file" arrives as a document
    whose MIME type says video; round video notes have their own field.
    """
    if message.video is not None:
        name = message.video.file_name or "video"
        return message.video, name
    if message.video_note is not None:
        return message.video_note, "video note"
    document = message.document
    if document is not None and (document.mime_type or "").startswith("video/"):
        return document, document.file_name or "video"
    return None


def download_route(size_bytes: int | None, mtproto_ready: bool) -> str:
    """Which way to fetch a file: "bot_api", "mtproto", "too_big" or "needs_setup".

    An unknown size is tried through the Bot API, which refuses anything over its
    limit with a clear error rather than silently truncating.
    """
    if size_bytes is not None and size_bytes > MAX_VIDEO_BYTES:
        return "too_big"
    if size_bytes is None or size_bytes <= BOT_API_DOWNLOAD_LIMIT_BYTES:
        return "bot_api"
    return "mtproto" if mtproto_ready else "needs_setup"


def parse_progress_seconds(line: str) -> float | None:
    """Seconds of output written so far, from one line of `ffmpeg -progress`.

    `out_time_us` is microseconds (ffmpeg's `out_time_ms` is, confusingly, also
    microseconds, so it is accepted too). "N/A" appears before the first frame.
    """
    key, _, value = line.strip().partition("=")
    if key not in ("out_time_us", "out_time_ms"):
        return None
    try:
        return int(value) / 1_000_000
    except ValueError:
        return None


# --- MTProto, for files the Bot API will not hand over -----------------------

_client: Any = None
_client_lock = asyncio.Lock()


async def _mtproto_client(config: Config) -> Any:
    """The shared Telethon client, logged in as the bot on first use.

    Lazy so a bot that never sees a big video never opens a second connection,
    and so a Telethon problem cannot stop the bot from starting.
    """
    global _client
    async with _client_lock:
        if _client is not None and _client.is_connected():
            return _client
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        # receive_updates=False: this session only downloads. Updates keep flowing
        # through the Bot API poller as before.
        client = TelegramClient(
            StringSession(),
            config.telegram_api_id,
            config.telegram_api_hash,
            receive_updates=False,
        )
        await client.start(bot_token=config.bot_token)
        _client = client
        log.info("mtproto client connected for large downloads")
        return client


async def close_mtproto() -> None:
    global _client
    if _client is not None:
        await _client.disconnect()
        _client = None


async def _download_mtproto(
    config: Config, message: Message, target: Path, state: dict[str, Any]
) -> None:
    client = await _mtproto_client(config)
    # In private chats message IDs are per account, so the Bot API's message_id
    # is also the MTProto one and no peer is needed to look it up.
    found = await client.get_messages(None, ids=[message.message_id])
    mt_message = found[0] if found else None
    if mt_message is None or mt_message.media is None:
        raise ConversionError("❌ Could not find that video on Telegram's side. Send it again.")

    def on_progress(done: int, total: int) -> None:
        if total:
            state["percent"] = done / total * 100

    await client.download_media(mt_message, file=str(target), progress_callback=on_progress)


# --- conversion ----------------------------------------------------------------


async def _probe(path: Path) -> tuple[float, bool]:
    """(duration in seconds, whether there is an audio stream)."""
    process = await asyncio.create_subprocess_exec(
        FFPROBE,
        "-v", "error",
        "-print_format", "json",
        "-show_entries", "format=duration:stream=codec_type",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await process.communicate()
    if process.returncode != 0:
        log.warning("ffprobe failed: %s", err.decode(errors="replace")[-500:])
        raise ConversionError("❌ I could not read that file as a video.")
    info = json.loads(out or b"{}")
    try:
        duration = float(info.get("format", {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return duration, has_audio


async def _transcode(
    source: Path, target: Path, bitrate_kbps: int, duration: float, state: dict[str, Any]
) -> None:
    args = [FFMPEG, "-hide_banner", "-nostdin", "-y", "-i", str(source), "-vn"]
    args += ["-c:a", "libmp3lame", "-b:a", f"{bitrate_kbps}k"]
    if bitrate_kbps <= MONO_AT_OR_BELOW_KBPS:
        args += ["-ac", "1"]
    args += ["-progress", "pipe:1", "-nostats", str(target)]

    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    assert process.stdout is not None and process.stderr is not None
    # Drain stderr alongside stdout so a chatty ffmpeg cannot fill the pipe and stall.
    stderr_task = asyncio.create_task(process.stderr.read())
    async for raw in process.stdout:
        seconds = parse_progress_seconds(raw.decode(errors="replace"))
        if seconds is not None and duration > 0:
            state["percent"] = min(100.0, seconds / duration * 100)
    await process.wait()
    stderr = (await stderr_task).decode(errors="replace")
    if process.returncode != 0 or not target.exists():
        log.warning("ffmpeg failed (%s): %s", process.returncode, stderr[-800:])
        raise ConversionError("❌ The conversion failed.")


def _render(state: dict[str, Any]) -> str:
    name = state["name"]
    percent = state.get("percent", 0.0)
    if state["phase"] == "downloading":
        return f"⬇️ Downloading — {name}\n[{_render_bar(percent)}] {percent:.0f}%"
    if state["phase"] == "converting":
        return f"🎧 Converting to MP3 — {name}\n[{_render_bar(percent)}] {percent:.0f}%"
    return f"📤 Uploading — {name}"


# --- handlers ------------------------------------------------------------------


async def start_video_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Entry point: ask for the video. Reachable as a command and from /hint."""
    assert context.user_data is not None
    message = update.effective_message
    if message is None:
        return
    context.user_data[AWAITING_KEY] = AWAITING_VIDEO
    await message.reply_text(
        "Send me the video (up to 100 MB), and I'll send back its audio as MP3.\n\n"
        "Tip: you can skip this command and just send a video.\n/cancel to abort."
    )


async def handle_waiting_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Text arrived while a video was expected."""
    assert update.message is not None
    await update.message.reply_text("That's text. Send a video, or /cancel.")


async def on_video(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """A video message from an authorised user (main.py does the gating)."""
    message = update.message
    assert message is not None and context.user_data is not None
    found = video_in(message)
    if found is None:
        return
    if context.user_data.get(AWAITING_KEY) == AWAITING_VIDEO:
        context.user_data.pop(AWAITING_KEY, None)

    if context.user_data.get(JOB_RUNNING_KEY):
        await message.reply_text("A conversion is already running. Wait for it to finish.")
        return

    context.user_data[JOB_RUNNING_KEY] = True
    try:
        await _convert(message, context, *found)
    finally:
        context.user_data[JOB_RUNNING_KEY] = False


async def _convert(
    message: Message, context: ContextTypes.DEFAULT_TYPE, media: Any, name: str
) -> None:
    config: Config = context.application.bot_data["config"]
    size = getattr(media, "file_size", None)
    route = download_route(size, config.mtproto_ready)

    if route == "too_big":
        await message.reply_text(
            f"❌ That video is {size / _MB:.0f} MB. The limit is {MAX_VIDEO_BYTES // _MB} MB."
        )
        return
    if route == "needs_setup":
        await message.reply_text(
            f"❌ That video is {size / _MB:.0f} MB. Telegram only lets bots download files "
            f"up to 20 MB unless the bot is given API credentials (TELEGRAM_API_ID and "
            f"TELEGRAM_API_HASH), which aren't set yet."
        )
        return

    stem = Path(name).stem if name != "video note" else "video note"
    state: dict[str, Any] = {"phase": "downloading", "percent": 0.0, "name": stem, "done": False}
    status = await message.reply_text(_render(state))

    async def push_progress() -> None:
        last = ""
        while not state["done"]:
            text = _render(state)
            if text != last:
                try:
                    await status.edit_text(text)
                    last = text
                except BadRequest:
                    pass
            await asyncio.sleep(PROGRESS_EDIT_INTERVAL_SECONDS)

    updater = asyncio.create_task(push_progress())

    async def fail(text: str) -> None:
        state["done"] = True
        await updater
        await status.edit_text(text)

    with tempfile.TemporaryDirectory(prefix="vidaudio-") as tmp:
        source = Path(tmp) / "source"
        target = Path(tmp) / "audio.mp3"
        try:
            if route == "bot_api":
                telegram_file = await context.bot.get_file(media.file_id)
                await telegram_file.download_to_drive(source, read_timeout=120)
            else:
                await _download_mtproto(config, message, source, state)

            duration, has_audio = await _probe(source)
            if not has_audio:
                raise ConversionError("❌ That video has no sound, so there is no audio to send.")

            bitrate = choose_bitrate(int(duration))
            if bitrate is None:
                lowest = BITRATE_LADDER_KBPS[-1]
                smallest_mb = estimate_size_bytes(lowest, int(duration)) / _MB
                raise ConversionError(
                    f"❌ That video is {int(duration) // 60} min long. Even at {lowest} kbps "
                    f"the audio would be about {smallest_mb:.0f} MB, over Telegram's 50 MB "
                    f"limit for bots."
                )

            state.update(phase="converting", percent=0.0)
            await _transcode(source, target, bitrate, duration, state)
        except ConversionError as error:
            await fail(str(error))
            return
        except BadRequest as error:
            log.warning("bot api download failed: %s", error)
            await fail("❌ Telegram wouldn't let me download that file.")
            return
        except Exception:  # noqa: BLE001 - Telethon and the network raise many types
            log.exception("video conversion failed")
            await fail("❌ Download or conversion failed.")
            return

        audio_size = target.stat().st_size
        if audio_size > MAX_UPLOAD_BYTES:
            await fail(
                f"❌ The audio came to {audio_size / _MB:.0f} MB, over Telegram's 50 MB "
                f"limit for bots. I cannot send it."
            )
            return

        state.update(phase="uploading")
        state["done"] = True
        await updater
        try:
            await status.edit_text(_render(state))
        except BadRequest:
            pass

        caption = f"🎧 {stem}\n{bitrate} kbps · {audio_size / _MB:.1f} MB"
        if bitrate < BITRATE_LADDER_KBPS[0]:
            caption += f"\n(reduced from {BITRATE_LADDER_KBPS[0]} kbps to fit Telegram's 50 MB limit)"
        with target.open("rb") as audio:
            await message.reply_audio(
                audio=audio,
                title=stem[:64],
                duration=int(duration) or None,
                filename=f"{stem[:64]}.mp3",
                caption=caption,
                write_timeout=300,
                read_timeout=120,
            )

    await status.delete()
