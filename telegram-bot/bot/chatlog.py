"""Logging every message in the chat so /clean can delete them by type.

The Bot API gives no way to read history, and won't delete anything older than 48
hours — so a message is only removable if we recorded its id while it happened.
Incoming messages are logged by a catch-all handler (registered in main); the
bot's own outgoing messages by patching ExtBot's send_* methods, which keeps the
Application builder's request configuration intact (subclassing would not).
"""

from __future__ import annotations

import logging

import asyncpg
from telegram import Message, Update
from telegram.ext import ContextTypes, ExtBot

from bot.auth import is_authorized

log = logging.getLogger(__name__)

# Telegram's hard limit on deletion, and how long we keep rows before pruning
# (a little past the window, since older rows are useless — undeletable).
DELETABLE_WINDOW = "48 hours"
_PRUNE_AFTER = "7 days"

# Set at startup once the pool exists; None disables outgoing logging (e.g. no DB).
_pool: asyncpg.Pool | None = None
_patched = False


def set_pool(pool: asyncpg.Pool | None) -> None:
    global _pool
    _pool = pool


def _classify(message: Message) -> str:
    if (
        message.photo
        or message.video
        or message.audio
        or message.voice
        or message.document
        or message.animation
        or message.sticker
        or message.video_note
    ):
        return "media"
    return "text"


async def _record(pool: asyncpg.Pool, chat_id: int, message_id: int, kind: str) -> None:
    try:
        await pool.execute(
            "INSERT INTO chat_message (chat_id, message_id, kind) VALUES ($1, $2, $3) "
            "ON CONFLICT (chat_id, message_id) DO NOTHING",
            chat_id,
            message_id,
            kind,
        )
    except Exception:  # noqa: BLE001 — logging a message must never break the bot
        log.exception("failed to log message %s/%s", chat_id, message_id)


async def log_outgoing(message: Message, kind: str) -> None:
    if _pool is not None and message is not None:
        await _record(_pool, message.chat_id, message.message_id, kind)


async def log_incoming(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Catch-all handler (group -1): record every incoming message from the owner."""
    config = context.application.bot_data.get("config")
    pool = context.application.bot_data.get("pool")
    message = update.message
    if pool is None or message is None or config is None:
        return
    if not is_authorized(update, config):
        return
    await _record(pool, message.chat_id, message.message_id, _classify(message))


def install_outgoing_logging() -> None:
    """Patch ExtBot's senders once so the bot's own messages are logged too.

    Class-level rather than per-instance because telegram.Bot uses __slots__; and
    it means reply_text/reply_audio (which call these under the hood) are covered.
    """
    global _patched
    if _patched:
        return
    _patched = True
    for name, kind in (
        ("send_message", "text"),
        ("send_audio", "media"),
        ("send_document", "media"),
        ("send_photo", "media"),
        ("send_video", "media"),
        ("send_voice", "media"),
    ):
        _wrap(name, kind)


def _wrap(name: str, kind: str) -> None:
    original = getattr(ExtBot, name)

    async def wrapper(self, *args, **kwargs):
        message = await original(self, *args, **kwargs)
        try:
            await log_outgoing(message, kind)
        except Exception:  # noqa: BLE001 — never fail a send over logging
            log.exception("outgoing log failed for %s", name)
        return message

    wrapper.__name__ = name
    setattr(ExtBot, name, wrapper)


# --- queries used by /clean --------------------------------------------------


async def deletable_counts(
    pool: asyncpg.Pool, chat_id: int, exclude_message_id: int
) -> dict[str, int]:
    rows = await pool.fetch(
        f"""
        SELECT kind, count(*) AS n FROM chat_message
        WHERE chat_id = $1 AND message_id <> $2
          AND created_at > now() - interval '{DELETABLE_WINDOW}'
        GROUP BY kind
        """,
        chat_id,
        exclude_message_id,
    )
    counts = {"text": 0, "media": 0}
    for row in rows:
        counts[row["kind"]] = row["n"]
    counts["all"] = counts["text"] + counts["media"]
    return counts


async def deletable_ids(
    pool: asyncpg.Pool, chat_id: int, kind: str, exclude_message_id: int
) -> list[int]:
    rows = await pool.fetch(
        f"""
        SELECT message_id FROM chat_message
        WHERE chat_id = $1 AND message_id <> $2
          AND created_at > now() - interval '{DELETABLE_WINDOW}'
          AND ($3 = 'all' OR kind = $3)
        ORDER BY message_id
        """,
        chat_id,
        exclude_message_id,
        kind,
    )
    return [row["message_id"] for row in rows]


async def too_old_count(pool: asyncpg.Pool, chat_id: int, kind: str) -> int:
    return await pool.fetchval(
        f"""
        SELECT count(*) FROM chat_message
        WHERE chat_id = $1 AND created_at <= now() - interval '{DELETABLE_WINDOW}'
          AND ($2 = 'all' OR kind = $2)
        """,
        chat_id,
        kind,
    )


async def forget(pool: asyncpg.Pool, chat_id: int, message_ids: list[int]) -> None:
    """Drop the deleted rows, and prune anything long past the deletable window."""
    if message_ids:
        await pool.execute(
            "DELETE FROM chat_message WHERE chat_id = $1 AND message_id = ANY($2::bigint[])",
            chat_id,
            message_ids,
        )
    await pool.execute(
        f"DELETE FROM chat_message WHERE created_at < now() - interval '{_PRUNE_AFTER}'"
    )
