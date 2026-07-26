"""/money — a personal ledger of accounts, spending, income and transfers.

Everything is in JOD, which divides into 1000 fils, so amounts carry three
decimal places (stored as NUMERIC(14,3); see migrations/0002_money.sql).

Balances are never stored: an account's balance is its opening balance plus the
signed sum of its transactions, computed on read, so it can never drift from the
ledger. A transfer is two linked rows — a transfer_out on the source account and
a transfer_in on the destination sharing one transfer_group — so the balance sum
stays uniform and a transfer nets to zero across accounts.

The fast path is `/spend 25 lunch`: type the amount and note, then tap a
category. The dashboard buttons (/money) drive the same actions by tapping.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import asyncpg
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Message, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.tools.youtube_audio import AWAITING_KEY

log = logging.getLogger(__name__)

# Same wall clock the /todo feature uses, so "today" and "this month" never shift
# under the server's UTC. Jordan and Riyadh both sit at UTC+3 with no DST.
TIMEZONE = ZoneInfo("Asia/Riyadh")

CURRENCY = "JOD"
# The dinar divides into 1000 fils, so it carries three decimals, not the usual two.
CURRENCY_DECIMALS = 3
_QUANTUM = Decimal(10) ** -CURRENCY_DECIMALS  # Decimal('0.001')

# Shared bot_data key where main() stashes the asyncpg pool (matches todo).
POOL_KEY = "pool"

CALLBACK_PREFIX = "money:"

# Discriminator main() maps to handle_text; the in-progress action itself lives in
# a MONEY_PENDING dict, whose "step" says what the next typed message means.
AWAITING_MONEY_TEXT = "money_text"
MONEY_PENDING = "money_pending"

_HISTORY_LIMIT = 15
# Full-width buttons (account/history rows) fit ~40 chars; two-per-row (categories)
# get roughly half the width, so keep those labels short.
_LABEL_WIDE = 40
_LABEL_CAT = 18

_NO_DB = (
    "🗄️ The money manager needs a database, which isn't configured here "
    "(set DATABASE_URL). It works on the deployed bot."
)

# Seeded on first use so /money is usable immediately; all editable afterwards.
_SEED_ACCOUNT = ("Cash", "💵")
_SEED_EXPENSE = [
    ("Food", "🍔"),
    ("Groceries", "🛒"),
    ("Transport", "🚗"),
    ("Rent", "🏠"),
    ("Bills", "🧾"),
    ("Fun", "🎉"),
]
_SEED_INCOME = [("Salary", "💼"), ("Other", "💰")]


def today() -> date:
    return datetime.now(TIMEZONE).date()


def _month_start(day: date) -> date:
    return day.replace(day=1)


# --- queries -----------------------------------------------------------------


async def ensure_seeded(pool: asyncpg.Pool, user_id: int) -> None:
    """Give a brand-new user a default Cash account and a starter category set."""
    async with pool.acquire() as conn, conn.transaction():
        exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM money_account WHERE user_id = $1)", user_id
        )
        if exists:
            return
        await conn.execute(
            "INSERT INTO money_account (user_id, name, emoji, is_default, position) "
            "VALUES ($1, $2, $3, true, 0)",
            user_id,
            _SEED_ACCOUNT[0],
            _SEED_ACCOUNT[1],
        )
        for position, (name, emoji) in enumerate(_SEED_EXPENSE):
            await conn.execute(
                "INSERT INTO money_category (user_id, name, kind, emoji, position) "
                "VALUES ($1, $2, 'expense', $3, $4)",
                user_id,
                name,
                emoji,
                position,
            )
        for position, (name, emoji) in enumerate(_SEED_INCOME):
            await conn.execute(
                "INSERT INTO money_category (user_id, name, kind, emoji, position) "
                "VALUES ($1, $2, 'income', $3, $4)",
                user_id,
                name,
                emoji,
                position,
            )


async def list_accounts(
    pool: asyncpg.Pool, user_id: int, *, include_archived: bool = False
) -> list[asyncpg.Record]:
    """Active accounts with their derived balances, default first."""
    return await pool.fetch(
        """
        SELECT a.id, a.name, a.emoji, a.is_default,
               a.opening_balance + COALESCE(SUM(
                   CASE WHEN t.kind IN ('income', 'transfer_in')
                        THEN t.amount ELSE -t.amount END), 0) AS balance
        FROM money_account a
        LEFT JOIN money_txn t ON t.account_id = a.id
        WHERE a.user_id = $1 AND ($2 OR a.archived_at IS NULL)
        GROUP BY a.id
        ORDER BY a.is_default DESC, a.position, a.id
        """,
        user_id,
        include_archived,
    )


async def default_account(pool: asyncpg.Pool, user_id: int) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, name, emoji FROM money_account "
        "WHERE user_id = $1 AND is_default AND archived_at IS NULL",
        user_id,
    )


async def account_owned(
    pool: asyncpg.Pool, user_id: int, account_id: int
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, name, emoji FROM money_account "
        "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
        account_id,
        user_id,
    )


async def account_balance(pool: asyncpg.Pool, account_id: int) -> Decimal:
    value = await pool.fetchval(
        """
        SELECT a.opening_balance + COALESCE(SUM(
                   CASE WHEN t.kind IN ('income', 'transfer_in')
                        THEN t.amount ELSE -t.amount END), 0)
        FROM money_account a
        LEFT JOIN money_txn t ON t.account_id = a.id
        WHERE a.id = $1
        GROUP BY a.id
        """,
        account_id,
    )
    return value if value is not None else Decimal(0)


async def list_categories(
    pool: asyncpg.Pool, user_id: int, kind: str
) -> list[asyncpg.Record]:
    return await pool.fetch(
        "SELECT id, name, emoji FROM money_category "
        "WHERE user_id = $1 AND kind = $2 AND archived_at IS NULL "
        "ORDER BY position, id",
        user_id,
        kind,
    )


async def category_owned(
    pool: asyncpg.Pool, user_id: int, category_id: int, kind: str
) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT id, name, emoji FROM money_category "
        "WHERE id = $1 AND user_id = $2 AND kind = $3 AND archived_at IS NULL",
        category_id,
        user_id,
        kind,
    )


async def category_by_id(
    pool: asyncpg.Pool, user_id: int, category_id: int
) -> asyncpg.Record | None:
    """A category of either kind — used when the kind is what the tap reveals."""
    return await pool.fetchrow(
        "SELECT id, name, emoji, kind FROM money_category "
        "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
        category_id,
        user_id,
    )


async def add_category(
    pool: asyncpg.Pool, user_id: int, kind: str, name: str, emoji: str | None = None
) -> int:
    """Insert a category at the end of its kind. May raise UniqueViolationError."""
    return await pool.fetchval(
        """
        INSERT INTO money_category (user_id, name, kind, emoji, position)
        VALUES ($1, $2, $3, $4,
                COALESCE((SELECT MAX(position) + 1 FROM money_category
                          WHERE user_id = $1 AND kind = $3), 0))
        RETURNING id
        """,
        user_id,
        name,
        kind,
        emoji,
    )


async def archive_category(pool: asyncpg.Pool, user_id: int, category_id: int) -> None:
    await pool.execute(
        "UPDATE money_category SET archived_at = now() "
        "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
        category_id,
        user_id,
    )


async def add_account(
    pool: asyncpg.Pool,
    user_id: int,
    name: str,
    opening: Decimal,
    emoji: str | None = None,
) -> int:
    """Insert an account; the very first one a user has becomes their default."""
    return await pool.fetchval(
        """
        INSERT INTO money_account (user_id, name, emoji, opening_balance, is_default, position)
        VALUES ($1, $2, $3, $4,
                NOT EXISTS (SELECT 1 FROM money_account
                            WHERE user_id = $1 AND archived_at IS NULL),
                COALESCE((SELECT MAX(position) + 1 FROM money_account
                          WHERE user_id = $1 AND archived_at IS NULL), 0))
        RETURNING id
        """,
        user_id,
        name,
        emoji,
        opening,
    )


async def set_default_account(pool: asyncpg.Pool, user_id: int, account_id: int) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "UPDATE money_account SET is_default = false "
            "WHERE user_id = $1 AND is_default",
            user_id,
        )
        await conn.execute(
            "UPDATE money_account SET is_default = true "
            "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
            account_id,
            user_id,
        )


async def archive_account(pool: asyncpg.Pool, user_id: int, account_id: int) -> str:
    """Soft-delete an account. Refuses unless it is empty and not the last one.

    Returns one of: ok, not_found, not_empty, last.
    """
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "SELECT is_default FROM money_account "
            "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
            account_id,
            user_id,
        )
        if row is None:
            return "not_found"
        balance = await conn.fetchval(
            """
            SELECT a.opening_balance + COALESCE(SUM(
                       CASE WHEN t.kind IN ('income', 'transfer_in')
                            THEN t.amount ELSE -t.amount END), 0)
            FROM money_account a
            LEFT JOIN money_txn t ON t.account_id = a.id
            WHERE a.id = $1
            GROUP BY a.id
            """,
            account_id,
        )
        if balance != 0:
            return "not_empty"
        active = await conn.fetchval(
            "SELECT COUNT(*) FROM money_account "
            "WHERE user_id = $1 AND archived_at IS NULL",
            user_id,
        )
        if active <= 1:
            return "last"
        await conn.execute(
            "UPDATE money_account SET archived_at = now(), is_default = false "
            "WHERE id = $1",
            account_id,
        )
        if row["is_default"]:
            # Promote another active account so a default always exists.
            await conn.execute(
                """
                UPDATE money_account SET is_default = true
                WHERE id = (SELECT id FROM money_account
                            WHERE user_id = $1 AND archived_at IS NULL
                            ORDER BY position, id LIMIT 1)
                """,
                user_id,
            )
        return "ok"


async def add_txn(
    pool: asyncpg.Pool,
    user_id: int,
    account_id: int,
    category_id: int | None,
    kind: str,
    amount: Decimal,
    note: str | None,
    occurred_on: date,
) -> int:
    return await pool.fetchval(
        """
        INSERT INTO money_txn
            (user_id, account_id, category_id, kind, amount, note, occurred_on)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        user_id,
        account_id,
        category_id,
        kind,
        amount,
        note,
        occurred_on,
    )


