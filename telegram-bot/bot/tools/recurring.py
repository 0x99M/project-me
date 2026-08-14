"""/remind — recurring messages the bot sends you on a schedule.

Three shapes, chosen through a guided button flow (no fragile sentence parsing):

  * daily    — every day at a time            ("every day at 07:00")
  * weekly   — chosen weekdays at a time       ("Mon/Wed/Fri at 09:00")
  * interval — every N minutes, optionally inside a daily window and on
               chosen weekdays                 ("Fridays, every 1h, 09:00-21:00")

This is the calendar's reminder idea taken to its limit. A calendar event fans
out into a fixed set of one-shot rows; a recurring message never ends, so instead
it stores the recurrence plus a single next_fire_at pointer. The same once-a-minute
heartbeat pattern drives it: fetch what's due, send it, then advance the pointer to
the next occurrence. Advancing from "now" (not from the stale pointer) means a spell
of downtime collapses to at most one catch-up send rather than a flood.

Times are Asia/Riyadh (UTC+3, no DST — a typed time is unambiguous), stored as UTC.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Message, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.tools.youtube_audio import AWAITING_KEY

log = logging.getLogger(__name__)

# The same wall clock as /todo, /money and /calendar.
TIMEZONE = ZoneInfo("Asia/Riyadh")

POOL_KEY = "pool"
CALLBACK_PREFIX = "recur:"
# Discriminator main() maps to handle_text; the in-progress build lives in a
# RECUR_PENDING dict whose "step" says what the next typed message means.
AWAITING_RECUR_TEXT = "recur_text"
RECUR_PENDING = "recur_pending"
# bot_data key for the background heartbeat task (mirrors the calendar one).
RECUR_TASK_KEY = "recur_notify_task"

REMINDER_INTERVAL_SECONDS = 60
_BATCH = 50
_LIST_LIMIT = 25
_LABEL_WIDE = 40

_NO_DB = (
    "🗄️ Recurring messages need a database, which isn't configured here "
    "(set DATABASE_URL). It works on the deployed bot."
)

_WEEKDAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
_ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
# Quick-pick times offered in the picker; "Type a time…" covers anything else.
_COMMON_TIMES = (
    "06:00", "07:00", "08:00", "09:00", "10:00",
    "12:00", "14:00", "18:00", "20:00", "21:00",
)
# Interval choices, in minutes, with their labels.
_INTERVALS: tuple[tuple[int, str], ...] = (
    (15, "15 min"),
    (30, "30 min"),
    (60, "1 hour"),
    (120, "2 hours"),
    (180, "3 hours"),
    (240, "4 hours"),
    (360, "6 hours"),
    (720, "12 hours"),
)
_INTERVAL_LABELS = dict(_INTERVALS)

_TIME_RE = re.compile(r"^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$", re.IGNORECASE)


# --- the recurrence engine ---------------------------------------------------


def compute_next_fire(
    *,
    kind: str,
    at_time: time | None = None,
    weekdays: list[int] | None = None,
    interval_min: int | None = None,
    window_start: time | None = None,
    window_end: time | None = None,
    after: datetime,
) -> datetime:
    """The next occurrence strictly after `after`, as a UTC datetime.

    `after` must be timezone-aware. All wall-clock reasoning happens in Riyadh
    local time; the result is converted back to UTC for storage. This is the whole
    brain of the feature and the only part worth unit-testing.
    """
    after_local = after.astimezone(TIMEZONE)
    allowed = set(weekdays) if weekdays else set(_ALL_DAYS)

    if kind in ("daily", "weekly"):
        assert at_time is not None
        # Within 8 days we always hit an allowed weekday whose time is still ahead
        # (offset 7 covers "one weekday a week, and today's already passed").
        for offset in range(8):
            day = (after_local + timedelta(days=offset)).date()
            if day.isoweekday() not in allowed:
                continue
            candidate = datetime.combine(day, at_time, tzinfo=TIMEZONE)
            if candidate > after_local:
                return candidate.astimezone(timezone.utc)
        raise ValueError("no next fire found for daily/weekly schedule")

    if kind == "interval":
        assert interval_min is not None and interval_min > 0
        step = timedelta(minutes=interval_min)
        start = window_start or time(0, 0)
        end = window_end or time(23, 59)
        for offset in range(8):
            day = (after_local + timedelta(days=offset)).date()
            if day.isoweekday() not in allowed:
                continue
            slot = datetime.combine(day, start, tzinfo=TIMEZONE)
            day_end = datetime.combine(day, end, tzinfo=TIMEZONE)
            # Slots are anchored to window_start, so fires land on tidy boundaries.
            while slot <= day_end:
                if slot > after_local:
                    return slot.astimezone(timezone.utc)
                slot += step
            # Exhausted today's window; roll to the next allowed day's start.
        raise ValueError("no next fire found for interval schedule")

    raise ValueError(f"unknown recurrence kind: {kind}")


# --- queries -----------------------------------------------------------------

_COLUMNS = (
    "id, user_id, chat_id, text, kind, at_time, weekdays, interval_min, "
    "window_start, window_end, next_fire_at, last_fired_at, paused_at"
)


async def add_notification(
    pool: asyncpg.Pool,
    user_id: int,
    chat_id: int,
    text: str,
    *,
    kind: str,
    at_time: time | None,
    weekdays: list[int] | None,
    interval_min: int | None,
    window_start: time | None,
    window_end: time | None,
    next_fire: datetime,
) -> int:
    return await pool.fetchval(
        """
        INSERT INTO recurring_notification
            (user_id, chat_id, text, kind, at_time, weekdays, interval_min,
             window_start, window_end, next_fire_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        """,
        user_id,
        chat_id,
        text,
        kind,
        at_time,
        weekdays,
        interval_min,
        window_start,
        window_end,
        next_fire,
    )


async def list_active(pool: asyncpg.Pool, user_id: int) -> list[asyncpg.Record]:
    return await pool.fetch(
        f"SELECT {_COLUMNS} FROM recurring_notification "
        "WHERE user_id = $1 AND canceled_at IS NULL "
        "ORDER BY created_at, id LIMIT $2",
        user_id,
        _LIST_LIMIT,
    )


async def get_notification(
    pool: asyncpg.Pool, user_id: int, notification_id: int
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        f"SELECT {_COLUMNS} FROM recurring_notification "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL",
        notification_id,
        user_id,
    )


async def pause_notification(
    pool: asyncpg.Pool, user_id: int, notification_id: int
) -> None:
    await pool.execute(
        "UPDATE recurring_notification SET paused_at = now() "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL AND paused_at IS NULL",
        notification_id,
        user_id,
    )


async def resume_notification(
    pool: asyncpg.Pool, user_id: int, notification_id: int, next_fire: datetime
) -> None:
    await pool.execute(
        "UPDATE recurring_notification SET paused_at = NULL, next_fire_at = $3 "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL",
        notification_id,
        user_id,
        next_fire,
    )


async def cancel_notification(
    pool: asyncpg.Pool, user_id: int, notification_id: int
) -> None:
    await pool.execute(
        "UPDATE recurring_notification SET canceled_at = now() "
        "WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL",
        notification_id,
        user_id,
    )


async def _due(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    return await pool.fetch(
        f"SELECT {_COLUMNS} FROM recurring_notification "
        "WHERE canceled_at IS NULL AND paused_at IS NULL AND next_fire_at <= now() "
        "ORDER BY next_fire_at LIMIT $1",
        _BATCH,
    )


async def _mark_fired(
    pool: asyncpg.Pool, notification_id: int, next_fire: datetime
) -> None:
    await pool.execute(
        "UPDATE recurring_notification SET last_fired_at = now(), next_fire_at = $2 "
        "WHERE id = $1",
        notification_id,
        next_fire,
    )


# --- the heartbeat -----------------------------------------------------------


def _row_schedule(row: asyncpg.Record) -> dict:
    """The compute_next_fire kwargs for a stored row."""
    return {
        "kind": row["kind"],
        "at_time": row["at_time"],
        "weekdays": row["weekdays"],
        "interval_min": row["interval_min"],
        "window_start": row["window_start"],
        "window_end": row["window_end"],
    }


async def check_due(bot, pool: asyncpg.Pool) -> None:
    """Send every recurring message that's due, then advance each past now."""
    rows = await _due(pool)
    now = datetime.now(timezone.utc)
    for row in rows:
        try:
            await bot.send_message(row["chat_id"], row["text"])
        except Exception:  # noqa: BLE001 — leave next_fire_at so the next tick retries
            log.exception("failed to send recurring message %s", row["id"])
            continue
        # Advance from now, not from the (possibly stale) pointer: one catch-up max.
        next_fire = compute_next_fire(after=now, **_row_schedule(row))
        await _mark_fired(pool, row["id"], next_fire)


async def recurring_loop(bot, pool: asyncpg.Pool) -> None:
    """Background task started by main(): fire due recurring messages every minute."""
    log.info("recurring-message loop started")
    while True:
        try:
            await check_due(bot, pool)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a bad tick must not kill the loop
            log.exception("recurring check failed")
        await asyncio.sleep(REMINDER_INTERVAL_SECONDS)


# --- pure helpers ------------------------------------------------------------


def _parse_hhmm(raw: str | None) -> time | None:
    """A time of day from '09:00', '9', '9pm', '21:30'; None if unrecognised."""
    if not raw:
        return None
    match = _TIME_RE.match(raw)
    if match is None:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = (match.group(3) or "").lower()
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        if meridiem == "pm" and hour != 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour, minute)


