import type {
  AndroidDevice,
  AppLifecycleResult,
  ExperimentReport,
  FaultRequest,
  FaultResult,
  MissingEvidence,
  RecoveryResult,
  TimelineEvent,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStepResult,
} from '@chaostwin/contracts';
import {
  CHAOSTWIN_PRODUCT,
  CHAOSTWIN_VERSION,
  EXPERIMENT_ID_PATTERN,
  FaultRequestSchema,
  WorkflowDefinitionSchema,
  isChaosTwinActivity,
} from '@chaostwin/contracts';
import type { WorkflowRunRange } from '../workflows/workflow-runner.js';
import { resolveExperimentStatus } from './experiment-status.js';

export interface ExperimentEvidence {
  readonly directory: string;
  saveScreenshot(stepId: string, bytes: Buffer): string;
  saveLog(name: string, text: string): string;
  addEvent(event: TimelineEvent): void;
  recordMissing(kind: string, message: string): void;
  files(): string[];
  missing(): MissingEvidence[];
  writeTimeline(): string;
  writeMetadata(metadata: unknown): string;
  writeText(name: string, contents: string): string;
}

export interface FaultApplication {
  result: FaultResult;
  restore(): Promise<FaultResult>;
}

export interface NetworkRecoveryInput {
  experimentId: string;
  experimentName: string;
  device: AndroidDevice;
  selection: { serial: string; operatorApproved: boolean };
  disruptiveActionApproved: boolean;
  apkPath: string;
  apkReady: boolean;
  packageName: string;
  activity: string;
  appVersion: string | null;
  serverUrl: string;
  uninstallAfter: boolean;
  workflow: WorkflowDefinition;
  faultRequest: unknown;
}

export interface NetworkRecoveryPorts {
  clock: () => Date;
  sleep: (ms: number) => Promise<void>;
  openEvidence(experimentId: string): ExperimentEvidence;
  session: {
    open(): Promise<{ ok: true; androidVersion: string | null } | { ok: false; message: string }>;
    close(): Promise<{ ok: boolean; message: string }>;
  };
  apps: {
    installAndLaunch(input: {
      device: AndroidDevice;
      selection: { serial: string; operatorApproved: true };
      apkPath: string;
      packageName: string;
      activity: string;
      timeoutMs: number;
    }): Promise<AppLifecycleResult>;
    uninstall(input: {
      device: AndroidDevice;
      selection: { serial: string; operatorApproved: true };
      packageName: string;
      confirmed: true;
      timeoutMs: number;
    }): Promise<AppLifecycleResult>;
  };
  runWorkflow(
    definition: WorkflowDefinition,
    range: WorkflowRunRange,
    evidence: ExperimentEvidence,
  ): Promise<WorkflowExecution>;
  faults: {
    apply(input: {
      target: { serial: string; kind: AndroidDevice['kind'] };
      approval: { operatorApproved: boolean; disruptiveActionApproved: boolean };
      request: FaultRequest;
    }): Promise<FaultApplication>;
  };
  recovery: {
    verify(): Promise<RecoveryResult>;
  };
  logs: {
    collect(serial: string): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
  };
  renderJson(report: ExperimentReport): string;
  renderHtml(report: ExperimentReport): string;
}

const START_STEP = 'start_visit';
const SUBMIT_STEP = 'submit_visit';

/**
 * Android network recovery experiment. A fault that cannot be applied does
 * not submit the visitor transaction. PASS is refused without evidence.
 */
