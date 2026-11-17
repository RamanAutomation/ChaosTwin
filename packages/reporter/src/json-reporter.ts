import type { ExperimentReport } from '@chaostwin/contracts';
import { ExperimentReportSchema, parseWithSchema } from '@chaostwin/contracts';

export function renderJsonReport(report: unknown): string {
  const parsed: ExperimentReport = parseWithSchema(ExperimentReportSchema, report, 'Experiment report');
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
