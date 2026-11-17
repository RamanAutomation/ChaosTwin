import { z } from 'zod';

export const RecoveryAssertionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['PASSED', 'FAILED', 'INCONCLUSIVE']),
  message: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type RecoveryAssertion = z.infer<typeof RecoveryAssertionSchema>;

export const RecoveryResultSchema = z.object({
  status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  assertions: z.array(RecoveryAssertionSchema),
});
export type RecoveryResult = z.infer<typeof RecoveryResultSchema>;

export const VisitorRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
});
export type VisitorRecord = z.infer<typeof VisitorRecordSchema>;

export const VisitorListSchema = z.object({
  visitors: z.array(VisitorRecordSchema),
});
export type VisitorList = z.infer<typeof VisitorListSchema>;
