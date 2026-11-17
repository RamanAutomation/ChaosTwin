import type { AndroidDevice, DeviceDiscoveryReport, EnvironmentReport } from '@chaostwin/contracts';
import { AdbDeviceStatusProbe } from '@chaostwin/android-adapter';
import { runSession } from '../../apps/cli/src/commands/session.ts';
import { describe, expect, it } from 'vitest';
import { FakeCommandRunner, commandResult } from '../helpers/fake-command-runner.ts';

const emulator: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: 'sdk_gphone64_x86_64',
  product: null,
  deviceName: null,
  transportId: '1',
  avdName: 'Pixel_Tablet',
};

function environment(): EnvironmentReport {
  return {
    inspectedAt: '2026-01-15T12:00:00.000Z',
    host: { platform: 'win32', arch: 'x64', nodeVersion: 'v24.18.0' },
    tools: [
      {
        id: 'adb',
        displayName: 'ADB',
        status: 'ready',
        requiredFor: ['device-discovery'],
        version: '37.0.1-15733141',
        location: 'C:\\sdk\\platform-tools\\adb.exe',
        resolution: 'sdk',
        detail: null,
      },
      {
        id: 'emulator',
        displayName: 'Android Emulator',
        status: 'ready',
        requiredFor: ['emulator-inventory'],
        version: '37.2.12.0',
        location: 'C:\\sdk\\emulator\\emulator.exe',
        resolution: 'sdk',
        detail: null,
      },
    ],
    readiness: {
      canDiscoverDevices: true,
      canListVirtualDevices: true,
      canStartAppiumSession: false,
    },
    suggestions: [],
    issues: [],
  };
}

function discovery(devices: AndroidDevice[]): DeviceDiscoveryReport {
  return {
    inspectedAt: '2026-01-15T12:00:00.000Z',
    status: 'ok',
    adbPath: 'C:\\sdk\\platform-tools\\adb.exe',
    emulatorPath: 'C:\\sdk\\emulator\\emulator.exe',
    devices,
    virtualDevices: [],
    unidentifiedRunningEmulators: 0,
    issues: [],
  };
}

describe('session command', () => {
  it('refuses to contact Appium without explicit approval', async () => {
    let opened = 0;
    const output = await runSession(
      {
        inspect: async () => environment(),
        discover: async () => discovery([emulator]),
        openAndClose: async () => {
          opened += 1;
          throw new Error('should not open');
        },
      },
      ['--serial', 'emulator-5554'],
    );
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain('--approve');
    expect(opened).toBe(0);
  });

  it('does not open a session for a serial that is not online', async () => {
    let opened = 0;
    const output = await runSession(
      {
        inspect: async () => environment(),
        discover: async () => discovery([]),
        openAndClose: async () => {
          opened += 1;
          throw new Error('should not open');
        },
      },
      ['--serial', 'emulator-5554', '--approve'],
    );
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain('not an online device');
    expect(opened).toBe(0);
  });
});

describe('AdbDeviceStatusProbe', () => {
  it('reads an online state and reports a missing device', async () => {
    const runner = new FakeCommandRunner((_command, args) => {
      if (args[0] === '-s' && args[1] === 'emulator-5554') {
        return commandResult({ stdout: 'device\n' });
      }
      return commandResult({
        exitCode: 1,
        stderr: "error: device 'emulator-5556' not found\n",
      });
    });
    const probe = new AdbDeviceStatusProbe(runner, 'C:\\sdk\\platform-tools\\adb.exe');
    expect(await probe.currentState('emulator-5554')).toBe('device');
    expect(await probe.currentState('emulator-5556')).toBe('missing');
  });

  it('throws when adb times out instead of inventing a state', async () => {
    const runner = new FakeCommandRunner(() => commandResult({ timedOut: true, exitCode: null }));
    const probe = new AdbDeviceStatusProbe(runner, 'C:\\sdk\\platform-tools\\adb.exe');
    await expect(probe.currentState('emulator-5554')).rejects.toThrow(/timed out/);
  });
});
