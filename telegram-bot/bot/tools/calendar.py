"""/calendar — one-off events the bot reminds you about over Telegram.

You add an event by typing it the way you'd say it ("interview at 14:00
03-10-2026", DD-MM-YYYY, 24-hour, Asia/Riyadh): a bare date+time is auto-detected
the same way a link or a number is, and the bot confirms before saving. /event is
the same thing as a typed command, and /calendar lists what's upcoming.

Reminders are the one thing the rest of the bot doesn't do — it is otherwise
purely reactive. Each event fans out into calendar_reminder rows (a day before, an
hour before) and a once-a-minute heartbeat (reminder_loop) sends the ones that are
due, so nothing is lost across a redeploy.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Message, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.tools.youtube_audio import AWAITING_KEY

log = logging.getLogger(__name__)

# The same wall clock as /todo and /money; no DST, so a typed time is unambiguous.
TIMEZONE = ZoneInfo("Asia/Riyadh")

POOL_KEY = "pool"
CALLBACK_PREFIX = "cal:"
AWAITING_CAL_TEXT = "cal_text"
CAL_PENDING = "cal_pending"
CAL_TASK_KEY = "cal_reminder_task"

REMINDER_INTERVAL_SECONDS = 60
_REMINDER_BATCH = 50
_LIST_LIMIT = 20
_LABEL_WIDE = 40

# One reminder per offset before the start. Only those still in the future when the
# event is added are actually scheduled.
_REMINDERS: tuple[tuple[str, timedelta], ...] = (
    ("day", timedelta(days=1)),
    ("hour", timedelta(hours=1)),
)

_NO_DB = (
    "🗄️ The calendar needs a database, which isn't configured here "
    "(set DATABASE_URL). It works on the deployed bot."
)

# A 24-hour HH:MM and a DD-MM-YYYY date (also accepting / or . as separators).
_TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
_DATE_RE = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b")
_FILLER_RE = re.compile(r"\b(at|on)\b|@", re.IGNORECASE)


# --- parsing -----------------------------------------------------------------


def parse_event(text: str) -> tuple[datetime, str] | None:
    """(start datetime in Riyadh, title) from a sentence, or None.

    Needs both a time and a date so ordinary chatter never looks like an event.
    """
    time_match = _TIME_RE.search(text)
    date_match = _DATE_RE.search(text)
    if time_match is None or date_match is None:
        return None

    hour, minute = int(time_match.group(1)), int(time_match.group(2))
    day, month, year = (int(date_match.group(i)) for i in (1, 2, 3))
    try:
        starts_at = datetime(year, month, day, hour, minute, tzinfo=TIMEZONE)
    except ValueError:
        return None  # e.g. 32-13-2026

    title = _DATE_RE.sub(" ", _TIME_RE.sub(" ", text))
    title = _FILLER_RE.sub(" ", title)
    title = re.sub(r"\s+", " ", title).strip(" -,.·")
    return starts_at, (title or "Event")


def detect_datetime(text: str) -> str | None:
    """Auto-detect matcher: a sentence carrying a date+time. `run` re-parses it."""
    parsed = parse_event(text)
    return None if parsed is None else parsed[0].isoformat()


def _command_args(message: Message) -> str:
    parts = (message.text or "").strip().split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def _fmt_when(dt: datetime, *, year: bool = True) -> str:
    local = dt.astimezone(TIMEZONE)
    return local.strftime("%a %d %b %Y · %H:%M" if year else "%a %d %b · %H:%M")


# --- queries -----------------------------------------------------------------


async def add_event(
    pool: asyncpg.Pool,
    user_id: int,
    chat_id: int,
    title: str,
    starts_at: datetime,
    location: str | None = None,
) -> tuple[int, int]:
    """Insert the event and its still-future reminders. Returns (id, reminders)."""
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn, conn.transaction():
        event_id = await conn.fetchval(
            "INSERT INTO calendar_event (user_id, chat_id, title, starts_at, location) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            user_id,
            chat_id,
            title,
            starts_at,
            location,
        )
        scheduled = 0
        for kind, offset in _REMINDERS:
            remind_at = starts_at - offset
            if remind_at > now:
                await conn.execute(
                    "INSERT INTO calendar_reminder (event_id, kind, remind_at) "
                    "VALUES ($1, $2, $3)",
                    event_id,
                    kind,
                    remind_at,
                )
                scheduled += 1
    return event_id, scheduled


async def list_upcoming(
    pool: asyncpg.Pool, user_id: int, limit: int = _LIST_LIMIT
) -> list[asyncpg.Record]:
    # Keep an event visible for an hour after it starts so it doesn't vanish mid-event.
    return await pool.fetch(
        "SELECT id, title, starts_at, location FROM calendar_event "
        "WHERE user_id = $1 AND canceled_at IS NULL "
        "AND starts_at >= now() - interval '1 hour' "
        "ORDER BY starts_at LIMIT $2",
        user_id,
        limit,
    )


async def get_event(
    pool: asyncpg.Pool, user_id: int, event_id: int
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, title, starts_at, location FROM calendar_event "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL",
        event_id,
        user_id,
    )


async def cancel_event(
    pool: asyncpg.Pool, user_id: int, event_id: int
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "UPDATE calendar_event SET canceled_at = now() "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL RETURNING title",
        event_id,
        user_id,
    )


async def _due_reminders(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    return await pool.fetch(
        """
        SELECT r.id, r.kind, e.title, e.location, e.starts_at, e.chat_id
        FROM calendar_reminder r
        JOIN calendar_event e ON e.id = r.event_id
        WHERE r.sent_at IS NULL AND e.canceled_at IS NULL AND r.remind_at <= now()
        ORDER BY r.remind_at
        LIMIT $1
        """,
        _REMINDER_BATCH,
    )


async def _mark_sent(pool: asyncpg.Pool, reminder_id: int) -> None:
    await pool.execute(
        "UPDATE calendar_reminder SET sent_at = now() WHERE id = $1", reminder_id
    )


# --- the reminder heartbeat --------------------------------------------------


def _reminder_text(row: asyncpg.Record) -> str:
    when = _fmt_when(row["starts_at"])
    time = row["starts_at"].astimezone(TIMEZONE).strftime("%H:%M")
    location = f"\n📍 {row['location']}" if row["location"] else ""
    if row["kind"] == "day":
        return f"📅 Tomorrow — {row['title']}\n{when}{location}"
    return f"⏰ In 1 hour ({time}) — {row['title']}{location}"


async def check_due_reminders(bot, pool: asyncpg.Pool) -> None:
    """Send every reminder whose time has come; run once per heartbeat."""
    rows = await _due_reminders(pool)
    now = datetime.now(timezone.utc)
    for row in rows:
        # After downtime a reminder can surface past its event; suppress it silently
        # rather than pinging about something already over.
        if row["starts_at"] <= now:
            await _mark_sent(pool, row["id"])
            continue
        try:
            await bot.send_message(row["chat_id"], _reminder_text(row))
        except Exception:  # noqa: BLE001 — leave unsent so the next tick retries
            log.exception("failed to send reminder %s", row["id"])
            continue
        await _mark_sent(pool, row["id"])


async def reminder_loop(bot, pool: asyncpg.Pool) -> None:
    """Background task started by main(): check for due reminders every minute."""
    log.info("calendar reminder loop started")
    while True:
        try:
            await check_due_reminders(bot, pool)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a bad tick must not kill the loop
            log.exception("reminder check failed")
        await asyncio.sleep(REMINDER_INTERVAL_SECONDS)


# --- rendering ---------------------------------------------------------------


def _cb(action: str, rest: str = "") -> str:
    return f"{CALLBACK_PREFIX}{action}{':' + rest if rest else ''}"


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _render_confirm(pending: dict) -> tuple[str, InlineKeyboardMarkup]:
    text = f"📅 Add “{pending['title']}”?\n{_fmt_when(pending['starts_at'])}"
    keyboard = [
        [
            InlineKeyboardButton("✅ Add", callback_data=_cb("add")),
            InlineKeyboardButton("✏️ Edit", callback_data=_cb("edit")),
            InlineKeyboardButton("✖ No", callback_data=_cb("cancel")),
        ]
    ]
    return text, InlineKeyboardMarkup(keyboard)


def _render_list(
    events: list[asyncpg.Record],
) -> tuple[str, InlineKeyboardMarkup | None]:
    if not events:
        text = "📅 No upcoming events.\n\nAdd one like: interview at 14:00 03-10-2026"
        return text, None

    text = "📅 Upcoming — tap an event to cancel it."
    keyboard = [
        [
            InlineKeyboardButton(
                _truncate(f"{_fmt_when(e['starts_at'], year=False)} — {e['title']}", _LABEL_WIDE),
                callback_data=_cb("ask", str(e["id"])),
            )
        ]
        for e in events
    ]
    return text, InlineKeyboardMarkup(keyboard)


# --- context helpers ---------------------------------------------------------


def _pool(context: ContextTypes.DEFAULT_TYPE) -> asyncpg.Pool | None:
    return context.application.bot_data.get(POOL_KEY)


async def _respond(
    update: Update, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    query = update.callback_query
    if query is not None:
        try:
            await query.edit_message_text(text, reply_markup=markup)
        except BadRequest:
            pass
    elif update.effective_message is not None:
        await update.effective_message.reply_text(text, reply_markup=markup)


def _clear_pending(context: ContextTypes.DEFAULT_TYPE) -> None:
    assert context.user_data is not None
    context.user_data.pop(CAL_PENDING, None)
    context.user_data.pop(AWAITING_KEY, None)


# --- command handlers --------------------------------------------------------


async def show_calendar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/calendar and the 📅 Calendar menu button — upcoming events."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    events = await list_upcoming(pool, update.effective_user.id)
    text, markup = _render_list(events)
    await _respond(update, text, markup)


async def start_event(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/event — add via inline text if given, else ask for the sentence."""
    assert update.message is not None and context.user_data is not None
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return

    args = _command_args(update.message)
    if not args:
        context.user_data[CAL_PENDING] = {"chat_id": update.message.chat_id}
        context.user_data[AWAITING_KEY] = AWAITING_CAL_TEXT
        await update.message.reply_text(
            "Tell me the event, like:\ninterview at 14:00 03-10-2026\n\n/cancel to abort."
        )
        return
    await _offer(update.message, context, args)