async def add_transfer(
    pool: asyncpg.Pool,
    user_id: int,
    from_id: int,
    to_id: int,
    amount: Decimal,
    note: str | None,
    occurred_on: date,
) -> uuid.UUID:
    group = uuid.uuid4()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO money_txn "
            "(user_id, account_id, kind, amount, note, occurred_on, transfer_group) "
            "VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6)",
            user_id,
            from_id,
            amount,
            note,
            occurred_on,
            group,
        )
        await conn.execute(
            "INSERT INTO money_txn "
            "(user_id, account_id, kind, amount, note, occurred_on, transfer_group) "
            "VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6)",
            user_id,
            to_id,
            amount,
            note,
            occurred_on,
            group,
        )
    return group


async def account_name_map(pool: asyncpg.Pool, user_id: int) -> dict[int, tuple[str, str]]:
    rows = await pool.fetch(
        "SELECT id, name, emoji FROM money_account WHERE user_id = $1", user_id
    )
    return {row["id"]: (row["name"], row["emoji"] or "") for row in rows}


async def recent_simple_txns(
    pool: asyncpg.Pool, user_id: int, limit: int
) -> list[asyncpg.Record]:
    """Recent non-transfer transactions (expense/income), newest first."""
    return await pool.fetch(
        """
        SELECT t.id, t.kind, t.amount, t.note, t.occurred_on, t.created_at,
               c.name AS category, c.emoji AS category_emoji
        FROM money_txn t
        LEFT JOIN money_category c ON c.id = t.category_id
        WHERE t.user_id = $1 AND t.transfer_group IS NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )


async def recent_transfers(
    pool: asyncpg.Pool, user_id: int, limit: int
) -> list[asyncpg.Record]:
    """Recent transfers collapsed to one row each, newest first."""
    return await pool.fetch(
        """
        SELECT transfer_group,
               MAX(occurred_on) AS occurred_on,
               MAX(created_at)  AS created_at,
               MAX(amount)      AS amount,
               MAX(account_id) FILTER (WHERE kind = 'transfer_out') AS from_id,
               MAX(account_id) FILTER (WHERE kind = 'transfer_in')  AS to_id
        FROM money_txn
        WHERE user_id = $1 AND transfer_group IS NOT NULL
        GROUP BY transfer_group
        ORDER BY MAX(created_at) DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )


async def delete_txn(pool: asyncpg.Pool, user_id: int, txn_id: int) -> None:
    await pool.execute(
        "DELETE FROM money_txn "
        "WHERE id = $1 AND user_id = $2 AND transfer_group IS NULL",
        txn_id,
        user_id,
    )


