"""Unit tests for the recurrence engine — compute_next_fire is where all the risk
lives, so it's the one thing worth pinning down.

Runnable two ways:
  * pytest tests/test_recurring.py
  * python tests/test_recurring.py     (no pytest needed — a tiny runner at the end)

All times are reasoned about in Asia/Riyadh (UTC+3, no DST) and asserted in UTC.
"""

from __future__ import annotations

import sys
from datetime import datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# Allow "python tests/test_recurring.py" from anywhere in the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.tools.recurring import TIMEZONE, compute_next_fire  # noqa: E402


def _local(y: int, mo: int, d: int, h: int, mi: int) -> datetime:
    """A Riyadh-local wall time as an aware datetime."""
    return datetime(y, mo, d, h, mi, tzinfo=TIMEZONE)


def _at(dt: datetime) -> tuple[int, int, int, int, int]:
    """A UTC result expressed back in Riyadh local, for readable assertions."""
    local = dt.astimezone(TIMEZONE)
    return (local.year, local.month, local.day, local.hour, local.minute)


# 2026-08-14 is a Friday (isoweekday 5); 08-17 is Monday. Anchor tests to those.


def test_daily_later_today():
    nxt = compute_next_fire(
        kind="daily", at_time=time(7, 0), after=_local(2026, 8, 14, 6, 0)
    )
    assert _at(nxt) == (2026, 8, 14, 7, 0)


def test_daily_rolls_to_tomorrow_when_passed():
    nxt = compute_next_fire(
        kind="daily", at_time=time(7, 0), after=_local(2026, 8, 14, 7, 0)
    )
    assert _at(nxt) == (2026, 8, 15, 7, 0)


def test_daily_result_is_utc():
    nxt = compute_next_fire(
        kind="daily", at_time=time(7, 0), after=_local(2026, 8, 14, 6, 0)
    )
    # 07:00 Riyadh == 04:00 UTC.
    assert nxt.tzinfo == timezone.utc
    assert (nxt.hour, nxt.minute) == (4, 0)


def test_weekly_finds_coming_friday():
    # From Monday, the next Friday 09:00.
    nxt = compute_next_fire(
        kind="weekly", at_time=time(9, 0), weekdays=[5], after=_local(2026, 8, 17, 12, 0)
    )
    assert _at(nxt) == (2026, 8, 21, 9, 0)


def test_weekly_single_day_wraps_a_week():
    # It's Friday and 09:00 already passed → next Friday, seven days on.
    nxt = compute_next_fire(
        kind="weekly", at_time=time(9, 0), weekdays=[5], after=_local(2026, 8, 14, 10, 0)
    )
    assert _at(nxt) == (2026, 8, 21, 9, 0)


def test_weekly_multiple_days_picks_nearest():
    # Mon/Wed/Fri at 09:00, asked on Monday 10:00 → Wednesday next.
    nxt = compute_next_fire(
        kind="weekly", at_time=time(9, 0), weekdays=[1, 3, 5],
        after=_local(2026, 8, 17, 10, 0),
    )
    assert _at(nxt) == (2026, 8, 19, 9, 0)


def test_interval_next_slot_in_window():
    # Fridays, every hour, 09:00–21:00. Asked Friday 09:30 → 10:00.
    nxt = compute_next_fire(
        kind="interval", interval_min=60, window_start=time(9, 0),
        window_end=time(21, 0), weekdays=[5], after=_local(2026, 8, 14, 9, 30),
    )
    assert _at(nxt) == (2026, 8, 14, 10, 0)


def test_interval_after_window_rolls_to_next_day():
    # Past the 21:00 close on Friday → next Friday's 09:00 open.
    nxt = compute_next_fire(
        kind="interval", interval_min=60, window_start=time(9, 0),
        window_end=time(21, 0), weekdays=[5], after=_local(2026, 8, 14, 21, 30),
    )
    assert _at(nxt) == (2026, 8, 21, 9, 0)


def test_interval_slots_anchor_to_window_start():
    # 09:00 + 90-min steps → 09:00, 10:30, 12:00… Asked at 11:00 → 12:00.
    nxt = compute_next_fire(
        kind="interval", interval_min=90, window_start=time(9, 0),
        window_end=time(21, 0), after=_local(2026, 8, 14, 11, 0),
    )
    assert _at(nxt) == (2026, 8, 14, 12, 0)


def test_interval_all_day_no_window():
    # No window = midnight-anchored slots, every day. 02:15 with 60-min step → 03:00.
    nxt = compute_next_fire(
        kind="interval", interval_min=60, after=_local(2026, 8, 14, 2, 15)
    )
    assert _at(nxt) == (2026, 8, 14, 3, 0)


def test_downtime_advances_from_now_not_stale_pointer():
    # The heartbeat always calls with after=now, so a long outage yields the next
    # future slot (one catch-up), never a backlog. Asked "now" = 15:20 → 16:00.
    now = _local(2026, 8, 14, 15, 20)
    nxt = compute_next_fire(kind="daily", at_time=time(7, 0), after=now)
    assert _at(nxt) == (2026, 8, 15, 7, 0)  # strictly after now


def test_result_strictly_after_input():
    # Exactly on the boundary must move forward, never return the same instant.
    nxt = compute_next_fire(
        kind="interval", interval_min=60, after=_local(2026, 8, 14, 10, 0)
    )
    assert nxt.astimezone(TIMEZONE) > _local(2026, 8, 14, 10, 0)


def _main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  ok  {test.__name__}")
        except AssertionError as error:
            failed += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
