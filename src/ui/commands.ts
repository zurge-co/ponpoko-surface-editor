export interface CommandDefinition {
  id: string;
  title: string;
  detail?: string;
  keybinding?: string;
  run(): void | Promise<void>;
}

export interface CommandRegistry {
  register(definition: CommandDefinition): void;
  run(id: string): Promise<boolean>;
  get(id: string): CommandDefinition | undefined;
  all(): CommandDefinition[];
}

export interface CommandRegistryOptions {
  onError(message: string): void;
}

export function createCommandRegistry(options: CommandRegistryOptions): CommandRegistry {
  const commands = new Map<string, CommandDefinition>();

  return {
    register(definition) {
      if (commands.has(definition.id)) {
        options.onError(`the editor registered the command '${definition.id}' twice`);
      }
      commands.set(definition.id, definition);
    },
    async run(id) {
      const command = commands.get(id);
      if (!command) return false;
      try {
        await command.run();
        return true;
      } catch (error) {
        options.onError(
          `${command.title} could not be completed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    get: (id) => commands.get(id),
    all: () => [...commands.values()],
  };
}
