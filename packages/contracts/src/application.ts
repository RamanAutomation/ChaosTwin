import { z } from 'zod';

export const AppOperationSchema = z.enum(['install', 'launch', 'verify', 'uninstall']);
export type AppOperation = z.infer<typeof AppOperationSchema>;

export const AppOperationRecordSchema = z.object({
  operation: AppOperationSchema,
  ok: z.boolean(),
  message: z.string(),
  args: z.array(z.string()),
});
export type AppOperationRecord = z.infer<typeof AppOperationRecordSchema>;

export const AppLifecycleResultSchema = z.object({
  ok: z.boolean(),
  packageName: z.string(),
  operations: z.array(AppOperationRecordSchema),
});
export type AppLifecycleResult = z.infer<typeof AppLifecycleResultSchema>;
