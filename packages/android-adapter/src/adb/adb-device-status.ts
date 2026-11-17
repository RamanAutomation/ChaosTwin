import type { CommandRunner, DeviceState } from '@chaostwin/contracts';

const SAFE_SERIAL = /^[A-Za-z0-9._:-]+$/;
const KNOWN_STATES = new Set<string>([
  'device',
  'offline',
  'unauthorized',
  'authorizing',
  'recovery',
  'sideload',
  'rescue',
  'bootloader',
]);

export interface DeviceStatusProbe {
  currentState(serial: string): Promise<DeviceState | 'missing'>;
}

/**
 * Read `adb get-state` for one serial. A timeout or spawn failure is thrown
 * so the session manager can report it instead of assuming the device is gone.
 */
export class AdbDeviceStatusProbe implements DeviceStatusProbe {
  constructor(
    private readonly runner: CommandRunner,
    private readonly adbPath: string,
  ) {}

  async currentState(serial: string): Promise<DeviceState | 'missing'> {
    if (!SAFE_SERIAL.test(serial)) {
      throw new Error(`Refusing to query an unexpected device serial: ${serial}`);
    }
    const result = await this.runner.run(this.adbPath, ['-s', serial, 'get-state'], {
      timeoutMs: 10_000,
      maxOutputBytes: 100_000,
    });
    if (result.timedOut) {
      throw new Error(`adb get-state timed out for ${serial}.`);
    }
    if (result.truncated) {
      throw new Error(`adb get-state output for ${serial} exceeded the output limit.`);
    }
    if (result.spawnError) {
      throw new Error(`adb get-state could not start: ${result.spawnError}`);
    }

    const combined = `${result.stdout}\n${result.stderr}`.trim();
    if (result.exitCode !== 0) {
      const lower = combined.toLowerCase();
      if (lower.includes('not found') || lower.includes('no devices') || lower.includes('no emulators')) {
        return 'missing';
      }
      throw new Error(combined || `adb get-state exited ${result.exitCode} for ${serial}.`);
    }

    const state = result.stdout.trim().split(/\s+/)[0] ?? '';
    if (state === 'device') {
      return 'device';
    }
    if (KNOWN_STATES.has(state)) {
      return state as DeviceState;
    }
    throw new Error(`adb get-state returned an unrecognized state for ${serial}: ${state || combined}`);
  }
}
