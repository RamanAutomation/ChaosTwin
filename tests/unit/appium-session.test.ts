import type { AndroidDevice } from '@chaostwin/contracts';
import {
  AppiumSessionManager,
  buildUiAutomator2Capabilities,
  classifyAppiumError,
  parseAppiumServerUrl,
  type AppiumClientFactory,
  type AppiumClientRequest,
  type AppiumDriverHandle,
} from '@chaostwin/android-adapter';
import { evaluateDeviceEligibility } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const device: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: 'sdk_gphone64_x86_64',
  product: 'sdk_gphone64_x86_64',
  deviceName: 'emu64xa',
  transportId: '1',
  avdName: 'Pixel_Tablet',
};

const config = {
  serverUrl: 'http://127.0.0.1:4723',
  connectionTimeoutMs: 10_000,
};

const selection = { serial: 'emulator-5554', operatorApproved: true as const };
const clock = (): Date => new Date('2026-01-15T12:00:00.000Z');

class FakeClient implements AppiumClientFactory {
  creates = 0;
  deletes = 0;
  lastRequest: AppiumClientRequest | null = null;
  failCreate: unknown = null;
  failDelete = false;
  sessionId: string | null = 'session-1';
  capabilities: Record<string, unknown> = {
    platformName: 'Android',
    platformVersion: '16',
    'appium:udid': 'emulator-5554',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Pixel_Tablet',
  };

  async create(request: AppiumClientRequest): Promise<AppiumDriverHandle> {
    this.creates += 1;
    this.lastRequest = request;
    if (this.failCreate) {
      throw this.failCreate;
    }
    return {
      sessionId: this.sessionId,
      capabilities: this.capabilities,
      deleteSession: async () => {
        this.deletes += 1;
        if (this.failDelete) {
          throw new Error('delete failed');
        }
      },
    };
  }
}

function manager(client: FakeClient, state: 'device' | 'offline' | 'missing' | Error = 'device'): AppiumSessionManager {
  return new AppiumSessionManager({
    client,
    deviceStatus: {
      async currentState() {
        if (state instanceof Error) {
          throw state;
        }
        return state;
      },
    },
    authorize: evaluateDeviceEligibility,
    clock,
  });
}

describe('UiAutomator2 session configuration', () => {
  it('builds a non-resetting session for the selected emulator', () => {
    const built = buildUiAutomator2Capabilities(device, { 'appium:systemPort': 8201 });
    expect(built).toEqual({
      ok: true,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': 'emulator-5554',
        'appium:deviceName': 'Pixel_Tablet',
        'appium:noReset': true,
        'appium:fullReset': false,
        'appium:autoGrantPermissions': false,
        'appium:newCommandTimeout': 60,
        'appium:systemPort': 8201,
      },
    });
    expect(parseAppiumServerUrl('http://127.0.0.1:4723/wd/hub')).toEqual({
      ok: true,
      server: { protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/wd/hub' },
    });
  });

  it('rejects capabilities that would retarget, reset, or launch an app', () => {
    expect(buildUiAutomator2Capabilities(device, { 'appium:fullReset': true }).ok).toBe(false);
    expect(buildUiAutomator2Capabilities(device, { 'appium:automationName': 'Espresso' }).ok).toBe(false);
    expect(buildUiAutomator2Capabilities(device, { 'appium:udid': 'other' }).ok).toBe(false);
    expect(buildUiAutomator2Capabilities(device, { 'appium:app': 'C:\\demo.apk' }).ok).toBe(false);
  });
});

