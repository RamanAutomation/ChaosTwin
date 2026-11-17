import type { AndroidDevice } from '@chaostwin/contracts';
import { DeviceSelectionSchema } from '@chaostwin/contracts';
import { evaluateDeviceEligibility } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const online: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: 'sdk_gphone64_x86_64',
  product: 'sdk_gphone64_x86_64',
  deviceName: 'emu64xa',
  transportId: '1',
  avdName: 'Pixel_Tablet',
};

describe('evaluateDeviceEligibility', () => {
  it('rejects a discovered device until the operator selects that serial', () => {
    expect(evaluateDeviceEligibility(online, null).eligible).toBe(false);
    expect(evaluateDeviceEligibility(online, null).reasons.map((reason) => reason.code)).toEqual([
      'selection-missing',
    ]);
  });

  it('rejects approval that is missing, a different serial, or a device that is not online', () => {
    expect(evaluateDeviceEligibility(online, { serial: 'emulator-5554', operatorApproved: false }).reasons.map((r) => r.code)).toContain(
      'operator-approval-missing',
    );
    expect(evaluateDeviceEligibility(online, { serial: 'emulator-5556', operatorApproved: true }).reasons.map((r) => r.code)).toContain(
      'serial-mismatch',
    );
    expect(
      evaluateDeviceEligibility({ ...online, state: 'unauthorized' }, { serial: online.serial, operatorApproved: true })
        .eligible,
    ).toBe(false);
    expect(
      evaluateDeviceEligibility({ ...online, state: 'offline' }, { serial: online.serial, operatorApproved: true }).reasons.map(
        (reason) => reason.code,
      ),
    ).toContain('device-not-online');
  });

  it('accepts only an explicit match against an online device', () => {
    const decision = evaluateDeviceEligibility(online, { serial: 'emulator-5554', operatorApproved: true });
    expect(decision).toEqual({ eligible: true, reasons: [] });
  });

  it('rejects a selection document that is not explicitly approved', () => {
    expect(DeviceSelectionSchema.safeParse({ serial: 'emulator-5554', operatorApproved: false }).success).toBe(false);
    expect(DeviceSelectionSchema.safeParse({ serial: 'emulator-5554', operatorApproved: true }).success).toBe(true);
  });
});
