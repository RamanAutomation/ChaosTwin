import { z } from 'zod';
import { IssueSchema } from './issue.js';
import { IsoTimestampSchema } from './schema-utils.js';

export const DeviceStateSchema = z.enum([
  'device',
  'offline',
  'unauthorized',
  'authorizing',
  'recovery',
  'sideload',
  'rescue',
  'bootloader',
  'unknown',
]);
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const DeviceKindSchema = z.enum(['emulator', 'hardware']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const DeviceConnectionSchema = z.enum(['emulator', 'usb', 'tcp', 'unknown']);
export type DeviceConnection = z.infer<typeof DeviceConnectionSchema>;

export const AndroidDeviceSchema = z.object({
  serial: z.string().min(1),
  state: DeviceStateSchema,
  kind: DeviceKindSchema,
  connection: DeviceConnectionSchema,
  model: z.string().nullable(),
  product: z.string().nullable(),
  deviceName: z.string().nullable(),
  transportId: z.string().nullable(),
  avdName: z.string().nullable(),
});
export type AndroidDevice = z.infer<typeof AndroidDeviceSchema>;

/**
 * `running: null` means the inventory does not prove whether the AVD is running.
 * Callers must not treat null as stopped.
 */
export const AndroidVirtualDeviceSchema = z.object({
  name: z.string().min(1),
  running: z.boolean().nullable(),
  serial: z.string().nullable(),
});
export type AndroidVirtualDevice = z.infer<typeof AndroidVirtualDeviceSchema>;

export const DeviceDiscoveryReportSchema = z.object({
  inspectedAt: IsoTimestampSchema,
  status: z.enum(['ok', 'unavailable', 'failed']),
  adbPath: z.string().nullable(),
  emulatorPath: z.string().nullable(),
  devices: z.array(AndroidDeviceSchema),
  virtualDevices: z.array(AndroidVirtualDeviceSchema),
  unidentifiedRunningEmulators: z.number().int().nonnegative(),
  issues: z.array(IssueSchema),
});
export type DeviceDiscoveryReport = z.infer<typeof DeviceDiscoveryReportSchema>;

export const ResolvedAndroidToolsSchema = z.object({
  adbPath: z.string().nullable(),
  emulatorPath: z.string().nullable(),
});
export type ResolvedAndroidTools = z.infer<typeof ResolvedAndroidToolsSchema>;

export const DeviceSelectionSchema = z.object({
  serial: z.string().min(1),
  operatorApproved: z.literal(true),
});
export type DeviceSelection = z.infer<typeof DeviceSelectionSchema>;

export const EligibilityDecisionSchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(
    z.object({
      code: z.string().min(1),
      message: z.string().min(1),
    }),
  ),
});
export type EligibilityDecision = z.infer<typeof EligibilityDecisionSchema>;
