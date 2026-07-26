-- The /calendar feature: one-off events with reminders the bot pushes over
-- Telegram. Times are entered in Asia/Riyadh and stored as TIMESTAMPTZ (UTC).
--
-- Each event fans out into calendar_reminder rows (one per ping — a day before
-- and an hour before), so the once-a-minute heartbeat is a single query for
-- "due and not yet sent" rather than any per-event timers that a redeploy would
-- lose. chat_id is stored per event so a reminder knows where to be delivered.

CREATE TABLE calendar_event (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      NOT NULL,
    chat_id     BIGINT      NOT NULL,
    title       TEXT        NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    location    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    canceled_at TIMESTAMPTZ
);
CREATE INDEX calendar_event_user_time
    ON calendar_event (user_id, starts_at) WHERE canceled_at IS NULL;

CREATE TABLE calendar_reminder (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id  BIGINT      NOT NULL REFERENCES calendar_event (id) ON DELETE CASCADE,
    kind      TEXT        NOT NULL CHECK (kind IN ('day', 'hour')),
    remind_at TIMESTAMPTZ NOT NULL,
    sent_at   TIMESTAMPTZ
);
-- The heartbeat's hot path: pending reminders whose time has come.
CREATE INDEX calendar_reminder_due ON calendar_reminder (remind_at) WHERE sent_at IS NULL;
