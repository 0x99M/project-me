function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function parseAllowedUserIds(raw: string): ReadonlySet<number> {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(
          `TELEGRAM_ALLOWED_USER_IDS contains "${part}", which is not a Telegram user ID.`
        );
      }
      return id;
    });

  // An empty allowlist would mean "trust nobody", but a typo that silently widened
  // access would be far worse, so refuse to start rather than guess.
  if (ids.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS is empty. Set at least one user ID.");
  }
  return new Set(ids);
}

export type Config = {
  botToken: string;
  allowedUserIds: ReadonlySet<number>;
};

export function loadConfig(): Config {
  return {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: parseAllowedUserIds(required("TELEGRAM_ALLOWED_USER_IDS")),
  };
}
