import type {
  CommandResult,
  CommandRunner,
  EnvironmentReport,
  Issue,
  Logger,
  PathProbe,
  ToolProbe,
  ToolResolution,
} from '@chaostwin/contracts';
import { EnvironmentReportSchema, noopLogger, parseWithSchema } from '@chaostwin/contracts';
import { NodeCommandRunner } from '../process/node-command-runner.js';
import { NodePathProbe } from '../process/node-path-probe.js';
import { MAX_COMMAND_OUTPUT_BYTES, TIMEOUTS } from '../timeouts.js';
import {
  androidStudioJavaCandidates,
  formatEnvAssignment,
  javaExecutableFromHome,
  javaVendorRoots,
  npmCliPath,
  pathFor,
  sdkAdbPath,
  sdkEmulatorPath,
  sdkSearchRoots,
  type EnvMap,
} from './search-paths.js';
import {
  parseAdbVersion,
  parseEmulatorVersion,
  parseJavaVersion,
  parseNodeVersion,
  parseStandaloneSemver,
} from './version-parsers.js';

export interface HostInfo {
  nodeVersion: string;
  nodeExecPath: string;
  arch: string;
}

export interface EnvironmentDetectorOptions {
  runner: CommandRunner;
  paths: PathProbe;
  env: EnvMap;
  platform: NodeJS.Platform;
  host: HostInfo;
  clock?: () => Date;
  logger?: Logger;
}

interface VersionProbe {
  status: 'ready' | 'unusable';
  version: string | null;
  detail: string | null;
}

interface LocatedFile {
  location: string;
  resolution: ToolResolution;
}

const COMMAND_NAME = /^[A-Za-z0-9._-]+$/;
const VENDOR_SCAN_LIMIT = 20;

function trimDetail(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 300) {
    return compact;
  }
  return `${compact.slice(0, 297)}...`;
}

export class EnvironmentDetector {
  private readonly runner: CommandRunner;
  private readonly paths: PathProbe;
  private readonly env: EnvMap;
  private readonly platform: NodeJS.Platform;
  private readonly host: HostInfo;
  private readonly clock: () => Date;
  private readonly logger: Logger;

  constructor(options: EnvironmentDetectorOptions) {
    this.runner = options.runner;
    this.paths = options.paths;
    this.env = options.env;
    this.platform = options.platform;
    this.host = options.host;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger ?? noopLogger;
  }

  async inspect(): Promise<EnvironmentReport> {
    const issues: Issue[] = [];
    const nodeTool = this.probeNode();
    const npmTool = await this.probeNpm();
    const javaTool = await this.probeJava(issues);
    const sdkTool = this.probeSdk(issues);
    const adbTool = await this.probeAdb(sdkTool, issues);
    const emulatorTool = await this.probeEmulator(sdkTool, issues);
    const appiumTool = await this.probeAppium(issues);
    const suggestions = await this.setupSuggestions(sdkTool, javaTool, adbTool, issues);

    const report: EnvironmentReport = {
      inspectedAt: this.clock().toISOString(),
      host: {
        platform: this.platform,
        arch: this.host.arch,
        nodeVersion: this.host.nodeVersion,
      },
      tools: [nodeTool, npmTool, javaTool, sdkTool, adbTool, emulatorTool, appiumTool],
      readiness: {
        canDiscoverDevices: adbTool.status === 'ready',
        canListVirtualDevices: emulatorTool.status === 'ready',
        canStartAppiumSession: javaTool.status === 'ready' && appiumTool.status === 'ready',
      },
      suggestions,
      issues,
    };

    return parseWithSchema(EnvironmentReportSchema, report, 'Environment report');
  }

  private probeNode(): ToolProbe {
    const version = parseNodeVersion(this.host.nodeVersion);
    return {
      id: 'node',
      displayName: 'Node.js',
      status: version ? 'ready' : 'unusable',
      requiredFor: [],
      version,
      location: this.host.nodeExecPath,
      resolution: 'process',
      detail: version ? null : `Could not parse a Node.js version from ${this.host.nodeVersion}`,
    };
  }

  private async probeNpm(): Promise<ToolProbe> {
    const cliPath = npmCliPath(this.host.nodeExecPath, this.platform);
    if (!this.paths.isFile(cliPath)) {
      return this.missing('npm', 'npm', [], 'npm CLI was not found next to the running Node.js executable.');
    }
    const probe = await this.runVersionProbe(
      this.host.nodeExecPath,
      [cliPath, '-v'],
      parseStandaloneSemver,
    );
    return this.fromProbe('npm', 'npm', [], cliPath, 'process', probe);
  }