async def start_from_sentence(
    message: Message, context: ContextTypes.DEFAULT_TYPE, detected: str
) -> None:
    """Auto-detect `run`: a date+time was spotted in a plain message."""
    await _offer(message, context, message.text or "")


async def _offer(
    message: Message, context: ContextTypes.DEFAULT_TYPE, text: str
) -> None:
    """Parse `text` and show the confirm card, or explain the format."""
    assert context.user_data is not None
    parsed = parse_event(text)
    if parsed is None:
        await message.reply_text(
            "I couldn't find a date and time. Try: interview at 14:00 03-10-2026"
        )
        return
    starts_at, title = parsed
    context.user_data.pop(AWAITING_KEY, None)
    context.user_data[CAL_PENDING] = {
        "title": title,
        "starts_at": starts_at,
        "chat_id": message.chat_id,
    }
    card, markup = _render_confirm(context.user_data[CAL_PENDING])
    await message.reply_text(card, reply_markup=markup)


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """The typed sentence after a bare /event or an ✏️ Edit tap."""
    assert update.message is not None and context.user_data is not None
    pending = context.user_data.get(CAL_PENDING) or {}
    context.user_data.pop(AWAITING_KEY, None)
    raw = update.message.text or ""
    parsed = parse_event(raw)
    if parsed is None:
        context.user_data[CAL_PENDING] = pending
        context.user_data[AWAITING_KEY] = AWAITING_CAL_TEXT
        await update.message.reply_text(
            "I couldn't find a date and time. Try: interview at 14:00 03-10-2026"
            "\n\n/cancel to abort."
        )
        return
    starts_at, title = parsed
    context.user_data[CAL_PENDING] = {
        "title": title,
        "starts_at": starts_at,
        "chat_id": pending.get("chat_id") or update.message.chat_id,
    }
    card, markup = _render_confirm(context.user_data[CAL_PENDING])
    await update.message.reply_text(card, reply_markup=markup)


