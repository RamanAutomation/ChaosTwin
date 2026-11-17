import net from 'node:net';
import type { AndroidDevice } from '@chaostwin/contracts';
import { AppiumSessionManager } from '@chaostwin/android-adapter';
import { createWebdriverioAppiumClient } from '../../packages/android-adapter/src/appium/webdriverio-client.ts';
import { evaluateDeviceEligibility } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const device: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: null,
  product: null,
  deviceName: null,
  transportId: null,
  avdName: 'Pixel_Tablet',
};

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

describe('WebdriverIO Appium client', () => {
  it('reports a closed local Appium port as unavailable and does not create a session', async () => {
    const listening = await portAcceptsConnections(4723);
    if (listening) {
      throw new Error(
        '127.0.0.1:4723 is accepting connections. This test will not open an unsolicited Appium session.',
      );
    }

    const started = Date.now();
    const opened = await new AppiumSessionManager({
      client: createWebdriverioAppiumClient(),
      deviceStatus: { async currentState() { return 'device'; } },
      authorize: evaluateDeviceEligibility,
    }).open({
      device,
      selection: { serial: device.serial, operatorApproved: true },
      config: { serverUrl: 'http://127.0.0.1:4723', connectionTimeoutMs: 2_000 },
    });
    const elapsed = Date.now() - started;

    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(['server-unavailable', 'connection-timeout']).toContain(opened.code);
      expect(opened.message.length).toBeGreaterThan(0);
    }
    expect(elapsed).toBeLessThan(8_000);
  });
});
