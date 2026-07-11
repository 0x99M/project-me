"""Entry point: poll Telegram, gate on the allowlist, dispatch off the command tree."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from bot.auth import is_authorized
from bot.commands import find_command, format_group, format_hint
from bot.config import Config, load_config
from bot.cookies import load_cookie_file
from bot.tools.youtube_audio import (
    AWAITING_KEY,
    AWAITING_YOUTUBE_URL,
    handle_youtube_url,
    set_cookie_file,
)

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    level=logging.INFO,
)
# httpx logs every long-poll request at INFO, which drowns everything else.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")

# Follow-ups the bot is waiting on, keyed by what start_* set in user_data.
PENDING_HANDLERS = {AWAITING_YOUTUBE_URL: handle_youtube_url}


def _parse_command_name(text: str) -> str | None:
    """'/tools@my_bot arg' -> 'tools'; plain text -> None."""
    word = text.strip().split()[0] if text.strip() else ""
    if not word.startswith("/"):
        return None
    return word[1:].split("@")[0].lower()


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    config: Config = context.application.bot_data["config"]
    message = update.message
    if message is None or message.text is None:
        return

    if not is_authorized(update, config):
        # Stay silent rather than replying "denied": a reply confirms the bot is
        # live and worth probing. The log line is how you discover a user's ID.
        user = update.effective_user
        chat = update.effective_chat
        log.warning(
            "denied: user=%s username=%s chat=%s",
            user.id if user else "unknown",
            user.username if user else "-",
            chat.type if chat else "-",
        )
        return

    assert context.user_data is not None
    name = _parse_command_name(message.text)

    if name == "cancel":
        had_pending = context.user_data.pop(AWAITING_KEY, None) is not None
        await message.reply_text("Cancelled." if had_pending else "Nothing to cancel.")
        return

    # A plain message while something is awaited is the answer to that prompt.
    if name is None:
        awaiting = context.user_data.get(AWAITING_KEY)
        handler = PENDING_HANDLERS.get(awaiting) if awaiting else None
        if handler is not None:
            await handler(update, context)
            return
        await message.reply_text(format_hint())
        return

    # A command supersedes any pending prompt, so /hint mid-flow is not swallowed.
    context.user_data.pop(AWAITING_KEY, None)

    if name in ("hint", "start", "help"):
        await message.reply_text(format_hint())
        return

    command = find_command(name)
    if command is None:
        await message.reply_text(f"Unknown command.\n\n{format_hint()}")
        return

    if command.handler is not None:
        await command.handler(update, context)
        return

    # A group with no handler: show what lives under it.
    await message.reply_text(format_group(command))


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("handler failed", exc_info=context.error)


def main() -> None:
    config = load_config()

    cookie_file = load_cookie_file()
    set_cookie_file(cookie_file)
    if cookie_file is None:
        # Not fatal: from a residential IP YouTube serves anonymous requests fine.
        log.info("no youtube cookies configured (fine on a residential IP)")

    application = Application.builder().token(config.bot_token).build()
    application.bot_data["config"] = config
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    application.add_handler(MessageHandler(filters.COMMAND, on_message))
    application.add_error_handler(on_error)

    log.info("starting; %d allowed user(s)", len(config.allowed_user_ids))
    application.run_polling(allowed_updates=[Update.MESSAGE])


if __name__ == "__main__":
    main()
