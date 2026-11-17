import type {
  AndroidDevice,
  CommandRunner,
  DeviceDiscoveryReport,
  Issue,
  Logger,
  ResolvedAndroidTools,
} from '@chaostwin/contracts';
import { DeviceDiscoveryReportSchema, noopLogger, parseWithSchema } from '@chaostwin/contracts';
import { parseAdbDevices } from '../adb/parse-adb-devices.js';
import { parseEmulatorAvdName } from '../adb/parse-emulator-avd-name.js';
import { parseAvdList } from '../adb/parse-avd-list.js';
import { correlateVirtualDevices, countUnidentifiedRunningEmulators } from './correlate-virtual-devices.js';

const ADB_DEVICES_TIMEOUT_MS = 20_000;
const LIST_AVDS_TIMEOUT_MS = 20_000;
const AVD_NAME_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const SAFE_SERIAL = /^[A-Za-z0-9._:-]+$/;

export interface AndroidDeviceDiscoveryOptions {
  runner: CommandRunner;
  clock?: () => Date;
  logger?: Logger;
}

function trimMessage(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 400) {
    return compact;
  }
  return `${compact.slice(0, 397)}...`;
}

export class AndroidDeviceDiscovery {
  private readonly runner: CommandRunner;
  private readonly clock: () => Date;
  private readonly logger: Logger;

  constructor(options: AndroidDeviceDiscoveryOptions) {
    this.runner = options.runner;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger ?? noopLogger;
  }

  async discover(tools: ResolvedAndroidTools): Promise<DeviceDiscoveryReport> {
    const inspectedAt = this.clock().toISOString();
    if (!tools.adbPath) {
      return this.finish({
        inspectedAt,
        status: 'unavailable',
        adbPath: null,
        emulatorPath: tools.emulatorPath,
        devices: [],
        virtualDevices: [],
        unidentifiedRunningEmulators: 0,
        issues: [
          {
            severity: 'error',
            code: 'adb-missing',
            message: 'ADB is not available, so Android devices cannot be discovered.',
          },
        ],
      });
    }

    const adbResult = await this.runner.run(tools.adbPath, ['devices', '-l'], {
      timeoutMs: ADB_DEVICES_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });

    if (adbResult.timedOut || adbResult.truncated || adbResult.spawnError || adbResult.exitCode !== 0) {
      const avds = await this.listAvds(tools.emulatorPath);
      const message = adbResult.timedOut
        ? `adb devices timed out after ${ADB_DEVICES_TIMEOUT_MS}ms. Partial output was discarded.`
        : adbResult.truncated
          ? 'adb devices output exceeded the output limit. Partial output was discarded.'
          : adbResult.spawnError
            ? `adb could not be started: ${adbResult.spawnError}`
            : `adb devices exited ${adbResult.exitCode}: ${trimMessage(`${adbResult.stdout}\n${adbResult.stderr}`)}`;
      this.logger.error({ message, adbPath: tools.adbPath }, 'Android device discovery failed');
      return this.finish({
        inspectedAt,
        status: 'failed',
        adbPath: tools.adbPath,
        emulatorPath: tools.emulatorPath,
        devices: [],
        virtualDevices: correlateVirtualDevices(avds.names, [], false),
        unidentifiedRunningEmulators: 0,
        issues: [{ severity: 'error', code: 'adb-devices-failed', message }, ...avds.issues],
      });
    }

    const parsed = parseAdbDevices(adbResult.stdout);
    const named = parsed.sawHeader
      ? await this.attachAvdNames(tools.adbPath, parsed.devices)
      : { devices: [], issues: [] };
    const inventoryTrusted = parsed.sawHeader && !parsed.issues.some((issue) => issue.severity === 'error');
    const avds = await this.listAvds(tools.emulatorPath);
    const issues = [...parsed.issues, ...named.issues, ...avds.issues];
    const devices = named.devices;
    if (!parsed.sawHeader) {
      return this.finish({
        inspectedAt,
        status: 'failed',
        adbPath: tools.adbPath,
        emulatorPath: tools.emulatorPath,
        devices: [],
        virtualDevices: correlateVirtualDevices(avds.names, [], false),
        unidentifiedRunningEmulators: 0,
        issues,
      });
    }

    return this.finish({
      inspectedAt,
      status: inventoryTrusted ? 'ok' : 'failed',
      adbPath: tools.adbPath,
      emulatorPath: tools.emulatorPath,
      devices,
      virtualDevices: correlateVirtualDevices(avds.names, devices, inventoryTrusted),
      unidentifiedRunningEmulators: inventoryTrusted ? countUnidentifiedRunningEmulators(devices) : 0,
      issues,
    });
  }

