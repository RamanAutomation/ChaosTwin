import { z } from 'zod';
import { IsoTimestampSchema } from './schema-utils.js';

export const APPIUM_SESSION_ERROR_CODES = [
  'invalid-capabilities',
  'invalid-server-url',
  'device-not-authorized',
  'device-disconnected',
  'device-status-unknown',
  'server-unavailable',
  'connection-timeout',
  'session-already-open',
  'udid-mismatch',
  'session-failed',
  'session-close-failed',
] as const;

export const AppiumSessionErrorCodeSchema = z.enum(APPIUM_SESSION_ERROR_CODES);
export type AppiumSessionErrorCode = z.infer<typeof AppiumSessionErrorCodeSchema>;

const CapabilityValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Session creation options. Capability overrides are optional and are checked
 * again against an allowlist before a client is contacted.
 */
export const AppiumSessionConfigSchema = z.object({
  serverUrl: z.string().min(1),
  connectionTimeoutMs: z.number().int().min(1_000).max(120_000),
  capabilities: z.record(z.string(), CapabilityValueSchema).optional(),
});
export type AppiumSessionConfig = z.infer<typeof AppiumSessionConfigSchema>;

export const AppiumSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  serverUrl: z.string().min(1),
  udid: z.string().min(1),
  platformName: z.string().min(1),
  platformVersion: z.string().nullable(),
  automationName: z.string().min(1),
  deviceName: z.string().nullable(),
  createdAt: IsoTimestampSchema,
  closedAt: IsoTimestampSchema.nullable(),
});
export type AppiumSessionRecord = z.infer<typeof AppiumSessionRecordSchema>;

export const AppiumSessionFailureSchema = z.object({
  ok: z.literal(false),
  code: AppiumSessionErrorCodeSchema,
  message: z.string().min(1),
});
export type AppiumSessionFailure = z.infer<typeof AppiumSessionFailureSchema>;

export const OpenAppiumSessionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    session: AppiumSessionRecordSchema,
  }),
  AppiumSessionFailureSchema,
]);
export type OpenAppiumSessionResult = z.infer<typeof OpenAppiumSessionResultSchema>;

export const CloseAppiumSessionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    alreadyClosed: z.boolean(),
    session: AppiumSessionRecordSchema.nullable(),
  }),
  AppiumSessionFailureSchema,
]);
export type CloseAppiumSessionResult = z.infer<typeof CloseAppiumSessionResultSchema>;
