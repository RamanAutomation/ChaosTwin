import path from 'node:path';

export type EnvMap = Record<string, string | undefined>;

export function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function executableName(platform: NodeJS.Platform, base: string): string {
  return platform === 'win32' ? `${base}.exe` : base;
}

export function sdkAdbPath(sdkRoot: string, platform: NodeJS.Platform): string {
  return pathFor(platform).join(sdkRoot, 'platform-tools', executableName(platform, 'adb'));
}

export function sdkEmulatorPath(sdkRoot: string, platform: NodeJS.Platform): string {
  return pathFor(platform).join(sdkRoot, 'emulator', executableName(platform, 'emulator'));
}

export function javaExecutableFromHome(javaHome: string, platform: NodeJS.Platform): string {
  return pathFor(platform).join(javaHome, 'bin', executableName(platform, 'java'));
}

export function npmCliPath(nodeExecPath: string, platform: NodeJS.Platform): string {
  const bin = pathFor(platform);
  return bin.join(bin.dirname(nodeExecPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

export function sdkSearchRoots(env: EnvMap, platform: NodeJS.Platform): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    roots.push(value);
  };

  if (platform === 'win32' && env.LOCALAPPDATA) {
    add(path.win32.join(env.LOCALAPPDATA, 'Android', 'Sdk'));
  }
  if (platform === 'win32' && env.USERPROFILE) {
    add(path.win32.join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'));
  }
  if (platform === 'darwin' && env.HOME) {
    add(path.posix.join(env.HOME, 'Library', 'Android', 'sdk'));
  }
  if (platform === 'linux' && env.HOME) {
    add(path.posix.join(env.HOME, 'Android', 'Sdk'));
  }
  return roots;
}

export function androidStudioJavaCandidates(env: EnvMap, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') {
    return [];
  }
  const candidates: string[] = [];
  if (env.ProgramFiles) {
    candidates.push(
      path.win32.join(env.ProgramFiles, 'Android', 'Android Studio', 'jbr', 'bin', 'java.exe'),
    );
    candidates.push(
      path.win32.join(env.ProgramFiles, 'Android', 'Android Studio', 'jre', 'bin', 'java.exe'),
    );
  }
  if (env.LOCALAPPDATA) {
    candidates.push(
      path.win32.join(env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr', 'bin', 'java.exe'),
    );
  }
  return candidates;
}

export function javaVendorRoots(env: EnvMap, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32' || !env.ProgramFiles) {
    return [];
  }
  return ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto', 'Zulu'].map((name) =>
    path.win32.join(env.ProgramFiles as string, name),
  );
}

export function formatEnvAssignment(
  platform: NodeJS.Platform,
  name: string,
  value: string,
): string {
  if (platform === 'win32') {
    return `$env:${name} = "${value}"`;
  }
  return `export ${name}="${value}"`;
}
