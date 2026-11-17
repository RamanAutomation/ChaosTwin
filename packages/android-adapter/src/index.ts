export { LogcatCollector } from './adb/logcat-collector.js';
export type { LogcatCollection, LogcatFailure } from './adb/logcat-collector.js';
export { AdbDeviceStatusProbe } from './adb/adb-device-status.js';
export type { DeviceStatusProbe } from './adb/adb-device-status.js';
export { parseAdbDevices } from './adb/parse-adb-devices.js';
export type { AdbDevicesParseResult } from './adb/parse-adb-devices.js';
export { parseEmulatorAvdName } from './adb/parse-emulator-avd-name.js';
export type { EmulatorAvdNameParse } from './adb/parse-emulator-avd-name.js';
export { parseAvdList } from './adb/parse-avd-list.js';
export { correlateVirtualDevices, countUnidentifiedRunningEmulators } from './device/correlate-virtual-devices.js';
export { AppManager } from './device/app-manager.js';
export type { AppInstallInput, AppManagerOptions, AppUninstallInput } from './device/app-manager.js';
export { AndroidDeviceDiscovery } from './device/discover-android-devices.js';
export type { AndroidDeviceDiscoveryOptions } from './device/discover-android-devices.js';
export { AppiumSessionManager } from './appium/appium-session.js';
export type {
  AppiumClientFactory,
  AppiumClientRequest,
  AppiumDriverHandle,
  AppiumSessionManagerOptions,
  SessionSelection,
} from './appium/appium-session.js';
export { buildUiAutomator2Capabilities, OPTIONAL_APPIUM_CAPABILITIES } from './appium/capabilities.js';
export { classifyAppiumError } from './appium/classify-appium-error.js';
export { parseAppiumServerUrl } from './appium/parse-server-url.js';
export { createWorkflowDevice, resourceSelector } from './appium/workflow-device.js';
export type { UiAutomatorBrowser, UiElement, WorkflowDevice } from './appium/workflow-device.js';
