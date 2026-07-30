"""/export — a monthly or yearly /money report as a PDF.

Reads the existing money tables (no new storage) and renders a "Modernist" report
(flat, architectural, near-mono red on white, Archivo throughout) as HTML, which
WeasyPrint turns into a PDF off the event loop. Everything is JOD and computed in
Asia/Riyadh; transfers between accounts are excluded (they're not income/expense).
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from html import escape
from pathlib import Path

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest
from telegram.ext import ContextTypes

from bot.auth import is_authorized
from bot.tools.money import CURRENCY, POOL_KEY, TIMEZONE, fmt, list_accounts

log = logging.getLogger(__name__)

CALLBACK_PREFIX = "exp:"
_NO_DB = (
    "🗄️ The money report needs a database, which isn't configured here. "
    "It works on the deployed bot."
)

# Bundled Archivo (google/fonts, OFL) referenced via @font-face, so the PDF needs
# no runtime Google Fonts fetch. Copied into the image at /app/fonts.
_FONT_PATH = Path(__file__).resolve().parents[2] / "fonts" / "Archivo.ttf"

_MINUS = "−"  # true minus sign, not a hyphen


# --- periods -----------------------------------------------------------------


@dataclass(frozen=True)
class Period:
    start: date  # inclusive
    end: date  # exclusive
    label: str
    filename: str
    is_year: bool
    year: int


_MONTH_RE = re.compile(r"^(\d{4})-(\d{1,2})$")
_YEAR_RE = re.compile(r"^(\d{4})$")


def _today() -> date:
    return datetime.now(TIMEZONE).date()


def _month_period(year: int, month: int) -> Period:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return Period(start, end, start.strftime("%B %Y"), f"money-{year}-{month:02d}", False, year)


def _year_period(year: int) -> Period:
    return Period(date(year, 1, 1), date(year + 1, 1, 1), str(year), f"money-{year}", True, year)


def _parse_period(text: str) -> Period | None:
    text = text.strip()
    if (m := _MONTH_RE.match(text)) is not None:
        year, month = int(m.group(1)), int(m.group(2))
        if 2000 <= year <= 2100 and 1 <= month <= 12:
            return _month_period(year, month)
        return None
    if (y := _YEAR_RE.match(text)) is not None:
        year = int(y.group(1))
        if 2000 <= year <= 2100:
            return _year_period(year)
    return None


def _resolve_spec(spec: str) -> Period | None:
    today = _today()
    if spec == "tmonth":
        return _month_period(today.year, today.month)
    if spec == "lmonth":
        year, month = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
        return _month_period(year, month)
    if spec == "tyear":
        return _year_period(today.year)
    if spec == "lyear":
        return _year_period(today.year - 1)
    return None


# --- queries -----------------------------------------------------------------


async def _summary_totals(pool, user_id, start, end) -> tuple[Decimal, Decimal]:
    income = await pool.fetchval(
        "SELECT COALESCE(SUM(amount), 0) FROM money_txn WHERE user_id=$1 "
        "AND kind='income' AND occurred_on >= $2 AND occurred_on < $3",
        user_id, start, end,
    )
    expense = await pool.fetchval(
        "SELECT COALESCE(SUM(amount), 0) FROM money_txn WHERE user_id=$1 "
        "AND kind='expense' AND occurred_on >= $2 AND occurred_on < $3",
        user_id, start, end,
    )
    return income, expense


async def _breakdown(pool, user_id, start, end, kind):
    return await pool.fetch(
        "SELECT c.name, COALESCE(SUM(t.amount), 0) AS total FROM money_txn t "
        "LEFT JOIN money_category c ON c.id = t.category_id "
        "WHERE t.user_id=$1 AND t.kind=$2 AND t.occurred_on >= $3 AND t.occurred_on < $4 "
        "GROUP BY c.id, c.name ORDER BY total DESC",
        user_id, kind, start, end,
    )


async def _transactions(pool, user_id, start, end):
    return await pool.fetch(
        "SELECT t.occurred_on, t.kind, t.amount, t.note, c.name AS category, a.name AS account "
        "FROM money_txn t LEFT JOIN money_category c ON c.id = t.category_id "
        "JOIN money_account a ON a.id = t.account_id "
        "WHERE t.user_id=$1 AND t.kind IN ('expense','income') "
        "AND t.occurred_on >= $2 AND t.occurred_on < $3 ORDER BY t.occurred_on, t.id",
        user_id, start, end,
    )


async def _monthly_totals(pool, user_id, start, end) -> dict[int, tuple[Decimal, Decimal]]:
    rows = await pool.fetch(
        "SELECT EXTRACT(MONTH FROM occurred_on)::int AS m, "
        "COALESCE(SUM(amount) FILTER (WHERE kind='income'), 0) AS income, "
        "COALESCE(SUM(amount) FILTER (WHERE kind='expense'), 0) AS expense "
        "FROM money_txn WHERE user_id=$1 AND kind IN ('income','expense') "
        "AND occurred_on >= $2 AND occurred_on < $3 GROUP BY m",
        user_id, start, end,
    )
    return {r["m"]: (r["income"], r["expense"]) for r in rows}


async def _count(pool, user_id, start, end) -> int:
    return await pool.fetchval(
        "SELECT count(*) FROM money_txn WHERE user_id=$1 AND kind IN ('expense','income') "
        "AND occurred_on >= $2 AND occurred_on < $3",
        user_id, start, end,
    )


async def _collect(pool, user_id: int, period: Period) -> dict:
    income, expense = await _summary_totals(pool, user_id, period.start, period.end)
    report = {
        "label": period.label,
        "generated": _today().strftime("%d %b %Y"),
        "is_year": period.is_year,
        "year": period.year,
        "income": income,
        "expense": expense,
        "exp_cats": await _breakdown(pool, user_id, period.start, period.end, "expense"),
        "inc_cats": await _breakdown(pool, user_id, period.start, period.end, "income"),
        "accounts": await list_accounts(pool, user_id),
    }
    if period.is_year:
        report["monthly"] = await _monthly_totals(pool, user_id, period.start, period.end)
        report["count"] = await _count(pool, user_id, period.start, period.end)
    else:
        txns = await _transactions(pool, user_id, period.start, period.end)
        report["transactions"] = txns
        report["count"] = len(txns)
    return report


# --- number → string (formatter unchanged; only the sign glyph is chosen) ----


def _num(value: Decimal) -> str:
    return fmt(value, symbol=False)


def _signed_net(value: Decimal) -> str:
    """A signed figure that always shows its sign (+ / −)."""
    return f"{'+' if value >= 0 else _MINUS}{_num(abs(value))}"


def _balance(value: Decimal) -> str:
    """A balance: bare when positive, true-minus when negative."""
    return f"{_MINUS}{_num(abs(value))}" if value < 0 else _num(value)


# --- HTML (pure; rendered to PDF by build_pdf) -------------------------------


_CSS = """
:root {
  --color-bg: #f3f2f2;
  --color-text: #201e1d;
  --color-accent: #ec3013;
  --color-accent-700: #ae1800;
  --color-divider: rgba(32, 30, 29, 0.4); /* color-mix(in srgb, #201e1d 40%, transparent) */
  --color-neutral-200: #eae7e7;
  --color-neutral-300: #d7d3d3;
  --color-neutral-400: #bab6b6;
  --color-neutral-700: #605d5d;
  --font-heading: "Archivo", system-ui, sans-serif;
  --font-body: "Archivo", system-ui, sans-serif;
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
}
@page { size: A4; margin: 0.7in; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  orphans: 3;
  widows: 3;
}
h1, h2 { margin: 0; }

