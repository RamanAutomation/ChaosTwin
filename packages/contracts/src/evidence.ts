import { z } from 'zod';
import { IsoTimestampSchema } from './schema-utils.js';

export const EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export const TimelineEventSchema = z.object({
  at: IsoTimestampSchema,
  order: z.number().int().nonnegative(),
  kind: z.string().min(1),
  stepId: z.string().nullable(),
  message: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const MissingEvidenceSchema = z.object({
  kind: z.string().min(1),
  message: z.string().min(1),
});
export type MissingEvidence = z.infer<typeof MissingEvidenceSchema>;
