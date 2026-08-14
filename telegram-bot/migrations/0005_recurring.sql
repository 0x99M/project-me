-- /remind — recurring messages the bot pushes to you on a schedule (daily at a
-- time, weekly on chosen days, or on an interval inside an optional daily window).
-- Times are entered in Asia/Riyadh; next_fire_at is stored as TIMESTAMPTZ (UTC).
--
-- Unlike calendar_reminder, a recurring message has no fixed set of future rows —
-- it repeats forever. So instead of fanning out we keep a single next_fire_at
-- pointer that the once-a-minute heartbeat advances each time it fires. After
-- downtime the pointer is recomputed from "now", so a burst of missed slots
-- collapses to at most one catch-up send. chat_id is stored per row so a due
-- message knows where to be delivered.

CREATE TABLE recurring_notification (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    chat_id       BIGINT      NOT NULL,
    text          TEXT        NOT NULL,
    kind          TEXT        NOT NULL CHECK (kind IN ('daily', 'weekly', 'interval')),
    -- daily/weekly: the local time of day to fire.
    at_time       TIME,
    -- ISO weekday numbers (1=Mon .. 7=Sun); NULL means every day. Used to restrict
    -- weekly fires and to gate interval fires to certain days.
    weekdays      SMALLINT[],
    -- interval: fire every N minutes, optionally only within [window_start, window_end].
    interval_min  INT,
    window_start  TIME,
    window_end    TIME,
    -- engine state
    next_fire_at  TIMESTAMPTZ NOT NULL,
    last_fired_at TIMESTAMPTZ,
    paused_at     TIMESTAMPTZ,
    canceled_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The heartbeat's hot path: live notifications whose time has come.
CREATE INDEX recurring_notification_due
    ON recurring_notification (next_fire_at)
    WHERE canceled_at IS NULL AND paused_at IS NULL;
