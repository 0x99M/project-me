"""/export — a monthly or yearly /money report as a PDF.

Reads the existing money tables (no new storage), builds a PDF with reportlab off
the event loop, and sends it back as a document. Everything is JOD and computed in
Asia/Riyadh; transfers between accounts are excluded (they're not income/expense).
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
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

# A Unicode TTF so odd characters render; falls back to Helvetica (built-in) when
# the font isn't installed, e.g. local dev without the Debian package.
_FONT = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
for _name, _bold, _path in (
    ("DejaVu", False, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ("DejaVu-Bold", True, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
):
    try:
        pdfmetrics.registerFont(TTFont(_name, _path))
        if _bold:
            _FONT_BOLD = _name
        else:
            _FONT = _name
    except Exception:  # noqa: BLE001 — keep the built-in font if DejaVu is absent
        pass


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


async def _summary(pool, user_id, start, end) -> tuple[Decimal, Decimal]:
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


async def _collect(pool, user_id: int, period: Period) -> dict:
    income, expense = await _summary(pool, user_id, period.start, period.end)
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
    else:
        report["transactions"] = await _transactions(pool, user_id, period.start, period.end)
    return report


# --- PDF (sync; run in an executor) ------------------------------------------


def _num(value: Decimal) -> str:
    return fmt(value, symbol=False)


def _signed(value: Decimal) -> str:
    return f"{'+' if value >= 0 else '-'}{_num(abs(value))}"


def _title_style() -> ParagraphStyle:
    return ParagraphStyle("title", fontName=_FONT_BOLD, fontSize=18, spaceAfter=2)


def _meta_style() -> ParagraphStyle:
    return ParagraphStyle("meta", fontName=_FONT, fontSize=9, textColor=colors.grey, spaceAfter=10)


def _h2_style() -> ParagraphStyle:
    return ParagraphStyle("h2", fontName=_FONT_BOLD, fontSize=12, spaceBefore=12, spaceAfter=5)


def _cell_style() -> ParagraphStyle:
    return ParagraphStyle("cell", fontName=_FONT, fontSize=8, leading=10)


_HEADER_BG = colors.HexColor("#2b2b2b")
_GRID = colors.HexColor("#dddddd")


def _table_style(amount_cols: tuple[int, ...], *, header: bool = True) -> TableStyle:
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), _FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, _GRID),
    ]
    for col in amount_cols:
        commands.append(("ALIGN", (col, 0), (col, -1), "RIGHT"))
    if header:
        commands += [
            ("FONTNAME", (0, 0), (-1, 0), _FONT_BOLD),
            ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ]
    return TableStyle(commands)


def _summary_table(income: Decimal, expense: Decimal) -> Table:
    net = income - expense
    rows = [["Income", _num(income)], ["Expenses", _num(expense)], ["Net", _signed(net)]]
    table = Table(rows, colWidths=[60 * mm, 45 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), _FONT),
        ("FONTNAME", (0, -1), (-1, -1), _FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.grey),
    ]))
    return table


def _category_table(cats, total: Decimal) -> Table:
    data = [["Category", f"Amount ({CURRENCY})", "Share"]]
    total_f = float(total)
    for c in cats:
        share = f"{float(c['total']) / total_f * 100:.0f}%" if total_f > 0 else "—"
        data.append([c["name"] or "Uncategorized", _num(c["total"]), share])
    table = Table(data, colWidths=[85 * mm, 45 * mm, 20 * mm], hAlign="LEFT", repeatRows=1)
    table.setStyle(_table_style((1, 2)))
    return table


def _accounts_table(accounts) -> Table:
    data = [["Account", f"Balance ({CURRENCY})"]]
    net = Decimal(0)
    for a in accounts:
        data.append([a["name"], _num(a["balance"])])
        net += a["balance"]
    data.append(["Net worth", _num(net)])
    table = Table(data, colWidths=[85 * mm, 45 * mm], hAlign="LEFT", repeatRows=1)
    style = _table_style((1,))
    style.add("FONTNAME", (0, -1), (-1, -1), _FONT_BOLD)
    style.add("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.grey)
    table.setStyle(style)
    return table


def _txn_table(txns, cell: ParagraphStyle) -> Table:
    def para(text: str) -> Paragraph:
        return Paragraph(escape(text or ""), cell)

    data = [["Date", "Category", "Account", f"Amount ({CURRENCY})", "Note"]]
    for t in txns:
        amount = t["amount"] if t["kind"] == "income" else -t["amount"]
        data.append([
            t["occurred_on"].strftime("%d %b"),
            para(t["category"] or "Uncategorized"),
            para(t["account"]),
            _signed(amount),
            para(t["note"] or ""),
        ])
    table = Table(data, colWidths=[18 * mm, 40 * mm, 28 * mm, 30 * mm, 44 * mm], repeatRows=1)
    table.setStyle(_table_style((3,)))
    return table


def _monthly_table(monthly: dict, year: int) -> Table:
    data = [["Month", "Income", "Expenses", "Net"]]
    total_income = total_expense = Decimal(0)
    for month in range(1, 13):
        income, expense = monthly.get(month, (Decimal(0), Decimal(0)))
        total_income += income
        total_expense += expense
        data.append([
            date(year, month, 1).strftime("%b"),
            _num(income),
            _num(expense),
            _signed(income - expense),
        ])
    data.append(["Total", _num(total_income), _num(total_expense), _signed(total_income - total_expense)])
    table = Table(data, colWidths=[30 * mm, 40 * mm, 40 * mm, 40 * mm], hAlign="LEFT", repeatRows=1)
    style = _table_style((1, 2, 3))
    style.add("FONTNAME", (0, -1), (-1, -1), _FONT_BOLD)
    style.add("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.grey)
    table.setStyle(style)
    return table


def build_pdf(report: dict) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Money report — {report['label']}",
    )
    meta, h2, cell = _meta_style(), _h2_style(), _cell_style()
    story = [
        Paragraph("Money Report", _title_style()),
        Paragraph(f"{report['label']} · generated {report['generated']} · {CURRENCY}", meta),
        Paragraph("Summary", h2),
        _summary_table(report["income"], report["expense"]),
    ]
    if report["exp_cats"]:
        story += [Paragraph("Spending by category", h2), _category_table(report["exp_cats"], report["expense"])]
    if report["inc_cats"]:
        story += [Paragraph("Income by category", h2), _category_table(report["inc_cats"], report["income"])]
    if report["accounts"]:
        story += [Paragraph(f"Accounts (as of {report['generated']})", h2), _accounts_table(report["accounts"])]

    if report["is_year"]:
        story += [Paragraph("By month", h2), _monthly_table(report["monthly"], report["year"])]
    else:
        story.append(Paragraph("Transactions", h2))
        if report["transactions"]:
            story.append(_txn_table(report["transactions"], cell))
        else:
            story.append(Paragraph("No transactions in this period.", meta))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Transfers between accounts are excluded.", meta))
    doc.build(story)
    return buf.getvalue()


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
    pdf = await loop.run_in_executor(None, build_pdf, report)

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
