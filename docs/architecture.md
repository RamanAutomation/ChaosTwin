# ChaosTwin architecture

ChaosTwin Mobile discovers, simulates, reproduces, and verifies real-world mobile failures. The deterministic execution core stays free of model calls. AI, when it exists later, can suggest experiments. It cannot decide that a recovery succeeded.

## Dependency rule

```text
apps/cli
  -> @chaostwin/core
  -> @chaostwin/android-adapter
  -> @chaostwin/evidence
  -> @chaostwin/fault-engine
  -> @chaostwin/reporter
  -> @chaostwin/contracts

@chaostwin/core
  -> @chaostwin/contracts

@chaostwin/android-adapter
  -> @chaostwin/contracts

@chaostwin/evidence
  -> @chaostwin/contracts

@chaostwin/fault-engine
  -> @chaostwin/contracts

@chaostwin/reporter
  -> @chaostwin/contracts
```

`core` does not import the Android adapter, the fault engine, or the reporter. The experiment orchestrator receives those as ports. The adapter and the fault engine do not spawn processes or read the filesystem themselves. ESLint rejects `node:child_process` and `node:fs` inside `contracts`, `android-adapter`, `fault-engine`, and `reporter`. Evidence is the package that writes the experiment folder.

## What exists now

| Module | Package | Responsibility |
| --- | --- | --- |
| CT-001 Environment detection | `@chaostwin/core` | Resolve Node.js, npm, Java, Android SDK, ADB, emulator, and Appium. Record version, location, and whether the tool was found from the process, an environment variable, PATH, the SDK, or a known install path. |
| CT-002 Device discovery | `@chaostwin/android-adapter` | Run `adb devices -l` and `emulator -list-avds`. Correlate a running emulator with its AVD name. |
| Device eligibility | `@chaostwin/core` | Refuse every device unless the operator selects that exact serial and adb reports state `device`. Discovery never authorizes a target. |
| CT-003 Appium session | `@chaostwin/android-adapter` | Open one UiAutomator2 session for an approved online emulator through an injected WebdriverIO client, then close it. Read UDID, platform name, and platform version from the created session. |
| CT-004 Install and launch | `@chaostwin/android-adapter` | Install, launch, and verify `com.chaostwin.*` on an approved emulator. Uninstall is a separate confirmed call. |
| CT-005 Workflow | `@chaostwin/core` | Run a Zod workflow through an injected device and a local API. No code evaluation. |
| CT-006 Evidence | `@chaostwin/evidence` | One folder per experiment id. Screenshots, logs, timeline, metadata. Never overwrite. |
| CT-007 Faults | `@chaostwin/fault-engine` | Emulator delay, speed, GSM data, background, and restart. Packet loss is unsupported. |
| CT-008 Recovery | `@chaostwin/core` | Query visitors and the screen. No submit during verification. |
| CT-009 Reports | `@chaostwin/reporter` | JSON and escaped HTML. PASS requires evidence and a restored actual fault. |
| CT-EXP-001 | `@chaostwin/core` and `@chaostwin/cli` | Android Network Recovery Test, composed from the ports above. |
| CLI | `@chaostwin/cli` | `doctor`, `devices`, `session`, and `experiment`. Structured logs go to stderr through Pino. |

Reports are validated with Zod before they are returned. A schema failure throws. Command timeouts, non-zero exits, and spawn errors stay in the result object and are copied into report issues.

The WebdriverIO client lives at `@chaostwin/android-adapter/appium`. The session manager receives that client, an adb status probe, and `evaluateDeviceEligibility` from the CLI. The adapter package does not import `@chaostwin/core`.

## Safety boundaries already enforced

- Version and discovery commands have hard timeouts and an output cap.
- A timed-out `adb devices` result is discarded. Partial stdout is not parsed into a device list.
- `running: null` on a virtual device means the evidence is incomplete. Callers must not treat it as stopped.
- Emulator serials that contain unexpected characters are not passed back to adb.
- Windows `.cmd` shims are quoted and rejected when an argument contains shell metacharacters.
- An Appium session is created only for an emulator whose serial was explicitly approved and whose adb state is still `device`.
- A second session is refused while the first has not closed. A failed `deleteSession` keeps that guard in place.
- Session capabilities force UiAutomator2, `noReset`, and no automatic permission grants. `fullReset`, a different UDID, and an app path are rejected.
- A session whose returned UDID does not match the selection is closed and reported as a mismatch.
- Install, launch, uninstall, and app-state faults accept only a `com.chaostwin.*` package.
- A network or app-state change requires disruptive approval. The command is refused before any device call when that flag is missing.
- Evidence for an experiment id is written once. A second open throws.
- A report cannot validate as PASS when an assertion lacks evidence, the fault was not actually applied and restored, or evidence is marked missing.

## Phase 1 sequence

1. CT-001 Environment detection. Implemented.
2. CT-002 Android device discovery. Implemented.
3. CT-003 Appium session management. Implemented. A live session has not been established: no Appium server is running and no emulator is connected.
4. CT-004 APK installation and launch. Implemented and covered with a fake command runner. No APK has been installed on a device.
5. CT-005 Workflow execution. Implemented. The visitor workflow is data. Android taps go through an injected WebdriverIO-shaped device.
6. CT-006 Evidence collection. Implemented. Tested with a temporary directory.
7. CT-007 Fault engine. Implemented for emulator console commands. Packet loss returns UNSUPPORTED. No fault has been applied to a running emulator.
8. CT-008 Recovery verification. Implemented as a read-only probe. A live visitor API is not running.
9. CT-009 Reports. Implemented. PASS is a schema error without evidence.

CT-EXP-001 is wired. On this machine it stops before a session when the demo APK is absent. It has not produced a live PASS.

## Process model

```text
doctor / devices
  EnvironmentDetector.inspect()
  AndroidDeviceDiscovery.discover(resolved adb and emulator)
  evaluateDeviceEligibility(device, selection)

session --serial <udid> --approve
  discover devices
  reject hardware, offline, and unapproved serials
  adb get-state
  WebdriverIO remote -> POST /session
  read session id, udid, platformVersion
  deleteSession

experiment --serial <udid> --approve --disruptive --apk <file>
  refuse when the APK, approval, or disruptive flag is missing
  discover the approved online emulator
  open one Appium session
  adb install and launch com.chaostwin.demo
  run the workflow through start_visit
  adb emu network delay <profile>
  submit the visit once
  restore delay none
  GET the local visitor list and read the screen
  write reports/<experiment-id>/
  close the session
  uninstall only when --uninstall was passed
```
