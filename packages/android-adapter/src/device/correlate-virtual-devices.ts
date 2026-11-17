import type { AndroidDevice, AndroidVirtualDevice } from '@chaostwin/contracts';

export function countUnidentifiedRunningEmulators(devices: readonly AndroidDevice[]): number {
  return devices.filter(
    (device) => device.kind === 'emulator' && device.state === 'device' && device.avdName === null,
  ).length;
}

/**
 * Do not mark an AVD as stopped unless every running emulator was identified.
 * `running: null` means the evidence is incomplete.
 */
export function correlateVirtualDevices(
  names: readonly string[],
  devices: readonly AndroidDevice[],
  inventoryTrusted: boolean,
): AndroidVirtualDevice[] {
  if (!inventoryTrusted) {
    return names.map((name) => ({ name, running: null, serial: null }));
  }

  const unidentified = countUnidentifiedRunningEmulators(devices) > 0;
  return names.map((name) => {
    const match = devices.find((device) => device.avdName === name && device.state === 'device');
    if (match) {
      return { name, running: true, serial: match.serial };
    }
    if (unidentified) {
      return { name, running: null, serial: null };
    }
    return { name, running: false, serial: null };
  });
}
