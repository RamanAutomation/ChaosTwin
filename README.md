# ChaosTwin Mobile

Discover failures before your users do.

ChaosTwin is an Android-first resilience runner. It understands a workflow, introduces a controlled disruption, keeps the evidence, and verifies recovery. This repository implements environment detection through the Android Network Recovery Test (CT-001 to CT-009 and CT-EXP-001). A live pass still needs a demo APK, a running emulator, and an Appium server.

## What is implemented

- Detect Node.js, npm, Java, the Android SDK, ADB, the Android emulator, and Appium.
- Find the SDK and Android Studio's bundled Java even when `ANDROID_HOME`, `JAVA_HOME`, and PATH are unset.
- List connected devices with `adb devices -l`.
- List AVDs with `emulator -list-avds`.
- Correlate a running emulator to its AVD name when the emulator console answers.
- Refuse to treat a discovered device as authorized for an experiment.
- Open one UiAutomator2 session for an explicitly approved online emulator, read the UDID and platform information, and close it.
- Install and launch `com.chaostwin.demo` from an APK path you supply. Uninstall only with `--uninstall`.
- Run the visitor check-in workflow, apply an emulator network fault, restore the emulator default, and verify one visitor record.
- Store screenshots, logs, a timeline, and JSON and HTML reports under `reports/<experiment-id>/`.
- Validate inspection and experiment results with Zod and write structured logs with Pino.

`doctor --json` and `devices --json` are inspection output. They are not experiment reports.

## Prerequisites found on a development machine

These are observations, not an installer. ChaosTwin does not download the Android SDK.

| Tool | Used by this phase |
| --- | --- |
| Node.js 22.12 or newer. This workspace was built on Node.js 24.18. | Required |
| npm 11 | Required to install workspace dependencies |
| Android SDK platform-tools (`adb`) | Required for device discovery |
| Android emulator | Required to list AVDs |
| JDK, including Android Studio's `jbr` | Detected now. Required later for Appium |
| Appium server | Not installed here. Required before `npm run session` can create a real session. The WebdriverIO client is installed. |

## Install

From the repository root in PowerShell:

```powershell
npm install
```

## Commands

```powershell
npm run typecheck
npm run lint
npm test
npm run test:unit
npm run test:integration
npm run doctor
npm run devices
npm run session -- --serial emulator-5554 --approve
npm run experiment -- --serial emulator-5554 --approve --disruptive --apk fixtures\demo-android-app\app.apk
npm run doctor -- --json
npm run devices -- --json
npm run session -- --serial emulator-5554 --approve --server http://127.0.0.1:4723 --json
```

On a machine where the Android SDK is installed, also run the stricter integration check:

```powershell
$env:CHAOSTWIN_EXPECT_LOCAL_ANDROID = '1'
npm run test:integration
```

Or run the full local check:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

`doctor` exits `0` when ADB is usable and device discovery returns a trusted inventory. It exits `1` when ADB is missing or discovery fails. Appium being absent does not fail `doctor`. `devices` exits `1` when discovery is unavailable or failed. An empty device list is a successful observation. `session` exits `0` only when an approved online emulator accepted a UiAutomator2 session and that session was closed. It exits `1` when approval, the device, or the server is missing. `experiment` exits `0` only when CT-EXP-001 reports PASS. A missing APK, a missing `--disruptive` flag, or an unverified assertion exits `1` and does not change the device.

`session` defaults to `http://127.0.0.1:4723` and prints that URL. It talks only to an emulator serial you pass with `--approve`. It sets `noReset`, refuses `fullReset`, and does not grant Android permissions. WebdriverIO is `9.32.0` because `9.33` and `10` require Node.js `24.22.1` or newer, and this workspace runs on Node.js `24.18`.

The Appium server is separate from the client. It was not installed for CT-003. When you choose to run one:

```powershell
npm install -g appium
appium driver install uiautomator2
appium --address 127.0.0.1 --port 4723
```

Start an emulator from Android Studio before `npm run session`. Inspection starts the ADB server if it is not already running. It does not boot an emulator, install a package, or change network state.

## Session environment

If `doctor` prints suggested assignments, paste them into the current PowerShell window. A typical result when Android Studio and the SDK are installed but not on PATH:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

Use the paths from `npm run doctor` if they differ. These assignments last for that window only.

## Layout

```text
apps/cli                  doctor, devices, session, and experiment commands
packages/contracts        Zod schemas and ports
packages/core             workflows, recovery, and the experiment orchestrator
packages/android-adapter  adb discovery, install, and Appium sessions
packages/fault-engine     emulator fault plans and restoration
packages/evidence         per-experiment screenshots, logs, and timeline
packages/reporter         JSON and HTML reports
fixtures/demo-android-app screen contract for com.chaostwin.demo
experiments               visitor-check-in workflow
tests/unit                module tests with fakes
tests/integration         live host inspection and a refused Appium connection
```

See [docs/architecture.md](docs/architecture.md) for the dependency rule and the rest of Phase 1.

## Known limitations

- No Appium server is installed, and no emulator is running. A real WebdriverIO call to `http://127.0.0.1:4723/session` returned `ECONNREFUSED`. That is a failed connection, not a session.
- Session creation and faults are limited to emulators. A hardware serial is rejected.
- No demo APK is compiled here, so install, launch, and CT-EXP-001 have not run against a device. The experiment command stops when the APK file is missing.
- Packet loss is not implemented. A request for it returns UNSUPPORTED and sends no command.
- Network restore returns the emulator defaults (delay none, speed full, GSM data on). A custom profile that was already set is not measured.
- Latency is verified by the emulator console accepting the command, not by a measured round trip.
- The demo app version is reported as unknown. It is not read from the package.
- Java discovered from Android Studio has not been proven compatible with an Appium server.
- WebdriverIO 9.32 pulls browser-driver packages used by desktop automation. `npm audit` reports vulnerabilities in that tree. They are not invoked by the Appium session path.
- A defined AVD is reported as not running only when every connected emulator was identified. Otherwise its running state is unknown.
- Discovery does not select a device. `session` requires `--serial` and `--approve`.
