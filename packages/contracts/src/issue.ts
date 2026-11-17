import { z } from 'zod';

export const IssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
});

export type Issue = z.infer<typeof IssueSchema>;