def _days_label(weekdays: list[int] | None) -> str:
    if not weekdays or sorted(set(weekdays)) == _ALL_DAYS:
        return "Every day"
    return ", ".join(_WEEKDAY_NAMES[d] for d in sorted(set(weekdays)))


def _interval_label(minutes: int | None) -> str:
    if minutes is None:
        return "?"
    return _INTERVAL_LABELS.get(minutes, f"{minutes} min")


def _describe(
    *,
    kind: str,
    at_time: time | None,
    weekdays: list[int] | None,
    interval_min: int | None,
    window_start: time | None,
    window_end: time | None,
) -> str:
    """A one-line, human summary of a schedule (typed values, not pending strings)."""
    days = _days_label(weekdays)
    if kind in ("daily", "weekly"):
        return f"{days} · {at_time.strftime('%H:%M')}" if at_time else days
    every = _interval_label(interval_min)
    if window_start and window_end:
        window = f"{window_start.strftime('%H:%M')}–{window_end.strftime('%H:%M')}"
    else:
        window = "all day"
    return f"{days} · every {every} · {window}"


def _pending_schedule(pending: dict) -> dict:
    """Convert the builder's string-y pending dict into typed compute kwargs."""
    return {
        "kind": pending["kind"],
        "at_time": _parse_hhmm(pending.get("at_time")),
        "weekdays": pending.get("weekdays") or None,
        "interval_min": pending.get("interval_min"),
        "window_start": _parse_hhmm(pending.get("window_start")),
        "window_end": _parse_hhmm(pending.get("window_end")),
    }


