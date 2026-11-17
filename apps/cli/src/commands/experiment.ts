import type { AndroidDevice, DeviceDiscoveryReport, EnvironmentReport, ExperimentReport, ResolvedAndroidTools } from '@chaostwin/contracts';

export interface CommandOutput {
  exitCode: number;
  stdout: string;
}

export interface ExperimentFlags {
  serial: string | null;
  serverUrl: string;
  apkPath: string | null;
  approve: boolean;
  disruptive: boolean;
  uninstall: boolean;
  json: boolean;
  connectionTimeoutMs: number;
  error: string | null;
}

export interface LiveExperimentInput {
  adbPath: string;
  device: AndroidDevice;
  serverUrl: string;
  connectionTimeoutMs: number;
  apkPath: string;
  uninstallAfter: boolean;
}

export interface ExperimentDependencies {
  apkExists(apkPath: string): boolean;
  inspect(): Promise<EnvironmentReport>;
  discover(tools: ResolvedAndroidTools): Promise<DeviceDiscoveryReport>;
  execute(input: LiveExperimentInput): Promise<ExperimentReport>;
}

const DEFAULT_SERVER = 'http://127.0.0.1:4723';
const DEFAULT_TIMEOUT_MS = 15_000;

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

export function parseExperimentFlags(args: readonly string[]): ExperimentFlags {
  const serial = readOption(args, '--serial');
  const server = readOption(args, '--server');
  const apk = readOption(args, '--apk');
  const timeout = readOption(args, '--timeout-ms');
  let connectionTimeoutMs = DEFAULT_TIMEOUT_MS;
  let error = serial.error ?? server.error ?? apk.error ?? timeout.error;
  if (timeout.value) {
    const parsed = Number(timeout.value);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
      error = '--timeout-ms must be an integer from 1000 to 120000.';
    } else {
      connectionTimeoutMs = parsed;
    }
  }
  return {
    serial: serial.value,
    serverUrl: server.value ?? DEFAULT_SERVER,
    apkPath: apk.value,
    approve: args.includes('--approve'),
    disruptive: args.includes('--disruptive'),
    uninstall: args.includes('--uninstall'),
    json: args.includes('--json'),
    connectionTimeoutMs,
    error,
  };
}

/**
 * CT-EXP-001 entry point. Missing approval, a missing APK, or a missing device
 * stops the command before a session or a network change.
 */
export async function runExperiment(dependencies: ExperimentDependencies, args: readonly string[]): Promise<CommandOutput> {
  const flags = parseExperimentFlags(args);
  if (flags.error) {
    return { exitCode: 1, stdout: flags.error };
  }
  if (!flags.approve || !flags.serial) {
    return { exitCode: 1, stdout: 'Pass --serial and --approve. Discovery does not choose a device.' };
  }
  if (!flags.disruptive) {
    return {
      exitCode: 1,
      stdout: 'Network disruption requires --disruptive. The device was not changed.',
    };
  }
  if (!flags.apkPath) {
    return { exitCode: 1, stdout: '--apk is required. No package was installed.' };
  }
  if (!dependencies.apkExists(flags.apkPath)) {
    return {
      exitCode: 1,
      stdout: `APK file is missing: ${flags.apkPath}. The session was not created.`,
    };
  }

  const environment = await dependencies.inspect();
  const adb = environment.tools.find((tool) => tool.id === 'adb' && tool.status === 'ready');
  if (!adb?.location) {
    return { exitCode: 1, stdout: 'ADB is not ready, so the experiment cannot start.' };
  }
  const emulator = environment.tools.find((tool) => tool.id === 'emulator' && tool.status === 'ready');
  const discovery = await dependencies.discover({ adbPath: adb.location, emulatorPath: emulator?.location ?? null });
  if (discovery.status !== 'ok') {
    return { exitCode: 1, stdout: discovery.issues.map((issue) => issue.message).join(' ') || 'Device discovery failed.' };
  }
  const device = discovery.devices.find((candidate) => candidate.serial === flags.serial);
  if (!device || device.state !== 'device' || device.kind !== 'emulator') {
    return {
      exitCode: 1,
      stdout: `Device ${flags.serial} is not an online emulator. The session was not created.`,
    };
  }

  const report = await dependencies.execute({
    adbPath: adb.location,
    device,
    serverUrl: flags.serverUrl,
    connectionTimeoutMs: flags.connectionTimeoutMs,
    apkPath: flags.apkPath,
    uninstallAfter: flags.uninstall,
  });
  const exitCode = report.status === 'PASS' ? 0 : 1;
  if (flags.json) {
    return { exitCode, stdout: JSON.stringify(report, null, 2) };
  }
  return {
    exitCode,
    stdout: [
      'ChaosTwin Android Network Recovery Test',
      `Experiment: ${report.experimentId}`,
      `Status: ${report.status}`,
      `Device: ${report.device.serial}`,
      `Evidence: ${report.evidence.directory ?? 'not created'}`,
      report.failure ? report.failure.summary : 'Required assertions passed with evidence.',
    ].join('\n'),
  };
}
