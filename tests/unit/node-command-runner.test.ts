import { NodeCommandRunner } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const limits = { timeoutMs: 5_000, maxOutputBytes: 100_000 };

describe('NodeCommandRunner', () => {
  const runner = new NodeCommandRunner();

  it('captures stdout from an executable without a shell', async () => {
    const result = await runner.run(process.execPath, ['-e', 'console.log("ok")'], limits);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
    expect(result.timedOut).toBe(false);
    expect(result.spawnError).toBeNull();
  });

  it('reports a missing executable instead of rejecting', async () => {
    const result = await runner.run('C:\\no\\such\\chaostwin-missing.exe', [], limits);
    expect(result.exitCode).toBeNull();
    expect(result.spawnError).toBe('ENOENT');
  });

  it('enforces the timeout and does not leave the promise pending', async () => {
    const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 300,
      maxOutputBytes: 10_000,
    });
    expect(result.timedOut).toBe(true);
  });

  it('stops a process that exceeds the output limit', async () => {
    const result = await runner.run(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(20000))'],
      { timeoutMs: 5_000, maxOutputBytes: 64 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(64);
  });
});