def _fmt_when(dt: datetime) -> str:
    return dt.astimezone(TIMEZONE).strftime("%a %d %b · %H:%M")


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# --- rendering ---------------------------------------------------------------


def _cb(action: str, rest: str = "") -> str:
    return f"{CALLBACK_PREFIX}{action}{':' + rest if rest else ''}"


_CANCEL_ROW = [InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))]


def _render_list(rows: list[asyncpg.Record]) -> tuple[str, InlineKeyboardMarkup]:
    if not rows:
        text = (
            "🔁 No recurring messages yet.\n\n"
            "Tap ➕ New to schedule one — like every day at 07:00, "
            "or Fridays every hour."
        )
        keyboard = [[InlineKeyboardButton("➕ New", callback_data=_cb("new"))]]
        return text, InlineKeyboardMarkup(keyboard)

    text = "🔁 Recurring messages — tap one to manage it."
    keyboard = [
        [
            InlineKeyboardButton(
                _truncate(f"{'⏸ ' if row['paused_at'] else ''}{row['text']}", _LABEL_WIDE),
                callback_data=_cb("open", str(row["id"])),
            )
        ]
        for row in rows
    ]
    keyboard.append([InlineKeyboardButton("➕ New", callback_data=_cb("new"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_kind() -> tuple[str, InlineKeyboardMarkup]:
    text = "🔁 New recurring message — how often should it repeat?"
    keyboard = [
        [
            InlineKeyboardButton("📅 Daily", callback_data=_cb("k", "daily")),
            InlineKeyboardButton("🗓 Weekly", callback_data=_cb("k", "weekly")),
            InlineKeyboardButton("⏱ Interval", callback_data=_cb("k", "interval")),
        ],
        _CANCEL_ROW,
    ]
    return text, InlineKeyboardMarkup(keyboard)


def _render_time(prompt: str) -> tuple[str, InlineKeyboardMarkup]:
    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for hhmm in _COMMON_TIMES:
        row.append(InlineKeyboardButton(hhmm, callback_data=_cb("t", hhmm)))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("⌨ Type a time…", callback_data=_cb("typet"))])
    keyboard.append(_CANCEL_ROW)
    return prompt, InlineKeyboardMarkup(keyboard)


def _render_interval() -> tuple[str, InlineKeyboardMarkup]:
    text = "⏱ Repeat how often?"
    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for minutes, label in _INTERVALS:
        row.append(InlineKeyboardButton(label, callback_data=_cb("iv", str(minutes))))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append(_CANCEL_ROW)
    return text, InlineKeyboardMarkup(keyboard)


def _render_window() -> tuple[str, InlineKeyboardMarkup]:
    text = "🕘 All day, or only inside a daily time window?"
    keyboard = [
        [
            InlineKeyboardButton("🌍 All day", callback_data=_cb("winall")),
            InlineKeyboardButton("🕘 Set a window", callback_data=_cb("winset")),
        ],
        _CANCEL_ROW,
    ]
    return text, InlineKeyboardMarkup(keyboard)


def _render_weekdays(pending: dict) -> tuple[str, InlineKeyboardMarkup]:
    selected = set(pending.get("weekdays") or [])
    summary = _days_label(pending.get("weekdays"))
    text = f"📆 Which days? Tap to toggle, then Done.\n\nSelected: {summary}"
    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for day in _ALL_DAYS:
        mark = "✅ " if day in selected else ""
        row.append(
            InlineKeyboardButton(f"{mark}{_WEEKDAY_NAMES[day]}", callback_data=_cb("wd", str(day)))
        )
        if len(row) == 4:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append(
        [
            InlineKeyboardButton("🌍 Every day", callback_data=_cb("wdall")),
            InlineKeyboardButton("✅ Done", callback_data=_cb("wddone")),
        ]
    )
    keyboard.append(_CANCEL_ROW)
    return text, InlineKeyboardMarkup(keyboard)


def _render_confirm(pending: dict) -> tuple[str, InlineKeyboardMarkup]:
    desc = _describe(**_pending_schedule(pending))
    text = f"🔁 Schedule this?\n{desc}\n“{pending.get('text', '')}”"
    keyboard = [
        [
            InlineKeyboardButton("✅ Save", callback_data=_cb("save")),
            InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel")),
        ]
    ]
    return text, InlineKeyboardMarkup(keyboard)


def _detail_text(row: asyncpg.Record) -> str:
    desc = _describe(**_row_schedule(row))
    status = "⏸ Paused" if row["paused_at"] else f"Next: {_fmt_when(row['next_fire_at'])}"
    return f"🔁 {desc}\n“{row['text']}”\n{status}"


def _render_detail(row: asyncpg.Record) -> tuple[str, InlineKeyboardMarkup]:
    paused = row["paused_at"] is not None
    toggle = (
        InlineKeyboardButton("▶️ Resume", callback_data=_cb("resume", str(row["id"])))
        if paused
        else InlineKeyboardButton("⏸ Pause", callback_data=_cb("pause", str(row["id"])))
    )
    keyboard = [
        [toggle, InlineKeyboardButton("🗑 Delete", callback_data=_cb("del", str(row["id"])))],
        [InlineKeyboardButton("⬅ Back", callback_data=_cb("list"))],
    ]
    return _detail_text(row), InlineKeyboardMarkup(keyboard)


# --- context helpers ---------------------------------------------------------


def _pool(context: ContextTypes.DEFAULT_TYPE) -> asyncpg.Pool | None:
    return context.application.bot_data.get(POOL_KEY)


def _pending(context: ContextTypes.DEFAULT_TYPE) -> dict:
    assert context.user_data is not None
    return context.user_data.get(RECUR_PENDING) or {}


def _arm_text(context: ContextTypes.DEFAULT_TYPE, pending: dict) -> None:
    """Store the in-progress build and route the next typed message to us."""
    assert context.user_data is not None
    context.user_data[RECUR_PENDING] = pending
    context.user_data[AWAITING_KEY] = AWAITING_RECUR_TEXT


def _clear(context: ContextTypes.DEFAULT_TYPE) -> None:
    assert context.user_data is not None
    context.user_data.pop(RECUR_PENDING, None)
    context.user_data.pop(AWAITING_KEY, None)


async def _respond(
    update: Update, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    """Edit in place when a button was tapped, else reply fresh."""
    query = update.callback_query
    if query is not None:
        try:
            await query.edit_message_text(text, reply_markup=markup)
        except BadRequest:
            pass
    elif update.effective_message is not None:
        await update.effective_message.reply_text(text, reply_markup=markup)


# --- command handler + builder flow ------------------------------------------


async def show_recurring(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/remind and the 🔁 menu button — list active recurring messages."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    rows = await list_active(pool, update.effective_user.id)
    text, markup = _render_list(rows)
    await _respond(update, text, markup)


async def _start_new(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert context.user_data is not None and update.effective_chat is not None
    context.user_data.pop(AWAITING_KEY, None)
    context.user_data[RECUR_PENDING] = {"chat_id": update.effective_chat.id}
    await _respond(update, *_render_kind())


async def _choose_kind(
    update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str
) -> None:
    if kind not in ("daily", "weekly", "interval"):
        return
    pending = _pending(context)
    if "chat_id" not in pending:
        await _respond(update, "That expired. Start again with /remind.")
        return
    pending["kind"] = kind
    if kind == "daily":
        pending["time_target"] = "at"
        await _respond(update, *_render_time("📅 Every day at what time?"))
    elif kind == "weekly":
        pending["weekdays"] = []
        await _respond(update, *_render_weekdays(pending))
    else:  # interval
        await _respond(update, *_render_interval())


async def _toggle_weekday(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    pending = _pending(context)
    try:
        day = int(rest)
    except ValueError:
        return
    if day not in _ALL_DAYS:
        return
    selected = set(pending.get("weekdays") or [])
    selected.symmetric_difference_update({day})
    pending["weekdays"] = sorted(selected)
    await _respond(update, *_render_weekdays(pending))


async def _weekdays_all(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    pending["weekdays"] = []  # empty means every day
    await _respond(update, *_render_weekdays(pending))


async def _weekdays_done(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    kind = pending.get("kind")
    if kind == "weekly":
        pending["time_target"] = "at"
        await _respond(update, *_render_time("🗓 At what time on those days?"))
    elif kind == "interval":
        await _prompt_text(update, context)
    else:
        await _respond(update, "That expired. Start again with /remind.")


async def _choose_interval(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    pending = _pending(context)
    try:
        minutes = int(rest)
    except ValueError:
        return
    if minutes not in _INTERVAL_LABELS:
        return
    pending["interval_min"] = minutes
    await _respond(update, *_render_window())


async def _window_all(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    pending["window_start"] = None
    pending["window_end"] = None
    pending["weekdays"] = pending.get("weekdays") or []
    await _respond(update, *_render_weekdays(pending))


async def _window_set(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    pending["time_target"] = "winstart"
    await _respond(update, *_render_time("🕘 When should the daily window start?"))


async def _time_button(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    parsed = _parse_hhmm(rest)
    if parsed is None:
        return
    await _apply_time(update, context, parsed)


async def _prompt_typed_time(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    pending["step"] = "time"
    _arm_text(context, pending)
    await _respond(
        update,
        "Send a time as HH:MM (24-hour), e.g. 09:00 or 21:30.\n\n/cancel to abort.",
    )


async def _apply_time(
    update: Update, context: ContextTypes.DEFAULT_TYPE, parsed: time
) -> None:
    """Route a chosen/typed time to whatever the builder is currently asking for."""
    assert context.user_data is not None
    # A time just landed; drop any stale "awaiting typed input" flag. Branches that
    # need more typing (the message step) re-arm it themselves.
    context.user_data.pop(AWAITING_KEY, None)
    pending = _pending(context)
    target = pending.get("time_target")
    hhmm = parsed.strftime("%H:%M")
    if target == "at":
        pending["at_time"] = hhmm
        await _prompt_text(update, context)
    elif target == "winstart":
        pending["window_start"] = hhmm
        pending["time_target"] = "winend"
        await _respond(update, *_render_time("🕘 …and when should it end?"))
    elif target == "winend":
        start = _parse_hhmm(pending.get("window_start"))
        if start is None or parsed <= start:
            pending["time_target"] = "winend"
            await _respond(
                update,
                *_render_time(
                    f"End must be after {pending.get('window_start')}. Pick an end time."
                ),
            )
            return
        pending["window_end"] = hhmm
        await _respond(update, *_render_weekdays(pending))
    else:
        await _respond(update, "That expired. Start again with /remind.")


async def _prompt_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = _pending(context)
    pending["step"] = "text"
    _arm_text(context, pending)
    await _respond(
        update,
        "Now send me the message to deliver each time.\n\n/cancel to abort.",
    )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """A plain message while a /remind prompt is pending (a typed time, or the text)."""
    assert update.message is not None and context.user_data is not None
    pending = context.user_data.get(RECUR_PENDING) or {}
    step = pending.get("step")
    context.user_data.pop(AWAITING_KEY, None)
    raw = (update.message.text or "").strip()

    if step == "time":
        parsed = _parse_hhmm(raw)
        if parsed is None:
            _arm_text(context, pending)
            await update.message.reply_text(
                "I couldn't read that time. Try HH:MM, like 09:00 or 9pm.\n\n/cancel to abort."
            )
            return
        pending.pop("step", None)
        await _apply_time(update, context, parsed)
    elif step == "text":
        if not raw:
            _arm_text(context, pending)
            await update.message.reply_text(
                "Send the message text to deliver.\n\n/cancel to abort."
            )
            return
        pending["text"] = raw
        pending.pop("step", None)
        text, markup = _render_confirm(pending)
        await update.message.reply_text(text, reply_markup=markup)
    else:
        _clear(context)
        await update.message.reply_text("That prompt expired. Start again with /remind.")


async def _save(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.effective_user is not None
    pending = _pending(context)
    if not pending.get("kind") or not pending.get("text") or "chat_id" not in pending:
        await _respond(update, "That expired. Start again with /remind.")
        return
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    schedule = _pending_schedule(pending)
    if schedule["kind"] in ("daily", "weekly") and schedule["at_time"] is None:
        await _respond(update, "That's missing a time. Start again with /remind.")
        return
    if schedule["kind"] == "interval" and not schedule["interval_min"]:
        await _respond(update, "That's missing an interval. Start again with /remind.")
        return

    now = datetime.now(timezone.utc)
    next_fire = compute_next_fire(after=now, **schedule)
    await add_notification(
        pool,
        update.effective_user.id,
        pending["chat_id"],
        pending["text"],
        next_fire=next_fire,
        **schedule,
    )
    _clear(context)
    await _respond(
        update,
        f"🔁 Scheduled — {_describe(**schedule)}\n"
        f"“{pending['text']}”\nNext: {_fmt_when(next_fire)}",
    )


# --- managing existing notifications -----------------------------------------


async def _open_detail(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        notification_id = int(rest)
    except ValueError:
        return
    row = await get_notification(pool, update.effective_user.id, notification_id)
    if row is None:
        await show_recurring(update, context)
        return
    await _respond(update, *_render_detail(row))


async def _pause(update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        notification_id = int(rest)
    except ValueError:
        return
    await pause_notification(pool, update.effective_user.id, notification_id)
    await _open_detail(update, context, rest)


async def _resume(update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        notification_id = int(rest)
    except ValueError:
        return
    row = await get_notification(pool, update.effective_user.id, notification_id)
    if row is None:
        await show_recurring(update, context)
        return
    # Resuming after a pause leaves a stale pointer; recompute from now.
    next_fire = compute_next_fire(after=datetime.now(timezone.utc), **_row_schedule(row))
    await resume_notification(pool, update.effective_user.id, notification_id, next_fire)
    await _open_detail(update, context, rest)


async def _confirm_delete(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        notification_id = int(rest)
    except ValueError:
        return
    row = await get_notification(pool, update.effective_user.id, notification_id)
    if row is None:
        await show_recurring(update, context)
        return
    keyboard = [
        [
            InlineKeyboardButton("🗑 Delete", callback_data=_cb("delok", rest)),
            InlineKeyboardButton("⬅ Keep", callback_data=_cb("open", rest)),
        ]
    ]
    await _respond(
        update,
        f"Delete this recurring message?\n“{row['text']}”",
        InlineKeyboardMarkup(keyboard),
    )


async def _do_delete(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        notification_id = int(rest)
    except ValueError:
        return
    await cancel_notification(pool, update.effective_user.id, notification_id)
    await show_recurring(update, context)


# --- callback dispatch -------------------------------------------------------


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route recur: inline-button taps."""
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

    if action == "list":
        await show_recurring(update, context)
    elif action == "new":
        await _start_new(update, context)
    elif action == "k":
        await _choose_kind(update, context, rest)
    elif action == "wd":
        await _toggle_weekday(update, context, rest)
    elif action == "wdall":
        await _weekdays_all(update, context)
    elif action == "wddone":
        await _weekdays_done(update, context)
    elif action == "iv":
        await _choose_interval(update, context, rest)
    elif action == "winall":
        await _window_all(update, context)
    elif action == "winset":
        await _window_set(update, context)
    elif action == "t":
        await _time_button(update, context, rest)
    elif action == "typet":
        await _prompt_typed_time(update, context)
    elif action == "save":
        await _save(update, context)
    elif action == "cancel":
        _clear(context)
        await query.edit_message_text("Cancelled.")
    elif action == "open":
        await _open_detail(update, context, rest)
    elif action == "pause":
        await _pause(update, context, rest)
    elif action == "resume":
        await _resume(update, context, rest)
    elif action == "del":
        await _confirm_delete(update, context, rest)
    elif action == "delok":
        await _do_delete(update, context, rest)
