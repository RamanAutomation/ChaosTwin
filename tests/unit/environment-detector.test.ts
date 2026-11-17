import path from 'node:path';
import { EnvironmentDetector, sdkSearchRoots } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';
import { FakeCommandRunner, commandResult } from '../helpers/fake-command-runner.ts';
import { MapPathProbe } from '../helpers/map-path-probe.ts';

const programFiles = 'C:\\Program Files';
const localAppData = 'C:\\Users\\Raman\\AppData\\Local';
const sdk = path.win32.join(localAppData, 'Android', 'Sdk');
const adb = path.win32.join(sdk, 'platform-tools', 'adb.exe');
const emulator = path.win32.join(sdk, 'emulator', 'emulator.exe');
const java = path.win32.join(programFiles, 'Android', 'Android Studio', 'jbr', 'bin', 'java.exe');
const nodeExec = 'C:\\Program Files\\nodejs\\node.exe';
const npmCli = path.win32.join('C:\\Program Files\\nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js');

const host = { nodeVersion: 'v24.18.0', nodeExecPath: nodeExec, arch: 'x64' };
const clock = (): Date => new Date('2026-01-15T12:00:00.000Z');

function workstationRunner(): FakeCommandRunner {
  return new FakeCommandRunner((command, args) => {
    if (command === 'where.exe') {
      return commandResult({ exitCode: 1, stderr: 'INFO: Could not find files for the given pattern(s).\r\n' });
    }
    if (command === java && args[0] === '-version') {
      return commandResult({ stderr: 'openjdk version "25.0.3" 2026-04-21\r\n' });
    }
    if (command === adb && args[0] === 'version') {
      return commandResult({ stdout: 'Android Debug Bridge version 1.0.41\r\nVersion 37.0.1-15733141\r\n' });
    }
    if (command === emulator && args[0] === '-version') {
      return commandResult({ stdout: 'Android emulator version 37.2.12.0 (build_id 16428233) (CL:N/A)\r\n' });
    }
    if (command === nodeExec && args[0] === npmCli && args[1] === '-v') {
      return commandResult({ stdout: '11.16.0\n' });
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  });
}

describe('EnvironmentDetector', () => {
  it('finds SDK and Java from known Windows locations when they are not on PATH', async () => {
    const runner = workstationRunner();
    const detector = new EnvironmentDetector({
      runner,
      paths: new MapPathProbe(new Set([adb, emulator, java, npmCli])),
      env: {
        LOCALAPPDATA: localAppData,
        ProgramFiles: programFiles,
        USERPROFILE: 'C:\\Users\\Raman',
      },
      platform: 'win32',
      host,
      clock,
    });

    const report = await detector.inspect();
    const byId = Object.fromEntries(report.tools.map((tool) => [tool.id, tool]));

    expect(report.inspectedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(byId.node).toMatchObject({ status: 'ready', version: '24.18.0', resolution: 'process' });
    expect(byId.npm).toMatchObject({ status: 'ready', version: '11.16.0' });
    expect(byId.java).toMatchObject({ status: 'ready', version: '25.0.3', location: java, resolution: 'well-known' });
    expect(byId['android-sdk']).toMatchObject({ status: 'ready', location: sdk, resolution: 'well-known', version: null });
    expect(byId.adb).toMatchObject({ status: 'ready', version: '37.0.1-15733141', location: adb, resolution: 'sdk' });
    expect(byId.emulator).toMatchObject({ status: 'ready', version: '37.2.12.0', resolution: 'sdk' });
    expect(byId.appium).toMatchObject({ status: 'missing', resolution: 'not-found' });
    expect(report.readiness).toEqual({
      canDiscoverDevices: true,
      canListVirtualDevices: true,
      canStartAppiumSession: false,
    });
    expect(report.suggestions).toEqual([
      `$env:JAVA_HOME = "${path.win32.join(programFiles, 'Android', 'Android Studio', 'jbr')}"`,
      `$env:ANDROID_HOME = "${sdk}"`,
      '$env:Path = "$env:JAVA_HOME\\bin;$env:ANDROID_HOME\\platform-tools;$env:ANDROID_HOME\\emulator;$env:Path"',
    ]);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'java-home-unset',
      'android-home-unset',
      'appium-missing',
    ]);
    expect(runner.calls.some((call) => call.args.includes('devices'))).toBe(false);
  });

  it('reports blockers without pretending the SDK is installed', async () => {
    const detector = new EnvironmentDetector({
      runner: new FakeCommandRunner(() => commandResult({ exitCode: 1 })),
      paths: new MapPathProbe(new Set()),
      env: {},
      platform: 'win32',
      host,
      clock,
    });

    const report = await detector.inspect();
    expect(report.readiness.canDiscoverDevices).toBe(false);
    expect(report.tools.find((tool) => tool.id === 'adb')?.status).toBe('missing');
    expect(report.issues.find((issue) => issue.code === 'adb-missing')?.severity).toBe('error');
    expect(report.suggestions).toEqual([]);
  });

  it('marks ADB unusable when the version command times out', async () => {
    const detector = new EnvironmentDetector({
      runner: new FakeCommandRunner((command) => {
        if (command === 'where.exe') {
          return commandResult({ exitCode: 1 });
        }
        if (command === adb) {
          return commandResult({ timedOut: true, exitCode: null });
        }
        return commandResult({ exitCode: 1 });
      }),
      paths: new MapPathProbe(new Set([adb])),
      env: { LOCALAPPDATA: localAppData },
      platform: 'win32',
      host,
      clock,
    });

    const report = await detector.inspect();
    expect(report.tools.find((tool) => tool.id === 'adb')).toMatchObject({ status: 'unusable' });
    expect(report.readiness.canDiscoverDevices).toBe(false);
    expect(report.issues.find((issue) => issue.code === 'adb-unusable')?.severity).toBe('error');
  });

  it('keeps searching when ANDROID_HOME does not contain platform-tools', async () => {
    const detector = new EnvironmentDetector({
      runner: workstationRunner(),
      paths: new MapPathProbe(new Set([adb, emulator, java, npmCli])),
      env: {
        ANDROID_HOME: 'C:\\missing\\Sdk',
        LOCALAPPDATA: localAppData,
        ProgramFiles: programFiles,
      },
      platform: 'win32',
      host,
      clock,
    });

    const report = await detector.inspect();
    expect(report.tools.find((tool) => tool.id === 'android-sdk')).toMatchObject({
      status: 'ready',
      location: sdk,
      resolution: 'well-known',
    });
    expect(report.issues.map((issue) => issue.code)).toContain('android-home-invalid');
    expect(report.suggestions.some((line) => line.includes(sdk))).toBe(true);
  });

  it('finds a JDK one level under Program Files\\Java', async () => {
    const jdk = path.win32.join(programFiles, 'Java', 'jdk-17');
    const javaExe = path.win32.join(jdk, 'bin', 'java.exe');
    const detector = new EnvironmentDetector({
      runner: new FakeCommandRunner((command, args) => {
        if (command === 'where.exe') {
          return commandResult({ exitCode: 1 });
        }
        if (command === javaExe && args[0] === '-version') {
          return commandResult({ stderr: 'java version "17.0.11"\n' });
        }
        if (command === nodeExec) {
          return commandResult({ stdout: '11.16.0\n' });
        }
        return commandResult({ exitCode: 1 });
      }),
      paths: new MapPathProbe(new Set([javaExe, npmCli]), new Map([[path.win32.join(programFiles, 'Java'), [jdk]]])),
      env: { ProgramFiles: programFiles },
      platform: 'win32',
      host,
      clock,
    });

    const report = await detector.inspect();
    expect(report.tools.find((tool) => tool.id === 'java')).toMatchObject({
      status: 'ready',
      version: '17.0.11',
      location: javaExe,
    });
  });
});

describe('sdk search roots', () => {
  it('uses the platform default without reading the host environment', () => {
    expect(sdkSearchRoots({ HOME: '/Users/raman' }, 'darwin')).toEqual(['/Users/raman/Library/Android/sdk']);
    expect(sdkSearchRoots({ HOME: '/home/raman' }, 'linux')).toEqual(['/home/raman/Android/Sdk']);
  });
});
