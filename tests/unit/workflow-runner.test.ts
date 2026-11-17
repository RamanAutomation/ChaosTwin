import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WorkflowDefinitionSchema, isLocalTestUrl } from '@chaostwin/contracts';
import { WorkflowRunner, visitorCheckInWorkflow, type WorkflowDevice } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const fixed = new Date('2026-11-17T07:00:00.000Z');

function device(overrides: Partial<WorkflowDevice> = {}): WorkflowDevice {
  return {
    launchApp: async () => undefined,
    tap: async () => undefined,
    enterText: async () => undefined,
    isVisible: async () => true,
    readText: async () => 'Checked in',
    screenshot: async () => Buffer.from('png'),
    ...overrides,
  };
}

function runner(target: WorkflowDevice, sleep: (ms: number) => Promise<void> = async () => undefined): WorkflowRunner {
  return new WorkflowRunner({
    device: target,
    api: {
      request: async () => ({ status: 200 }),
    },
    clock: () => fixed,
    sleep,
    saveScreenshot: () => 'screenshots/evidence_shot-1.png',
  });
}

describe('workflow schema', () => {
  it('accepts the visitor check-in definition and the JSON copy', () => {
    const workflow = visitorCheckInWorkflow();
    expect(workflow.steps.map((step) => step.id)).toEqual([
      'launch',
      'visitor_name',
      'start_visit',
      'submit_visit',
      'visit_status',
      'records',
      'evidence_shot',
    ]);
    const file = path.join(process.cwd(), 'experiments', 'visitor-check-in.json');
    const parsed = WorkflowDefinitionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(parsed).toEqual(workflow);
  });

  it('rejects a remote API and a duplicate step id', () => {
    expect(isLocalTestUrl('https://example.com/visitors')).toBe(false);
    const workflow = visitorCheckInWorkflow();
    const remote = structuredClone(workflow);
    const records = remote.steps.find((step) => step.id === 'records');
    if (records && records.type === 'api-verify') {
      records.url = 'https://example.com/visitors';
    }
    expect(WorkflowDefinitionSchema.safeParse(remote).success).toBe(false);
    const duplicate = structuredClone(workflow);
    const first = duplicate.steps[0];
    const second = duplicate.steps[1];
    if (first && second) {
      second.id = first.id;
    }
    expect(WorkflowDefinitionSchema.safeParse(duplicate).success).toBe(false);
  });
});

describe('WorkflowRunner', () => {
  it('runs steps in order and records start before finish', async () => {
    const seen: string[] = [];
    const execution = await runner(
      device({
        tap: async (selector) => {
          seen.push(selector);
        },
        enterText: async (selector) => {
          seen.push(selector);
        },
      }),
    ).run(visitorCheckInWorkflow());
    expect(execution.status).toBe('PASSED');
    expect(seen).toEqual(['id:visitor_name', 'id:start_visit', 'id:submit_visit']);
    const launchStart = execution.events.findIndex((event) => event.stepId === 'launch' && event.kind === 'step-started');
    const launchFinish = execution.events.findIndex((event) => event.stepId === 'launch' && event.kind === 'step-finished');
    expect(launchStart).toBeGreaterThanOrEqual(0);
    expect(launchFinish).toBeGreaterThan(launchStart);
    expect(execution.events.map((event) => event.order)).toEqual(execution.events.map((_event, index) => index));
  });

  it('fails a step that exceeds its timeout and skips the rest', async () => {
    const execution = await runner(
      device({
        tap: () => new Promise(() => undefined),
      }),
    ).run({
      id: 'timeout-check',
      name: 'Timeout check',
      stopOnFailure: true,
      steps: [
        { id: 'submit_visit', type: 'tap', selector: 'id:submit_visit', timeoutMs: 100 },
        { id: 'visit_status', type: 'assert-visible', selector: 'id:visit_status', timeoutMs: 1_000 },
      ],
    });
    expect(execution.steps[0]?.status).toBe('FAILED');
    expect(execution.steps[0]?.message).toContain('timed out');
    expect(execution.steps[1]?.status).toBe('SKIPPED');
    expect(execution.status).toBe('FAILED');
  });

  it('stops after a failed assertion', async () => {
    const execution = await runner(
      device({
        readText: async () => 'Still waiting',
      }),
    ).run({
      id: 'assert-check',
      name: 'Assert check',
      stopOnFailure: true,
      steps: [
        { id: 'visit_status', type: 'assert-text', selector: 'id:visit_status', text: 'Checked in', timeoutMs: 1_000 },
        { id: 'evidence_shot', type: 'screenshot', timeoutMs: 1_000 },
      ],
    });
    expect(execution.steps[0]?.status).toBe('FAILED');
    expect(execution.steps[0]?.message).toContain('Still waiting');
    expect(execution.steps[1]?.status).toBe('SKIPPED');
  });

  it('can stop before submit and resume from submit', async () => {
    const workflow = visitorCheckInWorkflow();
    const first = await runner(device()).run(workflow, { stopAfterStepId: 'start_visit' });
    expect(first.steps.find((step) => step.id === 'start_visit')?.status).toBe('PASSED');
    expect(first.steps.find((step) => step.id === 'submit_visit')?.status).toBe('SKIPPED');
    const second = await runner(device()).run(workflow, { startFromStepId: 'submit_visit' });
    expect(second.steps.find((step) => step.id === 'start_visit')?.status).toBe('SKIPPED');
    expect(second.steps.find((step) => step.id === 'submit_visit')?.status).toBe('PASSED');
  });
});
