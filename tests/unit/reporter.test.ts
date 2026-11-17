import type { ExperimentReport } from '@chaostwin/contracts';
import { renderHtmlReport, renderJsonReport } from '@chaostwin/reporter';
import { describe, expect, it } from 'vitest';

const passed: ExperimentReport = {
  product: 'ChaosTwin Mobile',
  productVersion: '0.1.0',
  experimentId: 'CT-EXP-001',
  experimentName: 'Android Network Recovery Test',
  status: 'PASS',
  startedAt: '2026-11-17T07:00:00.000Z',
  endedAt: '2026-11-17T07:00:05.000Z',
  durationMs: 5_000,
  device: { serial: 'emulator-5554', kind: 'emulator', avdName: 'Medium_Phone_API_37.0', androidVersion: '14' },
  app: { packageName: 'com.chaostwin.demo', version: null, activity: 'com.chaostwin.demo.MainActivity' },
  workflow: {
    id: 'visitor-check-in',
    steps: [
      {
        id: 'submit_visit',
        type: 'tap',
        status: 'PASSED',
        startedAt: '2026-11-17T07:00:01.000Z',
        endedAt: '2026-11-17T07:00:02.000Z',
        message: 'Tapped id:submit_visit.',
        evidenceRefs: [],
      },
    ],
  },
  fault: {
    kind: 'network-latency',
    status: 'APPLIED',
    mode: 'actual',
    message: 'Applied emulator network delay gprs.',
    startedAt: '2026-11-17T07:00:01.000Z',
    endedAt: '2026-11-17T07:00:04.000Z',
    restored: true,
  },
  assertions: [
    {
      id: 'visitor-record',
      status: 'PASSED',
      message: 'Exactly one visitor record.',
      evidenceRefs: ['logs/visitors.txt'],
    },
  ],
  failure: null,
  evidence: { directory: 'reports/CT-EXP-001', files: ['logs/visitors.txt'], missing: [] },
  reproduction: ['Select emulator emulator-5554 explicitly.'],
};

describe('experiment reports', () => {
  it('writes JSON with the experiment status', () => {
    const json = renderJsonReport(passed);
    const parsed = JSON.parse(json) as { status: string; experimentId: string };
    expect(parsed.status).toBe('PASS');
    expect(parsed.experimentId).toBe('CT-EXP-001');
  });

  it('escapes HTML and does not include a script element', () => {
    const hostile: ExperimentReport = {
      ...passed,
      status: 'FAIL',
      failure: { summary: '<script>alert(1)</script>', details: `Tom & "Jerry"` },
      assertions: [
        {
          id: 'visitor-record',
          status: 'FAILED',
          message: '<img src=x onerror=alert(1)>',
          evidenceRefs: [],
        },
      ],
    };
    const html = renderHtmlReport(hostile);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('shows missing evidence and refuses a PASS that has none', () => {
    const inconclusive: ExperimentReport = {
      ...passed,
      status: 'INCONCLUSIVE',
      failure: { summary: 'Evidence is missing.', details: 'logcat timed out' },
      assertions: [
        { id: 'visitor-record', status: 'INCONCLUSIVE', message: 'No stored response.', evidenceRefs: [] },
      ],
      evidence: {
        directory: 'reports/CT-EXP-001',
        files: [],
        missing: [{ kind: 'logcat', message: 'Logcat collection timed out.' }],
      },
    };
    expect(renderHtmlReport(inconclusive)).toContain('Logcat collection timed out.');
    expect(() => renderJsonReport({ ...passed, assertions: [], failure: null })).toThrow(/PASS requires/);
    expect(() =>
      renderJsonReport({
        ...passed,
        fault: { ...passed.fault, status: 'UNSUPPORTED', mode: 'none', restored: true },
      }),
    ).toThrow(/actual fault/);
  });
});
