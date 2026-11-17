import { z } from 'zod';
import { IssueSchema } from './issue.js';
import { IsoTimestampSchema } from './schema-utils.js';

export const TOOL_IDS = ['node', 'npm', 'java', 'android-sdk', 'adb', 'emulator', 'appium'] as const;
export const ToolIdSchema = z.enum(TOOL_IDS);
export type ToolId = z.infer<typeof ToolIdSchema>;

export const CAPABILITIES = ['device-discovery', 'emulator-inventory', 'appium-session'] as const;
export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

export const ToolStatusSchema = z.enum(['ready', 'missing', 'unusable']);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const ToolResolutionSchema = z.enum([
  'process',
  'environment',
  'path',
  'sdk',
  'well-known',
  'not-found',
]);
export type ToolResolution = z.infer<typeof ToolResolutionSchema>;

export const ToolProbeSchema = z.object({
  id: ToolIdSchema,
  displayName: z.string().min(1),
  status: ToolStatusSchema,
  requiredFor: z.array(CapabilitySchema),
  version: z.string().nullable(),
  location: z.string().nullable(),
  resolution: ToolResolutionSchema,
  detail: z.string().nullable(),
});
export type ToolProbe = z.infer<typeof ToolProbeSchema>;

export const EnvironmentReportSchema = z.object({
  inspectedAt: IsoTimestampSchema,
  host: z.object({
    platform: z.string().min(1),
    arch: z.string().min(1),
    nodeVersion: z.string().min(1),
  }),
  tools: z.array(ToolProbeSchema),
  readiness: z.object({
    canDiscoverDevices: z.boolean(),
    canListVirtualDevices: z.boolean(),
    canStartAppiumSession: z.boolean(),
  }),
  suggestions: z.array(z.string()),
  issues: z.array(IssueSchema),
});
export type EnvironmentReport = z.infer<typeof EnvironmentReportSchema>;
