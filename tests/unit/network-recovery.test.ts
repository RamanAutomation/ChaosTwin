import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AndroidDevice, ExperimentReport, FaultResult, WorkflowExecution } from '@chaostwin/contracts';
import { DEMO_LAUNCH_ACTIVITY, DEMO_PACKAGE_NAME } from '@chaostwin/contracts';
import {
  runNetworkRecoveryExperiment,
  visitorCheckInWorkflow,
  type ExperimentEvidence,
  type NetworkRecoveryInput,
  type NetworkRecoveryPorts,
} from '@chaostwin/core';
import { EvidenceStore } from '@chaostwin/evidence';
import { renderHtmlReport, renderJsonReport } from '@chaostwin/reporter';
import { afterEach, describe, expect, it } from 'vitest';

const device: AndroidDevice = {
  serial: 'emulator-5554',
  state: 'device',
  kind: 'emulator',
  connection: 'emulator',
  model: null,
  product: null,
  deviceName: null,
  transportId: null,
  avdName: 'Medium_Phone_API_37.0',
};

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function clock(): () => Date {
  let tick = Date.parse('2026-11-17T07:00:00.000Z');
  return () => {
    const current = new Date(tick);
    tick += 1_000;
    return current;
  };
}

function passed(id: string, type: string): WorkflowExecution['steps'][number] {
  return {
    id,
    type,
    status: 'PASSED',
    startedAt: '2026-11-17T07:00:01.000Z',
    endedAt: '2026-11-17T07:00:02.000Z',
    message: `${id} passed.`,
    evidenceRefs: id === 'evidence_shot' ? ['screenshots/evidence_shot-1.png'] : [],
  };
}

function execution(steps: WorkflowExecution['steps']): WorkflowExecution {
  return { workflowId: 'visitor-check-in', status: 'PASSED', steps, events: [] };
}

function appliedFault(): FaultResult {
  return {
    kind: 'network-latency',
    status: 'APPLIED',
    mode: 'actual',
    message: 'Applied emulator network delay gprs.',
    startedAt: '2026-11-17T07:00:01.000Z',
    endedAt: '2026-11-17T07:00:04.000Z',
    restored: true,
  };
}

function input(overrides: Partial<NetworkRecoveryInput> = {}): NetworkRecoveryInput {
  return {
    experimentId: 'CT-EXP-001',
    experimentName: 'Android Network Recovery Test',
    device,
    selection: { serial: device.serial, operatorApproved: true },
    disruptiveActionApproved: true,
    apkPath: 'demo.apk',
    apkReady: true,
    packageName: DEMO_PACKAGE_NAME,
    activity: DEMO_LAUNCH_ACTIVITY,
    appVersion: null,
    serverUrl: 'http://127.0.0.1:4723',
    uninstallAfter: false,
    workflow: visitorCheckInWorkflow(),
    faultRequest: { kind: 'network-latency', profile: 'gprs', durationMs: 0, timeoutMs: 1_000 },
    ...overrides,
  };
}

function harness(options: {
  fault?: FaultResult;
  recoveryStatus?: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  installOk?: boolean;
  installThrows?: boolean;
  logOk?: boolean;
}): { ports: NetworkRecoveryPorts; calls: string[]; evidenceRoot: string } {
  const calls: string[] = [];
  const evidenceRoot = mkdtempSync(path.join(tmpdir(), 'chaostwin-report-'));
  directories.push(evidenceRoot);
  let store: ExperimentEvidence | null = null;
  const fault = options.fault ?? appliedFault();
  const ports: NetworkRecoveryPorts = {
    clock: clock(),
    sleep: async (ms) => {
      calls.push(`sleep:${ms}`);
    },
    openEvidence: (experimentId) => {
      calls.push(`evidence:${experimentId}`);
      store = EvidenceStore.open(evidenceRoot, experimentId, '2026-11-17T07:00:00.000Z');
      return store;
    },
    session: {
      open: async () => {
        calls.push('session-open');
        return { ok: true, androidVersion: '14' };
      },
      close: async () => {
        calls.push('session-close');
        return { ok: true, message: 'closed' };
      },
    },
    apps: {
      installAndLaunch: async () => {
        calls.push('install');
        if (options.installThrows) {
          throw new Error('install exploded');
        }
        return {
          ok: options.installOk !== false,
          packageName: DEMO_PACKAGE_NAME,
          operations: [{ operation: 'install', ok: options.installOk !== false, message: 'Success', args: [] }],
        };
      },
      uninstall: async () => {
        calls.push('uninstall');
        return { ok: true, packageName: DEMO_PACKAGE_NAME, operations: [] };
      },
    },
    runWorkflow: async (_definition, range, evidence) => {
      if (range.stopAfterStepId) {
        calls.push('workflow-before');
        return execution([
          passed('launch', 'launch-app'),
          passed('visitor_name', 'enter-text'),
          passed('start_visit', 'tap'),
        ]);
      }
      calls.push('workflow-submit');
      evidence.saveScreenshot('evidence_shot', Buffer.from('png'));
      return execution([
        passed('submit_visit', 'tap'),
        passed('visit_status', 'assert-text'),
        passed('records', 'api-verify'),
        passed('evidence_shot', 'screenshot'),
      ]);
    },
    faults: {
      apply: async () => {
        calls.push('fault-apply');
        return {
          result: fault,
          restore: async () => {
            calls.push('fault-restore');
            return fault;
          },
        };
      },
    },
    recovery: {
      verify: async () => {
        calls.push('recovery');
        const status = options.recoveryStatus ?? 'PASS';
        if (status === 'FAIL') {
          return {
            status,
            assertions: [
              {
                id: 'visitor-record',
                status: 'FAILED' as const,
                message: 'Found 2 visitor records. Expected exactly one.',
                evidenceRefs: ['logs/visitors.txt'],
              },
            ],
          };
        }
        return {
          status,
          assertions: [
            {
              id: 'visitor-record',
              status: 'PASSED' as const,
              message: 'Exactly one visitor record.',
              evidenceRefs: ['logs/visitors.txt'],
            },
            {
              id: 'expected-screen',
              status: 'PASSED' as const,
              message: 'Screen shows Checked in.',
              evidenceRefs: ['screenshots/recovery-screen-1.png'],
            },
            {
              id: 'api-transaction',
              status: 'PASSED' as const,
              message: 'One successful check-in.',
              evidenceRefs: ['logs/visitors.txt'],
            },
          ],
        };
      },
    },
    logs: {
      collect: async () => {
        calls.push('logcat');
        return options.logOk === false
          ? { ok: false, message: 'Logcat collection timed out.' }
          : { ok: true, text: 'ChaosTwinDemo check-in' };
      },
    },
    renderJson: renderJsonReport,
    renderHtml: renderHtmlReport,
  };
  return { ports, calls, evidenceRoot };
}