async def delete_transfer(pool: asyncpg.Pool, user_id: int, group: uuid.UUID) -> None:
    await pool.execute(
        "DELETE FROM money_txn WHERE user_id = $1 AND transfer_group = $2",
        user_id,
        group,
    )


async def month_stats(
    pool: asyncpg.Pool, user_id: int, start: date
) -> tuple[Decimal, Decimal, list[asyncpg.Record]]:
    spent = await pool.fetchval(
        "SELECT COALESCE(SUM(amount), 0) FROM money_txn "
        "WHERE user_id = $1 AND kind = 'expense' AND occurred_on >= $2",
        user_id,
        start,
    )
    earned = await pool.fetchval(
        "SELECT COALESCE(SUM(amount), 0) FROM money_txn "
        "WHERE user_id = $1 AND kind = 'income' AND occurred_on >= $2",
        user_id,
        start,
    )
    by_category = await pool.fetch(
        """
        SELECT c.name, c.emoji, COALESCE(SUM(t.amount), 0) AS total
        FROM money_txn t
        LEFT JOIN money_category c ON c.id = t.category_id
        WHERE t.user_id = $1 AND t.kind = 'expense' AND t.occurred_on >= $2
        GROUP BY c.id, c.name, c.emoji
        ORDER BY total DESC
        LIMIT 10
        """,
        user_id,
        start,
    )
    return spent, earned, by_category


# --- pure helpers ------------------------------------------------------------


def fmt(amount: Decimal | None, *, symbol: bool = True) -> str:
    value = amount if amount is not None else Decimal(0)
    text = f"{value:,.{CURRENCY_DECIMALS}f}"
    return f"{text} {CURRENCY}" if symbol else text


def _command_args(message: Message) -> str:
    """'/spend 25 lunch' -> '25 lunch'; '/spend' -> ''."""
    parts = (message.text or "").strip().split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def _command_amount(update: Update) -> tuple[Decimal | None, str | None]:
    """Amount and note from a typed command. A button tap carries neither (its
    message is the dashboard, not a command), so return (None, None) for those."""
    if update.callback_query is not None or update.effective_message is None:
        return None, None
    return _split_amount_note(_command_args(update.effective_message))


def _parse_amount(raw: str) -> Decimal | None:
    """A positive money amount, rounded to fils, or None if it isn't one."""
    cleaned = raw.strip().replace(",", "").replace(CURRENCY, "").strip()
    if not cleaned:
        return None
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if not value.is_finite() or value <= 0:
        return None
    return value.quantize(_QUANTUM)


def detect_amount(text: str) -> str | None:
    """The normalised amount if the whole message is just a positive number.

    This is the auto-detect matcher (like the YouTube link one): a bare number
    means "money", so /money is offered without the user naming a command. It is
    strict on purpose — "spent 25" or "25 lunch" are not bare numbers and fall
    through to the normal handling.
    """
    amount = _parse_amount(text)
    return None if amount is None else str(amount)


def _parse_balance(raw: str) -> Decimal | None:
    """An opening balance: any finite number, including 0 or negative (debt)."""
    cleaned = raw.strip().replace(",", "").replace(CURRENCY, "").strip()
    if not cleaned:
        return None
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if not value.is_finite():
        return None
    return value.quantize(_QUANTUM)


def _split_amount_note(text: str) -> tuple[Decimal | None, str | None]:
    parts = text.strip().split(maxsplit=1)
    if not parts:
        return None, None
    amount = _parse_amount(parts[0])
    note = parts[1].strip() if len(parts) > 1 else None
    return amount, note


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _label(emoji: str | None, name: str) -> str:
    return f"{emoji + ' ' if emoji else ''}{name}"


# --- rendering ---------------------------------------------------------------


def _cb(action: str, rest: str = "") -> str:
    return f"{CALLBACK_PREFIX}{action}{':' + rest if rest else ''}"


def _render_dashboard(
    accounts: list[asyncpg.Record],
) -> tuple[str, InlineKeyboardMarkup]:
    net = sum((a["balance"] for a in accounts), Decimal(0))
    lines = [f"💼 Money — {fmt(net)}", ""]
    if accounts:
        for account in accounts:
            star = " ⭐" if account["is_default"] else ""
            label = _label(account["emoji"], account["name"])
            lines.append(f"{label} — {fmt(account['balance'], symbol=False)}{star}")
    else:
        lines.append("No accounts yet.")

    keyboard = [
        [
            InlineKeyboardButton("➕ Spend", callback_data=_cb("menu", "spend")),
            InlineKeyboardButton("💰 Income", callback_data=_cb("menu", "income")),
        ],
        [
            InlineKeyboardButton("🔁 Transfer", callback_data=_cb("menu", "transfer")),
            InlineKeyboardButton("📊 Stats", callback_data=_cb("menu", "stats")),
        ],
        [
            InlineKeyboardButton("🗒 History", callback_data=_cb("menu", "history")),
            InlineKeyboardButton("🏦 Accounts", callback_data=_cb("menu", "accounts")),
        ],
    ]
    return "\n".join(lines), InlineKeyboardMarkup(keyboard)


def _render_category_picker(
    pending: dict, categories: list[asyncpg.Record]
) -> tuple[str, InlineKeyboardMarkup]:
    if pending.get("origin") == "balance":
        # Reached from a "new balance" number: the account is fixed and the amount
        # is the difference the bot worked out, so explain that rather than "Spent".
        direction = "a spend" if pending["flow"] == "expense" else "income"
        account_label = _label(pending.get("account_emoji"), pending["account_name"])
        text = (
            f"New balance {fmt(pending['new_balance'])} on {account_label}\n"
            f"That's {direction} of {fmt(pending['amount'])} — tag it:"
        )
    else:
        verb = "Spent" if pending["flow"] == "expense" else "Received"
        note = f" · {pending['note']}" if pending.get("note") else ""
        text = f"{verb} {fmt(pending['amount'])}{note}\n\nPick a category:"

    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for category in categories:
        row.append(
            InlineKeyboardButton(
                _truncate(_label(category["emoji"], category["name"]), _LABEL_CAT),
                callback_data=_cb("pick", str(category["id"])),
            )
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)

    keyboard.append([InlineKeyboardButton("➕ New category", callback_data=_cb("newcat"))])
    # The account is locked when the amount was derived from it (new-balance flow):
    # changing it would change the difference, so only offer the switch otherwise.
    if not pending.get("fixed_account"):
        account_label = _label(pending.get("account_emoji"), pending["account_name"])
        keyboard.append(
            [InlineKeyboardButton(f"from {account_label} · change", callback_data=_cb("acct"))]
        )
    keyboard.append([InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_kind_question(pending: dict) -> tuple[str, InlineKeyboardMarkup]:
    text = (
        f"💰 {fmt(pending['entered'])} — what is this?\n\n"
        "🆕 New balance — what the account holds now (I'll record the difference).\n"
        "💸 Transaction — the amount of one spend or income."
    )
    keyboard = [
        [
            InlineKeyboardButton("🆕 New balance", callback_data=_cb("autobal")),
            InlineKeyboardButton("💸 Transaction", callback_data=_cb("autotxn")),
        ],
        [InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))],
    ]
    return text, InlineKeyboardMarkup(keyboard)


