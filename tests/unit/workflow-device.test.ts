import { createWorkflowDevice, resourceSelector } from '@chaostwin/android-adapter';
import { describe, expect, it } from 'vitest';

describe('createWorkflowDevice', () => {
  it('maps an id selector to a UiSelector resource id and passes text through', async () => {
    const calls: string[] = [];
    const device = createWorkflowDevice(
      {
        startActivity: async (packageName, activity) => {
          calls.push(`${packageName}/${activity}`);
        },
        takeScreenshot: async () => Buffer.from('png-bytes').toString('base64'),
        $: async (selector) => ({
          click: async () => {
            calls.push(`click ${selector}`);
          },
          setValue: async (value) => {
            calls.push(`text ${selector} ${value}`);
          },
          isDisplayed: async () => true,
          getText: async () => 'Checked in',
        }),
      },
      'com.chaostwin.demo',
    );
    await device.launchApp('com.chaostwin.demo', 'com.chaostwin.demo.MainActivity');
    await device.enterText('id:visitor_name', 'Test Visitor');
    await device.tap('id:start_visit');
    const bytes = await device.screenshot();
    expect(calls).toEqual([
      'com.chaostwin.demo/com.chaostwin.demo.MainActivity',
      'text android=new UiSelector().resourceId("com.chaostwin.demo:id/visitor_name") Test Visitor',
      'click android=new UiSelector().resourceId("com.chaostwin.demo:id/start_visit")',
    ]);
    expect(bytes.toString()).toBe('png-bytes');
    expect(() => resourceSelector('com.chaostwin.demo', 'text:hello')).toThrow(/id:name/);
  });
});
