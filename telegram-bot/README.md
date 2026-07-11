# telegram-bot

A private Telegram bot.

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

The bot token is a credential: anyone holding it controls the bot. Keep it in
`.env` (gitignored) or in the host's secret store.

## Setup

1. Create the bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. In BotFather, run `/setjoingroups` → **Disable** so the bot cannot be added to
   groups at all.
3. `cp .env.example .env` and fill in `TELEGRAM_BOT_TOKEN`.
4. Find your user ID: put a placeholder in `TELEGRAM_ALLOWED_USER_IDS`, start the
   bot, message it, and read the `denied: user=...` log line. Put that ID in
   `TELEGRAM_ALLOWED_USER_IDS`. (Or ask [@userinfobot](https://t.me/userinfobot).)
5. To let someone else in, append their ID, comma-separated.

## Run

```bash
npm install
npm run dev     # build, then run with .env loaded
```

For production: `npm run build && npm start`, with the environment variables set
by the host.

## Commands

| Command | Behavior                            |
| ------- | ----------------------------------- |
| `/hint` | List every command the bot knows    |

## Adding a command

`src/commands.ts` holds the whole command list. Append an entry:

```ts
{
  name: "ping",
  description: "What it does, as one line",
  run: async () => "pong",
}
```

That is the only edit. The dispatcher routes to it by name, and `/hint` lists it
automatically — `/hint` is generated from the same array, so it cannot drift out
of date.