def _render_combined_picker(
    pending: dict,
    expense: list[asyncpg.Record],
    income: list[asyncpg.Record],
) -> tuple[str, InlineKeyboardMarkup]:
    account_label = _label(pending.get("account_emoji"), pending["account_name"])
    text = (
        f"Transaction {fmt(pending['amount'])} from {account_label}\n"
        "Pick a category — 🔻 spending subtracts, 🔺 income adds:"
    )
    keyboard: list[list[InlineKeyboardButton]] = []
    for mark, categories in (("🔻", expense), ("🔺", income)):
        row: list[InlineKeyboardButton] = []
        for category in categories:
            row.append(
                InlineKeyboardButton(
                    _truncate(f"{mark} {_label(category['emoji'], category['name'])}", _LABEL_CAT),
                    callback_data=_cb("pickc", str(category["id"])),
                )
            )
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
    keyboard.append([InlineKeyboardButton("➕ New category", callback_data=_cb("newcatk"))])
    keyboard.append([InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_account_choices(
    accounts: list[asyncpg.Record], action: str, prompt: str
) -> tuple[str, InlineKeyboardMarkup]:
    keyboard = [
        [
            InlineKeyboardButton(
                _truncate(
                    f"{_label(a['emoji'], a['name'])} — {fmt(a['balance'], symbol=False)}",
                    _LABEL_WIDE,
                ),
                callback_data=_cb(action, str(a["id"])),
            )
        ]
        for a in accounts
    ]
    keyboard.append([InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))])
    return prompt, InlineKeyboardMarkup(keyboard)


def _entry_confirmation(
    pending: dict, category_name: str, category_emoji: str | None, balance: Decimal
) -> str:
    sign = "🔻" if pending["flow"] == "expense" else "🔺"
    note = f" · {pending['note']}" if pending.get("note") else ""
    category = _label(category_emoji, category_name)
    account = _label(pending.get("account_emoji"), pending["account_name"])
    return (
        f"✅ {sign} {fmt(pending['amount'])} · {category}{note}\n"
        f"{account}: {fmt(balance, symbol=False)}"
    )


def _merge_history(
    simple: list[asyncpg.Record],
    transfers: list[asyncpg.Record],
    names: dict[int, tuple[str, str]],
) -> list[dict]:
    items: list[dict] = []
    for row in simple:
        sign = "🔻" if row["kind"] == "expense" else "🔺"
        category = _label(row["category_emoji"], row["category"] or "Uncategorized")
        note = f" · {row['note']}" if row["note"] else ""
        items.append(
            {
                "created_at": row["created_at"],
                "label": f"{sign} {fmt(row['amount'], symbol=False)} · {category}{note} "
                f"· {row['occurred_on']:%b %d}",
                "target": f"txn:{row['id']}",
            }
        )
    for row in transfers:
        from_name = names.get(row["from_id"], ("?", ""))[0]
        to_name = names.get(row["to_id"], ("?", ""))[0]
        items.append(
            {
                "created_at": row["created_at"],
                "label": f"↔ {fmt(row['amount'], symbol=False)} · "
                f"{from_name}→{to_name} · {row['occurred_on']:%b %d}",
                "target": f"xfer:{row['transfer_group']}",
            }
        )
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


