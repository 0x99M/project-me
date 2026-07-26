"""/clean — remove recent messages in the chat: text, media, or all.

Bounded by Telegram: only messages from the last 48h, and only ones the bot
recorded (see bot.chatlog), can go. It deletes both sides' messages but keeps the
menu message it's editing, so the summary stays visible.
"""

from __future__ import annotations

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest, TelegramError
from telegram.ext import ContextTypes

from bot import chatlog
from bot.auth import is_authorized

log = logging.getLogger(__name__)

POOL_KEY = "pool"
CALLBACK_PREFIX = "clean:"
_BATCH = 100  # Telegram's cap for deleteMessages

_KIND_LABEL = {"text": "📝 Text", "media": "🖼 Media", "all": "🗑 All"}
_NO_DB = "🗄️ Cleaning needs the database, which isn't configured here."


def _pool(context: ContextTypes.DEFAULT_TYPE):
    return context.application.bot_data.get(POOL_KEY)


def _plural(n: int) -> str:
    return "" if n == 1 else "s"


def _render_menu(counts: dict[str, int]) -> tuple[str, InlineKeyboardMarkup]:
    text = (
        "🧹 Clean the chat — the last 48 hours only (both your messages and mine).\n"
        "Pick what to remove:"
    )

    def button(kind: str) -> InlineKeyboardButton:
        return InlineKeyboardButton(
            f"{_KIND_LABEL[kind]} ({counts[kind]})",
            callback_data=f"{CALLBACK_PREFIX}ask:{kind}",
        )

    keyboard = [
        [button("text"), button("media")],
        [button("all")],
        [InlineKeyboardButton("✖ Cancel", callback_data=f"{CALLBACK_PREFIX}cancel")],
    ]
    return text, InlineKeyboardMarkup(keyboard)


async def show_clean(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/clean — offer to remove text, media, or everything from the last 48h."""
    message = update.effective_message
    assert message is not None
    pool = _pool(context)
    if pool is None:
        await message.reply_text(_NO_DB)
        return
    counts = await chatlog.deletable_counts(pool, message.chat_id, 0)
    text, markup = _render_menu(counts)
    await message.reply_text(text, reply_markup=markup)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None:
        return
    config = context.application.bot_data["config"]
    await query.answer()
    if not is_authorized(update, config):
        return
    pool = _pool(context)
    if pool is None:
        await query.edit_message_text(_NO_DB)
        return

    action, _, kind = query.data[len(CALLBACK_PREFIX) :].partition(":")
    if action == "cancel":
        await query.edit_message_text("Okay — nothing removed.")
    elif action == "ask":
        await _confirm(update, context, kind)
    elif action == "do":
        await _do_clean(update, context, kind)


async def _confirm(
    update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str
) -> None:
    query = update.callback_query
    assert query is not None and query.message is not None
    pool = _pool(context)
    ids = await chatlog.deletable_ids(
        pool, query.message.chat_id, kind, query.message.message_id
    )
    if not ids:
        await query.edit_message_text(
            f"Nothing to remove under {_KIND_LABEL.get(kind, kind)} in the last 48h."
        )
        return
    keyboard = [
        [
            InlineKeyboardButton("✅ Yes, delete", callback_data=f"{CALLBACK_PREFIX}do:{kind}"),
            InlineKeyboardButton("✖ No", callback_data=f"{CALLBACK_PREFIX}cancel"),
        ]
    ]
    await query.edit_message_text(
        f"Delete {len(ids)} message{_plural(len(ids))} ({_KIND_LABEL.get(kind, kind)})?",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def _do_clean(
    update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str
) -> None:
    query = update.callback_query
    assert query is not None and query.message is not None
    pool = _pool(context)
    chat_id = query.message.chat_id
    # Keep the message we're editing so the summary is still visible afterwards.
    ids = await chatlog.deletable_ids(pool, chat_id, kind, query.message.message_id)
    deleted = await _delete_ids(context.bot, chat_id, ids)
    await chatlog.forget(pool, chat_id, ids)
    too_old = await chatlog.too_old_count(pool, chat_id, kind)
    note = (
        f"\n({too_old} older than 48h — Telegram won't let me delete those.)"
        if too_old
        else ""
    )
    await query.edit_message_text(f"✅ Removed {deleted} message{_plural(deleted)}.{note}")


async def _delete_ids(bot, chat_id: int, ids: list[int]) -> int:
    """Delete in batches, falling back to one-by-one so a single bad id can't
    sink the whole batch. Returns how many were actually removed."""
    deleted = 0
    for start in range(0, len(ids), _BATCH):
        batch = ids[start : start + _BATCH]
        try:
            await bot.delete_messages(chat_id, batch)
            deleted += len(batch)
        except TelegramError:
            for message_id in batch:
                try:
                    await bot.delete_message(chat_id, message_id)
                    deleted += 1
                except BadRequest:
                    pass  # already gone, or now older than 48h
    return deleted
