import { planProcessSpawn } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

describe('planProcessSpawn', () => {
  it('leaves native executables unwrapped', () => {
    expect(
      planProcessSpawn({
        platform: 'win32',
        command: 'C:\\Android\\platform-tools\\adb.exe',
        args: ['devices', '-l'],
      }),
    ).toEqual({
      command: 'C:\\Android\\platform-tools\\adb.exe',
      args: ['devices', '-l'],
    });
  });

  it('routes an absolute Windows cmd shim through cmd.exe without a live shell', () => {
    expect(
      planProcessSpawn({
        platform: 'win32',
        command: 'C:\\Program Files\\nodejs\\appium.cmd',
        args: ['-v'],
      }),
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program Files\\nodejs\\appium.cmd" "-v"'],
    });
  });

  it('refuses shell metacharacters and relative scripts', () => {
    expect(() =>
      planProcessSpawn({
        platform: 'win32',
        command: 'C:\\tools\\appium.cmd',
        args: ['-v', 'a&b'],
      }),
    ).toThrow(/metacharacters/);
    expect(() =>
      planProcessSpawn({
        platform: 'win32',
        command: 'appium.cmd',
        args: ['-v'],
      }),
    ).toThrow(/non-absolute/);
  });
});
