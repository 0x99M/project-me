-- A log of message ids in the private chat, so /clean can delete them by type.
--
-- The Bot API can't read history and won't delete anything older than 48 hours,
-- so this only records messages as they happen (incoming via a catch-all handler,
-- the bot's own via patched send_* methods) and rows are pruned once they age out
-- of the deletable window. kind lets /clean remove just text or just media.

CREATE TABLE chat_message (
    chat_id    BIGINT      NOT NULL,
    message_id BIGINT      NOT NULL,
    kind       TEXT        NOT NULL CHECK (kind IN ('text', 'media')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX chat_message_recent ON chat_message (chat_id, created_at);
