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
