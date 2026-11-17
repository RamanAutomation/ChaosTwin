import { z } from 'zod';
import { IsoTimestampSchema } from './schema-utils.js';

const stepId = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const timeoutMs = z.number().int().min(100).max(120_000);
const selector = z.string().regex(/^id:[a-z][a-z0-9_]{0,40}$/);

const LaunchStepSchema = z
  .object({
    id: stepId,
    timeoutMs,
    type: z.literal('launch-app'),
    packageName: z.string().min(1),
    activity: z.string().min(1),
  })
  .strict();

const TapStepSchema = z.object({ id: stepId, timeoutMs, type: z.literal('tap'), selector }).strict();

const EnterTextStepSchema = z
  .object({
    id: stepId,
    timeoutMs,
    type: z.literal('enter-text'),
    selector,
    text: z.string().max(200),
  })
  .strict();

const WaitStepSchema = z
  .object({
    id: stepId,
    timeoutMs,
    type: z.literal('wait'),
    durationMs: z.number().int().min(0).max(30_000),
  })
  .strict();

const ScreenshotStepSchema = z.object({ id: stepId, timeoutMs, type: z.literal('screenshot') }).strict();

const AssertVisibleStepSchema = z
  .object({ id: stepId, timeoutMs, type: z.literal('assert-visible'), selector })
  .strict();

const AssertTextStepSchema = z
  .object({
    id: stepId,
    timeoutMs,
    type: z.literal('assert-text'),
    selector,
    text: z.string().min(1).max(200),
  })
  .strict();

const ApiVerifyStepSchema = z
  .object({
    id: stepId,
    timeoutMs,
    type: z.literal('api-verify'),
    method: z.enum(['GET', 'POST']),
    url: z.string().min(1),
    expectStatus: z.number().int().min(100).max(599),
  })
  .strict();

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  LaunchStepSchema,
  TapStepSchema,
  EnterTextStepSchema,
  WaitStepSchema,
  ScreenshotStepSchema,
  AssertVisibleStepSchema,
  AssertTextStepSchema,
  ApiVerifyStepSchema,
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export function isLocalTestUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

export const WorkflowDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/),
    name: z.string().min(1).max(120),
    stopOnFailure: z.literal(true),
    steps: z.array(WorkflowStepSchema).min(1).max(40),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const seen = new Set<string>();
    workflow.steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate step id ${step.id}.`, path: ['steps', index, 'id'] });
      }
      seen.add(step.id);
      if (step.type === 'api-verify' && !isLocalTestUrl(step.url)) {
        ctx.addIssue({
          code: 'custom',
          message: 'API verification is limited to http://127.0.0.1 or http://localhost with no credentials.',
          path: ['steps', index, 'url'],
        });
      }
      if (step.type === 'wait' && step.durationMs >= step.timeoutMs) {
        ctx.addIssue({
          code: 'custom',
          message: 'Wait duration must be shorter than the step timeout.',
          path: ['steps', index, 'durationMs'],
        });
      }
    });
  });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const StepStatusSchema = z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const WorkflowStepResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: StepStatusSchema,
  startedAt: IsoTimestampSchema.nullable(),
  endedAt: IsoTimestampSchema.nullable(),
  message: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type WorkflowStepResult = z.infer<typeof WorkflowStepResultSchema>;

export const WorkflowEventSchema = z.object({
  at: IsoTimestampSchema,
  order: z.number().int().nonnegative(),
  stepId: z.string(),
  kind: z.enum(['step-started', 'step-finished']),
  status: StepStatusSchema.nullable(),
  message: z.string(),
});
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;

export const WorkflowExecutionSchema = z.object({
  workflowId: z.string(),
  status: z.enum(['PASSED', 'FAILED']),
  steps: z.array(WorkflowStepResultSchema),
  events: z.array(WorkflowEventSchema),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
