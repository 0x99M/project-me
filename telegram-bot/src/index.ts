import { isAuthorized } from "./auth.js";
import { findCommand, formatHint } from "./commands.js";
import { loadConfig, type Config } from "./config.js";
import { TelegramClient, type TelegramMessage } from "./telegram.js";

const LONG_POLL_SECONDS = 30;
const ERROR_BACKOFF_MS = 5_000;

/** "/hint@some_bot extra args" -> "hint" */
function parseCommandName(text: string | undefined): string | undefined {
  const word = text?.trim().split(/\s+/)[0];
  if (!word?.startsWith("/")) return undefined;
  return word.slice(1).split("@")[0]?.toLowerCase();
}

async function handleMessage(
  message: TelegramMessage,
  telegram: TelegramClient,
  config: Config
): Promise<void> {
  if (!isAuthorized(message, config)) {
    // Stay silent rather than replying "denied": a reply confirms the bot is live
    // and worth probing. The log line is how you discover a user's ID.
    console.warn(
      `denied: user=${message.from?.id ?? "unknown"} username=${
        message.from?.username ?? "-"
      } chat=${message.chat.type}`
    );
    return;
  }

  const name = parseCommandName(message.text);

  // /start is what Telegram sends when a chat is first opened, so answer it with
  // the command list rather than an "unknown command" scolding.
  if (name === undefined || name === "start") {
    await telegram.sendMessage(message.chat.id, formatHint());
    return;
  }

  const command = findCommand(name);
  if (!command) {
    await telegram.sendMessage(message.chat.id, `Unknown command.\n\n${formatHint()}`);
    return;
  }

  await telegram.sendMessage(message.chat.id, await command.run());
}

async function main(): Promise<void> {
  const config = loadConfig();
  const telegram = new TelegramClient(config.botToken);

  const me = await telegram.getMe();
  console.log(
    `started as @${me.username ?? me.id}; ${config.allowedUserIds.size} allowed user(s)`
  );

  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down`);
      running = false;
    });
  }

  let offset = 0;
  while (running) {
    try {
      const updates = await telegram.getUpdates(offset, LONG_POLL_SECONDS);
      for (const update of updates) {
        // Advance past this update even if the handler throws, so one bad message
        // cannot wedge the bot into redelivering it forever.
        offset = update.update_id + 1;
        if (!update.message) continue;
        try {
          await handleMessage(update.message, telegram, config);
        } catch (error) {
          console.error("handler failed:", error);
        }
      }
    } catch (error) {
      if (!running) break;
      console.error("poll failed:", error);
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
