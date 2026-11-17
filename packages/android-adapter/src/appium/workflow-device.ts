export interface UiElement {
  click(): Promise<unknown>;
  setValue(value: string): Promise<unknown>;
  isDisplayed(): Promise<boolean>;
  getText(): Promise<string>;
}

/**
 * Structural slice of a WebdriverIO Android session. The live client adapts
 * `remote()` to this shape. Core never imports WebdriverIO.
 */
export interface UiAutomatorBrowser {
  startActivity(packageName: string, activity: string): Promise<unknown>;
  takeScreenshot(): Promise<string>;
  $(selector: string): Promise<UiElement>;
}

export interface WorkflowDevice {
  launchApp(packageName: string, activity: string): Promise<void>;
  tap(selector: string): Promise<void>;
  enterText(selector: string, text: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  readText(selector: string): Promise<string | null>;
  screenshot(): Promise<Buffer>;
}

const SELECTOR_PATTERN = /^id:[a-z][a-z0-9_]{0,40}$/;

export function resourceSelector(packageName: string, selector: string): string {
  if (!SELECTOR_PATTERN.test(selector)) {
    throw new Error(`Selector "${selector}" is not an id:name selector.`);
  }
  const name = selector.slice(3);
  return `android=new UiSelector().resourceId("${packageName}:id/${name}")`;
}

export function createWorkflowDevice(browser: UiAutomatorBrowser, packageName: string): WorkflowDevice {
  return {
    async launchApp(appPackage: string, activity: string): Promise<void> {
      await browser.startActivity(appPackage, activity);
    },
    async tap(selector: string): Promise<void> {
      const element = await browser.$(resourceSelector(packageName, selector));
      await element.click();
    },
    async enterText(selector: string, text: string): Promise<void> {
      const element = await browser.$(resourceSelector(packageName, selector));
      await element.setValue(text);
    },
    async isVisible(selector: string): Promise<boolean> {
      const element = await browser.$(resourceSelector(packageName, selector));
      return element.isDisplayed();
    },
    async readText(selector: string): Promise<string | null> {
      const element = await browser.$(resourceSelector(packageName, selector));
      return element.getText();
    },
    async screenshot(): Promise<Buffer> {
      const encoded = await browser.takeScreenshot();
      return Buffer.from(encoded, 'base64');
    },
  };
}
