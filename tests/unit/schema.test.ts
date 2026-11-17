import { EnvironmentReportSchema, parseWithSchema } from '@chaostwin/contracts';
import { describe, expect, it } from 'vitest';

describe('parseWithSchema', () => {
  it('throws a readable error instead of returning an invalid report', () => {
    expect(() => parseWithSchema(EnvironmentReportSchema, { inspectedAt: 'today' }, 'Environment report')).toThrow(
      /Environment report failed schema validation/,
    );
  });
});
