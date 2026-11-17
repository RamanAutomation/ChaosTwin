export interface EmulatorAvdNameParse {
  avdName: string | null;
  error: string | null;
}

/** Parse `adb -s <serial> emu avd name` stdout. */
export function parseEmulatorAvdName(output: string): EmulatorAvdNameParse {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const failure = lines.find((line) => line.startsWith('KO:') || line.startsWith('KO '));
  if (failure) {
    return { avdName: null, error: failure };
  }
  const name = lines.find((line) => line !== 'OK');
  if (!name) {
    return { avdName: null, error: 'The emulator console did not return an AVD name.' };
  }
  return { avdName: name, error: null };
}
