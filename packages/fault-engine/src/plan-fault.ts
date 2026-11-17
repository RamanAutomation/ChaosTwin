import type { FaultRequest } from '@chaostwin/contracts';
import { isChaosTwinActivity } from '@chaostwin/contracts';

const EMULATOR_SERIAL = /^emulator-\d+$/;

export interface FaultPlan {
  apply: string[][];
  restore: string[][];
}

export type FaultPlanResult =
  | { ok: true; plan: FaultPlan }
  | { ok: false; status: 'UNSUPPORTED' | 'FAILED'; message: string };

/**
 * Command plan for one fault. Packet loss has no plan.
 * Restore targets are emulator defaults, not a previously measured profile.
 */
export function planFault(target: { serial: string; kind: 'emulator' | 'hardware' }, request: FaultRequest): FaultPlanResult {
  if (request.kind === 'packet-loss') {
    return {
      ok: false,
      status: 'UNSUPPORTED',
      message: 'Packet loss is not implemented. No network command was sent.',
    };
  }
  if (target.kind !== 'emulator' || !EMULATOR_SERIAL.test(target.serial)) {
    return {
      ok: false,
      status: 'UNSUPPORTED',
      message: `Faults are limited to an emulator serial. ${target.serial} is not supported.`,
    };
  }
  const serial = target.serial;
  switch (request.kind) {
    case 'network-latency':
      return {
        ok: true,
        plan: {
          apply: [['-s', serial, 'emu', 'network', 'delay', request.profile]],
          restore: [['-s', serial, 'emu', 'network', 'delay', 'none']],
        },
      };
    case 'network-speed':
      return {
        ok: true,
        plan: {
          apply: [['-s', serial, 'emu', 'network', 'speed', request.profile]],
          restore: [['-s', serial, 'emu', 'network', 'speed', 'full']],
        },
      };
    case 'network-disconnect':
      return {
        ok: true,
        plan: {
          apply: [['-s', serial, 'emu', 'gsm', 'data', 'off']],
          restore: [['-s', serial, 'emu', 'gsm', 'data', 'on']],
        },
      };
    case 'app-background':
    case 'app-restart': {
      if (!isChaosTwinActivity(request.packageName, request.activity)) {
        return {
          ok: false,
          status: 'FAILED',
          message: `Refusing to change ${request.packageName}. Only a com.chaostwin activity can be backgrounded or restarted.`,
        };
      }
      const start = ['-s', serial, 'shell', 'am', 'start', '-n', `${request.packageName}/${request.activity}`];
      if (request.kind === 'app-background') {
        return {
          ok: true,
          plan: {
            apply: [['-s', serial, 'shell', 'input', 'keyevent', '3']],
            restore: [start],
          },
        };
      }
      return {
        ok: true,
        plan: {
          apply: [['-s', serial, 'shell', 'am', 'force-stop', request.packageName]],
          restore: [start],
        },
      };
    }
    default: {
      const unknown: never = request;
      return { ok: false, status: 'FAILED', message: `Unsupported fault ${JSON.stringify(unknown)}.` };
    }
  }
}
