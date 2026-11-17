export const CHAOSTWIN_PRODUCT = 'ChaosTwin Mobile';
export const CHAOSTWIN_VERSION = '0.1.0';
export const DEMO_PACKAGE_NAME = 'com.chaostwin.demo';
export const DEMO_LAUNCH_ACTIVITY = 'com.chaostwin.demo.MainActivity';

const PACKAGE_PATTERN = /^com\.chaostwin\.[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
const ACTIVITY_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

/** Install, launch, uninstall, and app-state faults stay inside this namespace. */
export function isChaosTwinPackage(packageName: string): boolean {
  return PACKAGE_PATTERN.test(packageName);
}

export function isChaosTwinActivity(packageName: string, activity: string): boolean {
  return isChaosTwinPackage(packageName) && activity.startsWith(`${packageName}.`) && ACTIVITY_PATTERN.test(activity);
}
