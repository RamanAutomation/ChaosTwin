/** Hard limits for host inspection. Experiment execution will use its own budget later. */
export const TIMEOUTS = {
  pathLookupMs: 5_000,
  versionMs: 15_000,
  adbDevicesMs: 20_000,
  listAvdsMs: 20_000,
  emulatorAvdNameMs: 5_000,
} as const;

export const MAX_COMMAND_OUTPUT_BYTES = 1_000_000;
