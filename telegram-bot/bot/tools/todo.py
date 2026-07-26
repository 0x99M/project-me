"""/todo — a recurring daily routine you tick off, mostly by tapping buttons.

The items persist; "done" is a dated row (see migrations/0001_todo.sql), so the
list looks like it resets each Asia/Riyadh midnight while every day's history is
kept for /todo_stats. Nothing is ever wiped on a schedule.

The primary UI is one live message whose inline keyboard is the list: tapping a
row toggles done, the arrows reorder, the bin archives. The typed commands
(/todo_done N, /todo_order FROM TO, ...) are the same actions by number, kept as
a fallback.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Message, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.tools.youtube_audio import AWAITING_KEY

log = logging.getLogger(__name__)

# No DST, so a calendar day is unambiguous and never shifts under us.
TIMEZONE = ZoneInfo("Asia/Riyadh")

# Set by main() when a follow-up message should be treated as new item text.
AWAITING_TODO_ADD = "todo_add_text"

# Where main() stashes the asyncpg pool on application.bot_data.
POOL_KEY = "pool"

CALLBACK_PREFIX = "todo:"

STATS_WINDOW_DAYS = 30
STREAK_HISTORY_DAYS = 400

# Reorder writes positions in two phases inside one transaction: first shift every
# active row out of range so nothing collides with the partial unique index, then
# assign the final 0..n-1. This offset is the temporary out-of-range home.
_REORDER_OFFSET = 1_000_000

# The toggle button spans the full row width, so it has room for the whole item.
_LABEL_MAX = 60

_NO_DB = (
    "🗄️ The to-do list needs a database, which isn't configured here "
    "(set DATABASE_URL). It works on the deployed bot."
)


def today() -> date:
    return datetime.now(TIMEZONE).date()


# --- queries -----------------------------------------------------------------


async def add_item(pool: asyncpg.Pool, user_id: int, text: str) -> None:
    await pool.execute(
        """
        INSERT INTO todo_item (user_id, text, position)
        VALUES ($1, $2,
                COALESCE((SELECT MAX(position) + 1 FROM todo_item
                          WHERE user_id = $1 AND archived_at IS NULL), 0))
        """,
        user_id,
        text,
    )


async def list_today(
    pool: asyncpg.Pool, user_id: int, day: date
) -> list[asyncpg.Record]:
    """The active routine in order, each row flagged whether it is done today."""
    return await pool.fetch(
        """
        SELECT i.id, i.text, i.position, (c.item_id IS NOT NULL) AS done_today
        FROM todo_item i
        LEFT JOIN todo_completion c ON c.item_id = i.id AND c.done_on = $2
        WHERE i.user_id = $1 AND i.archived_at IS NULL
        ORDER BY i.position
        """,
        user_id,
        day,
    )


async def _owns_active(conn: asyncpg.Connection, user_id: int, item_id: int) -> bool:
    row = await conn.fetchrow(
        "SELECT 1 FROM todo_item WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
        item_id,
        user_id,
    )
    return row is not None


async def toggle(pool: asyncpg.Pool, user_id: int, item_id: int, day: date) -> None:
    async with pool.acquire() as conn, conn.transaction():
        if not await _owns_active(conn, user_id, item_id):
            return
        removed = await conn.execute(
            "DELETE FROM todo_completion WHERE item_id = $1 AND done_on = $2",
            item_id,
            day,
        )
        if removed == "DELETE 0":
            await conn.execute(
                "INSERT INTO todo_completion (item_id, done_on) VALUES ($1, $2) "
                "ON CONFLICT DO NOTHING",
                item_id,
                day,
            )


async def set_done(
    pool: asyncpg.Pool, user_id: int, item_id: int, day: date, done: bool
) -> None:
    async with pool.acquire() as conn:
        if not await _owns_active(conn, user_id, item_id):
            return
        if done:
            await conn.execute(
                "INSERT INTO todo_completion (item_id, done_on) VALUES ($1, $2) "
                "ON CONFLICT DO NOTHING",
                item_id,
                day,
            )
        else:
            await conn.execute(
                "DELETE FROM todo_completion WHERE item_id = $1 AND done_on = $2",
                item_id,
                day,
            )


async def archive(pool: asyncpg.Pool, user_id: int, item_id: int) -> None:
    await pool.execute(
        "UPDATE todo_item SET archived_at = now() "
        "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
        item_id,
        user_id,
    )


async def set_order(pool: asyncpg.Pool, user_id: int, ordered_ids: list[int]) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "UPDATE todo_item SET position = position + $2 "
            "WHERE user_id = $1 AND archived_at IS NULL",
            user_id,
            _REORDER_OFFSET,
        )
        for position, item_id in enumerate(ordered_ids):
            await conn.execute(
                "UPDATE todo_item SET position = $1 "
                "WHERE id = $2 AND user_id = $3 AND archived_at IS NULL",
                position,
                item_id,
                user_id,
            )


async def completion_dates(
    pool: asyncpg.Pool, user_id: int
) -> dict[int, list[date]]:
    """Recent done-days per active item, newest-first, for streaks and counts."""
    rows = await pool.fetch(
        """
        SELECT c.item_id, c.done_on
        FROM todo_completion c
        JOIN todo_item i ON i.id = c.item_id
        WHERE i.user_id = $1 AND i.archived_at IS NULL AND c.done_on >= $2
        ORDER BY c.item_id, c.done_on DESC
        """,
        user_id,
        today() - timedelta(days=STREAK_HISTORY_DAYS),
    )
    dates: dict[int, list[date]] = {}
    for row in rows:
        dates.setdefault(row["item_id"], []).append(row["done_on"])
    return dates


# --- pure helpers ------------------------------------------------------------


def current_streak(done_dates: list[date], as_of: date) -> int:
    """Consecutive days done, ending today or yesterday.

    Yesterday counts as the anchor so an item you simply have not ticked *yet*
    today still shows its live streak rather than dropping to zero.
    """
    days = set(done_dates)
    if as_of in days:
        cursor = as_of
    elif (as_of - timedelta(days=1)) in days:
        cursor = as_of - timedelta(days=1)
    else:
        return 0
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _window_count(done_dates: list[date], as_of: date) -> int:
    floor = as_of - timedelta(days=STATS_WINDOW_DAYS - 1)
    return sum(1 for day in done_dates if day >= floor)


def _command_arg(text: str) -> str:
    """'/todo_add buy milk' -> 'buy milk'; '/todo_add' -> ''."""
    parts = text.strip().split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def _int_args(text: str) -> list[int]:
    values: list[int] = []
    for token in _command_arg(text).split():
        try:
            values.append(int(token))
        except ValueError:
            continue
    return values


def _truncate(text: str) -> str:
    return text if len(text) <= _LABEL_MAX else text[: _LABEL_MAX - 1] + "…"


# --- rendering ---------------------------------------------------------------


def _render(rows: list[asyncpg.Record]) -> tuple[str, InlineKeyboardMarkup]:
    if not rows:
        text = "🗒️ Your routine is empty.\n\nTap ➕ Add to create your first item."
        keyboard = [[InlineKeyboardButton("➕ Add", callback_data=f"{CALLBACK_PREFIX}add")]]
        return text, InlineKeyboardMarkup(keyboard)

    done = sum(1 for row in rows if row["done_today"])
    text = f"🗒️ Today — {done}/{len(rows)} done\n\nTap an item to check it off."

    keyboard: list[list[InlineKeyboardButton]] = []
    for number, row in enumerate(rows, start=1):
        item_id = row["id"]
        mark = "✅" if row["done_today"] else "⬜"
        # The item is a full-width button on its own row (so the whole text shows
        # and tapping it toggles), with the reorder/delete controls as an even
        # three-way row beneath it.
        keyboard.append(
            [
                InlineKeyboardButton(
                    _truncate(f"{mark} {number}. {row['text']}"),
                    callback_data=f"{CALLBACK_PREFIX}toggle:{item_id}",
                )
            ]
        )
        keyboard.append(
            [
                InlineKeyboardButton("↑", callback_data=f"{CALLBACK_PREFIX}up:{item_id}"),
                InlineKeyboardButton("↓", callback_data=f"{CALLBACK_PREFIX}down:{item_id}"),
                InlineKeyboardButton("🗑", callback_data=f"{CALLBACK_PREFIX}del:{item_id}"),
            ]
        )
    keyboard.append(
        [
            InlineKeyboardButton("➕ Add", callback_data=f"{CALLBACK_PREFIX}add"),
            InlineKeyboardButton("📊 Stats", callback_data=f"{CALLBACK_PREFIX}stats"),
        ]
    )
    return text, InlineKeyboardMarkup(keyboard)


def _render_stats(rows: list[asyncpg.Record], dates: dict[int, list[date]]) -> str:
    if not rows:
        return "📊 No routine items yet — add some and check them off to build a history."
    as_of = today()
    lines = [f"📊 Last {STATS_WINDOW_DAYS} days", ""]
    for number, row in enumerate(rows, start=1):
        item_dates = dates.get(row["id"], [])
        count = _window_count(item_dates, as_of)
        streak = current_streak(item_dates, as_of)
        streak_note = f" · streak {streak}" if streak else ""
        lines.append(
            f"{number}. {row['text']} — {count}/{STATS_WINDOW_DAYS} days{streak_note}"
        )
    return "\n".join(lines)


def _pool(context: ContextTypes.DEFAULT_TYPE) -> asyncpg.Pool | None:
    return context.application.bot_data.get(POOL_KEY)


async def _show(message: Message, pool: asyncpg.Pool, user_id: int) -> None:
    text, markup = _render(await list_today(pool, user_id, today()))
    await message.reply_text(text, reply_markup=markup)


async def _respond(
    update: Update, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    """Edit in place when opened from a button (the /hint menu), else reply fresh."""
    query = update.callback_query
    if query is not None:
        try:
            await query.edit_message_text(text, reply_markup=markup)
        except BadRequest:
            pass
    elif update.effective_message is not None:
        await update.effective_message.reply_text(text, reply_markup=markup)


# --- command handlers --------------------------------------------------------


async def show_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo, /todo_list, and the 🗒 To-do menu button — the interactive checklist."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    text, markup = _render(await list_today(pool, update.effective_user.id, today()))
    await _respond(update, text, markup)


async def start_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo_add — add inline text if given, else prompt for the next message."""
    assert update.message is not None and context.user_data is not None
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return

    text = _command_arg(update.message.text or "")
    if text:
        await add_item(pool, update.effective_user.id, text)
        await _show(update.message, pool, update.effective_user.id)
        return

    context.user_data[AWAITING_KEY] = AWAITING_TODO_ADD
    await update.message.reply_text("Send me the to-do text.\n\n/cancel to abort.")


