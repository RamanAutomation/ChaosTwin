import type {
  AndroidDevice,
  CloseAppiumSessionResult,
  DeviceDiscoveryReport,
  EnvironmentReport,
  OpenAppiumSessionResult,
  ResolvedAndroidTools,
} from '@chaostwin/contracts';

export interface CommandOutput {
  exitCode: number;
  stdout: string;
}

export interface SessionOpenInput {
  adbPath: string;
  device: AndroidDevice;
  selection: { serial: string; operatorApproved: boolean };
  serverUrl: string;
  connectionTimeoutMs: number;
}

export interface SessionDependencies {
  inspect(): Promise<EnvironmentReport>;
  discover(tools: ResolvedAndroidTools): Promise<DeviceDiscoveryReport>;
  openAndClose(input: SessionOpenInput): Promise<{
    opened: OpenAppiumSessionResult;
    closed: CloseAppiumSessionResult | null;
  }>;
}

const DEFAULT_SERVER = 'http://127.0.0.1:4723';
const DEFAULT_TIMEOUT_MS = 15_000;

interface SessionFlags {
  serial: string | null;
  serverUrl: string;
  approve: boolean;
  json: boolean;
  connectionTimeoutMs: number;
  error: string | null;
}

function readOption(args: readonly string[], name: string): { value: string | null; error: string | null } {
  const index = args.indexOf(name);
  if (index < 0) {
    return { value: null, error: null };
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    return { value: null, error: `${name} requires a value.` };
  }
  return { value, error: null };
}

export function parseSessionFlags(args: readonly string[]): SessionFlags {
  const serial = readOption(args, '--serial');
  const server = readOption(args, '--server');
  const timeout = readOption(args, '--timeout-ms');
  const error = serial.error ?? server.error ?? timeout.error;
  let connectionTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeout.value) {
    const parsed = Number(timeout.value);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
      return {
        serial: serial.value,
        serverUrl: server.value ?? DEFAULT_SERVER,
        approve: args.includes('--approve'),
        json: args.includes('--json'),
        connectionTimeoutMs,
        error: '--timeout-ms must be an integer from 1000 to 120000.',
      };
    }
    connectionTimeoutMs = parsed;
  }
  return {
    serial: serial.value,
    serverUrl: server.value ?? DEFAULT_SERVER,
    approve: args.includes('--approve'),
    json: args.includes('--json'),
    connectionTimeoutMs,
    error,
  };
}

function toolLocation(report: EnvironmentReport, id: 'adb'): string | null {
  const tool = report.tools.find((candidate) => candidate.id === id);
  if (!tool || tool.status !== 'ready' || !tool.location) {
    return null;
  }
  return tool.location;
}

function textResult(input: {
  serverUrl: string;
  serial: string;
  opened: OpenAppiumSessionResult;
  closed: CloseAppiumSessionResult | null;
}): string {
  if (!input.opened.ok) {
    return ['ChaosTwin Appium session', `Server: ${input.serverUrl}`, `ERROR [${input.opened.code}] ${input.opened.message}`].join(
      '\n',
    );
  }
  const lines = [
    'ChaosTwin Appium session',
    `Server: ${input.opened.session.serverUrl}`,
    `Session: ${input.opened.session.sessionId}`,
    `UDID: ${input.opened.session.udid}`,
    `Platform: ${input.opened.session.platformName} ${input.opened.session.platformVersion ?? 'version unknown'}`,
    `Automation: ${input.opened.session.automationName}`,
    `Device: ${input.opened.session.deviceName ?? input.serial}`,
  ];
  if (!input.closed) {
    lines.push('Closed: no');
  } else if (input.closed.ok) {
    lines.push('Closed: yes');
  } else {
    lines.push(`Closed: no`, `ERROR [${input.closed.code}] ${input.closed.message}`);
  }
  return lines.join('\n');
}

/**
 * Create one UiAutomator2 session for an explicitly approved emulator and close it.
 * The command does not leave a session open when close succeeds.
 */
export async function runSession(dependencies: SessionDependencies, args: readonly string[]): Promise<CommandOutput> {
  const flags = parseSessionFlags(args);
  if (flags.error) {
    return { exitCode: 1, stdout: flags.error };
  }
  if (!flags.approve) {
    return {
      exitCode: 1,
      stdout: 'Operator approval is required. Re-run with --approve after selecting an emulator serial.',
    };
  }
  if (!flags.serial) {
    return { exitCode: 1, stdout: '--serial is required. Discovery does not choose a device.' };
  }

  const environment = await dependencies.inspect();
  const adbPath = toolLocation(environment, 'adb');
  const emulatorPath = environment.tools.find((tool) => tool.id === 'emulator' && tool.status === 'ready')?.location ?? null;
  if (!adbPath) {
    return { exitCode: 1, stdout: 'ADB is not ready, so an Appium session cannot be opened.' };
  }

  const discovery = await dependencies.discover({ adbPath, emulatorPath });
  if (discovery.status !== 'ok') {
    const message = discovery.issues.map((issue) => issue.message).join(' ') || 'Device discovery failed.';
    return { exitCode: 1, stdout: message };
  }

  const device = discovery.devices.find((candidate) => candidate.serial === flags.serial);
  if (!device || device.state !== 'device') {
    return {
      exitCode: 1,
      stdout: `Device ${flags.serial} is not an online device in the current adb inventory. The session was not created.`,
    };
  }
  if (device.kind !== 'emulator') {
    return {
      exitCode: 1,
      stdout: `Session creation is limited to emulators. ${device.serial} is ${device.kind}.`,
    };
  }

  const result = await dependencies.openAndClose({
    adbPath,
    device,
    selection: { serial: flags.serial, operatorApproved: true },
    serverUrl: flags.serverUrl,
    connectionTimeoutMs: flags.connectionTimeoutMs,
  });
  const exitCode = result.opened.ok && result.closed?.ok ? 0 : 1;
  if (flags.json) {
    return { exitCode, stdout: JSON.stringify(result, null, 2) };
  }
  return {
    exitCode,
    stdout: textResult({
      serverUrl: flags.serverUrl,
      serial: flags.serial,
      opened: result.opened,
      closed: result.closed,
    }),
  };
}