.masthead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 2px solid var(--color-divider);
  padding-bottom: var(--space-3);
}
.masthead h1 {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 44px;
  line-height: 0.95;
  letter-spacing: -0.02em;
  text-transform: uppercase;
}
.masthead__meta {
  text-align: right;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  line-height: 1.6;
}
.masthead__period { color: var(--color-text); font-weight: 600; }
.masthead__sub { color: var(--color-neutral-700); }

.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 2px solid var(--color-divider);
  break-inside: avoid;
}
.summary__cell {
  padding: var(--space-4);
  border-right: 1px solid var(--color-neutral-300);
}
.summary__cell:first-child { padding-left: 0; }
.summary__cell:last-child { padding-right: 0; border-right: none; }
.summary__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-neutral-700);
}
.summary__figure {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  margin-top: var(--space-2);
}
.summary__figure--net { color: var(--color-accent); }

.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-8);
  padding-top: var(--space-6);
}
.section-heading {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding-bottom: var(--space-2);
  border-bottom: 2px solid var(--color-divider);
}
.subsection { margin-top: var(--space-6); }

.cat-block { break-inside: avoid; margin-top: var(--space-3); }
.cat-row { display: flex; align-items: baseline; }
.cat-label { font-weight: 500; }
.cat-leader {
  flex: 1 1 auto;
  align-self: stretch;
  border-bottom: 1px dotted var(--color-neutral-400);
  margin: 0 var(--space-2);
  transform: translateY(-3px);
}
.cat-share {
  font-size: 10px;
  color: var(--color-neutral-700);
  letter-spacing: 0.06em;
}
.cat-amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-left: var(--space-3);
}
.cat-bar { height: 4px; background: var(--color-accent); margin-top: var(--space-1); }