# --- callback dispatch -------------------------------------------------------


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route cal: taps: add/edit/dismiss a pending event, or cancel a saved one."""
    query = update.callback_query
    if query is None or query.data is None:
        return
    config = context.application.bot_data["config"]
    await query.answer()
    if not is_authorized(update, config):
        return
    assert context.user_data is not None and update.effective_user is not None

    pool = _pool(context)
    if pool is None:
        await query.edit_message_text(_NO_DB)
        return

    action, _, rest = query.data[len(CALLBACK_PREFIX) :].partition(":")
    if action == "add":
        await _confirm_add(update, context)
    elif action == "edit":
        await _prompt_edit(update, context)
    elif action == "cancel":
        _clear_pending(context)
        await query.edit_message_text("Okay — not added.")
    elif action == "list":
        await show_calendar(update, context)
    elif action == "ask":
        await _confirm_cancel(update, context, rest)
    elif action == "delok":
        await _do_cancel(update, context, rest)


async def _confirm_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(CAL_PENDING) or {}
    if "starts_at" not in pending:
        await update.callback_query.edit_message_text("That expired — send the event again.")
        return
    pool = _pool(context)
    if pool is None:
        await update.callback_query.edit_message_text(_NO_DB)
        return
    _, scheduled = await add_event(
        pool,
        update.effective_user.id,
        pending["chat_id"],
        pending["title"],
        pending["starts_at"],
    )
    _clear_pending(context)
    if scheduled == 0:
        note = "It's too soon for a reminder."
    elif scheduled == 1:
        note = "🔔 1 reminder set."
    else:
        note = "🔔 Reminders a day and an hour before."
    await update.callback_query.edit_message_text(
        f"✅ {pending['title']}\n{_fmt_when(pending['starts_at'])}\n{note}"
    )


async def _prompt_edit(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.callback_query is not None
    pending = (context.user_data or {}).get(CAL_PENDING) or {}
    # Keep chat_id so the retyped event still knows where its reminders go.
    context.user_data[CAL_PENDING] = {"chat_id": pending.get("chat_id")}
    context.user_data[AWAITING_KEY] = AWAITING_CAL_TEXT
    await update.callback_query.edit_message_text(
        "Send the corrected event, like:\ninterview at 14:00 03-10-2026\n\n/cancel to abort."
    )


async def _confirm_cancel(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        event_id = int(rest)
    except ValueError:
        return
    event = await get_event(pool, update.effective_user.id, event_id)
    if event is None:
        await show_calendar(update, context)
        return
    keyboard = [
        [
            InlineKeyboardButton("🗑 Cancel event", callback_data=_cb("delok", str(event_id))),
            InlineKeyboardButton("⬅ Keep", callback_data=_cb("list")),
        ]
    ]
    await update.callback_query.edit_message_text(
        f"Cancel this event?\n{_fmt_when(event['starts_at'])} — {event['title']}",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def _do_cancel(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        event_id = int(rest)
    except ValueError:
        return
    await cancel_event(pool, update.effective_user.id, event_id)
    await show_calendar(update, context)