describe('AppiumSessionManager', () => {
  it('creates one session and records the platform information returned by the client', async () => {
    const client = new FakeClient();
    const session = manager(client);
    const opened = await session.open({ device, selection, config });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.session).toMatchObject({
      sessionId: 'session-1',
      udid: 'emulator-5554',
      platformName: 'Android',
      platformVersion: '16',
      automationName: 'UiAutomator2',
      deviceName: 'Pixel_Tablet',
      createdAt: '2026-01-15T12:00:00.000Z',
      closedAt: null,
    });
    expect(client.lastRequest).toMatchObject({
      protocol: 'http',
      hostname: '127.0.0.1',
      port: 4723,
      path: '/',
      connectionTimeoutMs: 10_000,
    });
    expect(client.creates).toBe(1);
  });

  it('does not open a second session while the first is still open', async () => {
    const client = new FakeClient();
    const session = manager(client);
    await session.open({ device, selection, config });
    const again = await session.open({ device, selection, config });
    expect(again).toMatchObject({ ok: false, code: 'session-already-open' });
    expect(client.creates).toBe(1);
  });

  it('closes the session and allows a later open', async () => {
    const client = new FakeClient();
    const session = manager(client);
    await session.open({ device, selection, config });
    const closed = await session.close();
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.alreadyClosed).toBe(false);
      expect(closed.session?.closedAt).toBe('2026-01-15T12:00:00.000Z');
    }
    expect(client.deletes).toBe(1);
    expect(session.current()).toBeNull();
    const secondClose = await session.close();
    expect(secondClose).toMatchObject({ ok: true, alreadyClosed: true });
    expect(client.deletes).toBe(1);
  });

  it('keeps the session guarded when cleanup fails', async () => {
    const client = new FakeClient();
    client.failDelete = true;
    const session = manager(client);
    await session.open({ device, selection, config });
    const closed = await session.close();
    expect(closed).toMatchObject({ ok: false, code: 'session-close-failed', message: 'delete failed' });
    expect(session.current()?.sessionId).toBe('session-1');
    const again = await session.open({ device, selection, config });
    expect(again).toMatchObject({ ok: false, code: 'session-already-open' });
    expect(client.creates).toBe(1);
  });

  it('reports an unavailable server and does not leave a session open', async () => {
    const client = new FakeClient();
    client.failCreate = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4723'), { code: 'ECONNREFUSED' });
    const opened = await manager(client).open({ device, selection, config });
    expect(opened).toMatchObject({
      ok: false,
      code: 'server-unavailable',
      message: 'connect ECONNREFUSED 127.0.0.1:4723',
    });
    expect(client.deletes).toBe(0);
  });

  it('reports a connection timeout', async () => {
    const client = new FakeClient();
    client.failCreate = Object.assign(new Error('Appium connection timed out.'), { code: 'ETIMEDOUT' });
    const opened = await manager(client).open({ device, selection, config });
    expect(opened).toMatchObject({ ok: false, code: 'connection-timeout' });
  });

  it('reports invalid capabilities before calling the client', async () => {
    const client = new FakeClient();
    const opened = await manager(client).open({
      device,
      selection,
      config: { ...config, capabilities: { 'appium:fullReset': true } },
    });
    expect(opened).toMatchObject({ ok: false, code: 'invalid-capabilities' });
    expect(client.creates).toBe(0);
    const badUrl = await manager(client).open({
      device,
      selection,
      config: { ...config, serverUrl: 'ftp://127.0.0.1:4723' },
    });
    expect(badUrl).toMatchObject({ ok: false, code: 'invalid-server-url' });
    expect(client.creates).toBe(0);
  });

  it('does not create a session when the device is no longer online', async () => {
    const client = new FakeClient();
    const opened = await manager(client, 'offline').open({ device, selection, config });
    expect(opened).toMatchObject({ ok: false, code: 'device-disconnected' });
    expect(client.creates).toBe(0);
  });

  it('does not create a session without operator approval or for hardware', async () => {
    const client = new FakeClient();
    const unapproved = await manager(client).open({
      device,
      selection: { serial: device.serial, operatorApproved: false },
      config,
    });
    expect(unapproved).toMatchObject({ ok: false, code: 'device-not-authorized' });
    const phone = await manager(client).open({
      device: { ...device, kind: 'hardware', connection: 'usb' },
      selection,
      config,
    });
    expect(phone).toMatchObject({ ok: false, code: 'device-not-authorized' });
    expect(client.creates).toBe(0);
  });

  it('closes a session whose reported UDID does not match the selection', async () => {
    const client = new FakeClient();
    client.capabilities = { ...client.capabilities, 'appium:udid': 'emulator-5556' };
    const opened = await manager(client).open({ device, selection, config });
    expect(opened).toMatchObject({ ok: false, code: 'udid-mismatch' });
    expect(client.deletes).toBe(1);
    expect(client.creates).toBe(1);
  });

  it('surfaces a device-status failure instead of continuing', async () => {
    const client = new FakeClient();
    const opened = await manager(client, new Error('adb get-state timed out for emulator-5554.')).open({
      device,
      selection,
      config,
    });
    expect(opened).toMatchObject({
      ok: false,
      code: 'device-status-unknown',
      message: 'adb get-state timed out for emulator-5554.',
    });
    expect(client.creates).toBe(0);
  });
});

describe('classifyAppiumError', () => {
  it('keeps the driver message for server, device, capability, and timeout failures', () => {
    expect(classifyAppiumError(new Error('fetch failed')).code).toBe('server-unavailable');
    expect(classifyAppiumError(new Error('Could not find a connected Android device')).code).toBe('device-disconnected');
    expect(classifyAppiumError(new Error('session not created: invalid capabilities')).code).toBe('invalid-capabilities');
    expect(classifyAppiumError(new Error('connection timed out')).code).toBe('connection-timeout');
    expect(classifyAppiumError(new Error('socket hang up')).code).toBe('session-failed');
  });
});
