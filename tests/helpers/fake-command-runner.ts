import type { CommandResult, CommandRunner, RunOptions } from '@chaostwin/contracts';

export function commandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    truncated: false,
    spawnError: null,
    ...overrides,
  };
}

export class FakeCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(private readonly handler: (command: string, args: readonly string[]) => CommandResult) {}

  async run(command: string, args: readonly string[], _options: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args: [...args] });
    return this.handler(command, args);
  }
}
