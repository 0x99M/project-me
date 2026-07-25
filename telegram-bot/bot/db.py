"""Postgres: a connection pool and a tiny forward-only migration runner.

No ORM and no migration framework — the schema is two tables. Migrations are
plain .sql files in ../migrations, applied in filename order on startup and
recorded in schema_migrations so each runs exactly once.
"""

from __future__ import annotations

import logging
from pathlib import Path

import asyncpg

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# A deploy briefly runs the old and new containers at once (the same overlap that
# produces the transient getUpdates Conflict). This advisory lock makes sure only
# one of them applies migrations; the other waits, then sees them already done.
MIGRATION_LOCK_KEY = 992_053_001

_SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


async def create_pool(dsn: str) -> asyncpg.Pool:
    """Open the shared pool. Small: one poller, one user, short queries."""
    return await asyncpg.create_pool(dsn, min_size=1, max_size=5)


def _load_migrations() -> list[tuple[str, str]]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [(path.name, path.read_text(encoding="utf-8")) for path in files]


async def migrate(pool: asyncpg.Pool) -> None:
    """Apply every pending migration inside one lock-guarded transaction.

    All-or-nothing per deploy: if any file fails, the whole batch rolls back, so
    the schema is never left half-migrated.
    """
    migrations = _load_migrations()
    if not migrations:
        log.warning("no migration files found in %s", MIGRATIONS_DIR)
        return

    applied_count = 0
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", MIGRATION_LOCK_KEY)
        await conn.execute(_SCHEMA_MIGRATIONS_DDL)
        applied = {
            row["version"]
            for row in await conn.fetch("SELECT version FROM schema_migrations")
        }
        for version, sql in migrations:
            if version in applied:
                continue
            log.info("applying migration %s", version)
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO schema_migrations (version) VALUES ($1)", version
            )
            applied_count += 1

    log.info("migrations: %d applied, schema up to date", applied_count)
