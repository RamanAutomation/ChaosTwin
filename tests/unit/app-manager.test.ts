import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AndroidDevice, PathProbe } from '@chaostwin/contracts';
import { DEMO_LAUNCH_ACTIVITY, DEMO_PACKAGE_NAME } from '@chaostwin/contracts';
import { AppManager } from '@chaostwin/android-adapter';
import { NodePathProbe, evaluateDeviceEligibility } from '@chaostwin/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeCommandRunner, commandResult } from '../helpers/fake-command-runner.js';

const device: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: 'sdk_gphone64_x86_64',
  product: 'sdk_gphone64_x86_64',
  deviceName: 'emu64xa',
  transportId: '1',
  avdName: 'Medium_Phone_API_37.0',
};

const selection = { serial: 'emulator-5554', operatorApproved: true as const };
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function manager(handler: (command: string, args: readonly string[]) => ReturnType<typeof commandResult>, paths: PathProbe): {
  apps: AppManager;
  runner: FakeCommandRunner;
} {
  const runner = new FakeCommandRunner(handler);
  return {
    runner,
    apps: new AppManager({ runner, paths, authorize: evaluateDeviceEligibility, adbPath: 'adb' }),
  };
}

describe('AppManager', () => {
  it('installs, verifies, launches, and checks the process without uninstalling', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chaostwin-apk-'));
    directories.push(directory);
    const apk = path.join(directory, 'demo.apk');
    writeFileSync(apk, 'not a real package');
    const { apps, runner } = manager((command, args) => {
      const line = args.join(' ');
      if (line.includes(' install ')) return commandResult({ stdout: 'Success' });
      if (line.includes('pm path')) return commandResult({ stdout: `package:${apk}` });
      if (line.includes('am start')) return commandResult({ stdout: 'Starting: Intent' });
      if (line.includes('pidof')) return commandResult({ stdout: '4321\n' });
      return commandResult({ exitCode: 1, stderr: `unexpected ${command}` });
    }, new NodePathProbe());

    const result = await apps.installAndLaunch({
      device,
      selection,
      apkPath: apk,
      packageName: DEMO_PACKAGE_NAME,
      activity: DEMO_LAUNCH_ACTIVITY,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(runner.calls.map((call) => call.args.join(' '))).toEqual([
      `-s emulator-5554 install -r ${apk}`,
      `-s emulator-5554 shell pm path ${DEMO_PACKAGE_NAME}`,
      `-s emulator-5554 shell am start -n ${DEMO_PACKAGE_NAME}/${DEMO_LAUNCH_ACTIVITY}`,
      `-s emulator-5554 shell pidof ${DEMO_PACKAGE_NAME}`,
    ]);
    expect(runner.calls.some((call) => call.args.includes('uninstall'))).toBe(false);
  });

  it('rejects a missing APK before ADB is called', async () => {
    const { apps, runner } = manager(() => commandResult(), {
      isFile: () => false,
      isDirectory: () => false,
      listDirectories: () => [],
    });
    const result = await apps.installAndLaunch({
      device,
      selection,
      apkPath: 'missing.apk',
      packageName: DEMO_PACKAGE_NAME,
      activity: DEMO_LAUNCH_ACTIVITY,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.operations[0]?.message).toContain('does not exist');
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects a package outside com.chaostwin', async () => {
    const { apps, runner } = manager(() => commandResult(), {
      isFile: () => true,
      isDirectory: () => false,
      listDirectories: () => [],
    });
    const result = await apps.installAndLaunch({
      device,
      selection,
      apkPath: 'demo.apk',
      packageName: 'com.example.mail',
      activity: 'com.example.mail.Main',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.operations[0]?.message).toContain('com.chaostwin');
    expect(runner.calls).toHaveLength(0);
  });

  it('stops after a launch failure and does not claim the process is running', async () => {
    const { apps, runner } = manager((_command, args) => {
      if (args.includes('install')) return commandResult({ stdout: 'Success' });
      if (args.includes('path')) return commandResult({ stdout: 'package:/data/app/demo.apk' });
      if (args.includes('start')) return commandResult({ exitCode: 1, stderr: 'Error: Activity not found' });
      return commandResult({ stdout: '999' });
    }, { isFile: () => true, isDirectory: () => false, listDirectories: () => [] });

    const result = await apps.installAndLaunch({
      device,
      selection,
      apkPath: 'demo.apk',
      packageName: DEMO_PACKAGE_NAME,
      activity: DEMO_LAUNCH_ACTIVITY,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.operations.map((operation) => operation.operation)).toEqual(['install', 'verify', 'launch']);
    expect(runner.calls.some((call) => call.args.includes('pidof'))).toBe(false);
  });

  it('uninstalls only the demo package when confirmed', async () => {
    const { apps, runner } = manager(() => commandResult({ stdout: 'Success' }), {
      isFile: () => false,
      isDirectory: () => false,
      listDirectories: () => [],
    });
    const result = await apps.uninstall({
      device,
      selection,
      packageName: DEMO_PACKAGE_NAME,
      confirmed: true,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(runner.calls[0]?.args).toEqual(['-s', 'emulator-5554', 'uninstall', DEMO_PACKAGE_NAME]);
  });
});
