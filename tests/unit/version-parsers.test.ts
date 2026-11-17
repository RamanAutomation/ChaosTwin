import {
  parseAdbVersion,
  parseEmulatorVersion,
  parseJavaVersion,
  parseNodeVersion,
  parseStandaloneSemver,
} from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

describe('version parsers', () => {
  it('parses Node, npm, and Appium versions', () => {
    expect(parseNodeVersion('v24.18.0')).toBe('24.18.0');
    expect(parseStandaloneSemver('11.16.0\n')).toBe('11.16.0');
    expect(parseStandaloneSemver('2.15.0\n')).toBe('2.15.0');
  });

  it('parses Java from stderr', () => {
    expect(parseJavaVersion('openjdk version "25.0.3" 2026-04-21\r\nOpenJDK Runtime Environment\r\n')).toBe(
      '25.0.3',
    );
    expect(parseJavaVersion('java version "17.0.11" 2024-04-16\n')).toBe('17.0.11');
  });

  it('prefers the platform-tools ADB version', () => {
    const output = [
      'Android Debug Bridge version 1.0.41',
      'Version 37.0.1-15733141',
      'Installed as C:\\Android\\platform-tools\\adb.exe',
    ].join('\r\n');
    expect(parseAdbVersion(output)).toBe('37.0.1-15733141');
  });

  it('parses the emulator version and ignores the GPL banner', () => {
    const output = 'Android emulator version 37.2.12.0 (build_id 16428233) (CL:N/A)\nCopyright (C) 2006-2024\n';
    expect(parseEmulatorVersion(output)).toBe('37.2.12.0');
  });

  it('returns null when the output has no version', () => {
    expect(parseJavaVersion('not a runtime')).toBeNull();
    expect(parseAdbVersion('')).toBeNull();
    expect(parseEmulatorVersion('INFO | Graphics backend: gfxstream')).toBeNull();
  });
});
