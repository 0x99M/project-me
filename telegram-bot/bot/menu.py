"""The /hint menu: a compact, tappable index of what the bot can do.

Printing every command became a wall once there were three command groups, so
/hint now shows the top-level sections as buttons. Tapping a section that has its
own screen (/todo, /money) opens it; a plain container (/tools) expands to its
commands; "All commands" still shows the full flat list. It is also the reply for
/start, /help, and anything the bot doesn't recognise.
"""

from __future__ import annotations

import logging

from telegram import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.commands import COMMANDS, Command, find_command, format_hint

log = logging.getLogger(__name__)

CALLBACK_PREFIX = "hint:"


def _cb(action: str, rest: str = "") -> str:
    return f"{CALLBACK_PREFIX}{action}{':' + rest if rest else ''}"


def _button_label(command: Command) -> str:
    return command.menu_label or command.label or f"/{command.name}"


def _top_level() -> list[Command]:
    # Everything except /hint itself — this menu is what /hint is.
    return [command for command in COMMANDS if command.name != "hint"]


def _find_parent(name: str) -> Command | None:
    """The group a command sits under, or None if it is top-level."""

    def walk(parent: Command | None, children: tuple[Command, ...]) -> Command | None:
        for child in children:
            if child.name == name:
                return parent
            found = walk(child, child.children)
            if found is not None:
                return found
        return None

    return walk(None, COMMANDS)


# --- rendering ---------------------------------------------------------------


def _render_menu() -> tuple[str, InlineKeyboardMarkup]:
    text = "🤖 What can I help with?\n\nTap a section — or just paste a link."
    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for command in _top_level():
        row.append(
            InlineKeyboardButton(_button_label(command), callback_data=_cb("open", command.name))
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("📋 All commands", callback_data=_cb("all"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_submenu(command: Command) -> tuple[str, InlineKeyboardMarkup]:
    lines = [f"{_button_label(command)} — {command.description}", ""]
    keyboard: list[list[InlineKeyboardButton]] = []
    for child in command.children:
        lines.append(f"/{child.name} — {child.description}")
        keyboard.append(
            [InlineKeyboardButton(_button_label(child), callback_data=_cb("open", child.name))]
        )
    parent = _find_parent(command.name)
    back = _cb("open", parent.name) if parent is not None else _cb("home")
    keyboard.append([InlineKeyboardButton("⬅ Back", callback_data=back)])
    return "\n".join(lines), InlineKeyboardMarkup(keyboard)


def _render_all() -> tuple[str, InlineKeyboardMarkup]:
    markup = InlineKeyboardMarkup(
        [[InlineKeyboardButton("⬅ Back", callback_data=_cb("home"))]]
    )
    return format_hint(), markup


# --- responding --------------------------------------------------------------


async def _respond(
    update: Update, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    """Edit in place when a button was tapped, else reply fresh."""
    query = update.callback_query
    if query is not None:
        await _edit(query, text, markup)
    elif update.effective_message is not None:
        await update.effective_message.reply_text(text, reply_markup=markup)


async def _edit(
    query: CallbackQuery, text: str, markup: InlineKeyboardMarkup | None
) -> None:
    try:
        await query.edit_message_text(text, reply_markup=markup)
    except BadRequest:
        # Re-tapping the section you're already on is a no-op edit; ignore.
        pass


# --- entry points ------------------------------------------------------------


async def show_menu(
    update: Update, context: ContextTypes.DEFAULT_TYPE, header: str | None = None
) -> None:
    """/hint, /start, /help, and the fallback for unrecognised input."""
    text, markup = _render_menu()
    if header:
        text = f"{header}\n\n{text}"
    await _respond(update, text, markup)


async def show_submenu(
    update: Update, context: ContextTypes.DEFAULT_TYPE, command: Command
) -> None:
    """What a typed container command (a group with no handler) replies with."""
    text, markup = _render_submenu(command)
    await _respond(update, text, markup)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route hint: taps: drill into a section, open it, or show every command."""
    query = update.callback_query
    if query is None or query.data is None:
        return
    config = context.application.bot_data["config"]
    await query.answer()
    if not is_authorized(update, config):
        return

    action, _, rest = query.data[len(CALLBACK_PREFIX) :].partition(":")
    if action == "home":
        await _edit(query, *_render_menu())
    elif action == "all":
        await _edit(query, *_render_all())
    elif action == "open":
        await _open(update, context, rest)


async def _open(
    update: Update, context: ContextTypes.DEFAULT_TYPE, name: str
) -> None:
    command = find_command(name)
    if command is None:
        await _edit(update.callback_query, *_render_menu())
        return
    # A section with its own screen (/todo, /money) opens straight into it; a
    # plain container expands to its commands.
    if command.handler is not None:
        await command.handler(update, context)
    elif command.children:
        await _edit(update.callback_query, *_render_submenu(command))
    else:
        await _edit(update.callback_query, *_render_menu())
