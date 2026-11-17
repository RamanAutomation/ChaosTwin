export function parseNodeVersion(output: string): string | null {
  const match = output.match(/v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1] ?? null;
}

export function parseStandaloneSemver(output: string): string | null {
  const match = output.trim().match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1] ?? null;
}

export function parseJavaVersion(output: string): string | null {
  const match =
    output.match(/(?:openjdk|java)\s+version\s+"([^"]+)"/i) ??
    output.match(/version\s+"([^"]+)"/i);
  return match?.[1] ?? null;
}

/** Prefer the platform-tools version (`Version 37.0.1-...`) over the bridge protocol version. */
export function parseAdbVersion(output: string): string | null {
  const detailed = output.match(/^Version\s+(\S+)/m);
  if (detailed?.[1]) {
    return detailed[1];
  }
  const bridge = output.match(/Android Debug Bridge version\s+(\S+)/);
  return bridge?.[1] ?? null;
}

export function parseEmulatorVersion(output: string): string | null {
  const match = output.match(/Android emulator version\s+(\S+)/);
  return match?.[1] ?? null;
}
