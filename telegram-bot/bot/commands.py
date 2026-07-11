"""The command tree.

This is the single source of truth: the dispatcher routes off it and /hint is
rendered from it, so a command added here is reachable and listed with no other
file to remember to update.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from telegram import Update
from telegram.ext import ContextTypes

from bot.tools.youtube_audio import start_youtube_audio

Handler = Callable[[Update, ContextTypes.DEFAULT_TYPE], Awaitable[None]]


@dataclass(frozen=True)
class Command:
    #: Without the leading slash. Telegram only recognises a-z, 0-9 and "_".
    name: str
    description: str
    #: A group (children, no handler) lists its children when invoked.
    children: tuple[Command, ...] = ()
    handler: Handler | None = None
    aliases: tuple[str, ...] = field(default=())


COMMANDS: tuple[Command, ...] = (
    Command(
        name="hint",
        description="List every command this bot knows",
    ),
    Command(
        name="tools",
        description="Utilities",
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


def format_hint() -> str:
    """Render the whole tree, indenting children under their parent."""
    lines = ["Commands:"]

    def render(commands: tuple[Command, ...], depth: int) -> None:
        for command in commands:
            lines.append(f"{'  ' * depth}/{command.name} — {command.description}")
            render(command.children, depth + 1)

    render(COMMANDS, 0)
    return "\n".join(lines)


def format_group(command: Command) -> str:
    """What a group replies with when invoked directly."""
    lines = [f"/{command.name} — {command.description}", ""]
    for child in command.children:
        lines.append(f"/{child.name} — {child.description}")
        for grandchild in child.children:
            lines.append(f"  /{grandchild.name} — {grandchild.description}")
    return "\n".join(lines)
