import type { CommandResult, CommandRunner, FaultRequest, FaultResult } from '@chaostwin/contracts';
import { FaultRequestSchema } from '@chaostwin/contracts';
import { planFault } from './plan-fault.js';

const OUTPUT_CAP = 1_000_000;

export interface FaultApproval {
  operatorApproved: boolean;
  disruptiveActionApproved: boolean;
}

export interface FaultTarget {
  serial: string;
  kind: 'emulator' | 'hardware';
}

export interface FaultApplication {
  result: FaultResult;
  restore(): Promise<FaultResult>;
}

export interface FaultSchedulerOptions {
  runner: CommandRunner;
  adbPath: string;
}

/**
 * Applies an emulator fault and always attempts the matching restore after
 * a command was sent. Restore returns delay none, speed full, or gsm data on.
 */
export class FaultScheduler {
  constructor(private readonly options: FaultSchedulerOptions) {}

  async apply(input: {
    target: FaultTarget;
    approval: FaultApproval;
    request: unknown;
    clock: () => Date;
  }): Promise<FaultApplication> {
    const startedAt = input.clock().toISOString();
    const untouched = (status: FaultResult['status'], message: string): FaultApplication => {
      const result = this.result(status, 'none', message, startedAt, input.clock().toISOString(), true, requestKind(input.request));
      return { result, restore: async () => result };
    };

    if (input.approval.operatorApproved !== true || input.approval.disruptiveActionApproved !== true) {
      return untouched('APPROVAL_REQUIRED', 'Disruptive approval is required. No fault command was sent.');
    }
    const parsed = FaultRequestSchema.safeParse(input.request);
    if (!parsed.success) {
      return untouched('FAILED', 'The fault request is invalid. No fault command was sent.');
    }
    const planned = planFault(input.target, parsed.data);
    if (!planned.ok) {
      return untouched(planned.status, planned.message);
    }

    const issued: string[][] = [];
    let applyProblem: { status: 'UNSUPPORTED' | 'FAILED'; message: string } | null = null;
    try {
      for (const args of planned.plan.apply) {
        issued.push(args);
        const outcome = await this.execute(args, parsed.data.timeoutMs);
        if (outcome.status !== 'ok') {
          applyProblem = outcome;
          break;
        }
      }
    } catch (error) {
      applyProblem = { status: 'FAILED', message: error instanceof Error ? error.message : String(error) };
    }

    const restore = async (): Promise<FaultResult> => {
      if (issued.length === 0) {
        return this.result('FAILED', 'none', 'No fault command was sent.', startedAt, input.clock().toISOString(), true, parsed.data.kind);
      }
      try {
        for (const args of planned.plan.restore) {
          const outcome = await this.execute(args, parsed.data.timeoutMs);
          if (outcome.status !== 'ok') {
            return this.result(
              'FAILED',
              'actual',
              `Restore failed: ${outcome.message}`,
              startedAt,
              input.clock().toISOString(),
              false,
              parsed.data.kind,
            );
          }
        }
        return this.result(
          'APPLIED',
          'actual',
          `${describe(parsed.data)} Restored the emulator default.`,
          startedAt,
          input.clock().toISOString(),
          true,
          parsed.data.kind,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.result('FAILED', 'actual', `Restore failed: ${message}`, startedAt, input.clock().toISOString(), false, parsed.data.kind);
      }
    };

    if (applyProblem) {
      const restored = await restore();
      const status = applyProblem.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'FAILED';
      return {
        result: this.result(
          status,
          'none',
          `${applyProblem.message} ${restored.message}`,
          startedAt,
          restored.endedAt,
          restored.restored,
          parsed.data.kind,
        ),
        restore: async () => restored,
      };
    }

    return {
      result: this.result(
        'APPLIED',
        'actual',
        `${describe(parsed.data)} Verification is the emulator console accepting the command.`,
        startedAt,
        null,
        false,
        parsed.data.kind,
      ),
      restore,
    };
  }

  async run(input: {
    target: FaultTarget;
    approval: FaultApproval;
    request: unknown;
    clock: () => Date;
    sleep: (ms: number) => Promise<void>;
  }): Promise<FaultResult> {
    const applied = await this.apply(input);
    if (applied.result.status !== 'APPLIED') {
      return applied.result;
    }
    const request = FaultRequestSchema.parse(input.request);
    try {
      await input.sleep(request.durationMs);
    } catch (error) {
      const restored = await applied.restore();
      return {
        ...restored,
        status: 'FAILED',
        message: `${error instanceof Error ? error.message : String(error)} ${restored.message}`,
      };
    }
    return applied.restore();
  }

  private async execute(args: string[], timeoutMs: number): Promise<{ status: 'ok' } | { status: 'UNSUPPORTED' | 'FAILED'; message: string }> {
    const result = await this.options.runner.run(this.options.adbPath, args, { timeoutMs, maxOutputBytes: OUTPUT_CAP });
    return classify(result);
  }

  private result(
    status: FaultResult['status'],
    mode: FaultResult['mode'],
    message: string,
    startedAt: string | null,
    endedAt: string | null,
    restored: boolean,
    kind: string,
  ): FaultResult {
    return { kind, status, mode, message, startedAt, endedAt, restored };
  }
}

function requestKind(request: unknown): string {
  if (typeof request === 'object' && request && 'kind' in request && typeof request.kind === 'string') {
    return request.kind;
  }
  return 'unknown';
}

function describe(request: FaultRequest): string {
  switch (request.kind) {
    case 'network-latency':
      return `Applied emulator network delay ${request.profile}.`;
    case 'network-speed':
      return `Applied emulator network speed ${request.profile}.`;
    case 'network-disconnect':
      return 'Turned emulator mobile data off.';
    case 'app-background':
      return `Sent ${request.packageName} to the background.`;
    case 'app-restart':
      return `Force-stopped ${request.packageName}.`;
    case 'packet-loss':
      return 'Packet loss was not applied.';
    default: {
      const unknown: never = request;
      return `Fault ${JSON.stringify(unknown)} was not applied.`;
    }
  }
}

function classify(result: CommandResult): { status: 'ok' } | { status: 'UNSUPPORTED' | 'FAILED'; message: string } {
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.timedOut) {
    return { status: 'FAILED', message: 'The fault command timed out.' };
  }
  if (result.truncated || result.spawnError) {
    return { status: 'FAILED', message: result.spawnError ?? 'The fault command output was truncated.' };
  }
  if (/unknown command|not implemented|not supported|\bKO\b/i.test(text)) {
    return { status: 'UNSUPPORTED', message: text.trim() || 'The emulator rejected the fault command.' };
  }
  if (result.exitCode !== 0) {
    return { status: 'FAILED', message: text.trim() || `The fault command exited ${result.exitCode}.` };
  }
  return { status: 'ok' };
}
