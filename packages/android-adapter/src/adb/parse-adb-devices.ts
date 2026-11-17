import type { AndroidDevice, DeviceConnection, DeviceKind, DeviceState, Issue } from '@chaostwin/contracts';

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

export interface AdbDevicesParseResult {
  sawHeader: boolean;
  devices: AndroidDevice[];
  issues: Issue[];
}

function classify(serial: string, properties: Map<string, string>): {
  kind: DeviceKind;
  connection: DeviceConnection;
} {
  if (serial.startsWith('emulator-')) {
    return { kind: 'emulator', connection: 'emulator' };
  }
  if (properties.has('usb')) {
    return { kind: 'hardware', connection: 'usb' };
  }
  if (serial.includes(':')) {
    return { kind: 'hardware', connection: 'tcp' };
  }
  return { kind: 'hardware', connection: 'unknown' };
}

function parseDeviceLine(line: string): AndroidDevice | null {
  const tokens = line.split(/\s+/);
  const serial = tokens[0];
  const stateToken = tokens[1];
  if (!serial || !stateToken || serial === 'List') {
    return null;
  }

  const properties = new Map<string, string>();
  for (const token of tokens.slice(2)) {
    const separator = token.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (key && value) {
      properties.set(key, value);
    }
  }

  const state: DeviceState = KNOWN_STATES.has(stateToken) ? (stateToken as DeviceState) : 'unknown';
  const classified = classify(serial, properties);
  return {
    serial,
    state,
    kind: classified.kind,
    connection: classified.connection,
    model: properties.get('model') ?? null,
    product: properties.get('product') ?? null,
    deviceName: properties.get('device') ?? null,
    transportId: properties.get('transport_id') ?? null,
    avdName: null,
  };
}

/**
 * Parse `adb devices -l` stdout. Daemon chatter and blank lines are ignored.
 * Any other unrecognized line is returned as an error so a missed device is
 * not reported as an empty inventory.
 */
export function parseAdbDevices(output: string): AdbDevicesParseResult {
  const devices: AndroidDevice[] = [];
  const issues: Issue[] = [];
  let sawHeader = false;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*')) {
      continue;
    }
    if (line.startsWith('List of devices attached')) {
      sawHeader = true;
      continue;
    }
    const device = parseDeviceLine(line);
    if (!device || device.state === 'unknown') {
      issues.push({
        severity: 'error',
        code: 'adb-line-unrecognized',
        message: `Unrecognized adb devices line: ${line}`,
      });
      if (device) {
        devices.push(device);
      }
      continue;
    }
    devices.push(device);
  }

  if (!sawHeader) {
    issues.push({
      severity: 'error',
      code: 'adb-output-unrecognized',
      message: 'adb devices did not return "List of devices attached". The output was not treated as an empty device list.',
    });
  }

  return { sawHeader, devices, issues };
}