async def handle_add_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """The follow-up message after ➕ Add / bare /todo_add: the item's text."""
    assert update.message is not None and update.message.text is not None
    assert context.user_data is not None and update.effective_user is not None

    context.user_data.pop(AWAITING_KEY, None)
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return

    text = update.message.text.strip()
    if not text:
        await update.message.reply_text("That was empty — nothing added.")
        return
    await add_item(pool, update.effective_user.id, text)
    await _show(update.message, pool, update.effective_user.id)


async def _mark(update: Update, context: ContextTypes.DEFAULT_TYPE, done: bool) -> None:
    assert update.message is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id

    args = _int_args(update.message.text or "")
    if not args:
        verb = "done" if done else "undo"
        await update.message.reply_text(f"Give me the item number, e.g. /todo_{verb} 2.")
        return

    rows = await list_today(pool, user_id, today())
    number = args[0]
    if not 1 <= number <= len(rows):
        await update.message.reply_text(f"There is no item {number}.")
        return
    await set_done(pool, user_id, rows[number - 1]["id"], today(), done)
    await _show(update.message, pool, user_id)


async def mark_done(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo_done N — mark item N done for today."""
    await _mark(update, context, done=True)


async def mark_undone(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo_undo N — clear today's tick on item N."""
    await _mark(update, context, done=False)


async def reorder(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo_order FROM TO — move item FROM to position TO."""
    assert update.message is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id

    args = _int_args(update.message.text or "")
    if len(args) < 2:
        await update.message.reply_text("Give me two numbers, e.g. /todo_order 3 1.")
        return

    rows = await list_today(pool, user_id, today())
    source, target = args[0], args[1]
    if not (1 <= source <= len(rows) and 1 <= target <= len(rows)):
        await update.message.reply_text(f"Numbers must be between 1 and {len(rows)}.")
        return

    ids = [row["id"] for row in rows]
    ids.insert(target - 1, ids.pop(source - 1))
    await set_order(pool, user_id, ids)
    await _show(update.message, pool, user_id)


async def show_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/todo_stats — per-item completion over the last 30 days, plus streaks."""
    assert update.message is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id
    rows = await list_today(pool, user_id, today())
    dates = await completion_dates(pool, user_id)
    await update.message.reply_text(_render_stats(rows, dates))


# --- callback dispatch -------------------------------------------------------


async def _move(pool: asyncpg.Pool, user_id: int, item_id: int, direction: str) -> None:
    rows = await list_today(pool, user_id, today())
    ids = [row["id"] for row in rows]
    if item_id not in ids:
        return
    index = ids.index(item_id)
    swap = index - 1 if direction == "up" else index + 1
    if not 0 <= swap < len(ids):
        return  # already at the edge
    ids[index], ids[swap] = ids[swap], ids[index]
    await set_order(pool, user_id, ids)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the todo: inline-button taps and re-render the list in place."""
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
        if query.message is not None:
            await query.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id

    action, _, rest = query.data[len(CALLBACK_PREFIX) :].partition(":")

    if action == "add":
        context.user_data[AWAITING_KEY] = AWAITING_TODO_ADD
        if query.message is not None:
            await query.message.reply_text("Send me the to-do text.\n\n/cancel to abort.")
        return

    if action == "stats":
        rows = await list_today(pool, user_id, today())
        dates = await completion_dates(pool, user_id)
        if query.message is not None:
            await query.message.reply_text(_render_stats(rows, dates))
        return

    try:
        item_id = int(rest)
    except ValueError:
        return

    if action == "toggle":
        await toggle(pool, user_id, item_id, today())
    elif action == "del":
        await archive(pool, user_id, item_id)
    elif action in ("up", "down"):
        await _move(pool, user_id, item_id, action)
    else:
        return

    text, markup = _render(await list_today(pool, user_id, today()))
    try:
        await query.edit_message_text(text, reply_markup=markup)
    except BadRequest:
        # Tapping ↑ on the top row (or ↓ on the bottom) changes nothing; Telegram
        # rejects an identical edit. Not worth surfacing.
        pass
