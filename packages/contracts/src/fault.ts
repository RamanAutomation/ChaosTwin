import { z } from 'zod';
import { IsoTimestampSchema } from './schema-utils.js';

const durationMs = z.number().int().min(0).max(120_000);
const timeoutMs = z.number().int().min(1_000).max(120_000);

const NetworkLatencySchema = z
  .object({
    kind: z.literal('network-latency'),
    profile: z.enum(['gprs', 'edge', 'umts', 'hsdpa']),
    durationMs,
    timeoutMs,
  })
  .strict();

const NetworkSpeedSchema = z
  .object({
    kind: z.literal('network-speed'),
    profile: z.enum(['gprs', 'edge', 'umts', 'full']),
    durationMs,
    timeoutMs,
  })
  .strict();

const NetworkDisconnectSchema = z
  .object({
    kind: z.literal('network-disconnect'),
    durationMs,
    timeoutMs,
  })
  .strict();

const PacketLossSchema = z
  .object({
    kind: z.literal('packet-loss'),
    durationMs,
    timeoutMs,
  })
  .strict();

const AppBackgroundSchema = z
  .object({
    kind: z.literal('app-background'),
    packageName: z.string().min(1),
    activity: z.string().min(1),
    durationMs,
    timeoutMs,
  })
  .strict();

const AppRestartSchema = z
  .object({
    kind: z.literal('app-restart'),
    packageName: z.string().min(1),
    activity: z.string().min(1),
    durationMs,
    timeoutMs,
  })
  .strict();

export const FaultRequestSchema = z
  .discriminatedUnion('kind', [
    NetworkLatencySchema,
    NetworkSpeedSchema,
    NetworkDisconnectSchema,
    PacketLossSchema,
    AppBackgroundSchema,
    AppRestartSchema,
  ])
  .superRefine((request, ctx) => {
    if (request.durationMs >= request.timeoutMs) {
      ctx.addIssue({
        code: 'custom',
        message: 'Fault duration must be shorter than the fault timeout.',
        path: ['durationMs'],
      });
    }
  });
export type FaultRequest = z.infer<typeof FaultRequestSchema>;

export const FaultStatusSchema = z.enum(['APPLIED', 'UNSUPPORTED', 'FAILED', 'APPROVAL_REQUIRED', 'NOT_RUN']);
export type FaultStatus = z.infer<typeof FaultStatusSchema>;

/**
 * Restoration targets are the emulator defaults: delay none, speed full, and
 * mobile data on. A custom profile that was already active is not measured.
 */
export const FaultResultSchema = z.object({
  kind: z.string(),
  status: FaultStatusSchema,
  mode: z.enum(['actual', 'none']),
  message: z.string(),
  startedAt: IsoTimestampSchema.nullable(),
  endedAt: IsoTimestampSchema.nullable(),
  restored: z.boolean(),
});
export type FaultResult = z.infer<typeof FaultResultSchema>;
