import type { RecoveryAssertion, RecoveryResult, VisitorRecord } from '@chaostwin/contracts';

export interface RecoveryExpectation {
  visitorName: string;
  statusText: string;
  screenText: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface RecoveryProbe {
  queryVisitors(timeoutMs: number): Promise<
    | { ok: true; records: VisitorRecord[]; evidenceRef: string | null }
    | { ok: false; reason: 'timeout' | 'error'; message: string }
  >;
  currentScreen(timeoutMs: number): Promise<
    | { ok: true; text: string; evidenceRef: string | null }
    | { ok: false; reason: 'timeout' | 'error'; message: string }
  >;
}

/**
 * Read-only recovery check. The probe has no submit method, so verification
 * cannot create a second visitor record.
 */
export class RecoveryVerifier {
  constructor(
    private readonly clock: () => Date,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async verify(expectation: RecoveryExpectation, probe: RecoveryProbe): Promise<RecoveryResult> {
    if (expectation.pollIntervalMs < 50 || expectation.timeoutMs < expectation.pollIntervalMs || expectation.timeoutMs > 120_000) {
      const message = 'Recovery polling must use an interval of at least 50ms and stay inside the timeout.';
      const assertions = [
        assertion('visitor-record', 'INCONCLUSIVE', message, []),
        assertion('expected-screen', 'INCONCLUSIVE', message, []),
        assertion('api-transaction', 'INCONCLUSIVE', message, []),
      ];
      return { status: 'INCONCLUSIVE', assertions };
    }
    const records = await this.pollRecords(expectation, probe);
    const screen = await this.pollScreen(expectation, probe);
    const assertions = [records, screen, this.transactionAssertion(records)];
    return { status: overall(assertions), assertions };
  }

  private async pollRecords(expectation: RecoveryExpectation, probe: RecoveryProbe): Promise<RecoveryAssertion> {
    const started = this.clock().getTime();
    let last: Awaited<ReturnType<RecoveryProbe['queryVisitors']>> | null = null;
    for (let attempt = 0; attempt < 30 && this.clock().getTime() - started <= expectation.timeoutMs; attempt += 1) {
      last = await probe.queryVisitors(expectation.timeoutMs);
      if (last.ok) {
        return this.judgeRecords(expectation, last.records, last.evidenceRef);
      }
      if (this.clock().getTime() - started + expectation.pollIntervalMs > expectation.timeoutMs) {
        break;
      }
      await this.sleep(expectation.pollIntervalMs);
    }
    const message = last && !last.ok ? last.message : 'Visitor query did not return.';
    const reason = last && !last.ok && last.reason === 'timeout' ? 'timed out' : 'could not be queried';
    return assertion(
      'visitor-record',
      'INCONCLUSIVE',
      `Visitor records ${reason}: ${message}`,
      [],
    );
  }

  private judgeRecords(
    expectation: RecoveryExpectation,
    records: VisitorRecord[],
    evidenceRef: string | null,
  ): RecoveryAssertion {
    if (!evidenceRef) {
      return assertion(
        'visitor-record',
        'INCONCLUSIVE',
        'The visitor query returned, but there is no stored response to cite.',
        [],
      );
    }
    if (records.length === 0) {
      return assertion('visitor-record', 'FAILED', 'The visitor record is missing.', [evidenceRef]);
    }
    if (records.length > 1) {
      return assertion('visitor-record', 'FAILED', `Found ${records.length} visitor records. Expected exactly one.`, [
        evidenceRef,
      ]);
    }
    const record = records[0];
    if (!record || record.name !== expectation.visitorName || record.status !== expectation.statusText) {
      return assertion(
        'visitor-record',
        'FAILED',
        `Visitor was "${record?.name ?? ''}" / "${record?.status ?? ''}". Expected "${expectation.visitorName}" / "${expectation.statusText}".`,
        [evidenceRef],
      );
    }
    return assertion(
      'visitor-record',
      'PASSED',
      `Exactly one visitor record for ${record.name} with status ${record.status}.`,
      [evidenceRef],
    );
  }

  private async pollScreen(expectation: RecoveryExpectation, probe: RecoveryProbe): Promise<RecoveryAssertion> {
    const started = this.clock().getTime();
    let last: Awaited<ReturnType<RecoveryProbe['currentScreen']>> | null = null;
    for (let attempt = 0; attempt < 30 && this.clock().getTime() - started <= expectation.timeoutMs; attempt += 1) {
      last = await probe.currentScreen(expectation.timeoutMs);
      if (last.ok) {
        if (!last.evidenceRef) {
          return assertion('expected-screen', 'INCONCLUSIVE', 'The screen was read, but no screenshot was stored.', []);
        }
        if (last.text !== expectation.screenText) {
          return assertion(
            'expected-screen',
            'FAILED',
            `Screen text was "${last.text}". Expected "${expectation.screenText}".`,
            [last.evidenceRef],
          );
        }
        return assertion('expected-screen', 'PASSED', `Screen shows ${last.text}.`, [last.evidenceRef]);
      }
      if (this.clock().getTime() - started + expectation.pollIntervalMs > expectation.timeoutMs) {
        break;
      }
      await this.sleep(expectation.pollIntervalMs);
    }
    const message = last && !last.ok ? last.message : 'Screen was not read.';
    return assertion('expected-screen', 'INCONCLUSIVE', `Screen check did not finish: ${message}`, []);
  }

  private transactionAssertion(records: RecoveryAssertion): RecoveryAssertion {
    if (records.status === 'PASSED') {
      return assertion('api-transaction', 'PASSED', 'The visitor query confirms one successful check-in.', [
        ...records.evidenceRefs,
      ]);
    }
    if (records.status === 'FAILED') {
      return assertion('api-transaction', 'FAILED', records.message, [...records.evidenceRefs]);
    }
    return assertion('api-transaction', 'INCONCLUSIVE', records.message, []);
  }
}

function assertion(
  id: string,
  status: RecoveryAssertion['status'],
  message: string,
  evidenceRefs: string[],
): RecoveryAssertion {
  return { id, status, message, evidenceRefs };
}

function overall(assertions: RecoveryAssertion[]): RecoveryResult['status'] {
  if (assertions.some((item) => item.status === 'FAILED')) {
    return 'FAIL';
  }
  if (assertions.some((item) => item.status !== 'PASSED' || item.evidenceRefs.length === 0)) {
    return 'INCONCLUSIVE';
  }
  return 'PASS';
}
