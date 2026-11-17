import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodePathProbe } from '@chaostwin/core';
import { afterEach, describe, expect, it } from 'vitest';

describe('NodePathProbe', () => {
  const created: string[] = [];
  const probe = new NodePathProbe();

  afterEach(() => {
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distinguishes files, missing paths, and child directories', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'chaostwin-probe-'));
    created.push(dir);
    const nested = path.join(dir, 'jdk');
    const file = path.join(dir, 'adb.exe');
    writeFileSync(file, '');
    mkdirSync(nested);

    expect(probe.isFile(file)).toBe(true);
    expect(probe.isFile(path.join(dir, 'missing.exe'))).toBe(false);
    expect(probe.isDirectory(nested)).toBe(true);
    expect(probe.listDirectories(dir)).toEqual([nested]);
    expect(probe.listDirectories(path.join(dir, 'absent'))).toEqual([]);
  });
});
