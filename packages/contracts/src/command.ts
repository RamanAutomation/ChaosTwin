export interface RunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

/**
 * Result of one bounded process invocation.
 * `run` resolves with this object for timeouts, non-zero exits, and spawn
 * failures. It rejects only when the caller asks for an unsafe command.
 */
export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  spawnError: string | null;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options: RunOptions): Promise<CommandResult>;
}

export interface PathProbe {
  isFile(filePath: string): boolean;
  isDirectory(dirPath: string): boolean;
  /** Immediate child directories. Missing paths return an empty list. */
  listDirectories(dirPath: string): string[];
}
