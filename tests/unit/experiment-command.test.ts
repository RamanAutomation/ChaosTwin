import type { DeviceDiscoveryReport, EnvironmentReport, ExperimentReport } from '@chaostwin/contracts';
import { runExperiment, type ExperimentDependencies } from '../../apps/cli/src/commands/experiment.ts';
import { describe, expect, it } from 'vitest';

const environment: EnvironmentReport = {
  inspectedAt: '2026-11-17T07:00:00.000Z',
  host: { platform: 'win32', arch: 'x64', nodeVersion: '24.18.0' },
  tools: [
    {
      id: 'adb',
      displayName: 'ADB',
      status: 'ready',
      requiredFor: ['device-discovery'],
      version: '37.0.0',
      location: 'adb',
      resolution: 'sdk',
      detail: null,
    },
  ],
  readiness: { canDiscoverDevices: true, canListVirtualDevices: false, canStartAppiumSession: false },
  suggestions: [],
  issues: [],
};

const discovery: DeviceDiscoveryReport = {
  inspectedAt: '2026-11-17T07:00:00.000Z',
  status: 'ok',
  adbPath: 'adb',
  emulatorPath: null,
  devices: [],
  virtualDevices: [],
  unidentifiedRunningEmulators: 0,
  issues: [],
};

function dependencies(overrides: Partial<ExperimentDependencies> = {}): ExperimentDependencies & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    apkExists: (apkPath) => {
      events.push(`apk:${apkPath}`);
      return false;
    },
    inspect: async () => {
      events.push('inspect');
      return environment;
    },
    discover: async () => {
      events.push('discover');
      return discovery;
    },
    execute: async () => {
      events.push('execute');
      const report = { status: 'ERROR' } as ExperimentReport;
      return report;
    },
    ...overrides,
  };
}

describe('runExperiment', () => {
  it('refuses a missing disruptive approval before checking the APK or the device', async () => {
    const deps = dependencies();
    const output = await runExperiment(deps, ['--serial', 'emulator-5554', '--approve', '--apk', 'demo.apk']);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain('--disruptive');
    expect(deps.events).toEqual([]);
  });

  it('refuses a missing APK before inspection', async () => {
    const deps = dependencies();
    const output = await runExperiment(deps, [
      '--serial',
      'emulator-5554',
      '--approve',
      '--disruptive',
      '--apk',
      'missing.apk',
    ]);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain('missing.apk');
    expect(deps.events).toEqual(['apk:missing.apk']);
  });

  it('does not execute when the serial is not an online emulator', async () => {
    const deps = dependencies({
      apkExists: () => true,
    });
    const output = await runExperiment(deps, [
      '--serial',
      'emulator-5554',
      '--approve',
      '--disruptive',
      '--apk',
      'demo.apk',
    ]);
    expect(output.exitCode).toBe(1);
    expect(output.stdout).toContain('not an online emulator');
    expect(deps.events).not.toContain('execute');
  });
});
