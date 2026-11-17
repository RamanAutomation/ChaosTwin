import type { AndroidDevice } from '@chaostwin/contracts';

export type CapabilityValue = string | number | boolean;

/**
 * Extra capabilities a caller may set. App identity, reset, automation, and
 * UDID stay under ChaosTwin's control so a session cannot wipe or retarget a device.
 */
export const OPTIONAL_APPIUM_CAPABILITIES = [
  'appium:systemPort',
  'appium:newCommandTimeout',
  'appium:mjpegServerPort',
  'appium:adbPort',
  'appium:uiautomator2ServerLaunchTimeout',
] as const;

export type UiAutomator2Capabilities = Record<string, CapabilityValue>;

function deviceLabel(device: AndroidDevice): string {
  return device.avdName ?? device.model ?? device.serial;
}

function portValue(value: CapabilityValue, key: string): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return `${key} must be an integer port from 1 to 65535.`;
  }
  return null;
}

export function buildUiAutomator2Capabilities(
  device: AndroidDevice,
  overrides: Record<string, CapabilityValue> | undefined,
): { ok: true; capabilities: UiAutomator2Capabilities } | { ok: false; message: string } {
  const extra = overrides ?? {};
  for (const key of Object.keys(extra)) {
    if (!OPTIONAL_APPIUM_CAPABILITIES.includes(key as (typeof OPTIONAL_APPIUM_CAPABILITIES)[number])) {
      return {
        ok: false,
        message: `Capability "${key}" is not allowed. Session creation sets the device, automation driver, and reset policy itself.`,
      };
    }
  }

  const systemPort = extra['appium:systemPort'];
  if (systemPort !== undefined) {
    const problem = portValue(systemPort, 'appium:systemPort');
    if (problem) {
      return { ok: false, message: problem };
    }
  }
  const mjpeg = extra['appium:mjpegServerPort'];
  if (mjpeg !== undefined) {
    const problem = portValue(mjpeg, 'appium:mjpegServerPort');
    if (problem) {
      return { ok: false, message: problem };
    }
  }
  const adbPort = extra['appium:adbPort'];
  if (adbPort !== undefined) {
    const problem = portValue(adbPort, 'appium:adbPort');
    if (problem) {
      return { ok: false, message: problem };
    }
  }

  const commandTimeout = extra['appium:newCommandTimeout'];
  if (
    commandTimeout !== undefined &&
    (typeof commandTimeout !== 'number' || !Number.isInteger(commandTimeout) || commandTimeout < 1 || commandTimeout > 300)
  ) {
    return { ok: false, message: 'appium:newCommandTimeout must be an integer from 1 to 300 seconds.' };
  }

  const launchTimeout = extra['appium:uiautomator2ServerLaunchTimeout'];
  if (
    launchTimeout !== undefined &&
    (typeof launchTimeout !== 'number' || !Number.isInteger(launchTimeout) || launchTimeout < 1_000 || launchTimeout > 120_000)
  ) {
    return {
      ok: false,
      message: 'appium:uiautomator2ServerLaunchTimeout must be an integer from 1000 to 120000 milliseconds.',
    };
  }

  const capabilities: UiAutomator2Capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:udid': device.serial,
    'appium:deviceName': deviceLabel(device),
    'appium:noReset': true,
    'appium:fullReset': false,
    'appium:autoGrantPermissions': false,
    'appium:newCommandTimeout': commandTimeout ?? 60,
  };

  if (systemPort !== undefined) {
    capabilities['appium:systemPort'] = systemPort;
  }
  if (mjpeg !== undefined) {
    capabilities['appium:mjpegServerPort'] = mjpeg;
  }
  if (adbPort !== undefined) {
    capabilities['appium:adbPort'] = adbPort;
  }
  if (launchTimeout !== undefined) {
    capabilities['appium:uiautomator2ServerLaunchTimeout'] = launchTimeout;
  }

  return { ok: true, capabilities };
}

export function capabilityString(capabilities: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = capabilities[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}
