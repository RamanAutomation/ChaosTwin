import { RecoveryVerifier, createHttpVisitorProbe, type RecoveryProbe } from '@chaostwin/core';
import { describe, expect, it } from 'vitest';

const expectation = {
  visitorName: 'Test Visitor',
  statusText: 'Checked in',
  screenText: 'Checked in',
  timeoutMs: 1_000,
  pollIntervalMs: 100,
};

function verifier(): { recovery: RecoveryVerifier; sleep: (ms: number) => Promise<void> } {
  let now = 0;
  return {
    recovery: new RecoveryVerifier(
      () => new Date(now),
      async (ms) => {
        now += ms;
      },
    ),
    sleep: async (ms) => {
      now += ms;
    },
  };
}

describe('RecoveryVerifier', () => {
  it('passes only when one matching record and the screen both have evidence', async () => {
    const { recovery } = verifier();
    const result = await recovery.verify(expectation, {
      queryVisitors: async () => ({
        ok: true,
        records: [{ id: 'v1', name: 'Test Visitor', status: 'Checked in' }],
        evidenceRef: 'logs/visitors.txt',
      }),
      currentScreen: async () => ({ ok: true, text: 'Checked in', evidenceRef: 'screenshots/recovery-screen-1.png' }),
    });
    expect(result.status).toBe('PASS');
    expect(result.assertions.every((assertion) => assertion.evidenceRefs.length > 0)).toBe(true);
  });

  it('fails when the record is missing or duplicated', async () => {
    const { recovery } = verifier();
    const missing = await recovery.verify(expectation, probeFor([]));
    const duplicate = await recovery.verify(
      expectation,
      probeFor([
        { id: 'v1', name: 'Test Visitor', status: 'Checked in' },
        { id: 'v2', name: 'Test Visitor', status: 'Checked in' },
      ]),
    );
    expect(missing.status).toBe('FAIL');
    expect(missing.assertions[0]?.message).toContain('missing');
    expect(duplicate.status).toBe('FAIL');
    expect(duplicate.assertions[0]?.message).toContain('exactly one');
  });

  it('is inconclusive when the API times out or the response has no stored evidence', async () => {
    const { recovery } = verifier();
    const timedOut = await recovery.verify(expectation, {
      queryVisitors: async () => ({ ok: false, reason: 'timeout', message: 'The request timed out.' }),
      currentScreen: async () => ({ ok: false, reason: 'timeout', message: 'Screen timed out.' }),
    });
    const uncited = await recovery.verify(expectation, {
      queryVisitors: async () => ({
        ok: true,
        records: [{ id: 'v1', name: 'Test Visitor', status: 'Checked in' }],
        evidenceRef: null,
      }),
      currentScreen: async () => ({ ok: true, text: 'Checked in', evidenceRef: 'screenshots/recovery-screen-1.png' }),
    });
    expect(timedOut.status).toBe('INCONCLUSIVE');
    expect(uncited.status).toBe('INCONCLUSIVE');
    expect(timedOut.assertions.some((assertion) => assertion.status === 'FAILED')).toBe(false);
  });
});

describe('createHttpVisitorProbe', () => {
  it('reads the local visitor list with GET and stores the body', async () => {
    const methods: string[] = [];
    const probe = createHttpVisitorProbe({
      url: 'http://127.0.0.1:8080/visitors',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        return new Response(JSON.stringify({ visitors: [{ id: 'v1', name: 'Test Visitor', status: 'Checked in' }] }), {
          status: 200,
        });
      }) as typeof fetch,
      saveBody: () => 'logs/visitors.txt',
      readScreen: async () => ({ text: 'Checked in', evidenceRef: 'screenshots/recovery-screen-1.png' }),
    });
    const records = await probe.queryVisitors(1_000);
    expect(methods).toEqual(['GET']);
    expect(records.ok).toBe(true);
  });

  it('does not call fetch for a non-local URL and reports a timeout', async () => {
    let called = false;
    const refused = createHttpVisitorProbe({
      url: 'https://example.com/visitors',
      fetchImpl: (async () => {
        called = true;
        return new Response('no');
      }) as typeof fetch,
      saveBody: () => 'logs/visitors.txt',
      readScreen: async () => ({ text: '', evidenceRef: null }),
    });
    const blocked = await refused.queryVisitors(1_000);
    expect(called).toBe(false);
    expect(blocked.ok).toBe(false);

    const timed = createHttpVisitorProbe({
      url: 'http://127.0.0.1:8080/visitors',
      fetchImpl: (async () => {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }) as typeof fetch,
      saveBody: () => 'logs/visitors.txt',
      readScreen: async () => ({ text: '', evidenceRef: null }),
    });
    const result = await timed.queryVisitors(1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
    }
  });
});

function probeFor(records: Array<{ id: string; name: string; status: string }>): RecoveryProbe {
  return {
    queryVisitors: async () => ({ ok: true, records, evidenceRef: 'logs/visitors.txt' }),
    currentScreen: async () => ({ ok: true, text: 'Checked in', evidenceRef: 'screenshots/recovery-screen-1.png' }),
  };
}
