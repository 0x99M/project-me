"""Who the bot is willing to act on.

Anyone can *send* a Telegram bot a message; that cannot be prevented. The only
control that matters is who it answers, so this is a strict allowlist.
"""

from __future__ import annotations

from telegram import Update

from bot.config import Config


def is_authorized(update: Update, config: Config) -> bool:
    chat = update.effective_chat
    user = update.effective_user

    # Group chats are refused even when an allowed user sends the command, since
    # every other member would see the bot's replies.
    if chat is None or chat.type != "private":
        return False
    if user is None:
        return False

    return user.id in config.allowed_user_ids
