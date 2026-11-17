import type { DeviceDiscoveryReport, EnvironmentReport, ResolvedAndroidTools } from '@chaostwin/contracts';
import { formatDiscoveryReport } from '../format.js';

export interface DevicesDependencies {
  inspect(): Promise<EnvironmentReport>;
  discover(tools: ResolvedAndroidTools): Promise<DeviceDiscoveryReport>;
}

export async function runDevices(
  dependencies: DevicesDependencies,
  json: boolean,
): Promise<{ exitCode: number; stdout: string }> {
  const environment = await dependencies.inspect();
  const adb = environment.tools.find((tool) => tool.id === 'adb');
  const emulator = environment.tools.find((tool) => tool.id === 'emulator');
  if (adb?.status === 'ready' && !adb.location) {
    throw new Error('Internal error: ADB was marked ready without a location.');
  }
  const report = await dependencies.discover({
    adbPath: adb?.status === 'ready' ? adb.location : null,
    emulatorPath: emulator?.status === 'ready' ? (emulator.location ?? null) : null,
  });
  return {
    exitCode: report.status === 'ok' ? 0 : 1,
    stdout: json ? JSON.stringify(report, null, 2) : formatDiscoveryReport(report),
  };
}
