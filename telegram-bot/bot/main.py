"""Entry point: poll Telegram, gate on the allowlist, dispatch off the command tree."""

from __future__ import annotations

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from bot import db
from bot.auth import is_authorized
from bot.commands import Command, detect_matches, find_command, format_group, format_hint
from bot.config import Config, load_config
from bot.cookies import load_cookie_file
from bot.tools import money, todo
from bot.tools.money import AWAITING_MONEY_TEXT, handle_text as handle_money_text
from bot.tools.todo import AWAITING_TODO_ADD, POOL_KEY, handle_add_text
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
PENDING_HANDLERS = {
    AWAITING_YOUTUBE_URL: handle_youtube_url,
    AWAITING_TODO_ADD: handle_add_text,
    AWAITING_MONEY_TEXT: handle_money_text,
}

# Where an unanswered auto-detect choice is parked, and the callback_data prefix
# the buttons carry back. Keep the prefix short: callback_data caps at 64 bytes.
PENDING_CHOICE_KEY = "autodetect_choice"
CALLBACK_PREFIX = "skill:"


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

        # Auto-detect: if the message is something a skill recognises (a YouTube
        # link, say), act on it directly. One match runs; several offer a choice.
        matches = detect_matches(message.text)
        if len(matches) == 1:
            command, detected = matches[0]
            assert command.run is not None
            await command.run(message, context, detected)
            return
        if len(matches) > 1:
            await _offer_choices(message, context, matches)
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


async def _offer_choices(
    message, context: ContextTypes.DEFAULT_TYPE, matches: list[tuple[Command, str]]
) -> None:
    """Park the detected inputs and show one button per skill that matched.

    The input can be long (a URL), so it stays in user_data; the button only
    carries the command name, which the callback pairs back with its input.
    """
    assert context.user_data is not None
    context.user_data[PENDING_CHOICE_KEY] = {
        command.name: detected for command, detected in matches
    }
    keyboard = [
        [
            InlineKeyboardButton(
                command.label or command.description,
                callback_data=f"{CALLBACK_PREFIX}{command.name}",
            )
        ]
        for command, _ in matches
    ]
    await message.reply_text(
        "I can handle that more than one way — pick one:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return

    config: Config = context.application.bot_data["config"]
    # Answer regardless so the client stops its spinner; act only if authorised.
    await query.answer()
    if not is_authorized(update, config):
        return

    assert context.user_data is not None
    data = query.data or ""
    if not data.startswith(CALLBACK_PREFIX):
        return
    name = data[len(CALLBACK_PREFIX) :]

    pending = context.user_data.get(PENDING_CHOICE_KEY) or {}
    detected = pending.get(name)
    command = find_command(name)
    if command is None or command.run is None or detected is None:
        await query.edit_message_text("That choice has expired — send it again.")
        return

    context.user_data.pop(PENDING_CHOICE_KEY, None)
    # Collapse the buttons into the chosen action so it cannot be tapped twice.
    await query.edit_message_text(f"▶️ {command.label or command.description}")
    await command.run(query.message, context, detected)


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("handler failed", exc_info=context.error)


async def on_startup(application: Application) -> None:
    """Open the pool and run migrations before the first update is served."""
    config: Config = application.bot_data["config"]
    if config.database_url is None:
        log.info("no DATABASE_URL configured (todo and money disabled)")
        return
    pool = await db.create_pool(config.database_url)
    await db.migrate(pool)
    application.bot_data[POOL_KEY] = pool
    log.info("database connected; todo and money enabled")


async def on_shutdown(application: Application) -> None:
    pool = application.bot_data.get(POOL_KEY)
    if pool is not None:
        await pool.close()


def main() -> None:
    config = load_config()

    cookie_file = load_cookie_file()
    set_cookie_file(cookie_file)
    if cookie_file is None:
        # Not fatal: from a residential IP YouTube serves anonymous requests fine.
        log.info("no youtube cookies configured (fine on a residential IP)")

    application = (
        Application.builder()
        .token(config.bot_token)
        .post_init(on_startup)
        .post_shutdown(on_shutdown)
        .build()
    )
    application.bot_data["config"] = config
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    application.add_handler(MessageHandler(filters.COMMAND, on_message))
    # Each namespace of inline buttons routes to its own handler by callback_data
    # prefix: skill: for auto-detect choices, todo: for the checklist.
    application.add_handler(CallbackQueryHandler(on_callback, pattern=r"^skill:"))
    application.add_handler(CallbackQueryHandler(todo.on_callback, pattern=r"^todo:"))
    application.add_handler(CallbackQueryHandler(money.on_callback, pattern=r"^money:"))
    application.add_error_handler(on_error)

    log.info("starting; %d allowed user(s)", len(config.allowed_user_ids))
    application.run_polling(allowed_updates=[Update.MESSAGE, Update.CALLBACK_QUERY])


if __name__ == "__main__":
    main()
