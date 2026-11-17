import { spawn } from 'node:child_process';
import type { CommandResult, CommandRunner, RunOptions } from '@chaostwin/contracts';
import { planProcessSpawn } from './plan-process-spawn.js';

export class NodeCommandRunner implements CommandRunner {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  run(command: string, args: readonly string[], options: RunOptions): Promise<CommandResult> {
    const plan = planProcessSpawn({ platform: this.platform, command, args });
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      let truncated = false;
      let killError: string | null = null;
      let outputBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const timers: {
        main?: ReturnType<typeof setTimeout>;
        force?: ReturnType<typeof setTimeout>;
      } = {};

      const child = spawn(plan.command, plan.args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (result: CommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timers.main) {
          clearTimeout(timers.main);
        }
        if (timers.force) {
          clearTimeout(timers.force);
        }
        resolve(result);
      };

      const build = (exitCode: number | null, spawnError: string | null): CommandResult => ({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        truncated,
        spawnError: spawnError ?? killError,
      });

      const noteOutput = (target: Buffer[], chunk: Buffer): void => {
        if (outputBytes + chunk.length > options.maxOutputBytes) {
          truncated = true;
          try {
            child.kill();
          } catch (error) {
            killError = error instanceof Error ? error.message : String(error);
          }
          return;
        }
        outputBytes += chunk.length;
        target.push(chunk);
      };

      timers.main = setTimeout(() => {
        timedOut = true;
        timers.force = setTimeout(() => {
          finish(build(null, killError));
        }, 2_000);
        try {
          child.kill();
        } catch (error) {
          killError = error instanceof Error ? error.message : String(error);
        }
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        noteOutput(stdoutChunks, chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        noteOutput(stderrChunks, chunk);
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(build(null, error.code ?? error.message));
      });

      child.on('close', (code) => {
        finish(build(code, null));
      });
    });
  }
}