def _render_history(entries: list[dict]) -> tuple[str, InlineKeyboardMarkup]:
    if not entries:
        text = "🗒 No transactions yet.\n\nAdd one with /spend 25 lunch."
        keyboard = [[InlineKeyboardButton("⬅ Back", callback_data=_cb("menu", "dashboard"))]]
        return text, InlineKeyboardMarkup(keyboard)

    text = "🗒 Recent — tap one to delete it."
    keyboard = [
        [
            InlineKeyboardButton(
                _truncate(entry["label"], _LABEL_WIDE),
                callback_data=_cb("histdel", entry["target"]),
            )
        ]
        for entry in entries
    ]
    keyboard.append([InlineKeyboardButton("⬅ Back", callback_data=_cb("menu", "dashboard"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_accounts(
    accounts: list[asyncpg.Record], banner: str | None = None
) -> tuple[str, InlineKeyboardMarkup]:
    lines = [banner] if banner else []
    lines.append("🏦 Accounts — tap one to make it your default.")
    text = "\n".join(lines)

    keyboard: list[list[InlineKeyboardButton]] = []
    for account in accounts:
        star = " ⭐" if account["is_default"] else ""
        label = f"{_label(account['emoji'], account['name'])} — {fmt(account['balance'], symbol=False)}{star}"
        keyboard.append(
            [
                InlineKeyboardButton(
                    _truncate(label, _LABEL_WIDE),
                    callback_data=_cb("acctdef", str(account["id"])),
                )
            ]
        )
        keyboard.append(
            [
                InlineKeyboardButton(
                    "🗑 Archive", callback_data=_cb("acctarch", str(account["id"]))
                )
            ]
        )
    keyboard.append([InlineKeyboardButton("➕ Add account", callback_data=_cb("acctadd"))])
    keyboard.append([InlineKeyboardButton("⬅ Back", callback_data=_cb("menu", "dashboard"))])
    return text, InlineKeyboardMarkup(keyboard)


def _render_categories(
    expense: list[asyncpg.Record],
    income: list[asyncpg.Record],
    banner: str | None = None,
) -> tuple[str, InlineKeyboardMarkup]:
    lines = [banner] if banner else []
    lines.append("🏷 Categories — tap 🗑 to archive one (your history keeps it).")
    lines.append("")
    lines.append("Spending: " + (", ".join(c["name"] for c in expense) or "—"))
    lines.append("Income: " + (", ".join(c["name"] for c in income) or "—"))
    text = "\n".join(lines)

    keyboard: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for category in [*expense, *income]:
        row.append(
            InlineKeyboardButton(
                _truncate(f"🗑 {_label(category['emoji'], category['name'])}", _LABEL_CAT),
                callback_data=_cb("catarch", str(category["id"])),
            )
        )
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("⬅ Back", callback_data=_cb("menu", "dashboard"))])
    return text, InlineKeyboardMarkup(keyboard)


# --- small context helpers ---------------------------------------------------


def _pool(context: ContextTypes.DEFAULT_TYPE) -> asyncpg.Pool | None:
    return context.application.bot_data.get(POOL_KEY)


async def _respond(
    update: Update, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    """Edit the message in place when a button was tapped, else reply fresh."""
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
    context.user_data.pop(MONEY_PENDING, None)
    context.user_data.pop(AWAITING_KEY, None)


def _arm_text(context: ContextTypes.DEFAULT_TYPE, pending: dict) -> None:
    """Store the in-progress action and route the next typed message to us."""
    assert context.user_data is not None
    context.user_data[MONEY_PENDING] = pending
    context.user_data[AWAITING_KEY] = AWAITING_MONEY_TEXT


# --- command handlers --------------------------------------------------------


async def show_dashboard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/money — net worth, per-account balances and the action buttons."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    await ensure_seeded(pool, update.effective_user.id)
    accounts = await list_accounts(pool, update.effective_user.id)
    text, markup = _render_dashboard(accounts)
    await _respond(update, text, markup)


async def start_from_number(
    message: Message, context: ContextTypes.DEFAULT_TYPE, detected: str
) -> None:
    """Auto-detect entry: a bare number was sent. Ask what it means, then branch.

    This is the `run` half of the detect/run pair, so it kicks off the flow and
    hands the rest to on_callback (new balance vs transaction, account, category).
    """
    assert context.user_data is not None
    pool = _pool(context)
    if pool is None:
        await message.reply_text(_NO_DB)
        return
    amount = _parse_amount(detected)
    user = message.from_user
    if amount is None or user is None:
        return
    await ensure_seeded(pool, user.id)
    context.user_data.pop(AWAITING_KEY, None)
    context.user_data[MONEY_PENDING] = {"origin": "number", "entered": amount}
    text, markup = _render_kind_question(context.user_data[MONEY_PENDING])
    await message.reply_text(text, reply_markup=markup)


async def start_spend(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/spend AMOUNT NOTE — log an expense, then tap a category."""
    await _start_entry(update, context, "expense")


async def start_income(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/income AMOUNT NOTE — log income, then tap a category."""
    await _start_entry(update, context, "income")


async def _start_entry(
    update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str
) -> None:
    assert update.effective_user is not None and update.effective_message is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    await ensure_seeded(pool, update.effective_user.id)

    # Only a typed command carries args; a button tap's message is the dashboard.
    amount, note = _command_amount(update)
    if amount is None:
        await _prompt_amount(update, context, kind, note)
        return
    await _begin_category_pick(update, context, kind, amount, note)


async def _prompt_amount(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    kind: str,
    note: str | None = None,
) -> None:
    step = "transfer_amount" if kind == "transfer" else "amount"
    _arm_text(context, {"flow": kind, "note": note, "step": step})
    if kind == "expense":
        prompt = "How much did you spend? Send the amount (e.g. 25 or 25.500)."
    elif kind == "income":
        prompt = "How much did you receive? Send the amount (e.g. 5000)."
    else:
        prompt = "How much to transfer? Send the amount."
    await _respond(update, prompt + "\n\n/cancel to abort.")


async def _begin_category_pick(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    kind: str,
    amount: Decimal,
    note: str | None,
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    user_id = update.effective_user.id
    account = await default_account(pool, user_id)
    if account is None:
        await _respond(update, "You have no account yet. Add one with /money_accounts.")
        return
    categories = await list_categories(pool, user_id, kind)

    _clear_pending(context)
    assert context.user_data is not None
    context.user_data[MONEY_PENDING] = {
        "flow": kind,
        "amount": amount,
        "note": note,
        "account_id": account["id"],
        "account_name": account["name"],
        "account_emoji": account["emoji"],
    }
    text, markup = _render_category_picker(context.user_data[MONEY_PENDING], categories)
    await _respond(update, text, markup)


async def start_transfer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/transfer AMOUNT — move money between two of your accounts."""
    assert update.effective_user is not None and update.effective_message is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    user_id = update.effective_user.id
    await ensure_seeded(pool, user_id)
    accounts = await list_accounts(pool, user_id)
    if len(accounts) < 2:
        await _respond(
            update, "You need at least two accounts to transfer. Add one with /money_accounts."
        )
        return

    amount, note = _command_amount(update)
    if amount is None:
        await _prompt_amount(update, context, "transfer", note)
        return
    await _transfer_pick_from(update, context, amount, note)


async def _transfer_pick_from(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    amount: Decimal,
    note: str | None,
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    accounts = await list_accounts(pool, update.effective_user.id)
    _clear_pending(context)
    assert context.user_data is not None
    context.user_data[MONEY_PENDING] = {"flow": "transfer", "amount": amount, "note": note}
    text, markup = _render_account_choices(
        accounts, "xfrom", f"Transfer {fmt(amount)} — from which account?"
    )
    await _respond(update, text, markup)


async def show_history(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/money_list — recent transactions, each tappable to delete."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    user_id = update.effective_user.id
    await ensure_seeded(pool, user_id)
    simple = await recent_simple_txns(pool, user_id, _HISTORY_LIMIT)
    transfers = await recent_transfers(pool, user_id, _HISTORY_LIMIT)
    names = await account_name_map(pool, user_id)
    entries = _merge_history(simple, transfers, names)[:_HISTORY_LIMIT]
    text, markup = _render_history(entries)
    await _respond(update, text, markup)


async def show_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/money_stats — this month's spending, income and per-category breakdown."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    user_id = update.effective_user.id
    await ensure_seeded(pool, user_id)
    now = today()
    spent, earned, by_category = await month_stats(pool, user_id, _month_start(now))
    net = earned - spent
    lines = [
        f"📊 {now:%B %Y}",
        "",
        f"Spent:  {fmt(spent)}",
        f"Income: {fmt(earned)}",
        f"Net:    {'+' if net >= 0 else ''}{fmt(net)}",
    ]
    if by_category:
        lines.append("")
        lines.append("Top spending:")
        for row in by_category:
            name = _label(row["emoji"], row["name"] or "Uncategorized")
            lines.append(f"  {name} — {fmt(row['total'], symbol=False)}")
    markup = InlineKeyboardMarkup(
        [[InlineKeyboardButton("⬅ Back", callback_data=_cb("menu", "dashboard"))]]
    )
    await _respond(update, "\n".join(lines), markup)


async def show_accounts(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/money_accounts — list balances, add, set default, archive."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    await ensure_seeded(pool, update.effective_user.id)
    accounts = await list_accounts(pool, update.effective_user.id)
    text, markup = _render_accounts(accounts)
    await _respond(update, text, markup)


async def show_categories(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/money_categories — view categories and archive the ones you don't use."""
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        await _respond(update, _NO_DB)
        return
    user_id = update.effective_user.id
    await ensure_seeded(pool, user_id)
    expense = await list_categories(pool, user_id, "expense")
    income = await list_categories(pool, user_id, "income")
    text, markup = _render_categories(expense, income)
    await _respond(update, text, markup)


# --- typed follow-ups --------------------------------------------------------


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """A plain message while a /money prompt is pending; the step says what it is."""
    assert update.message is not None and context.user_data is not None
    pending = context.user_data.get(MONEY_PENDING) or {}
    step = pending.get("step")
    context.user_data.pop(AWAITING_KEY, None)
    raw = update.message.text or ""

    if step in ("amount", "transfer_amount"):
        amount = _parse_amount(raw)
        if amount is None:
            _arm_text(context, pending)  # keep the flow, ask again
            await update.message.reply_text(
                "That doesn't look like an amount. Try a number like 25 or 25.500."
                "\n\n/cancel to abort."
            )
            return
        if step == "transfer_amount":
            await _transfer_pick_from(update, context, amount, pending.get("note"))
        else:
            await _begin_category_pick(update, context, pending["flow"], amount, pending.get("note"))
    elif step == "category_name":
        await _finish_new_category(update, context, raw)
    elif step == "account_name":
        await _finish_account_name(update, context, raw)
    elif step == "account_opening":
        await _finish_account_opening(update, context, raw)
    else:
        _clear_pending(context)
        await update.message.reply_text("That prompt expired. Try /money again.")


async def _finish_new_category(
    update: Update, context: ContextTypes.DEFAULT_TYPE, raw: str
) -> None:
    assert update.message is not None and update.effective_user is not None
    name = raw.strip()
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if not name or "amount" not in pending:
        _clear_pending(context)
        await update.message.reply_text("Couldn't add that. Start again with /money.")
        return
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id
    try:
        category_id = await add_category(pool, user_id, pending["flow"], name)
    except asyncpg.UniqueViolationError:
        existing = await pool.fetchrow(
            "SELECT id FROM money_category "
            "WHERE user_id = $1 AND lower(name) = lower($2) AND kind = $3 AND archived_at IS NULL",
            user_id,
            name,
            pending["flow"],
        )
        category_id = existing["id"] if existing else None
    if category_id is None:
        _clear_pending(context)
        await update.message.reply_text("Couldn't add that category.")
        return

    category = await pool.fetchrow(
        "SELECT name, emoji FROM money_category WHERE id = $1", category_id
    )
    await add_txn(
        pool,
        user_id,
        pending["account_id"],
        category_id,
        pending["flow"],
        pending["amount"],
        pending.get("note"),
        today(),
    )
    balance = await account_balance(pool, pending["account_id"])
    _clear_pending(context)
    await update.message.reply_text(
        _entry_confirmation(pending, category["name"], category["emoji"], balance)
    )


async def _finish_account_name(
    update: Update, context: ContextTypes.DEFAULT_TYPE, raw: str
) -> None:
    assert update.message is not None
    name = raw.strip()
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if not name:
        _arm_text(context, pending)
        await update.message.reply_text("Send a name for the account.\n\n/cancel to abort.")
        return
    pending["name"] = name
    pending["step"] = "account_opening"
    _arm_text(context, pending)
    await update.message.reply_text(
        f"What's the current balance of “{name}”? Send a number (0 if empty)."
        "\n\n/cancel to abort."
    )


async def _finish_account_opening(
    update: Update, context: ContextTypes.DEFAULT_TYPE, raw: str
) -> None:
    assert update.message is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    name = pending.get("name")
    if not name:
        _clear_pending(context)
        await update.message.reply_text("Couldn't add that. Start again with /money_accounts.")
        return
    opening = _parse_balance(raw)
    if opening is None:
        _arm_text(context, pending)
        await update.message.reply_text(
            "Send the balance as a number, e.g. 1500 or 0.\n\n/cancel to abort."
        )
        return
    pool = _pool(context)
    if pool is None:
        await update.message.reply_text(_NO_DB)
        return
    user_id = update.effective_user.id
    try:
        await add_account(pool, user_id, name, opening)
    except asyncpg.UniqueViolationError:
        _clear_pending(context)
        await update.message.reply_text(f"You already have an account called “{name}”.")
        return
    _clear_pending(context)
    accounts = await list_accounts(pool, user_id)
    text, markup = _render_accounts(accounts, banner=f"✅ Added {name}.")
    await update.message.reply_text(text, reply_markup=markup)


# --- callback dispatch -------------------------------------------------------


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route money: inline-button taps."""
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

    if action == "menu":
        await _handle_menu(update, context, rest)
    elif action == "cancel":
        _clear_pending(context)
        await query.edit_message_text("Cancelled.")
    elif action == "pick":
        await _commit_entry(update, context, rest)
    elif action == "newcat":
        await _prompt_new_category(update, context)
    elif action == "acct":
        await _show_account_switcher(update, context)
    elif action == "setacct":
        await _switch_account(update, context, rest)
    elif action == "back":
        await _rerender_picker(update, context)
    elif action == "xfrom":
        await _transfer_pick_to(update, context, rest)
    elif action == "xto":
        await _commit_transfer(update, context, rest)
    elif action == "histdel":
        await _confirm_delete(update, context, rest)
    elif action == "deltx":
        await _delete_entry(update, context, "txn", rest)
    elif action == "delxf":
        await _delete_entry(update, context, "xfer", rest)
    elif action == "acctadd":
        await _prompt_new_account(update, context)
    elif action == "acctdef":
        await _account_set_default(update, context, rest)
    elif action == "acctarch":
        await _account_archive(update, context, rest)
    elif action == "catarch":
        await _category_archive(update, context, rest)
    elif action == "autobal":
        await _auto_choose(update, context, "balance")
    elif action == "autotxn":
        await _auto_choose(update, context, "txn")
    elif action == "balacct":
        await _auto_balance_account(update, context, rest)
    elif action == "txnacct":
        await _auto_txn_account(update, context, rest)
    elif action == "pickc":
        await _auto_txn_pick(update, context, rest)
    elif action == "newcatk":
        await _auto_txn_newcat(update, context)
    elif action == "nck":
        await _auto_txn_newcat_kind(update, context, rest)


# --- auto-detect (a bare number) flow ----------------------------------------


async def _auto_choose(
    update: Update, context: ContextTypes.DEFAULT_TYPE, mode: str
) -> None:
    """Q1 answered: the number is a new balance, or a transaction amount."""
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("origin") != "number" or "entered" not in pending:
        await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    pool = _pool(context)
    if pool is None:
        await update.callback_query.edit_message_text(_NO_DB)
        return
    accounts = await list_accounts(pool, update.effective_user.id)
    entered = pending["entered"]
    if mode == "balance":
        pending["mode"] = "balance"
        text, markup = _render_account_choices(
            accounts, "balacct", f"New balance {fmt(entered)} — which account?"
        )
    else:
        pending["mode"] = "txn"
        pending["amount"] = entered
        text, markup = _render_account_choices(
            accounts, "txnacct", f"Transaction {fmt(entered)} — from which account?"
        )
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _auto_balance_account(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    """A "new balance" account was picked: record the difference from its current."""
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("mode") != "balance" or "entered" not in pending:
        await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    pool = _pool(context)
    if pool is None:
        return
    user_id = update.effective_user.id
    try:
        account_id = int(rest)
    except ValueError:
        return
    account = await account_owned(pool, user_id, account_id)
    if account is None:
        await update.callback_query.edit_message_text("That account is gone.")
        return
    current = await account_balance(pool, account_id)
    entered = pending["entered"]
    delta = entered - current
    if delta == 0:
        _clear_pending(context)
        await update.callback_query.edit_message_text(
            f"✅ {account['name']} is already at {fmt(entered)} — nothing to record."
        )
        return
    # Below the entered balance means money left (a spend); above means money came in.
    kind = "expense" if delta < 0 else "income"
    pending.update(
        flow=kind,
        amount=abs(delta),
        note=None,
        account_id=account["id"],
        account_name=account["name"],
        account_emoji=account["emoji"],
        fixed_account=True,
        origin="balance",
        new_balance=entered,
    )
    categories = await list_categories(pool, user_id, kind)
    text, markup = _render_category_picker(pending, categories)
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _auto_txn_account(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    """A transaction account was picked: show categories of both kinds."""
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("mode") != "txn" or "amount" not in pending:
        await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    pool = _pool(context)
    if pool is None:
        return
    user_id = update.effective_user.id
    try:
        account_id = int(rest)
    except ValueError:
        return
    account = await account_owned(pool, user_id, account_id)
    if account is None:
        await update.callback_query.edit_message_text("That account is gone.")
        return
    pending.update(
        account_id=account["id"],
        account_name=account["name"],
        account_emoji=account["emoji"],
    )
    expense = await list_categories(pool, user_id, "expense")
    income = await list_categories(pool, user_id, "income")
    text, markup = _render_combined_picker(pending, expense, income)
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _auto_txn_pick(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    """A category was tapped in the combined picker: its kind sets the direction."""
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("mode") != "txn" or "amount" not in pending or "account_id" not in pending:
        await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    pool = _pool(context)
    if pool is None:
        return
    try:
        category_id = int(rest)
    except ValueError:
        return
    category = await category_by_id(pool, update.effective_user.id, category_id)
    if category is None:
        await update.callback_query.edit_message_text(
            "That category is gone — send the number again."
        )
        return
    pending["flow"] = category["kind"]
    await _commit_entry(update, context, str(category_id))


async def _auto_txn_newcat(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """New category from the combined picker: the kind isn't known yet, so ask."""
    assert update.callback_query is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("mode") != "txn" or "amount" not in pending:
        await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    keyboard = [
        [
            InlineKeyboardButton("🔻 Spending", callback_data=_cb("nck", "expense")),
            InlineKeyboardButton("🔺 Income", callback_data=_cb("nck", "income")),
        ],
        [InlineKeyboardButton("✖ Cancel", callback_data=_cb("cancel"))],
    ]
    await update.callback_query.edit_message_text(
        "New category — spending or income?", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def _auto_txn_newcat_kind(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("mode") != "txn" or "amount" not in pending or rest not in ("expense", "income"):
        if update.callback_query is not None:
            await update.callback_query.edit_message_text("That expired — send the number again.")
        return
    pending["flow"] = rest
    await _prompt_new_category(update, context)


async def _handle_menu(
    update: Update, context: ContextTypes.DEFAULT_TYPE, which: str
) -> None:
    if which == "spend":
        await _prompt_amount(update, context, "expense")
    elif which == "income":
        await _prompt_amount(update, context, "income")
    elif which == "transfer":
        await start_transfer(update, context)
    elif which == "stats":
        await show_stats(update, context)
    elif which == "history":
        await show_history(update, context)
    elif which == "accounts":
        await show_accounts(update, context)
    elif which == "dashboard":
        await show_dashboard(update, context)


async def _commit_entry(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("flow") not in ("expense", "income") or "amount" not in pending:
        await update.callback_query.edit_message_text(
            "That entry expired. Start again with /money."
        )
        return
    pool = _pool(context)
    if pool is None:
        await update.callback_query.edit_message_text(_NO_DB)
        return
    user_id = update.effective_user.id
    try:
        category_id = int(rest)
    except ValueError:
        return
    category = await category_owned(pool, user_id, category_id, pending["flow"])
    if category is None:
        await update.callback_query.edit_message_text(
            "That category is gone. Start again with /money."
        )
        return
    await add_txn(
        pool,
        user_id,
        pending["account_id"],
        category_id,
        pending["flow"],
        pending["amount"],
        pending.get("note"),
        today(),
    )
    balance = await account_balance(pool, pending["account_id"])
    _clear_pending(context)
    await update.callback_query.edit_message_text(
        _entry_confirmation(pending, category["name"], category["emoji"], balance)
    )


async def _prompt_new_category(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    assert update.callback_query is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if "amount" not in pending:
        await update.callback_query.edit_message_text(
            "That entry expired. Start again with /money."
        )
        return
    pending["step"] = "category_name"
    _arm_text(context, pending)
    await update.callback_query.edit_message_text(
        f"Send a name for the new {pending['flow']} category.\n\n/cancel to abort."
    )


async def _show_account_switcher(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if "amount" not in pending:
        await update.callback_query.edit_message_text(
            "That entry expired. Start again with /money."
        )
        return
    pool = _pool(context)
    if pool is None:
        await update.callback_query.edit_message_text(_NO_DB)
        return
    accounts = await list_accounts(pool, update.effective_user.id)
    keyboard = [
        [
            InlineKeyboardButton(
                _truncate(
                    f"{_label(a['emoji'], a['name'])} — {fmt(a['balance'], symbol=False)}",
                    _LABEL_WIDE,
                ),
                callback_data=_cb("setacct", str(a["id"])),
            )
        ]
        for a in accounts
    ]
    keyboard.append([InlineKeyboardButton("⬅ Back", callback_data=_cb("back"))])
    await update.callback_query.edit_message_text(
        "Which account?", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def _switch_account(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if "amount" not in pending:
        await _rerender_picker(update, context)
        return
    pool = _pool(context)
    if pool is None:
        return
    try:
        account_id = int(rest)
    except ValueError:
        return
    account = await account_owned(pool, update.effective_user.id, account_id)
    if account is not None:
        pending["account_id"] = account["id"]
        pending["account_name"] = account["name"]
        pending["account_emoji"] = account["emoji"]
    await _rerender_picker(update, context)


async def _rerender_picker(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if "amount" not in pending:
        await update.callback_query.edit_message_text(
            "That entry expired. Start again with /money."
        )
        return
    pool = _pool(context)
    if pool is None:
        return
    categories = await list_categories(pool, update.effective_user.id, pending["flow"])
    text, markup = _render_category_picker(pending, categories)
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _transfer_pick_to(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("flow") != "transfer" or "amount" not in pending:
        await update.callback_query.edit_message_text(
            "That transfer expired. Start again with /transfer."
        )
        return
    pool = _pool(context)
    if pool is None:
        return
    try:
        from_id = int(rest)
    except ValueError:
        return
    from_account = await account_owned(pool, update.effective_user.id, from_id)
    if from_account is None:
        await update.callback_query.edit_message_text("That account is gone.")
        return
    pending["from_id"] = from_id
    accounts = await list_accounts(pool, update.effective_user.id)
    others = [a for a in accounts if a["id"] != from_id]
    text, markup = _render_account_choices(
        others, "xto", f"Transfer {fmt(pending['amount'])} from {from_account['name']} — to?"
    )
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _commit_transfer(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pending = (context.user_data or {}).get(MONEY_PENDING) or {}
    if pending.get("flow") != "transfer" or "from_id" not in pending:
        await update.callback_query.edit_message_text(
            "That transfer expired. Start again with /transfer."
        )
        return
    pool = _pool(context)
    if pool is None:
        return
    user_id = update.effective_user.id
    try:
        to_id = int(rest)
    except ValueError:
        return
    from_id = pending["from_id"]
    if to_id == from_id:
        await update.callback_query.edit_message_text("Pick a different destination account.")
        return
    from_account = await account_owned(pool, user_id, from_id)
    to_account = await account_owned(pool, user_id, to_id)
    if from_account is None or to_account is None:
        await update.callback_query.edit_message_text("One of those accounts is gone.")
        return
    await add_transfer(pool, user_id, from_id, to_id, pending["amount"], pending.get("note"), today())
    from_balance = await account_balance(pool, from_id)
    to_balance = await account_balance(pool, to_id)
    _clear_pending(context)
    await update.callback_query.edit_message_text(
        f"✅ ↔ {fmt(pending['amount'])}\n"
        f"{from_account['name']}: {fmt(from_balance, symbol=False)}  →  "
        f"{to_account['name']}: {fmt(to_balance, symbol=False)}"
    )


async def _confirm_delete(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None
    kind, _, ident = rest.partition(":")
    yes = _cb("deltx", ident) if kind == "txn" else _cb("delxf", ident)
    keyboard = [
        [
            InlineKeyboardButton("🗑 Delete", callback_data=yes),
            InlineKeyboardButton("⬅ Keep", callback_data=_cb("menu", "history")),
        ]
    ]
    await update.callback_query.edit_message_text(
        "Delete this entry?", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def _delete_entry(
    update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str, ident: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    user_id = update.effective_user.id
    if kind == "txn":
        try:
            await delete_txn(pool, user_id, int(ident))
        except ValueError:
            return
    else:
        try:
            await delete_transfer(pool, user_id, uuid.UUID(ident))
        except ValueError:
            return
    await show_history(update, context)


async def _prompt_new_account(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    assert update.callback_query is not None
    _arm_text(context, {"flow": "account", "step": "account_name"})
    await update.callback_query.edit_message_text(
        "Send a name for the new account (e.g. Bank).\n\n/cancel to abort."
    )


async def _account_set_default(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        account_id = int(rest)
    except ValueError:
        return
    await set_default_account(pool, update.effective_user.id, account_id)
    accounts = await list_accounts(pool, update.effective_user.id)
    text, markup = _render_accounts(accounts)
    await _respond(update, text, markup)


async def _account_archive(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        account_id = int(rest)
    except ValueError:
        return
    result = await archive_account(pool, update.effective_user.id, account_id)
    banner = {
        "ok": "✅ Account archived.",
        "not_empty": "⚠️ Only an account with a zero balance can be archived.",
        "last": "⚠️ You can't archive your only account.",
        "not_found": "⚠️ That account is gone.",
    }.get(result)
    accounts = await list_accounts(pool, update.effective_user.id)
    text, markup = _render_accounts(accounts, banner=banner)
    await update.callback_query.edit_message_text(text, reply_markup=markup)


async def _category_archive(
    update: Update, context: ContextTypes.DEFAULT_TYPE, rest: str
) -> None:
    assert update.callback_query is not None and update.effective_user is not None
    pool = _pool(context)
    if pool is None:
        return
    try:
        category_id = int(rest)
    except ValueError:
        return
    await archive_category(pool, update.effective_user.id, category_id)
    user_id = update.effective_user.id
    expense = await list_categories(pool, user_id, "expense")
    income = await list_categories(pool, user_id, "income")
    text, markup = _render_categories(expense, income, banner="✅ Category archived.")
    await update.callback_query.edit_message_text(text, reply_markup=markup)
