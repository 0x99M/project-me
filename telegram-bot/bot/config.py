"""Configuration, loaded once at startup and validated eagerly."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    bot_token: str
    allowed_user_ids: frozenset[int]


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


def load_config() -> Config:
    load_dotenv()
    return Config(
        bot_token=_required("TELEGRAM_BOT_TOKEN"),
        allowed_user_ids=_parse_allowed_user_ids(_required("TELEGRAM_ALLOWED_USER_IDS")),
    )
