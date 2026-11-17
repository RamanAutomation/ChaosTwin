import { FaultRequestSchema } from '@chaostwin/contracts';
import { FaultScheduler } from '@chaostwin/fault-engine';
import { describe, expect, it } from 'vitest';
import { FakeCommandRunner, commandResult } from '../helpers/fake-command-runner.js';

const clock = () => new Date('2026-11-17T07:00:00.000Z');
const approved = { operatorApproved: true, disruptiveActionApproved: true };
const emulator = { serial: 'emulator-5554', kind: 'emulator' as const };

function scheduler(handler: (command: string, args: readonly string[]) => ReturnType<typeof commandResult>): {
  faults: FaultScheduler;
  runner: FakeCommandRunner;
} {
  const runner = new FakeCommandRunner(handler);
  return { runner, faults: new FaultScheduler({ runner, adbPath: 'adb' }) };
}

describe('FaultScheduler', () => {
  it('rejects a duration that is not shorter than the timeout', () => {
    expect(
      FaultRequestSchema.safeParse({ kind: 'network-latency', profile: 'gprs', durationMs: 5_000, timeoutMs: 5_000 }).success,
    ).toBe(false);
  });

  it('applies emulator latency for the requested duration and restores delay none', async () => {
    const slept: number[] = [];
    const { faults, runner } = scheduler(() => commandResult({ stdout: 'OK' }));
    const result = await faults.run({
      target: emulator,
      approval: approved,
      request: { kind: 'network-latency', profile: 'gprs', durationMs: 250, timeoutMs: 5_000 },
      clock,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(result.status).toBe('APPLIED');
    expect(result.mode).toBe('actual');
    expect(result.restored).toBe(true);
    expect(slept).toEqual([250]);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['-s', 'emulator-5554', 'emu', 'network', 'delay', 'gprs'],
      ['-s', 'emulator-5554', 'emu', 'network', 'delay', 'none'],
    ]);
  });

  it('does not send a command for packet loss or an unapproved fault', async () => {
    const { faults, runner } = scheduler(() => commandResult());
    const packet = await faults.run({
      target: emulator,
      approval: approved,
      request: { kind: 'packet-loss', durationMs: 100, timeoutMs: 5_000 },
      clock,
      sleep: async () => undefined,
    });
    const blocked = await faults.run({
      target: emulator,
      approval: { operatorApproved: true, disruptiveActionApproved: false },
      request: { kind: 'network-disconnect', durationMs: 100, timeoutMs: 5_000 },
      clock,
      sleep: async () => undefined,
    });
    expect(packet.status).toBe('UNSUPPORTED');
    expect(blocked.status).toBe('APPROVAL_REQUIRED');
    expect(runner.calls).toHaveLength(0);
  });

  it('restores mobile data when the disconnect command fails', async () => {
    const { faults, runner } = scheduler((_command, args) => {
      if (args.includes('off')) return commandResult({ exitCode: 1, stderr: 'failed to apply' });
      return commandResult({ stdout: 'OK' });
    });
    const applied = await faults.apply({
      target: emulator,
      approval: approved,
      request: { kind: 'network-disconnect', durationMs: 100, timeoutMs: 5_000 },
      clock,
    });
    expect(applied.result.status).toBe('FAILED');
    expect(applied.result.restored).toBe(true);
    expect(runner.calls.map((call) => call.args.at(-1))).toEqual(['off', 'on']);
  });

  it('treats an unknown emulator command as unsupported and still restores', async () => {
    const { faults, runner } = scheduler((_command, args) => {
      if (args.includes('off')) return commandResult({ exitCode: 1, stdout: 'KO: unknown command' });
      return commandResult({ stdout: 'OK' });
    });
    const result = await faults.run({
      target: emulator,
      approval: approved,
      request: { kind: 'network-disconnect', durationMs: 100, timeoutMs: 5_000 },
      clock,
      sleep: async () => undefined,
    });
    expect(result.status).toBe('UNSUPPORTED');
    expect(runner.calls.some((call) => call.args.includes('on'))).toBe(true);
  });

  it('refuses to force-stop a package outside com.chaostwin', async () => {
    const { faults, runner } = scheduler(() => commandResult());
    const result = await faults.run({
      target: emulator,
      approval: approved,
      request: {
        kind: 'app-restart',
        packageName: 'com.android.settings',
        activity: 'com.android.settings.Settings',
        durationMs: 100,
        timeoutMs: 5_000,
      },
      clock,
      sleep: async () => undefined,
    });
    expect(result.status).toBe('FAILED');
    expect(runner.calls).toHaveLength(0);
  });

  it('returns a failure when the command times out and still runs restore', async () => {
    const { faults, runner } = scheduler((_command, args) => {
      if (args.includes('gprs')) return commandResult({ timedOut: true, exitCode: null });
      return commandResult({ stdout: 'OK' });
    });
    const result = await faults.run({
      target: emulator,
      approval: approved,
      request: { kind: 'network-latency', profile: 'gprs', durationMs: 100, timeoutMs: 5_000 },
      clock,
      sleep: async () => {
        throw new Error('sleep should not run');
      },
    });
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('timed out');
    expect(runner.calls.map((call) => call.args.at(-1))).toEqual(['gprs', 'none']);
  });
});