  private async attachAvdNames(
    adbPath: string,
    devices: AndroidDevice[],
  ): Promise<{ devices: AndroidDevice[]; issues: Issue[] }> {
    const named: AndroidDevice[] = [];
    const issues: Issue[] = [];
    for (const device of devices) {
      if (device.kind !== 'emulator' || device.state !== 'device') {
        named.push(device);
        continue;
      }
      if (!SAFE_SERIAL.test(device.serial)) {
        const message = `Refusing to query an unexpected emulator serial: ${device.serial}`;
        this.logger.error({ serial: device.serial }, message);
        issues.push({ severity: 'warning', code: 'emulator-serial-rejected', message });
        named.push(device);
        continue;
      }
      const result = await this.runner.run(adbPath, ['-s', device.serial, 'emu', 'avd', 'name'], {
        timeoutMs: AVD_NAME_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      if (result.timedOut || result.truncated || result.spawnError || result.exitCode !== 0) {
        const message = result.timedOut
          ? `Timed out reading the AVD name for ${device.serial}.`
          : result.spawnError
            ? result.spawnError
            : trimMessage(`${result.stdout}\n${result.stderr}`) || `adb emu avd name failed for ${device.serial}.`;
        this.logger.warn({ serial: device.serial, message }, 'AVD name was not identified');
        issues.push({ severity: 'warning', code: 'avd-name-unknown', message });
        named.push(device);
        continue;
      }
      const parsed = parseEmulatorAvdName(result.stdout);
      if (!parsed.avdName) {
        const message = parsed.error ?? `The emulator console did not return an AVD name for ${device.serial}.`;
        this.logger.warn({ serial: device.serial, error: message }, 'AVD name was not identified');
        issues.push({ severity: 'warning', code: 'avd-name-unknown', message });
        named.push(device);
        continue;
      }
      named.push({ ...device, avdName: parsed.avdName });
    }
    return { devices: named, issues };
  }

  private async listAvds(emulatorPath: string | null): Promise<{ names: string[]; issues: Issue[] }> {
    if (!emulatorPath) {
      return {
        names: [],
        issues: [
          {
            severity: 'warning',
            code: 'emulator-missing',
            message: 'The Android emulator binary is not available, so AVD names cannot be listed.',
          },
        ],
      };
    }
    const result = await this.runner.run(emulatorPath, ['-list-avds'], {
      timeoutMs: LIST_AVDS_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    if (result.timedOut || result.truncated || result.spawnError || result.exitCode !== 0) {
      const message = result.timedOut
        ? `emulator -list-avds timed out after ${LIST_AVDS_TIMEOUT_MS}ms.`
        : result.spawnError
          ? `The emulator could not be started: ${result.spawnError}`
          : trimMessage(`${result.stdout}\n${result.stderr}`) || 'emulator -list-avds failed.';
      this.logger.warn({ message, emulatorPath }, 'AVD list failed');
      return {
        names: [],
        issues: [{ severity: 'warning', code: 'avd-list-failed', message }],
      };
    }
    return { names: parseAvdList(result.stdout), issues: [] };
  }

  private finish(report: DeviceDiscoveryReport): DeviceDiscoveryReport {
    return parseWithSchema(DeviceDiscoveryReportSchema, report, 'Device discovery report');
  }
}
