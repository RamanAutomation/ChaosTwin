import type {
  AndroidDevice,
  AppiumSessionConfig,
  AppiumSessionErrorCode,
  AppiumSessionRecord,
  CloseAppiumSessionResult,
  EligibilityDecision,
  Logger,
  OpenAppiumSessionResult,
} from '@chaostwin/contracts';
import {
  AppiumSessionConfigSchema,
  AppiumSessionRecordSchema,
  CloseAppiumSessionResultSchema,
  OpenAppiumSessionResultSchema,
  noopLogger,
  parseWithSchema,
} from '@chaostwin/contracts';
import type { DeviceStatusProbe } from '../adb/adb-device-status.js';
import { buildUiAutomator2Capabilities, capabilityString, type UiAutomator2Capabilities } from './capabilities.js';
import { classifyAppiumError } from './classify-appium-error.js';
import { parseAppiumServerUrl } from './parse-server-url.js';
import type { UiAutomatorBrowser } from './workflow-device.js';

export interface AppiumClientRequest {
  protocol: 'http' | 'https';
  hostname: string;
  port: number;
  path: string;
  connectionTimeoutMs: number;
  capabilities: UiAutomator2Capabilities;
}

export interface AppiumDriverHandle {
  sessionId: string | null;
  capabilities: Record<string, unknown>;
  deleteSession(): Promise<void>;
  /** Present when the client can drive the UI. Session open does not require it. */
  ui?: UiAutomatorBrowser;
}

export interface AppiumClientFactory {
  create(request: AppiumClientRequest): Promise<AppiumDriverHandle>;
}

export interface SessionSelection {
  serial: string;
  operatorApproved: boolean;
}

export interface AppiumSessionManagerOptions {
  client: AppiumClientFactory;
  deviceStatus: DeviceStatusProbe;
  authorize: (device: AndroidDevice, selection: SessionSelection) => EligibilityDecision;
  logger?: Logger;
  clock?: () => Date;
}

interface ActiveSession {
  driver: AppiumDriverHandle;
  record: AppiumSessionRecord;
}

function schemaMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * One UiAutomator2 session at a time. Opening a second session is refused
 * until close() succeeds, so a lost handle cannot stack sessions.
 */
export class AppiumSessionManager {
  private readonly client: AppiumClientFactory;
  private readonly deviceStatus: DeviceStatusProbe;
  private readonly authorize: AppiumSessionManagerOptions['authorize'];
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private active: ActiveSession | null = null;

  constructor(options: AppiumSessionManagerOptions) {
    this.client = options.client;
    this.deviceStatus = options.deviceStatus;
    this.authorize = options.authorize;
    this.logger = options.logger ?? noopLogger;
    this.clock = options.clock ?? (() => new Date());
  }

  current(): AppiumSessionRecord | null {
    return this.active?.record ?? null;
  }

  workflowBrowser(): UiAutomatorBrowser | null {
    return this.active?.driver.ui ?? null;
  }

