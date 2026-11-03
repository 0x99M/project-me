# telegram-bot

A private Telegram bot, in Python.

## Security model

Telegram bots are reachable by anyone who knows the handle — that is inherent to
the platform and cannot be turned off. What is controlled here is who the bot
*acts on*:

- **Allowlist.** A message is handled only if the sender's numeric Telegram user
  ID is in `TELEGRAM_ALLOWED_USER_IDS`. Everyone else is ignored.
- **Private chats only.** Even an allowed user is refused in a group, since the
  other members would see the replies.
- **Silent denial.** Unauthorized messages get no reply at all — a reply would
  confirm to a stranger that the bot is live and worth probing. They are logged.
- **Fail closed.** A missing token, an empty allowlist, or a malformed ID stops
  the bot from starting rather than falling back to something permissive.
- **YouTube only.** `/youtube_audio` accepts YouTube hosts and nothing else.
  yt-dlp supports well over a thousand sites, several of which would happily
  fetch from internal addresses, so the host allowlist is what keeps the bot from
  being used as a fetch proxy.

The bot token is a credential: anyone holding it controls the bot. Keep it in
`.env` (gitignored) or in the host's secret store.

## Requirements

- Python 3.12+
- `ffmpeg` **and** `ffprobe` at `/usr/bin` (`sudo apt install ffmpeg`). The snap
  build of ffmpeg does not ship a runnable `ffprobe`, which yt-dlp needs, so the
  path is pinned rather than taken from `PATH`.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env      # then fill in the token
```

1. Create the bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. In BotFather, run `/setjoingroups` → **Disable** so it cannot be added to groups.
3. Find your user ID: put a placeholder in `TELEGRAM_ALLOWED_USER_IDS`, start the
   bot, message it, and read the `denied: user=...` log line. Put that ID in
   `TELEGRAM_ALLOWED_USER_IDS`. To let someone else in, append their ID.

## Run

```bash
.venv/bin/python -m bot.main
```

## Running a second bot for someone else

The same code runs as a separate bot: a second Railway service built from this
directory, with its own token and allowlist. No code changes are needed.

It **must have its own Postgres**. The reminder loops (`/calendar`, `/remind`)
send every due row in the database, whoever created it, through whichever bot is
running the loop. Two bots sharing one database would each try to send the other
bot's reminders.

1. In @BotFather: `/newbot`, copy the token, then `/setjoingroups` → **Disable**.
2. Railway, in the "Me" project: **+ New → Database → PostgreSQL**. Give it a
   name such as `Postgres-2`.
3. **+ New → GitHub Repo → `0x99M/project-me`**. In the service settings:
   - Root Directory: `telegram-bot`. It builds from the Dockerfile.
   - Replicas: **1**, one region. Two instances fight over `getUpdates`.
   - No public domain. The bot opens no port.
4. Variables on the new service:
   ```
   TELEGRAM_BOT_TOKEN=<the new token>
   TELEGRAM_ALLOWED_USER_IDS=<their numeric ID>
   DATABASE_URL=${{Postgres-2.DATABASE_URL}}
   ```
   Don't know their ID yet? Put `1` there, deploy, have them message the bot,
   then read the `denied: user=...` line in the deploy log.
5. Deploy. The log should show `migrations: 5 applied`, then
   `starting; 1 allowed user(s)`.

Both services redeploy on every push to `main` that touches the bot.

Times are Asia/Riyadh (UTC+3) and `/money` is in JOD, for both bots.

## Commands

```
/hint — List every command this bot knows
/tools — Utilities
  /convert — Convert media from one form to another
    /youtube_audio — Send a YouTube link, get its audio back
    /video_audio — Send a video (up to 100 MB), get its audio back
```

Invoking a group (`/tools`, `/convert`) lists what is under it. `/cancel` aborts a
prompt that is waiting on you.

`/youtube_audio` asks for a link, then reports a live progress bar while
downloading and transcoding. Telegram caps bot uploads at 50 MB, so videos over
30 minutes are refused up front rather than after a long conversion.

Only use it for audio you have the rights to.

`/video_audio` needs no command at all: send the bot a video (as a video, a video
note, or a file) and it replies with the audio as MP3, at a bitrate that fits
Telegram's 50 MB upload cap. The Bot API won't let a bot download files over
20 MB, so bigger videos are fetched over MTProto with the same bot token. That
takes `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from <https://my.telegram.org>
→ API development tools. Without them, videos up to 20 MB still work. One pair
serves every bot.

## Adding a command

`bot/commands.py` holds the whole tree. Add an entry where it belongs:

```python
Command(
    name="ping",                       # a-z, 0-9, "_" only — Telegram rejects "-"
    description="What it does, in one line",
    handler=my_handler,                # omit to make it a group
    children=(),                       # nest children here instead
)
```

That is the only edit. The dispatcher routes to it and `/hint` lists it, nested
under its parent — `/hint` is generated from the same tree, so it cannot drift
out of date.