  private async probeJava(issues: Issue[]): Promise<ToolProbe> {
    const candidates = await this.javaCandidates(issues);
    if (candidates.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'java-missing',
        message: 'Java was not found. Device discovery does not need it. Appium sessions do.',
      });
      return this.missing('java', 'Java', ['appium-session'], 'Java was not found on PATH, JAVA_HOME, or known install locations.');
    }

    let firstBroken: LocatedFile | null = null;
    let firstBrokenDetail: string | null = null;
    for (const candidate of candidates) {
      const probe = await this.runVersionProbe(candidate.location, ['-version'], parseJavaVersion);
      if (probe.status === 'ready') {
        if (candidate.resolution !== 'environment' && !this.env.JAVA_HOME) {
          issues.push({
            severity: 'warning',
            code: 'java-home-unset',
            message: `Java was found at ${candidate.location}, but JAVA_HOME is not set.`,
          });
        }
        return this.fromProbe('java', 'Java', ['appium-session'], candidate.location, candidate.resolution, probe);
      }
      this.logger.warn({ location: candidate.location, detail: probe.detail }, 'Java candidate is unusable');
      if (!firstBroken) {
        firstBroken = candidate;
        firstBrokenDetail = probe.detail;
      }
    }

    issues.push({
      severity: 'warning',
      code: 'java-unusable',
      message: firstBrokenDetail ?? 'A Java executable was found but did not report a version.',
    });
    return this.fromProbe(
      'java',
      'Java',
      ['appium-session'],
      firstBroken?.location ?? null,
      firstBroken?.resolution ?? 'not-found',
      { status: 'unusable', version: null, detail: firstBrokenDetail },
    );
  }

  private probeSdk(issues: Issue[]): ToolProbe {
    const located = this.locateSdk(issues);
    if (!located) {
      issues.push({
        severity: 'warning',
        code: 'android-sdk-missing',
        message: 'Android SDK was not found. Set ANDROID_HOME, or install it under the default Android SDK directory.',
      });
      return this.missing(
        'android-sdk',
        'Android SDK',
        ['device-discovery', 'emulator-inventory', 'appium-session'],
        'Android SDK was not found.',
      );
    }
    if (located.resolution !== 'environment' && !this.env.ANDROID_HOME && !this.env.ANDROID_SDK_ROOT) {
      issues.push({
        severity: 'warning',
        code: 'android-home-unset',
        message: `Android SDK was found at ${located.location}, but ANDROID_HOME and ANDROID_SDK_ROOT are unset.`,
      });
    }
    return {
      id: 'android-sdk',
      displayName: 'Android SDK',
      status: 'ready',
      requiredFor: ['device-discovery', 'emulator-inventory', 'appium-session'],
      version: null,
      location: located.location,
      resolution: located.resolution,
      detail: null,
    };
  }

  private async probeAdb(sdk: ToolProbe, issues: Issue[]): Promise<ToolProbe> {
    const fromSdk = sdk.location ? sdkAdbPath(sdk.location, this.platform) : null;
    let location: string | null = null;
    let resolution: ToolResolution = 'not-found';
    if (fromSdk && this.paths.isFile(fromSdk)) {
      location = fromSdk;
      resolution = 'sdk';
    } else {
      const onPath = await this.resolveOnPath('adb');
      if (onPath) {
        location = onPath;
        resolution = 'path';
      }
    }

    if (!location) {
      issues.push({
        severity: 'error',
        code: 'adb-missing',
        message: 'ADB was not found. Install Android SDK platform-tools or set ANDROID_HOME.',
      });
      return this.missing('adb', 'ADB', ['device-discovery', 'appium-session'], 'ADB was not found.');
    }

    const probe = await this.runVersionProbe(location, ['version'], parseAdbVersion);
    if (probe.status !== 'ready') {
      issues.push({
        severity: 'error',
        code: 'adb-unusable',
        message: probe.detail ?? 'ADB did not report a version.',
      });
    }
    return this.fromProbe('adb', 'ADB', ['device-discovery', 'appium-session'], location, resolution, probe);
  }

  private async probeEmulator(sdk: ToolProbe, issues: Issue[]): Promise<ToolProbe> {
    const fromSdk = sdk.location ? sdkEmulatorPath(sdk.location, this.platform) : null;
    let location: string | null = null;
    let resolution: ToolResolution = 'not-found';
    if (fromSdk && this.paths.isFile(fromSdk)) {
      location = fromSdk;
      resolution = 'sdk';
    } else {
      const onPath = await this.resolveOnPath('emulator');
      if (onPath) {
        location = onPath;
        resolution = 'path';
      }
    }

    if (!location) {
      issues.push({
        severity: 'warning',
        code: 'emulator-missing',
        message: 'The Android emulator binary was not found. Connected devices can still be listed when ADB is available.',
      });
      return this.missing('emulator', 'Android Emulator', ['emulator-inventory'], 'Android emulator was not found.');
    }

    const probe = await this.runVersionProbe(location, ['-version'], parseEmulatorVersion);
    if (probe.status !== 'ready') {
      issues.push({
        severity: 'warning',
        code: 'emulator-unusable',
        message: probe.detail ?? 'The Android emulator did not report a version.',
      });
    }
    return this.fromProbe('emulator', 'Android Emulator', ['emulator-inventory'], location, resolution, probe);
  }

  private async probeAppium(issues: Issue[]): Promise<ToolProbe> {
    const location = await this.resolveOnPath('appium');
    if (!location) {
      issues.push({
        severity: 'warning',
        code: 'appium-missing',
        message: 'Appium was not found on PATH. Session creation is not available until CT-003.',
      });
      return this.missing('appium', 'Appium', ['appium-session'], 'Appium was not found on PATH.');
    }
    const probe = await this.runVersionProbe(location, ['-v'], parseStandaloneSemver);
    if (probe.status !== 'ready') {
      issues.push({
        severity: 'warning',
        code: 'appium-unusable',
        message: probe.detail ?? 'Appium did not report a version.',
      });
    }
    return this.fromProbe('appium', 'Appium', ['appium-session'], location, 'path', probe);
  }

  private locateSdk(issues: Issue[]): { location: string; resolution: ToolResolution } | null {
    const environmentCandidates: Array<{ name: 'ANDROID_HOME' | 'ANDROID_SDK_ROOT'; value: string }> = [];
    if (this.env.ANDROID_HOME) {
      environmentCandidates.push({ name: 'ANDROID_HOME', value: this.env.ANDROID_HOME });
    }
    if (this.env.ANDROID_SDK_ROOT && this.env.ANDROID_SDK_ROOT !== this.env.ANDROID_HOME) {
      environmentCandidates.push({ name: 'ANDROID_SDK_ROOT', value: this.env.ANDROID_SDK_ROOT });
    }

    for (const candidate of environmentCandidates) {
      if (this.paths.isFile(sdkAdbPath(candidate.value, this.platform))) {
        return { location: candidate.value, resolution: 'environment' };
      }
      issues.push({
        severity: 'warning',
        code: 'android-home-invalid',
        message: `${candidate.name} is set to ${candidate.value}, but platform-tools ADB is not in that directory.`,
      });
    }

    for (const root of sdkSearchRoots(this.env, this.platform)) {
      if (this.paths.isFile(sdkAdbPath(root, this.platform))) {
        return { location: root, resolution: 'well-known' };
      }
    }
    return null;
  }

  private async javaCandidates(issues: Issue[]): Promise<LocatedFile[]> {
    const candidates: LocatedFile[] = [];
    const seen = new Set<string>();
    const add = (location: string | null, resolution: ToolResolution): void => {
      if (!location || seen.has(location) || !this.paths.isFile(location)) {
        return;
      }
      seen.add(location);
      candidates.push({ location, resolution });
    };

    if (this.env.JAVA_HOME) {
      const fromHome = javaExecutableFromHome(this.env.JAVA_HOME, this.platform);
      if (this.paths.isFile(fromHome)) {
        add(fromHome, 'environment');
      } else {
        issues.push({
          severity: 'warning',
          code: 'java-home-invalid',
          message: `JAVA_HOME is set to ${this.env.JAVA_HOME}, but java was not found at ${fromHome}.`,
        });
      }
    }

    for (const location of await this.resolveAllOnPath('java')) {
      add(location, 'path');
    }
    for (const location of androidStudioJavaCandidates(this.env, this.platform)) {
      add(location, 'well-known');
    }
    for (const root of javaVendorRoots(this.env, this.platform)) {
      const children = this.paths.listDirectories(root).sort();
      if (children.length > VENDOR_SCAN_LIMIT) {
        issues.push({
          severity: 'warning',
          code: 'java-scan-truncated',
          message: `Only the first ${VENDOR_SCAN_LIMIT} directories under ${root} were scanned for a JDK.`,
        });
      }
      for (const child of children.slice(0, VENDOR_SCAN_LIMIT)) {
        add(javaExecutableFromHome(child, this.platform), 'well-known');
      }
    }
    return candidates;
  }

  private async setupSuggestions(
    sdk: ToolProbe,
    java: ToolProbe,
    adb: ToolProbe,
    issues: Issue[],
  ): Promise<string[]> {
    const suggestions: string[] = [];
    if (java.status === 'ready' && java.location && java.resolution !== 'environment') {
      const javaHome = pathFor(this.platform).dirname(pathFor(this.platform).dirname(java.location));
      suggestions.push(formatEnvAssignment(this.platform, 'JAVA_HOME', javaHome));
    }
    if (sdk.status === 'ready' && sdk.location && sdk.resolution !== 'environment') {
      suggestions.push(formatEnvAssignment(this.platform, 'ANDROID_HOME', sdk.location));
    }
    if (adb.status === 'ready' && sdk.status === 'ready') {
      const onPath = await this.safeResolveOnPath('adb', issues);
      if (!onPath && this.platform === 'win32') {
        suggestions.push(
          '$env:Path = "$env:JAVA_HOME\\bin;$env:ANDROID_HOME\\platform-tools;$env:ANDROID_HOME\\emulator;$env:Path"',
        );
      }
      if (!onPath && this.platform !== 'win32') {
        suggestions.push('export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"');
      }
    }
    return suggestions;
  }

  private async safeResolveOnPath(commandName: string, issues: Issue[]): Promise<string | null> {
    try {
      return await this.resolveOnPath(commandName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message, commandName }, 'PATH lookup failed');
      issues.push({
        severity: 'warning',
        code: 'path-lookup-failed',
        message,
      });
      return null;
    }
  }

  private async resolveOnPath(commandName: string): Promise<string | null> {
    const found = await this.resolveAllOnPath(commandName);
    return found[0] ?? null;
  }

  private async resolveAllOnPath(commandName: string): Promise<string[]> {
    if (!COMMAND_NAME.test(commandName)) {
      throw new Error(`Refusing to search PATH for unexpected command name: ${commandName}`);
    }
    const locator = this.platform === 'win32' ? 'where.exe' : 'which';
    const result = await this.runner.run(locator, [commandName], {
      timeoutMs: TIMEOUTS.pathLookupMs,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
    if (result.timedOut) {
      throw new Error(`Timed out while searching PATH for ${commandName}.`);
    }
    if (result.truncated) {
      throw new Error(`PATH search output for ${commandName} exceeded the output limit.`);
    }
    if (result.spawnError || result.exitCode !== 0) {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('INFO:'))
      .filter((line) => this.paths.isFile(line));
  }

  private async runVersionProbe(
    location: string,
    args: readonly string[],
    parse: (output: string) => string | null,
  ): Promise<VersionProbe> {
    let result: CommandResult;
    try {
      result = await this.runner.run(location, args, {
        timeoutMs: TIMEOUTS.versionMs,
        maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message, location }, 'Version probe was rejected');
      return { status: 'unusable', version: null, detail: message };
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.timedOut) {
      return { status: 'unusable', version: null, detail: `Timed out after ${TIMEOUTS.versionMs}ms.` };
    }
    if (result.truncated) {
      return { status: 'unusable', version: null, detail: 'Version output exceeded the output limit.' };
    }
    if (result.spawnError) {
      return { status: 'unusable', version: null, detail: result.spawnError };
    }
    if (result.exitCode !== 0) {
      return {
        status: 'unusable',
        version: null,
        detail: trimDetail(combined) || `Exited with code ${result.exitCode}.`,
      };
    }
    const version = parse(combined);
    if (!version) {
      return { status: 'unusable', version: null, detail: 'Could not parse a version from the command output.' };
    }
    return { status: 'ready', version, detail: null };
  }

  private missing(
    id: ToolProbe['id'],
    displayName: string,
    requiredFor: ToolProbe['requiredFor'],
    detail: string,
  ): ToolProbe {
    return {
      id,
      displayName,
      status: 'missing',
      requiredFor,
      version: null,
      location: null,
      resolution: 'not-found',
      detail,
    };
  }

  private fromProbe(
    id: ToolProbe['id'],
    displayName: string,
    requiredFor: ToolProbe['requiredFor'],
    location: string | null,
    resolution: ToolResolution,
    probe: VersionProbe,
  ): ToolProbe {
    return {
      id,
      displayName,
      status: probe.status,
      requiredFor,
      version: probe.version,
      location,
      resolution,
      detail: probe.detail,
    };
  }
}

export function createHostEnvironmentDetector(logger?: Logger): EnvironmentDetector {
  return new EnvironmentDetector({
    runner: new NodeCommandRunner(),
    paths: new NodePathProbe(),
    env: process.env,
    platform: process.platform,
    host: {
      nodeVersion: process.version,
      nodeExecPath: process.execPath,
      arch: process.arch,
    },
    ...(logger ? { logger } : {}),
  });
}
