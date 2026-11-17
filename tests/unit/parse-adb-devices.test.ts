import { parseAdbDevices, parseAvdList, parseEmulatorAvdName } from '@chaostwin/android-adapter';
import { describe, expect, it } from 'vitest';

describe('parseAdbDevices', () => {
  it('parses an online emulator and an unauthorized phone', () => {
    const output = [
      'List of devices attached',
      'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1',
      'R58N123ABC             unauthorized usb:1-2 product:oriole model:Pixel_6 device:oriole transport_id:3',
      '',
    ].join('\r\n');

    const parsed = parseAdbDevices(output);
    expect(parsed.sawHeader).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.devices).toEqual([
      {
        serial: 'emulator-5554',
        state: 'device',
        kind: 'emulator',
        connection: 'emulator',
        model: 'sdk_gphone64_x86_64',
        product: 'sdk_gphone64_x86_64',
        deviceName: 'emu64xa',
        transportId: '1',
        avdName: null,
      },
      {
        serial: 'R58N123ABC',
        state: 'unauthorized',
        kind: 'hardware',
        connection: 'usb',
        model: 'Pixel_6',
        product: 'oriole',
        deviceName: 'oriole',
        transportId: '3',
        avdName: null,
      },
    ]);
  });

  it('treats a header with no devices as an empty inventory', () => {
    expect(parseAdbDevices('List of devices attached\r\n\r\n')).toMatchObject({
      sawHeader: true,
      devices: [],
      issues: [],
    });
  });

  it('does not treat missing header output as zero devices', () => {
    const parsed = parseAdbDevices('emulator-5554 device\n');
    expect(parsed.sawHeader).toBe(false);
    expect(parsed.issues.map((issue) => issue.code)).toContain('adb-output-unrecognized');
  });

  it('keeps an unknown state visible instead of dropping the line', () => {
    const parsed = parseAdbDevices('List of devices attached\nweird-serial mystery\n');
    expect(parsed.devices[0]).toMatchObject({ serial: 'weird-serial', state: 'unknown' });
    expect(parsed.issues[0]?.code).toBe('adb-line-unrecognized');
  });
});

describe('parseAvdList and emulator AVD names', () => {
  it('keeps AVD names that contain dots and skips log lines', () => {
    expect(parseAvdList('INFO         | Android emulator version\nMedium_Phone_API_37.0\nPixel_Tablet\n')).toEqual([
      'Medium_Phone_API_37.0',
      'Pixel_Tablet',
    ]);
  });

  it('reads the name that precedes the console OK', () => {
    expect(parseEmulatorAvdName('Pixel_Tablet\nOK\n')).toEqual({ avdName: 'Pixel_Tablet', error: null });
    expect(parseEmulatorAvdName('KO: unknown command\n').error).toMatch(/KO:/);
  });
});