export async function runNetworkRecoveryExperiment(
  input: NetworkRecoveryInput,
  ports: NetworkRecoveryPorts,
): Promise<ExperimentReport> {
  const startedAt = ports.clock();
  let opened = false;
  let evidence: ExperimentEvidence | null = null;
  let report: ExperimentReport;

  const closeOnce = async (): Promise<{ ok: boolean; message: string }> => {
    if (!opened) {
      return { ok: true, message: '' };
    }
    opened = false;
    return ports.session.close();
  };

  try {
    const precondition = preconditionError(input);
    if (precondition) {
      report = buildReport(input, ports, startedAt, {
        status: 'ERROR',
        androidVersion: null,
        steps: [],
        fault: notRun(precondition),
        assertions: [],
        failure: { summary: 'Experiment did not start.', details: precondition },
        evidence,
        missing: [],
      });
      return report;
    }

    const faultRequest = FaultRequestSchema.parse(input.faultRequest);
    try {
      evidence = ports.openEvidence(input.experimentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report = buildReport(input, ports, startedAt, {
        status: 'ERROR',
        androidVersion: null,
        steps: [],
        fault: notRun(message),
        assertions: [],
        failure: { summary: 'Evidence directory was not created.', details: message },
        evidence: null,
        missing: [],
      });
      return report;
    }

    let order = 0;
    const add = (kind: string, message: string, stepId: string | null): void => {
      evidence?.addEvent({ at: ports.clock().toISOString(), order, kind, stepId, message });
      order += 1;
    };
    add('experiment-started', input.experimentName, null);

    const session = await ports.session.open();
    if (!session.ok) {
      report = await finish(input, ports, startedAt, evidence, closeOnce, {
        status: 'ERROR',
        androidVersion: null,
        steps: [],
        fault: notRun(session.message),
        assertions: [],
        failure: { summary: 'Appium session was not created.', details: session.message },
      });
      return report;
    }
    opened = true;
    const androidVersion = session.androidVersion;

    const selection = { serial: input.selection.serial, operatorApproved: true as const };
    const installed = await ports.apps.installAndLaunch({
      device: input.device,
      selection,
      apkPath: input.apkPath,
      packageName: input.packageName,
      activity: input.activity,
      timeoutMs: 60_000,
    });
    if (!installed.ok) {
      const details = installed.operations.map((operation) => `${operation.operation}: ${operation.message}`).join(' ');
      report = await finish(input, ports, startedAt, evidence, closeOnce, {
        status: 'ERROR',
        androidVersion,
        steps: [],
        fault: notRun('The fault was not started because install or launch failed.'),
        assertions: [],
        failure: { summary: 'The demo app was not installed and launched.', details },
      });
      return report;
    }

    const before = await ports.runWorkflow(input.workflow, { stopAfterStepId: START_STEP }, evidence);
    copyWorkflowEvents(before, add);
    if (before.status !== 'PASSED') {
      report = await finish(input, ports, startedAt, evidence, closeOnce, {
        status: 'FAIL',
        androidVersion,
        steps: mergeSteps(input.workflow, [before]),
        fault: notRun('The fault was not started because the workflow failed first.'),
        assertions: [],
        failure: { summary: 'The visitor workflow failed before the fault.', details: failedStepMessage(before) },
      });
      return report;
    }

    const application = await ports.faults.apply({
      target: { serial: input.device.serial, kind: input.device.kind },
      approval: {
        operatorApproved: input.selection.operatorApproved,
        disruptiveActionApproved: input.disruptiveActionApproved,
      },
      request: faultRequest,
    });
    add('fault-started', application.result.message, null);

    let submit: WorkflowExecution | null = null;
    let fault = application.result;
    if (application.result.status === 'APPLIED') {
      try {
        const held = ports.sleep(faultRequest.durationMs);
        submit = await ports.runWorkflow(input.workflow, { startFromStepId: SUBMIT_STEP }, evidence);
        await held;
      } finally {
        fault = await application.restore();
        add('fault-ended', fault.message, null);
      }
    } else {
      add('fault-ended', application.result.message, null);
    }

    if (submit) {
      copyWorkflowEvents(submit, add);
    }
    const steps = mergeSteps(
      input.workflow,
      submit ? [before, submit] : [before],
      submit ? [] : skippedAfter(input.workflow, START_STEP, 'Fault was not applied, so the transaction was not submitted.'),
    );

    if (application.result.status !== 'APPLIED') {
      report = await finish(input, ports, startedAt, evidence, closeOnce, {
        status: 'INCONCLUSIVE',
        androidVersion,
        steps,
        fault,
        assertions: [],
        failure: {
          summary: 'The fault was not applied, so recovery was not judged.',
          details: application.result.message,
        },
      });
      return report;
    }

    if (!submit || submit.status !== 'PASSED') {
      report = await finish(input, ports, startedAt, evidence, closeOnce, {
        status: 'FAIL',
        androidVersion,
        steps,
        fault,
        assertions: [],
        failure: { summary: 'The visitor transaction did not complete during the fault.', details: failedStepMessage(submit) },
      });
      return report;
    }

    const recovery = await ports.recovery.verify();
    add('recovery-ended', recovery.status, null);

    let failure: ExperimentReport['failure'] = null;
    if (!fault.restored) {
      failure = { summary: 'The fault was not restored.', details: fault.message };
    } else if (recovery.status === 'FAIL') {
      failure = { summary: 'Recovery verification failed.', details: recovery.assertions.map((item) => item.message).join(' ') };
    } else if (recovery.status === 'INCONCLUSIVE') {
      failure = {
        summary: 'Recovery could not be verified.',
        details: recovery.assertions.map((item) => item.message).join(' '),
      };
    }

    const status = resolveExperimentStatus({
      precondition: null,
      workflowFailed: false,
      fault,
      assertions: recovery.assertions,
      missingEvidence: evidence.missing().length,
    });
    if (status !== 'PASS' && !failure) {
      failure = { summary: 'The experiment cannot pass.', details: fault.message };
    }
    if (status === 'PASS') {
      failure = null;
    }

    report = await finish(input, ports, startedAt, evidence, closeOnce, {
      status,
      androidVersion,
      steps,
      fault,
      assertions: recovery.assertions,
      failure,
    });
    return report;
  } finally {
    await closeOnce();
  }
}

interface ReportPieces {
  status: ExperimentReport['status'];
  androidVersion: string | null;
  steps: WorkflowStepResult[];
  fault: FaultResult;
  assertions: RecoveryResult['assertions'];
  failure: ExperimentReport['failure'];
}

async function finish(
  input: NetworkRecoveryInput,
  ports: NetworkRecoveryPorts,
  startedAt: Date,
  evidence: ExperimentEvidence,
  close: () => Promise<{ ok: boolean; message: string }>,
  pieces: ReportPieces,
): Promise<ExperimentReport> {
  if (input.uninstallAfter && pieces.steps.length > 0 && input.selection.operatorApproved === true) {
    const removed = await ports.apps.uninstall({
      device: input.device,
      selection: { serial: input.selection.serial, operatorApproved: true },
      packageName: input.packageName,
      confirmed: true,
      timeoutMs: 60_000,
    });
    if (!removed.ok) {
      const details = removed.operations.map((operation) => operation.message).join(' ');
      pieces = {
        ...pieces,
        status: pieces.status === 'PASS' ? 'INCONCLUSIVE' : pieces.status,
        failure: {
          summary: pieces.failure?.summary ?? 'The demo app was not uninstalled.',
          details: `${pieces.failure?.details ?? ''} ${details}`.trim(),
        },
      };
    }
  }
  const closed = await close();
  if (!closed.ok) {
    const note = `Session close failed: ${closed.message}`;
    pieces = {
      ...pieces,
      status: pieces.status === 'PASS' ? 'INCONCLUSIVE' : pieces.status,
      failure: {
        summary: pieces.status === 'PASS' ? 'The Appium session did not close.' : (pieces.failure?.summary ?? 'The Appium session did not close.'),
        details: pieces.failure ? `${pieces.failure.details} ${note}` : note,
      },
    };
  }
  if (pieces.steps.length > 0) {
    const log = await ports.logs.collect(input.device.serial);
    if (log.ok) {
      evidence.saveLog('logcat', log.text);
    } else {
      evidence.recordMissing('logcat', log.message);
    }
  }
  if (pieces.status === 'PASS' && evidence.missing().length > 0) {
    const missing = evidence.missing().map((item) => `${item.kind}: ${item.message}`).join(' ');
    return publish(input, ports, startedAt, evidence, {
      ...pieces,
      status: 'INCONCLUSIVE',
      failure: { summary: 'Required evidence is missing.', details: missing },
    });
  }
  return publish(input, ports, startedAt, evidence, pieces);
}

function publish(
  input: NetworkRecoveryInput,
  ports: NetworkRecoveryPorts,
  startedAt: Date,
  evidence: ExperimentEvidence | null,
  pieces: ReportPieces,
): ExperimentReport {
  if (evidence) {
    evidence.writeTimeline();
  }
  const missing = evidence?.missing() ?? [];
  const report = buildReport(input, ports, startedAt, { ...pieces, evidence, missing });
  if (!evidence) {
    return report;
  }
  try {
    evidence.writeText('report.json', ports.renderJson(report));
    evidence.writeText('report.html', ports.renderHtml(report));
    evidence.writeMetadata({
      experimentId: input.experimentId,
      createdAt: report.startedAt,
      files: evidence.files(),
      missing: evidence.missing(),
    });
    report.evidence.files = evidence.files();
    report.evidence.missing = evidence.missing();
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    evidence.recordMissing('report', message);
    report.status = 'ERROR';
    report.failure = { summary: 'The report could not be written.', details: message };
    report.evidence.files = evidence.files();
    report.evidence.missing = evidence.missing();
    return report;
  }
}

function buildReport(
  input: NetworkRecoveryInput,
  ports: NetworkRecoveryPorts,
  startedAt: Date,
  pieces: ReportPieces & { evidence: ExperimentEvidence | null; missing: MissingEvidence[] },
): ExperimentReport {
  const endedAt = ports.clock();
  const planned = new Set(pieces.evidence?.files() ?? []);
  if (pieces.evidence) {
    planned.add('timeline.json');
    planned.add('report.json');
    planned.add('report.html');
    planned.add('metadata.json');
  }
  return {
    product: CHAOSTWIN_PRODUCT,
    productVersion: CHAOSTWIN_VERSION,
    experimentId: input.experimentId,
    experimentName: input.experimentName,
    status: pieces.status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    device: {
      serial: input.device.serial,
      kind: input.device.kind,
      avdName: input.device.avdName,
      androidVersion: pieces.androidVersion,
    },
    app: {
      packageName: input.packageName,
      version: input.appVersion,
      activity: input.activity,
    },
    workflow: {
      id: input.workflow.id,
      steps: pieces.steps,
    },
    fault: pieces.fault,
    assertions: pieces.assertions,
    failure: pieces.status === 'PASS' ? null : pieces.failure,
    evidence: {
      directory: pieces.evidence?.directory ?? null,
      files: [...planned],
      missing: pieces.missing,
    },
    reproduction: [
      `Select emulator ${input.device.serial} explicitly and approve it. Do not use a production device.`,
      `Install only ${input.packageName}. The APK must be one you built for this test.`,
      `Start Appium at ${input.serverUrl}, apply emulator network delay, submit one visitor, then restore delay none and mobile data on.`,
      'Pass requires exactly one local visitor record, the Checked in screen, and stored evidence for each assertion.',
      `This run is ${pieces.status}.`,
    ],
  };
}

function preconditionError(input: NetworkRecoveryInput): string | null {
  if (!EXPERIMENT_ID_PATTERN.test(input.experimentId)) {
    return `Experiment id "${input.experimentId}" is not a safe folder name.`;
  }
  if (input.selection.operatorApproved !== true || input.selection.serial !== input.device.serial) {
    return 'Operator approval for the selected serial is required.';
  }
  if (input.device.state !== 'device' || input.device.kind !== 'emulator') {
    return `Device ${input.device.serial} must be an online emulator.`;
  }
  if (input.disruptiveActionApproved !== true) {
    return 'Network disruption requires --disruptive approval. The device was not changed.';
  }
  if (!input.apkReady) {
    return `APK file is missing: ${input.apkPath}. The session was not created.`;
  }
  if (!isChaosTwinActivity(input.packageName, input.activity)) {
    return `Refusing to run against ${input.packageName}. Only a com.chaostwin activity is allowed.`;
  }
  const workflow = WorkflowDefinitionSchema.safeParse(input.workflow);
  if (!workflow.success) {
    return 'The workflow definition is invalid.';
  }
  const ids = new Set(input.workflow.steps.map((step) => step.id));
  if (!ids.has(START_STEP) || !ids.has(SUBMIT_STEP)) {
    return 'The workflow must include start_visit and submit_visit.';
  }
  const fault = FaultRequestSchema.safeParse(input.faultRequest);
  if (!fault.success) {
    return 'The fault request is invalid.';
  }
  return null;
}

function notRun(message: string): FaultResult {
  return {
    kind: 'network-latency',
    status: 'NOT_RUN',
    mode: 'none',
    message,
    startedAt: null,
    endedAt: null,
    restored: true,
  };
}

function failedStepMessage(execution: WorkflowExecution | null): string {
  const failed = execution?.steps.find((step) => step.status === 'FAILED');
  return failed?.message ?? 'The workflow did not pass.';
}

function copyWorkflowEvents(
  execution: WorkflowExecution,
  add: (kind: string, message: string, stepId: string | null) => void,
): void {
  for (const event of execution.events) {
    add(event.kind, event.message, event.stepId);
  }
}

function mergeSteps(
  definition: WorkflowDefinition,
  runs: WorkflowExecution[],
  extras: WorkflowStepResult[] = [],
): WorkflowStepResult[] {
  const byId = new Map<string, WorkflowStepResult>();
  for (const run of runs) {
    for (const step of run.steps) {
      const existing = byId.get(step.id);
      if (!existing || existing.status === 'SKIPPED') {
        byId.set(step.id, step);
      }
    }
  }
  for (const step of extras) {
    const existing = byId.get(step.id);
    if (!existing || existing.status === 'SKIPPED') {
      byId.set(step.id, step);
    }
  }
  return definition.steps.map((step) => {
    return (
      byId.get(step.id) ?? {
        id: step.id,
        type: step.type,
        status: 'SKIPPED',
        startedAt: null,
        endedAt: null,
        message: 'The step did not run.',
        evidenceRefs: [],
      }
    );
  });
}

function skippedAfter(definition: WorkflowDefinition, stepId: string, message: string): WorkflowStepResult[] {
  const start = definition.steps.findIndex((step) => step.id === stepId);
  return definition.steps.slice(start + 1).map((step) => ({
    id: step.id,
    type: step.type,
    status: 'SKIPPED',
    startedAt: null,
    endedAt: null,
    message,
    evidenceRefs: [],
  }));
}
