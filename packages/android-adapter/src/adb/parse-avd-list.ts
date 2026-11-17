/** Parse `emulator -list-avds` stdout. Log lines are not AVD names. */
export function parseAvdList(output: string): string[] {
  const names: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('INFO') || line.startsWith('ERROR') || line.startsWith('WARNING') || line.startsWith('*')) {
      continue;
    }
    names.push(line);
  }
  return names;
}
