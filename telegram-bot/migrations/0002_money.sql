-- The /money ledger: accounts, categories, transactions. Single currency (JOD),
-- which divides into 1000 fils, hence NUMERIC(14,3) throughout.
--
-- Balances are never stored. An account's balance is its opening_balance plus the
-- signed sum of its transactions, computed on read, so it can never drift from the
-- ledger. A transfer is two linked rows (a transfer_out on the source account and a
-- transfer_in on the destination) sharing one transfer_group, so the balance sum
-- stays uniform and a transfer nets to zero across accounts.

CREATE TABLE money_account (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT        NOT NULL,
    name            TEXT          NOT NULL,
    emoji           TEXT,
    opening_balance NUMERIC(14,3) NOT NULL DEFAULT 0,   -- what was in it before the bot; may be negative
    is_default      BOOLEAN       NOT NULL DEFAULT false,
    position        INTEGER       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX money_account_user_name
    ON money_account (user_id, lower(name)) WHERE archived_at IS NULL;
-- At most one default account per user.
CREATE UNIQUE INDEX money_account_one_default
    ON money_account (user_id) WHERE is_default AND archived_at IS NULL;

CREATE TABLE money_category (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      NOT NULL,
    name        TEXT        NOT NULL,
    kind        TEXT        NOT NULL CHECK (kind IN ('expense', 'income')),
    emoji       TEXT,
    position    INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX money_category_user_name
    ON money_category (user_id, lower(name), kind) WHERE archived_at IS NULL;

CREATE TABLE money_txn (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT        NOT NULL,
    account_id     BIGINT        NOT NULL REFERENCES money_account (id) ON DELETE RESTRICT,
    category_id    BIGINT        REFERENCES money_category (id) ON DELETE SET NULL,
    kind           TEXT          NOT NULL
        CHECK (kind IN ('expense', 'income', 'transfer_out', 'transfer_in')),
    amount         NUMERIC(14,3) NOT NULL CHECK (amount > 0),
    note           TEXT,
    occurred_on    DATE          NOT NULL,
    transfer_group UUID,          -- the two halves of a transfer share this
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX money_txn_user_day ON money_txn (user_id, occurred_on DESC);
CREATE INDEX money_txn_account  ON money_txn (account_id);
CREATE INDEX money_txn_category ON money_txn (category_id);
CREATE INDEX money_txn_transfer ON money_txn (transfer_group) WHERE transfer_group IS NOT NULL;
