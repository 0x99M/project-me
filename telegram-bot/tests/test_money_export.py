"""Unit tests for the money CSV export — build_csv is the one pure piece worth
pinning down (the DB queries and Telegram plumbing are integration territory).

Runnable two ways:
  * pytest tests/test_money_export.py
  * python tests/test_money_export.py     (no pytest needed — a tiny runner at the end)

build_csv takes anything indexable by column name, so plain dicts stand in for
the asyncpg.Record rows the queries return.
"""

from __future__ import annotations

import csv
import io
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

# Allow "python tests/test_money_export.py" from anywhere in the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.tools.money_export import _CSV_COLUMNS, build_csv  # noqa: E402


def _row(occurred, kind, amount, note, category, account, created):
    return {
        "occurred_on": occurred,
        "kind": kind,
        "amount": Decimal(amount),
        "note": note,
        "category": category,
        "account": account,
        "created_at": created,
    }


def _parse(data: bytes) -> list[list[str]]:
    """Decode the export the way a spreadsheet would (BOM-aware) and parse it."""
    text = data.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def test_header_only_when_empty():
    rows = _parse(build_csv([]))
    assert rows == [_CSV_COLUMNS]


def test_bom_present_for_excel():
    # utf-8-sig prepends the BOM so Excel detects UTF-8 rather than mangling notes.
    assert build_csv([]).startswith(b"\xef\xbb\xbf")


def test_basic_expense_and_income():
    created = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)  # 07:30 Riyadh
    rows = _parse(
        build_csv(
            [
                _row(date(2026, 8, 14), "expense", "25.500", "lunch", "Food", "Cash", created),
                _row(date(2026, 8, 14), "income", "5000", None, "Salary", "Bank", created),
            ]
        )
    )
    assert rows[0] == _CSV_COLUMNS
    # date, kind, category, account, amount, currency, note, created_at
    assert rows[1] == [
        "2026-08-14", "expense", "Food", "Cash", "25.500", "JOD", "lunch", "2026-08-14 07:30",
    ]
    # amount keeps three decimals; empty note stays empty.
    assert rows[2] == [
        "2026-08-14", "income", "Salary", "Bank", "5000.000", "JOD", "", "2026-08-14 07:30",
    ]


def test_note_with_comma_is_quoted():
    created = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)
    data = build_csv(
        [_row(date(2026, 8, 14), "expense", "10", "coffee, cake", "Food", "Cash", created)]
    )
    # The raw bytes must quote the comma so it isn't read as a column break…
    assert b'"coffee, cake"' in data
    # …and a round-trip parse recovers the single field intact.
    assert _parse(data)[1][6] == "coffee, cake"


def test_transfers_kept_with_empty_category():
    created = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)
    rows = _parse(
        build_csv(
            [
                _row(date(2026, 8, 14), "transfer_out", "100", None, None, "Cash", created),
                _row(date(2026, 8, 14), "transfer_in", "100", None, None, "Bank", created),
            ]
        )
    )
    assert rows[1][1] == "transfer_out" and rows[1][2] == "" and rows[1][3] == "Cash"
    assert rows[2][1] == "transfer_in" and rows[2][2] == "" and rows[2][3] == "Bank"


def test_created_at_converted_to_riyadh():
    # 22:00 UTC is 01:00 the next day in Riyadh (UTC+3) — the date must roll over.
    created = datetime(2026, 8, 14, 22, 0, tzinfo=timezone.utc)
    rows = _parse(
        build_csv([_row(date(2026, 8, 14), "expense", "1", None, "Food", "Cash", created)])
    )
    assert rows[1][7] == "2026-08-15 01:00"


def test_missing_created_at_is_blank():
    rows = _parse(
        build_csv([_row(date(2026, 8, 14), "expense", "1", None, "Food", "Cash", None)])
    )
    assert rows[1][7] == ""


def _main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"ok   {test.__name__}")
        except AssertionError as exc:  # noqa: PERF203
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
