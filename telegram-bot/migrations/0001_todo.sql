-- A recurring daily routine. The items persist; "done" is a dated event, so the
-- list appears to reset each midnight without anything ever being deleted and
-- with every day's history kept for stats. "Today" is the Asia/Riyadh calendar
-- day, computed in the app and passed in as done_on.

CREATE TABLE todo_item (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    text        TEXT         NOT NULL,
    position    INTEGER      NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ                        -- soft delete: old stats still resolve the text
);

-- The active routine is an ordered set per user. Uniqueness is over live items
-- only, so an archived row keeps its old position without blocking a reorder.
CREATE UNIQUE INDEX todo_item_user_position
    ON todo_item (user_id, position)
    WHERE archived_at IS NULL;

CREATE TABLE todo_completion (
    item_id  BIGINT      NOT NULL REFERENCES todo_item (id) ON DELETE CASCADE,
    done_on  DATE        NOT NULL,                 -- the Asia/Riyadh day it counts for
    done_at  TIMESTAMPTZ NOT NULL DEFAULT now(),   -- the exact instant, for audit
    PRIMARY KEY (item_id, done_on)                 -- ticking twice in a day is a no-op
);

-- Streak and stats scans walk an item's days newest-first.
CREATE INDEX todo_completion_item_day
    ON todo_completion (item_id, done_on DESC);