describe('runNetworkRecoveryExperiment', () => {
  it('passes only after an applied fault, one record, and stored reports', async () => {
    const { ports, calls, evidenceRoot } = harness({});
    const report = await runNetworkRecoveryExperiment(input(), ports);
    expect(report.status).toBe('PASS');
    expect(calls).toEqual([
      'evidence:CT-EXP-001',
      'session-open',
      'install',
      'workflow-before',
      'fault-apply',
      'sleep:0',
      'workflow-submit',
      'fault-restore',
      'recovery',
      'session-close',
      'logcat',
    ]);
    const directory = path.join(evidenceRoot, 'CT-EXP-001');
    const saved = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8')) as ExperimentReport;
    expect(saved.status).toBe('PASS');
    expect(readFileSync(path.join(directory, 'report.html'), 'utf8')).toContain('PASS');
    expect(calls.includes('uninstall')).toBe(false);
  });

  it('fails when recovery finds a duplicate visitor and does not call uninstall', async () => {
    const { ports, calls } = harness({ recoveryStatus: 'FAIL' });
    const report = await runNetworkRecoveryExperiment(input(), ports);
    expect(report.status).toBe('FAIL');
    expect(report.failure?.details).toContain('exactly one');
    expect(calls.includes('uninstall')).toBe(false);
  });

  it('does not submit when the fault is unsupported', async () => {
    const { ports, calls } = harness({
      fault: {
        kind: 'network-latency',
        status: 'UNSUPPORTED',
        mode: 'none',
        message: 'The emulator rejected network delay.',
        startedAt: '2026-11-17T07:00:01.000Z',
        endedAt: '2026-11-17T07:00:01.000Z',
        restored: true,
      },
    });
    const report = await runNetworkRecoveryExperiment(input(), ports);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(calls.includes('workflow-submit')).toBe(false);
    expect(calls.includes('recovery')).toBe(false);
  });

  it('stops before a session when the APK is missing', async () => {
    const { ports, calls } = harness({});
    const report = await runNetworkRecoveryExperiment(input({ apkReady: false, apkPath: 'missing.apk' }), ports);
    expect(report.status).toBe('ERROR');
    expect(report.failure?.details).toContain('missing.apk');
    expect(calls).toEqual([]);
  });

  it('closes the session when install throws', async () => {
    const { ports, calls } = harness({ installThrows: true });
    await expect(runNetworkRecoveryExperiment(input(), ports)).rejects.toThrow('install exploded');
    expect(calls).toContain('session-close');
  });

  it('uninstalls only when that option is set', async () => {
    const { ports, calls } = harness({});
    await runNetworkRecoveryExperiment(input({ uninstallAfter: true }), ports);
    expect(calls).toContain('uninstall');
  });

  it('does not pass when log evidence is missing', async () => {
    const { ports } = harness({ logOk: false });
    const report = await runNetworkRecoveryExperiment(input(), ports);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(report.evidence.missing.some((item) => item.kind === 'logcat')).toBe(true);
  });
});
