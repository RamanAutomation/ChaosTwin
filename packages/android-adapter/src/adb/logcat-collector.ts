import type { CommandRunner } from '@chaostwin/contracts';

const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;

export interface LogcatCollection {
  ok: true;
  text: string;
}

export interface LogcatFailure {
  ok: false;
  message: string;
}

/**
 * Collect a short, filtered logcat snapshot. A failure is missing evidence,
 * not a successful empty log.
 */
export class LogcatCollector {
  constructor(
    private readonly runner: CommandRunner,
    private readonly adbPath: string,
  ) {}

  async collect(serial: string): Promise<LogcatCollection | LogcatFailure> {
    if (!this.adbPath) {
      return { ok: false, message: 'ADB path is required to collect logcat.' };
    }
    if (!SERIAL_PATTERN.test(serial)) {
      return { ok: false, message: `Serial "${serial}" contains unsupported characters.` };
    }
    const result = await this.runner.run(
      this.adbPath,
      ['-s', serial, 'logcat', '-d', '-t', '200', 'ChaosTwinDemo:V', 'AndroidRuntime:E', '*:S'],
      { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
    );
    if (result.timedOut) {
      return { ok: false, message: 'Logcat collection timed out.' };
    }
    if (result.truncated) {
      return { ok: false, message: 'Logcat output exceeded the capture limit.' };
    }
    if (result.spawnError) {
      return { ok: false, message: result.spawnError };
    }
    if (result.exitCode !== 0) {
      return { ok: false, message: result.stderr.trim() || result.stdout.trim() || `Logcat exited ${result.exitCode}.` };
    }
    return { ok: true, text: result.stdout };
  }
}
