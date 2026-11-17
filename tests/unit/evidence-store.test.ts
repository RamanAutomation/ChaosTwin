import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvidenceStore } from '@chaostwin/evidence';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'chaostwin-evidence-'));
  directories.push(directory);
  return directory;
}

describe('EvidenceStore', () => {
  it('stores a screenshot under a unique name and does not replace the experiment folder', () => {
    const store = EvidenceStore.open(root(), 'CT-EXP-001', '2026-11-17T07:00:00.000Z');
    const first = store.saveScreenshot('evidence_shot', Buffer.from('one'));
    const second = store.saveScreenshot('evidence_shot', Buffer.from('two'));
    expect(first).toBe('screenshots/evidence_shot-1.png');
    expect(second).toBe('screenshots/evidence_shot-2.png');
    expect(readFileSync(path.join(store.directory, first)).toString()).toBe('one');
    expect(() => EvidenceStore.open(path.dirname(store.directory), 'CT-EXP-001', '2026-11-17T07:00:00.000Z')).toThrow(
      /already exists/,
    );
  });

  it('records a missing log without creating a fake file', () => {
    const store = EvidenceStore.open(root(), 'CT-EXP-002', '2026-11-17T07:00:00.000Z');
    store.recordMissing('logcat', 'Logcat collection timed out.');
    expect(store.missing()).toEqual([{ kind: 'logcat', message: 'Logcat collection timed out.' }]);
    expect(readdirSync(path.join(store.directory, 'logs'))).toEqual([]);
    const saved = store.saveLog('logcat', 'ChaosTwinDemo line');
    expect(readFileSync(path.join(store.directory, saved), 'utf8')).toContain('ChaosTwinDemo');
  });

  it('orders timeline events by timestamp and then insertion order', () => {
    const store = EvidenceStore.open(root(), 'CT-EXP-003', '2026-11-17T07:00:00.000Z');
    store.addEvent({
      at: '2026-11-17T07:00:02.000Z',
      order: 1,
      kind: 'fault-ended',
      stepId: null,
      message: 'restored',
    });
    store.addEvent({
      at: '2026-11-17T07:00:01.000Z',
      order: 2,
      kind: 'step-finished',
      stepId: 'submit_visit',
      message: 'later insertion at an earlier time',
    });
    store.addEvent({
      at: '2026-11-17T07:00:01.000Z',
      order: 0,
      kind: 'step-started',
      stepId: 'submit_visit',
      message: 'started',
    });
    store.writeTimeline();
    const timeline = JSON.parse(readFileSync(path.join(store.directory, 'timeline.json'), 'utf8')) as Array<{ order: number }>;
    expect(timeline.map((event) => event.order)).toEqual([0, 2, 1]);
  });
});