.acct-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--space-1) 0;
}
.acct-row__balance { font-weight: 600; font-variant-numeric: tabular-nums; }
.acct-rule { border-top: 1px solid var(--color-neutral-300); margin-top: var(--space-2); }
.networth {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: var(--space-2);
}
.networth__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.networth__figure {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.detail { margin-top: var(--space-8); }
table.txn { width: 100%; border-collapse: collapse; }
table.txn thead { display: table-header-group; }
table.txn th {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-neutral-700);
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-neutral-300);
}
table.txn td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-neutral-200);
}
table.txn tr { break-inside: avoid; }
table.txn tbody tr:last-child td { border-bottom: 2px solid var(--color-divider); }
table.txn th:first-child, table.txn td:first-child { padding-left: 0; }
table.txn th:last-child, table.txn td:last-child { padding-right: 0; }
table.txn .amount { text-align: right; font-variant-numeric: tabular-nums; }
td.date { white-space: nowrap; }
td.account { color: var(--color-neutral-700); }
.amount .pos { font-weight: 600; color: var(--color-accent-700); }
.amount .neg { color: var(--color-text); }
tr.total td { font-weight: 600; }

.footnote {
  margin-top: var(--space-3);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-neutral-700);
}
"""


def _font_face_css() -> str:
    if _FONT_PATH.exists():
        return (
            '@font-face{font-family:"Archivo";'
            f'src:url("{_FONT_PATH.as_uri()}");'
            "font-weight:100 900;font-style:normal;font-display:swap;}"
        )
    return ""


def _masthead(report: dict) -> str:
    return (
        '<header class="masthead"><h1>MONEY<br>REPORT</h1>'
        '<div class="masthead__meta">'
        f'<div class="masthead__period">{escape(report["label"])}</div>'
        f'<div class="masthead__sub">Generated {escape(report["generated"])}</div>'
        f'<div class="masthead__sub">Currency {escape(CURRENCY)}</div>'
        "</div></header>"
    )


def _summary(report: dict) -> str:
    net = report["income"] - report["expense"]

    def cell(label: str, figure: str, extra: str = "") -> str:
        return (
            '<div class="summary__cell">'
            f'<div class="summary__label">{label}</div>'
            f'<div class="summary__figure {extra}">{figure}</div></div>'
        )

    return (
        '<section class="summary">'
        + cell("Income", _num(report["income"]))
        + cell("Expenses", _num(report["expense"]))
        + cell("Net", _signed_net(net), "summary__figure--net")
        + "</section>"
    )


def _cat_block(name, amount: Decimal, total: Decimal, *, bar: bool) -> str:
    share = round(float(amount) / float(total) * 100) if total and float(total) > 0 else 0
    row = (
        '<div class="cat-row">'
        f'<span class="cat-label">{escape(name or "Uncategorized")}</span>'
        '<span class="cat-leader"></span>'
        f'<span class="cat-share">{share}%</span>'
        f'<span class="cat-amount">{_num(amount)}</span></div>'
    )
    bar_html = f'<div class="cat-bar" style="width:{share}%"></div>' if bar else ""
    return f'<div class="cat-block">{row}{bar_html}</div>'


def _accounts_html(accounts) -> str:
    rows = "".join(
        '<div class="acct-row">'
        f'<span>{escape(a["name"])}</span>'
        f'<span class="acct-row__balance">{_balance(a["balance"])}</span></div>'
        for a in accounts
    )
    net = sum((a["balance"] for a in accounts), Decimal(0))
    return (
        '<h2 class="section-heading">Accounts</h2>'
        f"{rows}"
        '<div class="acct-rule"></div>'
        '<div class="networth"><span class="networth__label">Net worth</span>'
        f'<span class="networth__figure">{_balance(net)}</span></div>'
    )


def _body(report: dict) -> str:
    left = ""
    if report["exp_cats"]:
        blocks = "".join(
            _cat_block(c["name"], c["total"], report["expense"], bar=True) for c in report["exp_cats"]
        )
        left = f'<h2 class="section-heading">Spending by category</h2>{blocks}'

    right = ""
    if report["accounts"]:
        right += _accounts_html(report["accounts"])
    if report["inc_cats"]:
        blocks = "".join(
            _cat_block(c["name"], c["total"], report["income"], bar=False) for c in report["inc_cats"]
        )
        right += (
            '<div class="subsection"><h2 class="section-heading">Income by category</h2>'
            f"{blocks}</div>"
        )

    if not left and not right:
        return ""
    return f'<div class="body"><div class="col">{left}</div><div class="col">{right}</div></div>'


def _txn_table(txns) -> str:
    head = (
        "<thead><tr>"
        '<th class="date">Date</th><th>Category</th><th>Account</th>'
        '<th class="amount">Amount</th></tr></thead>'
    )
    rows = []
    for t in txns:
        signed = t["amount"] if t["kind"] == "income" else -t["amount"]
        if signed >= 0:
            amount = f'<span class="pos">+{_num(abs(signed))}</span>'
        else:
            amount = f'<span class="neg">{_MINUS}{_num(abs(signed))}</span>'
        rows.append(
            "<tr>"
            f'<td class="date">{t["occurred_on"].strftime("%d %b")}</td>'
            f'<td>{escape(t["category"] or "Uncategorized")}</td>'
            f'<td class="account">{escape(t["account"])}</td>'
            f'<td class="amount">{amount}</td></tr>'
        )
    return f'<table class="txn">{head}<tbody>{"".join(rows)}</tbody></table>'


def _monthly_table(monthly: dict, year: int) -> str:
    head = (
        "<thead><tr><th>Month</th>"
        '<th class="amount">Income</th><th class="amount">Expenses</th>'
        '<th class="amount">Net</th></tr></thead>'
    )
    rows = []
    total_income = total_expense = Decimal(0)
    for month in range(1, 13):
        income, expense = monthly.get(month, (Decimal(0), Decimal(0)))
        total_income += income
        total_expense += expense
        rows.append(
            "<tr>"
            f"<td>{date(year, month, 1).strftime('%b')}</td>"
            f'<td class="amount">{_num(income)}</td>'
            f'<td class="amount">{_num(expense)}</td>'
            f'<td class="amount">{_signed_net(income - expense)}</td></tr>'
        )
    rows.append(
        '<tr class="total"><td>Total</td>'
        f'<td class="amount">{_num(total_income)}</td>'
        f'<td class="amount">{_num(total_expense)}</td>'
        f'<td class="amount">{_signed_net(total_income - total_expense)}</td></tr>'
    )
    return f'<table class="txn">{head}<tbody>{"".join(rows)}</tbody></table>'


def _detail(report: dict) -> str:
    if report["is_year"]:
        return (
            '<section class="detail"><h2 class="section-heading">By month</h2>'
            f'{_monthly_table(report["monthly"], report["year"])}</section>'
        )
    return (
        '<section class="detail"><h2 class="section-heading">Transactions</h2>'
        f'{_txn_table(report["transactions"])}</section>'
    )


def _footnote(report: dict) -> str:
    n = report["count"]
    plural = "" if n == 1 else "s"
    return (
        '<div class="footnote">'
        f"Transfers between accounts are excluded · {n} transaction{plural}</div>"
    )


def _render_html(report: dict) -> str:
    parts = [_masthead(report), _summary(report)]
    body = _body(report)
    if body:
        parts.append(body)
    if report["count"] > 0:
        parts.append(_detail(report))
    parts.append(_footnote(report))
    style = _font_face_css() + _CSS
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        f"<style>{style}</style></head><body>{''.join(parts)}</body></html>"
    )


def build_pdf(report: dict) -> bytes:
    # Imported lazily so a missing system library disables /export rather than the
    # whole bot (bot.main imports this module at startup).
    from weasyprint import HTML

    return HTML(string=_render_html(report)).write_pdf()


# --- handlers ----------------------------------------------------------------


def _pool(context: ContextTypes.DEFAULT_TYPE):
    return context.application.bot_data.get(POOL_KEY)


def _command_args(text: str) -> str:
    parts = (text or "").strip().split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def _render_chooser() -> tuple[str, InlineKeyboardMarkup]:
    text = (
        "📄 Export a money report — pick a period:\n\n"
        "Or type a specific one: /export 2026-06 (month) or /export 2026 (year)."
    )
    keyboard = [
        [
            InlineKeyboardButton("📄 This month", callback_data=f"{CALLBACK_PREFIX}gen:tmonth"),
            InlineKeyboardButton("📄 Last month", callback_data=f"{CALLBACK_PREFIX}gen:lmonth"),
        ],
        [
            InlineKeyboardButton("📅 This year", callback_data=f"{CALLBACK_PREFIX}gen:tyear"),
            InlineKeyboardButton("📅 Last year", callback_data=f"{CALLBACK_PREFIX}gen:lyear"),
        ],
    ]
    return text, InlineKeyboardMarkup(keyboard)


async def start_export(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/export — a specific period if given, else the period chooser."""
    message = update.effective_message
    assert message is not None
    pool = _pool(context)
    if pool is None:
        await message.reply_text(_NO_DB)
        return
    args = _command_args(message.text or "")
    if args:
        period = _parse_period(args)
        if period is None:
            await message.reply_text(
                "Use /export 2026-06 (a month) or /export 2026 (a year), or just /export to pick."
            )
            return
        await _generate_and_send(update, context, period)
        return
    text, markup = _render_chooser()
    await message.reply_text(text, reply_markup=markup)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None:
        return
    config = context.application.bot_data["config"]
    await query.answer()
    if not is_authorized(update, config):
        return
    pool = _pool(context)
    if pool is None:
        await query.edit_message_text(_NO_DB)
        return

    action, _, rest = query.data[len(CALLBACK_PREFIX) :].partition(":")
    if action == "open":
        text, markup = _render_chooser()
        try:
            await query.edit_message_text(text, reply_markup=markup)
        except BadRequest:
            pass
    elif action == "gen":
        period = _resolve_spec(rest)
        if period is not None:
            await _generate_and_send(update, context, period)


