import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { PathProbe } from '@chaostwin/contracts';

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class NodePathProbe implements PathProbe {
  isFile(filePath: string): boolean {
    try {
      return statSync(filePath).isFile();
    } catch (error) {
      if (isMissingPath(error)) {
        return false;
      }
      throw error;
    }
  }

  isDirectory(dirPath: string): boolean {
    try {
      return statSync(dirPath).isDirectory();
    } catch (error) {
      if (isMissingPath(error)) {
        return false;
      }
      throw error;
    }
  }

  listDirectories(dirPath: string): string[] {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dirPath, entry.name));
    } catch (error) {
      if (isMissingPath(error)) {
        return [];
      }
      throw error;
    }
  }
}
