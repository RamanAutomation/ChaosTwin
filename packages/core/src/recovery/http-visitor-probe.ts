import type { VisitorRecord } from '@chaostwin/contracts';
import { VisitorListSchema, isLocalTestUrl } from '@chaostwin/contracts';
import type { RecoveryProbe } from './recovery-verifier.js';

export interface HttpVisitorProbeOptions {
  url: string;
  fetchImpl?: typeof fetch;
  saveBody: (text: string) => string;
  readScreen: () => Promise<{ text: string; evidenceRef: string | null }>;
}

/**
 * GET-only visitor probe. It refuses any URL that is not a local test endpoint
 * and it has no method that creates a record.
 */
export function createHttpVisitorProbe(options: HttpVisitorProbeOptions): RecoveryProbe {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async queryVisitors(timeoutMs: number) {
      if (!isLocalTestUrl(options.url)) {
        return { ok: false, reason: 'error', message: 'Visitor verification is limited to the local test endpoint.' };
      }
      try {
        const response = await fetchImpl(options.url, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, reason: 'error', message: `GET ${options.url} returned ${response.status}.` };
        }
        let evidenceRef: string | null = null;
        try {
          evidenceRef = options.saveBody(text);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, reason: 'error', message: `The visitor response could not be stored: ${message}` };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          return { ok: false, reason: 'error', message: 'Visitor response was not JSON.' };
        }
        const body = VisitorListSchema.safeParse(parsed);
        if (!body.success) {
          return { ok: false, reason: 'error', message: 'Visitor response did not match the expected record list.' };
        }
        const records: VisitorRecord[] = body.data.visitors;
        return { ok: true, records, evidenceRef };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { ok: false, reason: timeout ? 'timeout' : 'error', message };
      }
    },
    async currentScreen() {
      try {
        const screen = await options.readScreen();
        return { ok: true, text: screen.text, evidenceRef: screen.evidenceRef };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { ok: false, reason: timeout ? 'timeout' : 'error', message };
      }
    },
  };
}
