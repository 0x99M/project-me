import type { Config } from "./config.js";
import type { TelegramMessage } from "./telegram.js";

/**
 * Anyone can send a Telegram bot a message — that cannot be prevented. The only
 * control that matters is who it acts on, so this is deliberately a strict
 * allowlist: a sender must be a known user ID, in a one-to-one chat.
 */
export function isAuthorized(message: TelegramMessage, config: Config): boolean {
  // Group chats are refused even when an allowed user sends the command, since
  // every other member of the group would see the bot's replies.
  if (message.chat.type !== "private") return false;

  const senderId = message.from?.id;
  if (senderId === undefined) return false;

  return config.allowedUserIds.has(senderId);
}