async def _generate_and_send(
    update: Update, context: ContextTypes.DEFAULT_TYPE, period: Period
) -> None:
    assert update.effective_user is not None and update.effective_chat is not None
    pool = _pool(context)
    query = update.callback_query
    if query is not None:
        try:
            await query.edit_message_text(f"📄 Generating the {period.label} report…")
        except BadRequest:
            pass

    report = await _collect(pool, update.effective_user.id, period)
    loop = asyncio.get_running_loop()
    try:
        pdf = await loop.run_in_executor(None, build_pdf, report)
    except Exception:  # noqa: BLE001 — a render failure shouldn't crash the bot
        log.exception("failed to render report for %s", period.filename)
        message = "⚠️ Couldn't generate the report — something went wrong rendering the PDF."
        if query is not None:
            await query.edit_message_text(message)
        else:
            await update.effective_message.reply_text(message)
        return

    from io import BytesIO

    buf = BytesIO(pdf)
    buf.name = f"{period.filename}.pdf"
    await context.bot.send_document(
        chat_id=update.effective_chat.id,
        document=buf,
        filename=f"{period.filename}.pdf",
        caption=f"💼 Money report — {period.label}",
    )
    if query is not None:
        try:
            await query.edit_message_text(f"📄 Sent the {period.label} report.")
        except BadRequest:
            pass
