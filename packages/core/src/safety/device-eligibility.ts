import type { AndroidDevice, EligibilityDecision } from '@chaostwin/contracts';

export interface DeviceSelectionInput {
  serial: string;
  operatorApproved: boolean;
}

/**
 * Discovery never grants permission to run an experiment.
 * A device is eligible only when an operator selects that exact serial and
 * adb currently reports it as `device` (online and authorized by the device).
 */
export function evaluateDeviceEligibility(
  device: AndroidDevice,
  selection: DeviceSelectionInput | null,
): EligibilityDecision {
  const reasons: EligibilityDecision['reasons'] = [];

  if (!selection) {
    reasons.push({
      code: 'selection-missing',
      message: 'No explicit device selection was provided.',
    });
  } else {
    if (selection.operatorApproved !== true) {
      reasons.push({
        code: 'operator-approval-missing',
        message: 'Operator approval is required before a device can be used.',
      });
    }
    if (selection.serial !== device.serial) {
      reasons.push({
        code: 'serial-mismatch',
        message: `Selection serial "${selection.serial}" does not match device "${device.serial}".`,
      });
    }
  }

  if (device.state !== 'device') {
    reasons.push({
      code: 'device-not-online',
      message: `Device state is "${device.state}". Only state "device" can be used for an experiment.`,
    });
  }

  return { eligible: reasons.length === 0, reasons };
}
