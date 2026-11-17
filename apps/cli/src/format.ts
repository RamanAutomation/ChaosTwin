import type { DeviceDiscoveryReport, EnvironmentReport, Issue, ToolProbe } from '@chaostwin/contracts';

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function issueLine(issue: Issue): string {
  return `${issue.severity.toUpperCase()} [${issue.code}] ${issue.message}`;
}

function toolRow(tool: ToolProbe): string {
  return [
    pad(tool.id, 14),
    pad(tool.status, 10),
    pad(tool.version ?? '-', 18),
    tool.location ?? '-',
  ].join(' ');
}

export function formatEnvironmentReport(report: EnvironmentReport): string {
  const lines = [
    'ChaosTwin environment',
    `Inspected: ${report.inspectedAt}`,
    `Host: ${report.host.platform} ${report.host.arch} node ${report.host.nodeVersion}`,
    '',
    `${pad('Tool', 14)} ${pad('Status', 10)} ${pad('Version', 18)} Location`,
    ...report.tools.map(toolRow),
    '',
    `Device discovery: ${report.readiness.canDiscoverDevices ? 'ready' : 'blocked'}`,
    `Emulator inventory: ${report.readiness.canListVirtualDevices ? 'ready' : 'blocked'}`,
    `Appium session: ${report.readiness.canStartAppiumSession ? 'ready' : 'not available'}`,
  ];
  if (report.suggestions.length > 0) {
    lines.push('', 'Suggested PowerShell session setup:');
    lines.push(...report.suggestions);
  }
  if (report.issues.length > 0) {
    lines.push('', 'Issues:');
    lines.push(...report.issues.map(issueLine));
  }
  return lines.join('\n');
}

export function formatDiscoveryReport(report: DeviceDiscoveryReport): string {
  const lines = [
    'ChaosTwin Android devices',
    `Inspected: ${report.inspectedAt}`,
    `Status: ${report.status}`,
    `ADB: ${report.adbPath ?? 'not available'}`,
    `Emulator: ${report.emulatorPath ?? 'not available'}`,
    '',
    'Connected devices:',
  ];
  if (report.devices.length === 0) {
    lines.push('  none');
  } else {
    for (const device of report.devices) {
      const model = device.model ?? 'unknown-model';
      const avd = device.avdName ? ` avd=${device.avdName}` : '';
      lines.push(`  ${device.serial}  ${device.state}  ${device.kind}  ${device.connection}  ${model}${avd}`);
    }
  }

  lines.push('', 'Virtual devices:');
  const avdInventoryMissing = report.issues.some(
    (issue) => issue.code === 'emulator-missing' || issue.code === 'avd-list-failed',
  );
  if (avdInventoryMissing) {
    lines.push('  not available');
  } else if (report.virtualDevices.length === 0) {
    lines.push('  none defined');
  } else {
    for (const avd of report.virtualDevices) {
      const running = avd.running === true ? 'running' : avd.running === false ? 'not running' : 'running state unknown';
      const serial = avd.serial ? `  serial=${avd.serial}` : '';
      lines.push(`  ${avd.name}  ${running}${serial}`);
    }
  }
  if (report.unidentifiedRunningEmulators > 0) {
    lines.push(
      '',
      `Running emulators without an identified AVD name: ${report.unidentifiedRunningEmulators}`,
    );
  }
  if (report.issues.length > 0) {
    lines.push('', 'Issues:');
    lines.push(...report.issues.map(issueLine));
  }
  lines.push('', 'Discovery does not authorize a device. Experiments require an explicit operator selection.');
  return lines.join('\n');
}
