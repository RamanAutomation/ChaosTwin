import { remote } from 'webdriverio';
import type { AppiumClientFactory, AppiumClientRequest, AppiumDriverHandle } from './appium-session.js';
import type { UiAutomatorBrowser, UiElement } from './workflow-device.js';

interface WebdriverUiSession {
  sessionId: string | null;
  capabilities: Record<string, unknown>;
  deleteSession(): Promise<void>;
  takeScreenshot(): Promise<string>;
  startActivity(options: { appPackage: string; appActivity: string }): Promise<unknown>;
  $(selector: string): Promise<UiElement>;
}

/**
 * WebdriverIO is pinned to 9.32.0 because 9.33 and 10 require Node.js 24.22.1
 * or newer. This machine's supported runtime for the client is Node 24.18.
 * `connectionRetryCount: 0` is kept. WebdriverIO substitutes its default of 3
 * only when the option is undefined, and a count of 0 returns the first
 * connection failure without another attempt.
 */
export function createWebdriverioAppiumClient(): AppiumClientFactory {
  return {
    async create(request: AppiumClientRequest): Promise<AppiumDriverHandle> {
      const browser = (await remote({
        protocol: request.protocol,
        hostname: request.hostname,
        port: request.port,
        path: request.path,
        logLevel: 'error',
        connectionRetryTimeout: request.connectionTimeoutMs,
        connectionRetryCount: 0,
        capabilities: request.capabilities,
      })) as unknown as WebdriverUiSession;
      const ui: UiAutomatorBrowser = {
        startActivity(packageName: string, activity: string) {
          return browser.startActivity({ appPackage: packageName, appActivity: activity });
        },
        takeScreenshot() {
          return browser.takeScreenshot();
        },
        $(selector: string) {
          return browser.$(selector);
        },
      };
      return {
        sessionId: browser.sessionId,
        capabilities: browser.capabilities,
        ui,
        async deleteSession() {
          await browser.deleteSession();
        },
      };
    },
  };
}
