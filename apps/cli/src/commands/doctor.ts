import type { DeviceDiscoveryReport, EnvironmentReport, ResolvedAndroidTools } from '@chaostwin/contracts';
import { formatDiscoveryReport, formatEnvironmentReport } from '../format.js';

export interface DoctorDependencies {
  inspect(): Promise<EnvironmentReport>;
  discover(tools: ResolvedAndroidTools): Promise<DeviceDiscoveryReport>;
}

export interface CommandOutput {
  exitCode: number;
  stdout: string;
}

function toolLocation(report: EnvironmentReport, id: EnvironmentReport['tools'][number]['id']): string | null {
  const tool = report.tools.find((candidate) => candidate.id === id);
  if (!tool || tool.status !== 'ready' || !tool.location) {
    return null;
  }
  return tool.location;
}

export async function runDoctor(dependencies: DoctorDependencies, json: boolean): Promise<CommandOutput> {
  const environment = await dependencies.inspect();
  const tools: ResolvedAndroidTools = {
    adbPath: toolLocation(environment, 'adb'),
    emulatorPath: toolLocation(environment, 'emulator'),
  };
  const discovery = environment.readiness.canDiscoverDevices ? await dependencies.discover(tools) : null;
  const exitCode = !environment.readiness.canDiscoverDevices || (discovery !== null && discovery.status !== 'ok') ? 1 : 0;
  if (json) {
    return {
      exitCode,
      stdout: JSON.stringify({ environment, discovery }, null, 2),
    };
  }
  const sections = [formatEnvironmentReport(environment)];
  if (discovery) {
    sections.push('', formatDiscoveryReport(discovery));
  } else {
    sections.push('', 'Connected devices were not queried because ADB is not ready.');
  }
  return { exitCode, stdout: sections.join('\n') };
}
