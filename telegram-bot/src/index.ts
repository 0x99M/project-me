import { isAuthorized } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { checkStatus, formatStatus } from "./status.js";
import { TelegramClient, type TelegramMessage } from "./telegram.js";

const LONG_POLL_SECONDS = 30;
const ERROR_BACKOFF_MS = 5_000;

const HELP = ["/status — check whether the site is up", "/help — show this message"].join("\n");

async function handleMessage(
  message: TelegramMessage,
  telegram: TelegramClient,
  config: Config
): Promise<void> {
  if (!isAuthorized(message, config)) {
    // Stay silent rather than replying "denied": a reply confirms the bot is live
    // and worth probing. The log line is how you discover your own user ID.
    console.warn(
      `denied: user=${message.from?.id ?? "unknown"} username=${
        message.from?.username ?? "-"
      } chat=${message.chat.type}`
    );
    return;
  }

  const command = message.text?.trim().split(/\s+/)[0]?.toLowerCase();
  // Telegram appends @botname to commands sent in some contexts.
  const bare = command?.split("@")[0];

  switch (bare) {
    case "/status": {
      const report = await checkStatus(config.statusUrl);
      await telegram.sendMessage(message.chat.id, formatStatus(report));
      return;
    }
    case "/start":
    case "/help": {
      await telegram.sendMessage(message.chat.id, HELP);
      return;
    }
    default: {
      await telegram.sendMessage(message.chat.id, `Unknown command.\n\n${HELP}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const telegram = new TelegramClient(config.botToken);

  const me = await telegram.getMe();
  console.log(
    `started as @${me.username ?? me.id}; ${config.allowedUserIds.size} allowed user(s); watching ${config.statusUrl}`
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
