import type { DeviceDiscoveryReport, EnvironmentReport } from '@chaostwin/contracts';
import { runDevices } from '../../apps/cli/src/commands/devices.ts';
import { runDoctor } from '../../apps/cli/src/commands/doctor.ts';
import { describe, expect, it } from 'vitest';

const inspectedAt = '2026-01-15T12:00:00.000Z';

function environment(canDiscover: boolean): EnvironmentReport {
  return {
    inspectedAt,
    host: { platform: 'win32', arch: 'x64', nodeVersion: 'v24.18.0' },
    tools: [
      {
        id: 'node',
        displayName: 'Node.js',
        status: 'ready',
        requiredFor: [],
        version: '24.18.0',
        location: 'C:\\Program Files\\nodejs\\node.exe',
        resolution: 'process',
        detail: null,
      },
      {
        id: 'adb',
        displayName: 'ADB',
        status: canDiscover ? 'ready' : 'missing',
        requiredFor: ['device-discovery'],
        version: canDiscover ? '37.0.1-15733141' : null,
        location: canDiscover ? 'C:\\sdk\\platform-tools\\adb.exe' : null,
        resolution: canDiscover ? 'sdk' : 'not-found',
        detail: null,
      },
      {
        id: 'emulator',
        displayName: 'Android Emulator',
        status: 'missing',
        requiredFor: ['emulator-inventory'],
        version: null,
        location: null,
        resolution: 'not-found',
        detail: null,
      },
    ],
    readiness: {
      canDiscoverDevices: canDiscover,
      canListVirtualDevices: false,
      canStartAppiumSession: false,
    },
    suggestions: [],
    issues: [],
  };
}

const discovery: DeviceDiscoveryReport = {
  inspectedAt,
  status: 'ok',
  adbPath: 'C:\\sdk\\platform-tools\\adb.exe',
  emulatorPath: null,
  devices: [],
  virtualDevices: [],
  unidentifiedRunningEmulators: 0,
  issues: [{ severity: 'warning', code: 'emulator-missing', message: 'The Android emulator binary is not available, so AVD names cannot be listed.' }],
};

describe('doctor and devices commands', () => {
  it('exits 0 when discovery succeeds and does not hide a blocked ADB install', async () => {
    const ready = await runDoctor(
      {
        inspect: async () => environment(true),
        discover: async () => discovery,
      },
      false,
    );
    expect(ready.exitCode).toBe(0);
    expect(ready.stdout).toMatch(/adb\s+ready/);
    expect(ready.stdout).toContain('Connected devices:');

    const blocked = await runDoctor(
      {
        inspect: async () => environment(false),
        discover: async () => {
          throw new Error('discovery must not run when ADB is missing');
        },
      },
      false,
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stdout).toContain('were not queried');
  });

  it('returns JSON for device discovery and a failing exit code when discovery fails', async () => {
    const output = await runDevices(
      {
        inspect: async () => environment(true),
        discover: async () => ({ ...discovery, status: 'failed' }),
      },
      true,
    );
    expect(output.exitCode).toBe(1);
    expect(JSON.parse(output.stdout).status).toBe('failed');
  });
});
