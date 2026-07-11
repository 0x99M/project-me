"""Optional YouTube cookies, supplied through the environment.

YouTube serves "Sign in to confirm you're not a bot" to datacenter IPs, so a
cloud-hosted bot needs cookies from a logged-in session to get anywhere. A
residential IP generally needs none of this.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

COOKIE_FILENAME = "youtube-cookies.txt"


def _decode(raw_b64: str) -> str | None:
    try:
        return base64.b64decode(raw_b64.strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        log.error("YOUTUBE_COOKIES_B64 is not valid base64-encoded text: %s", error)
        return None


def load_cookie_file() -> str | None:
    """Materialise the cookie jar on disk and return its path, or None if unset.

    Base64 rather than the raw file: cookies.txt is tab-separated, and pasting it
    into a dashboard variable field routinely turns the tabs into spaces, which
    yt-dlp rejects as a malformed jar.
    """
    raw_b64 = (os.environ.get("YOUTUBE_COOKIES_B64") or "").strip()
    if not raw_b64:
        return None

    content = _decode(raw_b64)
    if content is None:
        return None

    if "\t" not in content:
        log.error(
            "Decoded cookies contain no tabs, so they are not in Netscape cookies.txt "
            "format. yt-dlp will not accept them; re-export the file."
        )
        return None

    # yt-dlp writes refreshed cookies back to this file, so it must be writable.
    path = Path(tempfile.gettempdir()) / COOKIE_FILENAME
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)

    cookie_lines = [
        line for line in content.splitlines() if line.strip() and not line.startswith("#")
    ]
    log.info("youtube cookies loaded: %d cookie(s)", len(cookie_lines))
    return str(path)
