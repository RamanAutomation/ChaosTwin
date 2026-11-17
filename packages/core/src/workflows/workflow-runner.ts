import type { WorkflowDefinition, WorkflowEvent, WorkflowExecution, WorkflowStep, WorkflowStepResult } from '@chaostwin/contracts';
import { WorkflowDefinitionSchema, parseWithSchema } from '@chaostwin/contracts';

export interface WorkflowDevice {
  launchApp(packageName: string, activity: string): Promise<void>;
  tap(selector: string): Promise<void>;
  enterText(selector: string, text: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  readText(selector: string): Promise<string | null>;
  screenshot(): Promise<Buffer>;
}

export interface WorkflowApi {
  request(input: { method: 'GET' | 'POST'; url: string; timeoutMs: number }): Promise<{ status: number }>;
}

export interface WorkflowRunRange {
  startFromStepId?: string;
  stopAfterStepId?: string;
}

export interface WorkflowRunnerOptions {
  device: WorkflowDevice;
  api: WorkflowApi;
  clock: () => Date;
  sleep: (ms: number) => Promise<void>;
  saveScreenshot: (stepId: string, bytes: Buffer) => string;
}

class StepTimeoutError extends Error {
  constructor(stepId: string, timeoutMs: number) {
    super(`Step ${stepId} timed out after ${timeoutMs}ms.`);
    this.name = 'StepTimeoutError';
  }
}

/**
 * Runs a validated workflow. Steps are data. There is no code evaluation.
 * A failed step skips the rest. `startFromStepId` and `stopAfterStepId` let
 * an experiment pause around a fault without submitting twice.
 */
export class WorkflowRunner {
  constructor(private readonly options: WorkflowRunnerOptions) {}

  async run(definition: WorkflowDefinition, range: WorkflowRunRange = {}): Promise<WorkflowExecution> {
    const workflow = parseWithSchema(WorkflowDefinitionSchema, definition, 'Workflow');
    const steps: WorkflowStepResult[] = [];
    const events: WorkflowEvent[] = [];
    let order = 0;
    const startFrom = range.startFromStepId;
    const stopAfter = range.stopAfterStepId;
    if (startFrom && !workflow.steps.some((step) => step.id === startFrom)) {
      return this.anchorFailure(workflow, events, `startFromStepId "${startFrom}" is not in the workflow.`);
    }
    if (stopAfter && !workflow.steps.some((step) => step.id === stopAfter)) {
      return this.anchorFailure(workflow, events, `stopAfterStepId "${stopAfter}" is not in the workflow.`);
    }

    let started = startFrom === undefined;
    let skipReason: string | null = null;
    for (const step of workflow.steps) {
      if (!started) {
        if (step.id !== startFrom) {
          steps.push(this.skipped(step, 'Skipped before the requested start step.'));
          events.push(this.event(order, step.id, 'SKIPPED', 'Skipped before the requested start step.'));
          order += 1;
          continue;
        }
        started = true;
      }
      if (skipReason) {
        steps.push(this.skipped(step, skipReason));
        events.push(this.event(order, step.id, 'SKIPPED', skipReason));
        order += 1;
        continue;
      }

      const startedAt = this.options.clock().toISOString();
      events.push(this.event(order, step.id, 'RUNNING', `Started ${step.type}.`));
      order += 1;
      try {
        const outcome = await withTimeout(this.execute(step), step.timeoutMs, step.id);
        const endedAt = this.options.clock().toISOString();
        steps.push({
          id: step.id,
          type: step.type,
          status: 'PASSED',
          startedAt,
          endedAt,
          message: outcome.message,
          evidenceRefs: outcome.evidenceRefs,
        });
        events.push(this.event(order, step.id, 'PASSED', outcome.message));
        order += 1;
        if (stopAfter === step.id) {
          skipReason = 'Skipped after the requested stop step.';
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const endedAt = this.options.clock().toISOString();
        steps.push({
          id: step.id,
          type: step.type,
          status: 'FAILED',
          startedAt,
          endedAt,
          message,
          evidenceRefs: [],
        });
        events.push(this.event(order, step.id, 'FAILED', message));
        order += 1;
        skipReason = 'Skipped because an earlier step failed.';
      }
    }

    return {
      workflowId: workflow.id,
      status: steps.some((step) => step.status === 'FAILED') ? 'FAILED' : 'PASSED',
      steps,
      events,
    };
  }

  private async execute(step: WorkflowStep): Promise<{ message: string; evidenceRefs: string[] }> {
    const device = this.options.device;
    switch (step.type) {
      case 'launch-app':
        await device.launchApp(step.packageName, step.activity);
        return { message: `Launched ${step.packageName}/${step.activity}.`, evidenceRefs: [] };
      case 'tap':
        await device.tap(step.selector);
        return { message: `Tapped ${step.selector}.`, evidenceRefs: [] };
      case 'enter-text':
        await device.enterText(step.selector, step.text);
        return { message: `Entered text into ${step.selector}.`, evidenceRefs: [] };
      case 'wait':
        await this.options.sleep(step.durationMs);
        return { message: `Waited ${step.durationMs}ms.`, evidenceRefs: [] };
      case 'screenshot': {
        const bytes = await device.screenshot();
        const evidenceRef = this.options.saveScreenshot(step.id, bytes);
        return { message: 'Saved a screenshot.', evidenceRefs: [evidenceRef] };
      }
      case 'assert-visible': {
        const visible = await device.isVisible(step.selector);
        if (!visible) {
          throw new Error(`${step.selector} is not visible.`);
        }
        return { message: `${step.selector} is visible.`, evidenceRefs: [] };
      }
      case 'assert-text': {
        const actual = await device.readText(step.selector);
        if (actual !== step.text) {
          throw new Error(`${step.selector} text was "${actual ?? ''}", expected "${step.text}".`);
        }
        return { message: `${step.selector} text matched.`, evidenceRefs: [] };
      }
      case 'api-verify': {
        const response = await this.options.api.request({
          method: step.method,
          url: step.url,
          timeoutMs: step.timeoutMs,
        });
        if (response.status !== step.expectStatus) {
          throw new Error(`${step.method} ${step.url} returned ${response.status}, expected ${step.expectStatus}.`);
        }
        return { message: `${step.method} ${step.url} returned ${response.status}.`, evidenceRefs: [] };
      }
      default: {
        const unknown: never = step;
        throw new Error(`Unsupported step ${JSON.stringify(unknown)}.`);
      }
    }
  }

  private skipped(step: WorkflowStep, message: string): WorkflowStepResult {
    return {
      id: step.id,
      type: step.type,
      status: 'SKIPPED',
      startedAt: null,
      endedAt: null,
      message,
      evidenceRefs: [],
    };
  }

  private event(order: number, stepId: string, status: WorkflowEvent['status'], message: string): WorkflowEvent {
    return {
      at: this.options.clock().toISOString(),
      order,
      stepId,
      kind: status === 'RUNNING' ? 'step-started' : 'step-finished',
      status,
      message,
    };
  }

  private anchorFailure(workflow: WorkflowDefinition, events: WorkflowEvent[], message: string): WorkflowExecution {
    return {
      workflowId: workflow.id,
      status: 'FAILED',
      steps: workflow.steps.map((step) => this.skipped(step, message)),
      events,
    };
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, stepId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(stepId, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
