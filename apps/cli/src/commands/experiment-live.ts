import path from 'node:path';
import {
  AdbDeviceStatusProbe,
  AppiumSessionManager,
  AppManager,
  LogcatCollector,
  createWorkflowDevice,
} from '@chaostwin/android-adapter';
import { createWebdriverioAppiumClient } from '@chaostwin/android-adapter/appium';
import { DEMO_LAUNCH_ACTIVITY, DEMO_PACKAGE_NAME, type ExperimentReport, type Logger } from '@chaostwin/contracts';
import {
  NodeCommandRunner,
  NodePathProbe,
  RecoveryVerifier,
  WorkflowRunner,
  createHttpVisitorProbe,
  evaluateDeviceEligibility,
  runNetworkRecoveryExperiment,
  visitorCheckInWorkflow,
} from '@chaostwin/core';
import { EvidenceStore } from '@chaostwin/evidence';
import { FaultScheduler } from '@chaostwin/fault-engine';
import { renderHtmlReport, renderJsonReport } from '@chaostwin/reporter';
import type { LiveExperimentInput } from './experiment.js';

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

export async function executeLiveExperiment(input: LiveExperimentInput, logger: Logger): Promise<ExperimentReport> {
  const runner = new NodeCommandRunner();
  const apps = new AppManager({
    runner,
    paths: new NodePathProbe(),
    authorize: evaluateDeviceEligibility,
    adbPath: input.adbPath,
  });
  const logs = new LogcatCollector(runner, input.adbPath);
  const faults = new FaultScheduler({ runner, adbPath: input.adbPath });
  const manager = new AppiumSessionManager({
    client: createWebdriverioAppiumClient(),
    deviceStatus: new AdbDeviceStatusProbe(runner, input.adbPath),
    authorize: evaluateDeviceEligibility,
    logger,
  });
  let workflowDevice: ReturnType<typeof createWorkflowDevice> | null = null;
  let evidence: EvidenceStore | null = null;

  return runNetworkRecoveryExperiment(
    {
      experimentId: 'CT-EXP-001',
      experimentName: 'Android Network Recovery Test',
      device: input.device,
      selection: { serial: input.device.serial, operatorApproved: true },
      disruptiveActionApproved: true,
      apkPath: input.apkPath,
      apkReady: true,
      packageName: DEMO_PACKAGE_NAME,
      activity: DEMO_LAUNCH_ACTIVITY,
      appVersion: null,
      serverUrl: input.serverUrl,
      uninstallAfter: input.uninstallAfter,
      workflow: visitorCheckInWorkflow(),
      faultRequest: {
        kind: 'network-latency',
        profile: 'gprs',
        durationMs: 3_000,
        timeoutMs: 20_000,
      },
    },
    {
      clock: () => new Date(),
      sleep,
      openEvidence(experimentId) {
        evidence = EvidenceStore.open(path.join(process.cwd(), 'reports'), experimentId, new Date().toISOString());
        return evidence;
      },
      session: {
        async open() {
          const opened = await manager.open({
            device: input.device,
            selection: { serial: input.device.serial, operatorApproved: true },
            config: { serverUrl: input.serverUrl, connectionTimeoutMs: input.connectionTimeoutMs },
          });
          if (!opened.ok) {
            return { ok: false, message: opened.message };
          }
          const browser = manager.workflowBrowser();
          if (!browser) {
            await manager.close();
            return { ok: false, message: 'The Appium session did not expose UI commands.' };
          }
          workflowDevice = createWorkflowDevice(browser, DEMO_PACKAGE_NAME);
          return { ok: true, androidVersion: opened.session.platformVersion };
        },
        async close() {
          const closed = await manager.close();
          return closed.ok ? { ok: true, message: 'Session closed.' } : { ok: false, message: closed.message };
        },
      },
      apps: {
        installAndLaunch: (value) => apps.installAndLaunch(value),
        uninstall: (value) => apps.uninstall(value),
      },
      runWorkflow(definition, range, store) {
        if (!workflowDevice) {
          return Promise.reject(new Error('The workflow started before the Appium session.'));
        }
        const workflow = new WorkflowRunner({
          device: workflowDevice,
          api: {
            async request(request) {
              const response = await fetch(request.url, {
                method: request.method,
                signal: AbortSignal.timeout(request.timeoutMs),
              });
              return { status: response.status };
            },
          },
          clock: () => new Date(),
          sleep,
          saveScreenshot: (stepId, bytes) => store.saveScreenshot(stepId, bytes),
        });
        return workflow.run(definition, range);
      },
      faults: {
        apply: (fault) => faults.apply({ ...fault, clock: () => new Date() }),
      },
      recovery: {
        verify() {
          if (!workflowDevice || !evidence) {
            return Promise.resolve({
              status: 'INCONCLUSIVE' as const,
              assertions: [
                {
                  id: 'visitor-record',
                  status: 'INCONCLUSIVE' as const,
                  message: 'Recovery had no UI session to read.',
                  evidenceRefs: [],
                },
              ],
            });
          }
          const store = evidence;
          const device = workflowDevice;
          const probe = createHttpVisitorProbe({
            url: 'http://127.0.0.1:8080/visitors',
            saveBody: (text) => store.saveLog('visitors', text),
            readScreen: async () => {
              const text = (await device.readText('id:visit_status')) ?? '';
              const shot = store.saveScreenshot('recovery-screen', await device.screenshot());
              return { text, evidenceRef: shot };
            },
          });
          return new RecoveryVerifier(() => new Date(), sleep).verify(
            {
              visitorName: 'Test Visitor',
              statusText: 'Checked in',
              screenText: 'Checked in',
              timeoutMs: 10_000,
              pollIntervalMs: 500,
            },
            probe,
          );
        },
      },
      logs: {
        collect: (serial) => logs.collect(serial),
      },
      renderJson: renderJsonReport,
      renderHtml: renderHtmlReport,
    },
  );
}
