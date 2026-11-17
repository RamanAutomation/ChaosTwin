import type { PathProbe } from '@chaostwin/contracts';

export class MapPathProbe implements PathProbe {
  constructor(
    private readonly files: ReadonlySet<string>,
    private readonly directories = new Map<string, readonly string[]>(),
  ) {}

  isFile(filePath: string): boolean {
    return this.files.has(filePath);
  }

  isDirectory(dirPath: string): boolean {
    return this.directories.has(dirPath);
  }

  listDirectories(dirPath: string): string[] {
    return [...(this.directories.get(dirPath) ?? [])];
  }
}
