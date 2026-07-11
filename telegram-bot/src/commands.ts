export type Command = {
  /** Without the leading slash. */
  name: string;
  description: string;
  run(): Promise<string>;
};

/**
 * The single source of truth for what the bot can do. Adding an entry here is
 * all it takes: the dispatcher will route to it and /hint will list it, with no
 * other file to remember to update.
 */
export const commands: Command[] = [
  {
    name: "hint",
    description: "List every command this bot knows",
    run: async () => formatHint(),
  },
];

export function findCommand(name: string): Command | undefined {
  return commands.find((command) => command.name === name);
}

export function formatHint(): string {
  const lines = commands
    .map((command) => `/${command.name} — ${command.description}`)
    .sort();
  return ["Commands:", ...lines].join("\n");
}
