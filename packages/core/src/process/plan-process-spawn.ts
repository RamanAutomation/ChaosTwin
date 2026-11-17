import path from 'node:path';

export interface SpawnPlan {
  command: string;
  args: string[];
}

const SHELL_METACHARACTERS = /[\r\n"&|<>^%]/;

/**
 * Windows `.cmd` shims cannot be spawned without a shell. This planner routes
 * only absolute `.cmd`/`.bat` paths through `cmd.exe /d /s /c`, and refuses
 * metacharacters so a tool path cannot become a shell command.
 */
export function planProcessSpawn(input: {
  platform: NodeJS.Platform;
  command: string;
  args: readonly string[];
}): SpawnPlan {
  if (input.command.trim().length === 0) {
    throw new Error('Refusing to spawn an empty command.');
  }

  const windowsScript =
    input.platform === 'win32' && /\.(cmd|bat)$/i.test(input.command);

  if (!windowsScript) {
    return { command: input.command, args: [...input.args] };
  }

  if (!path.win32.isAbsolute(input.command)) {
    throw new Error(`Refusing to launch a non-absolute Windows script: ${input.command}`);
  }

  const quote = (value: string): string => {
    if (SHELL_METACHARACTERS.test(value)) {
      throw new Error('Refusing to pass an argument with shell metacharacters.');
    }
    return `"${value}"`;
  };

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [quote(input.command), ...input.args.map(quote)].join(' ')],
  };
}
