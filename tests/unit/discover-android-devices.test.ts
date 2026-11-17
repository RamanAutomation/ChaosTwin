import { correlateVirtualDevices } from '@chaostwin/android-adapter';
import { AndroidDeviceDiscovery } from '@chaostwin/android-adapter';
import type { AndroidDevice } from '@chaostwin/contracts';
import { describe, expect, it } from 'vitest';
import { FakeCommandRunner, commandResult } from '../helpers/fake-command-runner.ts';

const adbPath = 'C:\\sdk\\platform-tools\\adb.exe';
const emulatorPath = 'C:\\sdk\\emulator\\emulator.exe';
const clock = (): Date => new Date('2026-01-15T12:00:00.000Z');

const attached = [
  'List of devices attached',
  'emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1',
].join('\n');

function discovery(handler: (command: string, args: readonly string[]) => ReturnType<typeof commandResult>): {
  service: AndroidDeviceDiscovery;
  runner: FakeCommandRunner;
} {
  const runner = new FakeCommandRunner(handler);
  return { service: new AndroidDeviceDiscovery({ runner, clock }), runner };
}

describe('AndroidDeviceDiscovery', () => {
  it('lists defined AVDs when nothing is connected', async () => {
    const { service } = discovery((command, args) => {
      if (command === adbPath && args[0] === 'devices') {
        return commandResult({ stdout: 'List of devices attached\n\n' });
      }
      if (command === emulatorPath && args[0] === '-list-avds') {
        return commandResult({ stdout: 'Medium_Phone_API_37.0\nPixel_Tablet\n' });
      }
      throw new Error(`unexpected ${command} ${args.join(' ')}`);
    });

    const report = await service.discover({ adbPath, emulatorPath });
    expect(report.status).toBe('ok');
    expect(report.devices).toEqual([]);
    expect(report.virtualDevices).toEqual([
      { name: 'Medium_Phone_API_37.0', running: false, serial: null },
      { name: 'Pixel_Tablet', running: false, serial: null },
    ]);
  });

  it('names a running emulator and does not mark the other AVD as running', async () => {
    const { service, runner } = discovery((command, args) => {
      if (args[0] === 'devices') {
        return commandResult({ stdout: attached });
      }
      if (args[0] === '-s') {
        return commandResult({ stdout: 'Pixel_Tablet\nOK\n' });
      }
      if (args[0] === '-list-avds') {
        return commandResult({ stdout: 'Medium_Phone_API_37.0\nPixel_Tablet\n' });
      }
      throw new Error(`unexpected ${command}`);
    });

    const report = await service.discover({ adbPath, emulatorPath });
    expect(report.status).toBe('ok');
    expect(report.devices[0]).toMatchObject({ serial: 'emulator-5554', avdName: 'Pixel_Tablet', state: 'device' });
    expect(report.virtualDevices).toEqual([
      { name: 'Medium_Phone_API_37.0', running: false, serial: null },
      { name: 'Pixel_Tablet', running: true, serial: 'emulator-5554' },
    ]);
    expect(runner.calls.some((call) => call.args.includes('emulator-5554'))).toBe(true);
  });

  it('discards partial adb output after a timeout', async () => {
    const { service } = discovery((command, args) => {
      if (args[0] === 'devices') {
        return commandResult({ timedOut: true, exitCode: null, stdout: attached });
      }
      if (args[0] === '-list-avds') {
        return commandResult({ stdout: 'Pixel_Tablet\n' });
      }
      throw new Error(`unexpected ${command}`);
    });

    const report = await service.discover({ adbPath, emulatorPath });
    expect(report.status).toBe('failed');
    expect(report.devices).toEqual([]);
    expect(report.virtualDevices).toEqual([{ name: 'Pixel_Tablet', running: null, serial: null }]);
    expect(report.issues[0]?.code).toBe('adb-devices-failed');
  });

  it('is unavailable when ADB was not resolved and does not spawn anything', async () => {
    const { service, runner } = discovery(() => {
      throw new Error('should not run');
    });
    const report = await service.discover({ adbPath: null, emulatorPath: null });
    expect(report.status).toBe('unavailable');
    expect(report.issues[0]?.code).toBe('adb-missing');
    expect(runner.calls).toEqual([]);
  });

  it('does not pass an unexpected emulator serial back to adb', async () => {
    const { service, runner } = discovery((command, args) => {
      if (args[0] === 'devices') {
        return commandResult({ stdout: 'List of devices attached\nemulator-5554;calc device\n' });
      }
      if (args[0] === '-list-avds') {
        return commandResult({ stdout: 'Pixel_Tablet\n' });
      }
      throw new Error(`unexpected ${command} ${args.join(' ')}`);
    });

    const report = await service.discover({ adbPath, emulatorPath });
    expect(report.issues.map((issue) => issue.code)).toContain('emulator-serial-rejected');
    expect(report.unidentifiedRunningEmulators).toBe(1);
    expect(report.virtualDevices[0]?.running).toBeNull();
    expect(runner.calls.some((call) => call.args.includes('emu'))).toBe(false);
  });
});

describe('correlateVirtualDevices', () => {
  it('does not claim an AVD is stopped while a running emulator is unidentified', () => {
    const devices: AndroidDevice[] = [
      {
        serial: 'emulator-5554',
        state: 'device',
        kind: 'emulator',
        connection: 'emulator',
        model: null,
        product: null,
        deviceName: null,
        transportId: null,
        avdName: null,
      },
    ];
    expect(correlateVirtualDevices(['Pixel_Tablet'], devices, true)).toEqual([
      { name: 'Pixel_Tablet', running: null, serial: null },
    ]);
  });
});
