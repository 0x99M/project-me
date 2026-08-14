"""The command tree.

This is the single source of truth: the dispatcher routes off it and /hint is
rendered from it, so a command added here is reachable and listed with no other
file to remember to update.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from telegram import Message, Update
from telegram.ext import ContextTypes

from bot.tools.calendar import (
    detect_datetime,
    show_calendar,
    start_event,
    start_from_sentence,
)
from bot.tools.clean import show_clean
from bot.tools.money import (
    detect_amount,
    show_accounts,
    show_categories,
    show_dashboard,
    show_history,
    start_from_number,
    start_income,
    start_spend,
    start_transfer,
)
from bot.tools.money import show_stats as money_stats
from bot.tools.money_export import start_export
from bot.tools.recurring import show_recurring
from bot.tools.todo import (
    mark_done,
    mark_undone,
    reorder,
    show_list,
    show_stats,
    start_add,
)
from bot.tools.youtube_audio import convert_url, detect_youtube_url, start_youtube_audio

Handler = Callable[[Update, ContextTypes.DEFAULT_TYPE], Awaitable[None]]
#: Given a plain message's text, return the normalised input this command can act
#: on (e.g. a canonical URL), or None if it does not apply.
Detector = Callable[[str], "str | None"]
#: Run the command directly on a detected input, replying off `message`.
Runner = Callable[[Message, ContextTypes.DEFAULT_TYPE, str], Awaitable[None]]


@dataclass(frozen=True)
class Command:
    #: Without the leading slash. Telegram only recognises a-z, 0-9 and "_".
    name: str
    description: str
    #: A group (children, no handler) lists its children when invoked.
    children: tuple[Command, ...] = ()
    handler: Handler | None = None
    aliases: tuple[str, ...] = field(default=())
    #: Auto-detection. A command with both detect and run can be triggered by
    #: pasting its input straight into the chat, no command needed.
    detect: Detector | None = None
    run: Runner | None = None
    #: Button text when this command is offered among several auto-detected options.
    label: str | None = None
    #: Button text for this command in the /hint menu; falls back to /name.
    menu_label: str | None = None


COMMANDS: tuple[Command, ...] = (
    Command(
        name="hint",
        description="List every command this bot knows",
    ),
    Command(
        name="todo",
        aliases=("to-do",),
        description="Your daily routine checklist",
        menu_label="🗒 To-do",
        # A handler on a group: /todo renders the interactive list, while its
        # children still show up under it in /hint.
        handler=show_list,
        children=(
            Command(
                name="todo_list",
                aliases=("to-do-list",),
                description="Show today's list",
                handler=show_list,
            ),
            Command(
                name="todo_add",
                aliases=("to-do-add",),
                description="Add an item (text after the command, or I'll ask)",
                handler=start_add,
            ),
            Command(
                name="todo_done",
                aliases=("to-do-done",),
                description="Mark item N done for today",
                handler=mark_done,
            ),
            Command(
                name="todo_undo",
                aliases=("to-do-undo",),
                description="Clear today's tick on item N",
                handler=mark_undone,
            ),
            Command(
                name="todo_order",
                aliases=("to-do-order",),
                description="Move item FROM to position TO",
                handler=reorder,
            ),
            Command(
                name="todo_stats",
                aliases=("to-do-stats",),
                description="Completion stats over the last 30 days",
                handler=show_stats,
            ),
        ),
    ),
    Command(
        name="money",
        description="Track accounts, spending, income and transfers (JOD)",
        menu_label="💼 Money",
        # Like /todo: /money renders the dashboard, its children still list in /hint.
        handler=show_dashboard,
        # Send a bare number and it's auto-detected as money (the only number
        # feature today, so it runs straight away with no picker).
        detect=detect_amount,
        run=start_from_number,
        label="💰 Log this amount",
        children=(
            Command(
                name="money_spend",
                aliases=("spend", "money-spend"),
                description="Log a spend, e.g. /spend 25 lunch",
                handler=start_spend,
            ),
            Command(
                name="money_income",
                aliases=("income", "money-income"),
                description="Log income, e.g. /income 5000 salary",
                handler=start_income,
            ),
            Command(
                name="money_transfer",
                aliases=("transfer", "money-transfer"),
                description="Move money between accounts, e.g. /transfer 500",
                handler=start_transfer,
            ),
            Command(
                name="money_list",
                aliases=("money-list",),
                description="Recent transactions (tap to delete)",
                handler=show_history,
            ),
            Command(
                name="money_stats",
                aliases=("money-stats",),
                description="This month's spending and income",
                handler=money_stats,
            ),
            Command(
                name="money_accounts",
                aliases=("money-accounts",),
                description="Add, set default, or archive accounts",
                handler=show_accounts,
            ),
            Command(
                name="money_categories",
                aliases=("money-categories",),
                description="View and archive spending/income categories",
                handler=show_categories,
            ),
            Command(
                name="money_export",
                aliases=("export", "money-export"),
                description="Export a monthly/yearly report as PDF",
                handler=start_export,
            ),
        ),
    ),
    Command(
        name="calendar",
        aliases=("events",),
        description="Book events and get reminders (Asia/Riyadh)",
        menu_label="📅 Calendar",
        # /calendar lists upcoming events; its child still shows in /hint.
        handler=show_calendar,
        # A message carrying a date + time (e.g. "interview at 14:00 03-10-2026")
        # is auto-detected, just like a link or a bare number.
        detect=detect_datetime,
        run=start_from_sentence,
        label="📅 Add to calendar",
        children=(
            Command(
                name="event",
                description="Add an event, e.g. /event interview at 14:00 03-10-2026",
                handler=start_event,
            ),
        ),
    ),
    Command(
        name="remind",
        aliases=("recurring", "reminders"),
        description="Schedule recurring messages (daily, weekly, or on an interval)",
        menu_label="🔁 Recurring",
        handler=show_recurring,
    ),
    Command(
        name="clean",
        description="Delete recent chat messages (text, media, or all)",
        menu_label="🧹 Clean",
        handler=show_clean,
    ),
    Command(
        name="tools",
        description="Utilities",
        menu_label="🛠 Tools",
        children=(
            Command(
                name="convert",
                description="Convert media from one form to another",
                children=(
                    Command(
                        name="youtube_audio",
                        # Telegram commands cannot contain "-", but accept the
                        # hyphenated spelling too since it is the natural one to type.
                        aliases=("youtube-audio",),
                        description="Send a YouTube link, get its audio back",
                        handler=start_youtube_audio,
                        detect=detect_youtube_url,
                        run=convert_url,
                        label="🎧 Extract audio",
                    ),
                ),
            ),
        ),
    ),
)


def _walk(commands: tuple[Command, ...]):
    for command in commands:
        yield command
        yield from _walk(command.children)


def find_command(name: str) -> Command | None:
    name = name.lower()
    for command in _walk(COMMANDS):
        if name == command.name or name in command.aliases:
            return command
    return None


def detect_matches(text: str) -> list[tuple[Command, str]]:
    """Every auto-detecting command that can act on `text`, with its input.

    Zero matches means nothing recognised it; one means run it straight away;
    more than one means ask the user which to run.
    """
    matches: list[tuple[Command, str]] = []
    for command in _walk(COMMANDS):
        if command.detect is None or command.run is None:
            continue
        detected = command.detect(text)
        if detected is not None:
            matches.append((command, detected))
    return matches


def format_hint() -> str:
    """Render the whole tree, indenting children under their parent."""
    lines = ["Commands:"]

    def render(commands: tuple[Command, ...], depth: int) -> None:
        for command in commands:
            lines.append(f"{'  ' * depth}/{command.name} — {command.description}")
            render(command.children, depth + 1)

    render(COMMANDS, 0)
    lines.append("")
    lines.append("Tip: just paste a link and I'll detect what to do with it.")
    return "\n".join(lines)


def format_group(command: Command) -> str:
    """What a group replies with when invoked directly."""
    lines = [f"/{command.name} — {command.description}", ""]
    for child in command.children:
        lines.append(f"/{child.name} — {child.description}")
        for grandchild in child.children:
            lines.append(f"  /{grandchild.name} — {grandchild.description}")
    return "\n".join(lines)
