export type TelegramUser = { id: number; username?: string };
export type TelegramChat = { id: number; type: string };
export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

export class TelegramClient {
  readonly #baseUrl: string;

  constructor(botToken: string) {
    this.#baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async #call<T>(method: string, body: unknown, timeoutMs: number): Promise<T> {
    const response = await fetch(`${this.#baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = (await response.json()) as
      | { ok: true; result: T }
      | { ok: false; description?: string };

    if (!payload.ok) {
      throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
    }
    return payload.result;
  }

  /**
   * Long-polls for new updates. `offset` must be the last handled update_id + 1;
   * sending it is what acknowledges earlier updates, so a crash mid-handler
   * redelivers rather than drops.
   */
  async getUpdates(offset: number, longPollSeconds: number): Promise<TelegramUpdate[]> {
    return this.#call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout: longPollSeconds, allowed_updates: ["message"] },
      (longPollSeconds + 10) * 1000
    );
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.#call("sendMessage", { chat_id: chatId, text }, 15_000);
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    return this.#call<{ id: number; username?: string }>("getMe", {}, 15_000);
  }
}
