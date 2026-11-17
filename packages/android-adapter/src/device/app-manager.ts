import type { AndroidDevice, AppLifecycleResult, AppOperationRecord, CommandRunner, EligibilityDecision, PathProbe } from '@chaostwin/contracts';
import { isChaosTwinActivity, isChaosTwinPackage } from '@chaostwin/contracts';

const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const OUTPUT_CAP = 1_000_000;

export interface AppManagerOptions {
  runner: CommandRunner;
  paths: PathProbe;
  authorize: (
    device: AndroidDevice,
    selection: { serial: string; operatorApproved: boolean } | null,
  ) => EligibilityDecision;
  adbPath: string;
}

export interface AppInstallInput {
  device: AndroidDevice;
  selection: { serial: string; operatorApproved: true };
  apkPath: string;
  packageName: string;
  activity: string;
  timeoutMs: number;
}

export interface AppUninstallInput {
  device: AndroidDevice;
  selection: { serial: string; operatorApproved: true };
  packageName: string;
  confirmed: true;
  timeoutMs: number;
}

/**
 * Install and launch one ChaosTwin package on an approved emulator.
 * `installAndLaunch` never uninstalls. Uninstall is a separate call and
 * requires `confirmed: true` plus a `com.chaostwin.*` package.
 */
export class AppManager {
  private readonly runner: CommandRunner;
  private readonly paths: PathProbe;
  private readonly authorize: AppManagerOptions['authorize'];
  private readonly adbPath: string;

  constructor(options: AppManagerOptions) {
    this.runner = options.runner;
    this.paths = options.paths;
    this.authorize = options.authorize;
    this.adbPath = options.adbPath;
  }

  async installAndLaunch(input: AppInstallInput): Promise<AppLifecycleResult> {
    const operations: AppOperationRecord[] = [];
    const refused = this.preflight(input.device, input.selection, input.packageName, input.activity, input.timeoutMs);
    if (refused) {
      return { ok: false, packageName: input.packageName, operations: [refused] };
    }
    const apkProblem = this.validateApk(input.apkPath);
    if (apkProblem) {
      return { ok: false, packageName: input.packageName, operations: [record('install', false, apkProblem, [])] };
    }

    const installed = await this.invoke(
      'install',
      ['-s', input.device.serial, 'install', '-r', input.apkPath],
      input.timeoutMs,
      (result) => !/failure|install_failed/i.test(`${result.stdout}\n${result.stderr}`),
    );
    operations.push(installed);
    if (!installed.ok) {
      return { ok: false, packageName: input.packageName, operations };
    }

    const listed = await this.invoke(
      'verify',
      ['-s', input.device.serial, 'shell', 'pm', 'path', input.packageName],
      input.timeoutMs,
      (result) => result.stdout.includes('package:'),
    );
    operations.push(listed);
    if (!listed.ok) {
      return { ok: false, packageName: input.packageName, operations };
    }

    const launched = await this.invoke(
      'launch',
      ['-s', input.device.serial, 'shell', 'am', 'start', '-n', `${input.packageName}/${input.activity}`],
      input.timeoutMs,
      (result) => !/error/i.test(`${result.stdout}\n${result.stderr}`),
    );
    operations.push(launched);
    if (!launched.ok) {
      return { ok: false, packageName: input.packageName, operations };
    }

    const running = await this.invoke(
      'verify',
      ['-s', input.device.serial, 'shell', 'pidof', input.packageName],
      input.timeoutMs,
      (result) => /^\d+/.test(result.stdout.trim()),
    );
    operations.push(running);
    return { ok: running.ok, packageName: input.packageName, operations };
  }

  async uninstall(input: AppUninstallInput): Promise<AppLifecycleResult> {
    if (input.confirmed !== true) {
      return {
        ok: false,
        packageName: input.packageName,
        operations: [record('uninstall', false, 'Uninstall requires confirmed: true.', [])],
      };
    }
    const refused = this.preflight(input.device, input.selection, input.packageName, null, input.timeoutMs);
    if (refused) {
      return { ok: false, packageName: input.packageName, operations: [{ ...refused, operation: 'uninstall' }] };
    }
    const removed = await this.invoke(
      'uninstall',
      ['-s', input.device.serial, 'uninstall', input.packageName],
      input.timeoutMs,
      (result) => /success/i.test(`${result.stdout}\n${result.stderr}`),
    );
    return { ok: removed.ok, packageName: input.packageName, operations: [removed] };
  }

  private preflight(
    device: AndroidDevice,
    selection: { serial: string; operatorApproved: true },
    packageName: string,
    activity: string | null,
    timeoutMs: number,
  ): AppOperationRecord | null {
    if (!this.adbPath) {
      return record('install', false, 'ADB path is required.', []);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      return record('install', false, 'Timeout must be an integer from 1000 to 120000 milliseconds.', []);
    }
    const decision = this.authorize(device, selection);
    if (!decision.eligible) {
      return record('install', false, decision.reasons.map((reason) => reason.message).join(' '), []);
    }
    if (device.kind !== 'emulator') {
      return record('install', false, `Install is limited to an approved emulator. ${device.serial} is ${device.kind}.`, []);
    }
    if (!SERIAL_PATTERN.test(device.serial)) {
      return record('install', false, `Serial "${device.serial}" contains unsupported characters.`, []);
    }
    if (!isChaosTwinPackage(packageName)) {
      return record('install', false, `Refusing to manage ${packageName}. Only com.chaostwin.* packages are allowed.`, []);
    }
    if (activity !== null && !isChaosTwinActivity(packageName, activity)) {
      return record('install', false, `Activity ${activity} is not part of ${packageName}.`, []);
    }
    return null;
  }

  private validateApk(apkPath: string): string | null {
    if (!apkPath.toLowerCase().endsWith('.apk')) {
      return `APK path must end in .apk. Received "${apkPath}".`;
    }
    if (apkPath.split(/[/\\]/).some((segment) => segment === '..')) {
      return `APK path must not contain a parent directory segment. Received "${apkPath}".`;
    }
    if (!this.paths.isFile(apkPath)) {
      return `APK file does not exist: ${apkPath}`;
    }
    return null;
  }

  private async invoke(
    operation: AppOperationRecord['operation'],
    args: string[],
    timeoutMs: number,
    accept: (result: { stdout: string; stderr: string }) => boolean,
  ): Promise<AppOperationRecord> {
    const result = await this.runner.run(this.adbPath, args, { timeoutMs, maxOutputBytes: OUTPUT_CAP });
    if (result.timedOut) {
      return record(operation, false, 'ADB command timed out.', args);
    }
    if (result.truncated) {
      return record(operation, false, 'ADB output exceeded the capture limit.', args);
    }
    if (result.spawnError) {
      return record(operation, false, result.spawnError, args);
    }
    if (result.exitCode !== 0) {
      return record(operation, false, result.stderr.trim() || result.stdout.trim() || `ADB exited ${result.exitCode}.`, args);
    }
    if (!accept(result)) {
      return record(operation, false, result.stdout.trim() || result.stderr.trim() || `${operation} was not verified.`, args);
    }
    return record(operation, true, result.stdout.trim() || 'ok', args);
  }
}

function record(
  operation: AppOperationRecord['operation'],
  ok: boolean,
  message: string,
  args: string[],
): AppOperationRecord {
  return { operation, ok, message, args };
}
