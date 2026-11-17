import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MissingEvidence, TimelineEvent } from '@chaostwin/contracts';
import { EXPERIMENT_ID_PATTERN, TimelineEventSchema, parseWithSchema } from '@chaostwin/contracts';

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * One directory per experiment id. Opening an id that already has a directory
 * throws, so a later run cannot replace an earlier result.
 */
export class EvidenceStore {
  private readonly saved: string[] = [];
  private readonly gaps: MissingEvidence[] = [];
  private readonly events: TimelineEvent[] = [];
  private screenshotCount = 0;

  private constructor(
    readonly directory: string,
    private readonly createdAt: string,
  ) {}

  static open(root: string, experimentId: string, createdAt: string): EvidenceStore {
    if (!EXPERIMENT_ID_PATTERN.test(experimentId)) {
      throw new Error(`Experiment id "${experimentId}" is not a safe folder name.`);
    }
    const base = path.resolve(root);
    const directory = path.resolve(base, experimentId);
    if (directory !== path.join(base, experimentId)) {
      throw new Error(`Experiment id "${experimentId}" escapes the evidence root.`);
    }
    try {
      mkdirSync(directory);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (code === 'EEXIST') {
        throw new Error(`Evidence directory already exists: ${directory}`, { cause: error });
      }
      throw error;
    }
    mkdirSync(path.join(directory, 'screenshots'));
    mkdirSync(path.join(directory, 'logs'));
    return new EvidenceStore(directory, createdAt);
  }

  saveScreenshot(stepId: string, bytes: Buffer): string {
    this.screenshotCount += 1;
    const safeStep = safeToken(stepId);
    const name = `${safeStep}-${this.screenshotCount}.png`;
    const relative = path.posix.join('screenshots', name);
    this.writeNew(relative, bytes);
    return relative;
  }

  saveLog(name: string, text: string): string {
    const relative = path.posix.join('logs', `${safeToken(name)}.txt`);
    this.writeNew(relative, text);
    return relative;
  }

  addEvent(event: TimelineEvent): void {
    this.events.push(parseWithSchema(TimelineEventSchema, event, 'Timeline event'));
  }

  recordMissing(kind: string, message: string): void {
    this.gaps.push({ kind, message });
  }

  files(): string[] {
    return [...this.saved];
  }

  missing(): MissingEvidence[] {
    return this.gaps.map((gap) => ({ ...gap }));
  }

  writeTimeline(): string {
    const ordered = [...this.events].sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order);
    return this.writeText('timeline.json', `${JSON.stringify(ordered, null, 2)}\n`);
  }

  writeMetadata(metadata: unknown): string {
    const body = {
      experimentId: path.basename(this.directory),
      createdAt: this.createdAt,
      metadata,
    };
    return this.writeText('metadata.json', `${JSON.stringify(body, null, 2)}\n`);
  }

  writeText(name: string, contents: string): string {
    if (!FILE_NAME.test(name)) {
      throw new Error(`Refusing to write "${name}".`);
    }
    this.writeNew(name, contents);
    return name;
  }

  private writeNew(relative: string, contents: string | Buffer): void {
    if (relative.includes('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to write "${relative}".`);
    }
    const target = path.resolve(this.directory, relative);
    const relativeToRoot = path.relative(this.directory, target);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Refusing to write outside ${this.directory}.`);
    }
    writeFileSync(target, contents, { flag: 'wx' });
    this.saved.push(relative.split(path.sep).join('/'));
  }
}

function safeToken(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!FILE_NAME.test(cleaned)) {
    throw new Error(`"${value}" cannot be used as an evidence file name.`);
  }
  return cleaned;
}
