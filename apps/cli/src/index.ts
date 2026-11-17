import { AdbDeviceStatusProbe, AndroidDeviceDiscovery, AppiumSessionManager } from '@chaostwin/android-adapter';
import { createWebdriverioAppiumClient } from '@chaostwin/android-adapter/appium';
import { evaluateDeviceEligibility, NodeCommandRunner, NodePathProbe, createHostEnvironmentDetector } from '@chaostwin/core';
import { runDevices } from './commands/devices.js';
import { runDoctor } from './commands/doctor.js';
import { executeLiveExperiment } from './commands/experiment-live.js';
import { runExperiment } from './commands/experiment.js';
import { runSession } from './commands/session.js';
import { createCliLogger } from './logging.js';

const HELP = `ChaosTwin Mobile

Usage:
  npm run doctor
  npm run devices
  npm run session -- --serial <udid> --approve
  npm run experiment -- --serial <udid> --approve --disruptive --apk <path>
  npm run doctor -- --json
  npm run devices -- --json
  npm run session -- --serial <udid> --approve --server http://127.0.0.1:4723 --json

Commands:
  doctor      Detect Node.js, npm, Java, the Android SDK, ADB, the emulator, and Appium.
              When ADB is ready, also list connected devices and virtual devices.
  devices     Discover connected Android devices and defined AVDs.
  session     Open one UiAutomator2 session on an explicitly approved online emulator, read its platform information, and close it.
  experiment  Run CT-EXP-001 against com.chaostwin.demo. Requires --serial, --approve, --disruptive, and --apk.
              Add --uninstall only when that demo package should be removed afterwards.

Exit codes:
  0  The command completed.
  1  A required check failed, or the Appium session was not created and closed.
  2  The command is not recognized.
`;

function wantsJson(args: readonly string[]): boolean {
  return args.includes('--json');
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const logger = createCliLogger();
  const detector = createHostEnvironmentDetector(logger);
  const discovery = new AndroidDeviceDiscovery({ runner: new NodeCommandRunner(), logger });
  const dependencies = {
    inspect: () => detector.inspect(),
    discover: (tools: { adbPath: string | null; emulatorPath: string | null }) => discovery.discover(tools),
  };

  if (command === 'doctor') {
    const output = await runDoctor(dependencies, wantsJson(args));
    process.stdout.write(`${output.stdout}\n`);
    return output.exitCode;
  }
  if (command === 'devices') {
    const output = await runDevices(dependencies, wantsJson(args));
    process.stdout.write(`${output.stdout}\n`);
    return output.exitCode;
  }
  if (command === 'experiment') {
    const paths = new NodePathProbe();
    const output = await runExperiment(
      {
        apkExists: (apkPath) => paths.isFile(apkPath),
        inspect: dependencies.inspect,
        discover: dependencies.discover,
        execute: (input) => executeLiveExperiment(input, logger),
      },
      args,
    );
    process.stdout.write(`${output.stdout}\n`);
    return output.exitCode;
  }
  if (command === 'session') {
    const output = await runSession(
      {
        inspect: dependencies.inspect,
        discover: dependencies.discover,
        openAndClose: async (input) => {
          const manager = new AppiumSessionManager({
            client: createWebdriverioAppiumClient(),
            deviceStatus: new AdbDeviceStatusProbe(new NodeCommandRunner(), input.adbPath),
            authorize: evaluateDeviceEligibility,
            logger,
          });
          const opened = await manager.open({
            device: input.device,
            selection: input.selection,
            config: {
              serverUrl: input.serverUrl,
              connectionTimeoutMs: input.connectionTimeoutMs,
            },
          });
          if (!opened.ok) {
            return { opened, closed: null };
          }
          const closed = await manager.close();
          return { opened, closed };
        },
      },
      args,
    );
    process.stdout.write(`${output.stdout}\n`);
    return output.exitCode;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

const executedDirectly = process.argv[1] && /(?:^|[\\/])index\.ts$/.test(process.argv[1]);
if (executedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}

export { main };
