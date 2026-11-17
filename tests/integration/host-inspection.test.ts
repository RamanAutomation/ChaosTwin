import { AndroidDeviceDiscovery } from '@chaostwin/android-adapter';
import { DeviceDiscoveryReportSchema, EnvironmentReportSchema } from '@chaostwin/contracts';
import { evaluateDeviceEligibility, NodeCommandRunner, createHostEnvironmentDetector } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const expectLocalAndroid = process.env.CHAOSTWIN_EXPECT_LOCAL_ANDROID === '1';

describe('host inspection', () => {
  it('detects this machine and discovers devices without authorizing them', async () => {
    const environment = await createHostEnvironmentDetector().inspect();
    expect(EnvironmentReportSchema.parse(environment)).toEqual(environment);
    expect(environment.tools.find((tool) => tool.id === 'node')).toMatchObject({
      status: 'ready',
      version: process.version.replace(/^v/, ''),
    });

    const adb = environment.tools.find((tool) => tool.id === 'adb');
    const emulator = environment.tools.find((tool) => tool.id === 'emulator');
    const java = environment.tools.find((tool) => tool.id === 'java');
    const sdk = environment.tools.find((tool) => tool.id === 'android-sdk');

    if (expectLocalAndroid) {
      expect(sdk).toMatchObject({ status: 'ready' });
      expect(adb).toMatchObject({ status: 'ready' });
      expect(adb?.version).toMatch(/\d+\.\d+\.\d+/);
      expect(java).toMatchObject({ status: 'ready' });
      expect(emulator).toMatchObject({ status: 'ready' });
      expect(environment.readiness.canDiscoverDevices).toBe(true);
      expect(environment.readiness.canStartAppiumSession).toBe(false);
    }

    const discovery = await new AndroidDeviceDiscovery({ runner: new NodeCommandRunner() }).discover({
      adbPath: adb?.status === 'ready' ? adb.location : null,
      emulatorPath: emulator?.status === 'ready' ? emulator.location : null,
    });
    expect(DeviceDiscoveryReportSchema.parse(discovery)).toEqual(discovery);

    if (adb?.status === 'ready') {
      expect(discovery.status).toBe('ok');
      for (const device of discovery.devices) {
        expect(evaluateDeviceEligibility(device, null).eligible).toBe(false);
      }
    } else {
      expect(discovery.status).toBe('unavailable');
    }

    if (expectLocalAndroid) {
      expect(discovery.status).toBe('ok');
      expect(discovery.virtualDevices.length).toBeGreaterThan(0);
      expect(discovery.virtualDevices.every((avd) => avd.name.length > 0)).toBe(true);
    }
  });
});
