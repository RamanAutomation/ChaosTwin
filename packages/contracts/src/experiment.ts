import { z } from 'zod';
import { FaultResultSchema } from './fault.js';
import { MissingEvidenceSchema } from './evidence.js';
import { CHAOSTWIN_PRODUCT } from './product.js';
import { RecoveryAssertionSchema } from './recovery.js';
import { IsoTimestampSchema } from './schema-utils.js';
import { WorkflowStepResultSchema } from './workflow.js';

export const ExperimentStatusSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR']);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentReportSchema = z
  .object({
    product: z.literal(CHAOSTWIN_PRODUCT),
    productVersion: z.string().min(1),
    experimentId: z.string().min(1),
    experimentName: z.string().min(1),
    status: ExperimentStatusSchema,
    startedAt: IsoTimestampSchema,
    endedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
    device: z.object({
      serial: z.string().min(1),
      kind: z.string().min(1),
      avdName: z.string().nullable(),
      androidVersion: z.string().nullable(),
    }),
    app: z.object({
      packageName: z.string().min(1),
      version: z.string().nullable(),
      activity: z.string().min(1),
    }),
    workflow: z.object({
      id: z.string().min(1),
      steps: z.array(WorkflowStepResultSchema),
    }),
    fault: FaultResultSchema,
    assertions: z.array(RecoveryAssertionSchema),
    failure: z
      .object({
        summary: z.string(),
        details: z.string(),
      })
      .nullable(),
    evidence: z.object({
      directory: z.string().nullable(),
      files: z.array(z.string()),
      missing: z.array(MissingEvidenceSchema),
    }),
    reproduction: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.status !== 'PASS') {
      return;
    }
    if (report.failure) {
      ctx.addIssue({ code: 'custom', message: 'A PASS report cannot include a failure.', path: ['failure'] });
    }
    if (report.assertions.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'PASS requires recovery assertions.', path: ['assertions'] });
    }
    report.assertions.forEach((assertion, index) => {
      if (assertion.status !== 'PASSED' || assertion.evidenceRefs.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'PASS requires every assertion to pass with evidence.',
          path: ['assertions', index],
        });
      }
    });
    if (report.fault.status !== 'APPLIED' || report.fault.mode !== 'actual' || !report.fault.restored) {
      ctx.addIssue({
        code: 'custom',
        message: 'PASS requires an actual fault that was applied and then restored.',
        path: ['fault'],
      });
    }
    if (report.evidence.missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'PASS cannot be reported while required evidence is missing.',
        path: ['evidence', 'missing'],
      });
    }
  });
export type ExperimentReport = z.infer<typeof ExperimentReportSchema>;