  async open(input: {
    device: AndroidDevice;
    selection: SessionSelection;
    config: AppiumSessionConfig;
  }): Promise<OpenAppiumSessionResult> {
    if (this.active) {
      return this.fail(
        'session-already-open',
        `An Appium session is already open for ${this.active.record.udid}. Close it before creating another.`,
      );
    }

    const parsed = AppiumSessionConfigSchema.safeParse(input.config);
    if (!parsed.success) {
      return this.fail('invalid-capabilities', schemaMessage(parsed.error));
    }

    const server = parseAppiumServerUrl(parsed.data.serverUrl);
    if (!server.ok) {
      return this.fail('invalid-server-url', server.message);
    }

    if (input.device.kind !== 'emulator') {
      return this.fail(
        'device-not-authorized',
        `Session creation is limited to emulators. ${input.device.serial} is ${input.device.kind}.`,
      );
    }

    const decision = this.authorize(input.device, input.selection);
    if (!decision.eligible) {
      const message = decision.reasons.map((reason) => reason.message).join(' ');
      const offline = decision.reasons.some((reason) => reason.code === 'device-not-online');
      return this.fail(offline ? 'device-disconnected' : 'device-not-authorized', message);
    }

    let observed: Awaited<ReturnType<DeviceStatusProbe['currentState']>>;
    try {
      observed = await this.deviceStatus.currentState(input.device.serial);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message, serial: input.device.serial }, 'Device status check failed');
      return this.fail('device-status-unknown', message);
    }
    if (observed !== 'device') {
      return this.fail(
        'device-disconnected',
        `Device ${input.device.serial} is ${observed} now. The session was not created.`,
      );
    }

    const capabilities = buildUiAutomator2Capabilities(input.device, parsed.data.capabilities);
    if (!capabilities.ok) {
      return this.fail('invalid-capabilities', capabilities.message);
    }

    const request: AppiumClientRequest = {
      protocol: server.server.protocol,
      hostname: server.server.hostname,
      port: server.server.port,
      path: server.server.path,
      connectionTimeoutMs: parsed.data.connectionTimeoutMs,
      capabilities: capabilities.capabilities,
    };

    let driver: AppiumDriverHandle;
    try {
      driver = await this.client.create(request);
    } catch (error) {
      const classified = classifyAppiumError(error);
      this.logger.error({ err: classified.message, code: classified.code }, 'Appium session was not created');
      return this.fail(classified.code, classified.message);
    }

    const udid = capabilityString(driver.capabilities, ['appium:udid', 'udid']);
    if (!driver.sessionId || udid !== input.device.serial) {
      const problem = !driver.sessionId
        ? 'Appium did not return a session id.'
        : `Appium session ${driver.sessionId} reported UDID "${udid ?? 'missing'}" instead of ${input.device.serial}.`;
      try {
        await driver.deleteSession();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.holdRejectedSession(driver, input.device.serial, parsed.data.serverUrl);
        this.logger.error({ err: message }, 'Discarding an unexpected Appium session failed');
        return this.fail(
          'session-failed',
          `${problem} Closing that session also failed: ${message}. Another session will not be opened until close succeeds.`,
        );
      }
      return this.fail(!driver.sessionId ? 'session-failed' : 'udid-mismatch', `${problem} The session was closed.`);
    }

    const record = parseWithSchema(
      AppiumSessionRecordSchema,
      {
        sessionId: driver.sessionId,
        serverUrl: parsed.data.serverUrl,
        udid,
        platformName: capabilityString(driver.capabilities, ['platformName']) ?? 'Android',
        platformVersion: capabilityString(driver.capabilities, ['appium:platformVersion', 'platformVersion']),
        automationName:
          capabilityString(driver.capabilities, ['appium:automationName', 'automationName']) ?? 'UiAutomator2',
        deviceName: capabilityString(driver.capabilities, ['appium:deviceName', 'deviceName']),
        createdAt: this.clock().toISOString(),
        closedAt: null,
      },
      'Appium session',
    );
    this.active = { driver, record };
    this.logger.info({ sessionId: record.sessionId, udid: record.udid }, 'Appium session created');
    return parseWithSchema(OpenAppiumSessionResultSchema, { ok: true, session: record }, 'Open Appium session result');
  }

  async close(): Promise<CloseAppiumSessionResult> {
    if (!this.active) {
      return parseWithSchema(
        CloseAppiumSessionResultSchema,
        { ok: true, alreadyClosed: true, session: null },
        'Close Appium session result',
      );
    }

    const current = this.active;
    try {
      await current.driver.deleteSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message, sessionId: current.record.sessionId }, 'Appium session close failed');
      return this.failClose(message);
    }

    const closed: AppiumSessionRecord = {
      ...current.record,
      closedAt: this.clock().toISOString(),
    };
    this.active = null;
    this.logger.info({ sessionId: closed.sessionId }, 'Appium session closed');
    return parseWithSchema(
      CloseAppiumSessionResultSchema,
      { ok: true, alreadyClosed: false, session: closed },
      'Close Appium session result',
    );
  }

  private holdRejectedSession(driver: AppiumDriverHandle, udid: string, serverUrl: string): void {
    this.active = {
      driver,
      record: {
        sessionId: driver.sessionId ?? 'unidentified-session',
        serverUrl,
        udid,
        platformName: 'Android',
        platformVersion: null,
        automationName: 'UiAutomator2',
        deviceName: null,
        createdAt: this.clock().toISOString(),
        closedAt: null,
      },
    };
  }

  private fail(code: AppiumSessionErrorCode, message: string): OpenAppiumSessionResult {
    return parseWithSchema(
      OpenAppiumSessionResultSchema,
      { ok: false, code, message: message || 'Appium session failed.' },
      'Open Appium session result',
    );
  }

  private failClose(message: string): CloseAppiumSessionResult {
    return parseWithSchema(
      CloseAppiumSessionResultSchema,
      { ok: false, code: 'session-close-failed', message: message || 'Appium session close failed.' },
      'Close Appium session result',
    );
  }
}
