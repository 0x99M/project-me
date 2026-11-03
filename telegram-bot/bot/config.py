"""Configuration, loaded once at startup and validated eagerly."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    bot_token: str
    allowed_user_ids: frozenset[int]
    #: Postgres DSN. Optional: without it the /todo and /money commands say so and
    #: the rest of the bot runs unaffected, so local dev needs no database.
    database_url: str | None
    #: From my.telegram.org. Optional: with both set, /video_audio downloads videos
    #: over MTProto, past the Bot API's 20 MB download limit.
    telegram_api_id: int | None = None
    telegram_api_hash: str | None = None

    @property
    def mtproto_ready(self) -> bool:
        return self.telegram_api_id is not None and self.telegram_api_hash is not None


def _required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"{name} is not set. Copy .env.example to .env and fill it in.")
    return value


def _parse_allowed_user_ids(raw: str) -> frozenset[int]:
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            user_id = int(part)
        except ValueError:
            raise SystemExit(
                f'TELEGRAM_ALLOWED_USER_IDS contains "{part}", which is not a Telegram user ID.'
            ) from None
        if user_id <= 0:
            raise SystemExit(f"TELEGRAM_ALLOWED_USER_IDS contains {user_id}, which is not valid.")
        ids.add(user_id)

    # An empty allowlist would mean "trust nobody", but a typo that silently widened
    # access would be far worse, so refuse to start rather than guess.
    if not ids:
        raise SystemExit("TELEGRAM_ALLOWED_USER_IDS is empty. Set at least one user ID.")
    return frozenset(ids)


def _parse_api_credentials() -> tuple[int | None, str | None]:
    raw_id = (os.environ.get("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    if not raw_id and not api_hash:
        return None, None
    # Half a pair is a typo, not a choice; say so instead of quietly running without.
    if not raw_id or not api_hash:
        raise SystemExit("Set both TELEGRAM_API_ID and TELEGRAM_API_HASH, or neither.")
    try:
        api_id = int(raw_id)
    except ValueError:
        raise SystemExit(f'TELEGRAM_API_ID is "{raw_id}", which is not a number.') from None
    return api_id, api_hash


def load_config() -> Config:
    load_dotenv()
    api_id, api_hash = _parse_api_credentials()
    return Config(
        bot_token=_required("TELEGRAM_BOT_TOKEN"),
        allowed_user_ids=_parse_allowed_user_ids(_required("TELEGRAM_ALLOWED_USER_IDS")),
        database_url=(os.environ.get("DATABASE_URL") or "").strip() or None,
        telegram_api_id=api_id,
        telegram_api_hash=api_hash,
    )
