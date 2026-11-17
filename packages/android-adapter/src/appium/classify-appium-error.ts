import type { AppiumSessionErrorCode } from '@chaostwin/contracts';

export interface ClassifiedAppiumError {
  code: Extract<
    AppiumSessionErrorCode,
    'server-unavailable' | 'connection-timeout' | 'device-disconnected' | 'invalid-capabilities' | 'session-failed'
  >;
  message: string;
}

function errorText(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : '';
    return { code, message: error.message || error.name };
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    const code = typeof record.code === 'string' ? record.code : '';
    const message = typeof record.message === 'string' ? record.message : '';
    if (message) {
      return { code, message };
    }
  }
  return { code: '', message: String(error) };
}

/**
 * Map a client failure to an operator-facing code. The original message is kept.
 * Connection refusal is not reported as a successful empty session.
 */
export function classifyAppiumError(error: unknown): ClassifiedAppiumError {
  const { code, message } = errorText(error);
  const text = `${code} ${message}`.toLowerCase();
  const deviceConnectionFailure =
    (text.includes('unable to connect') && text.includes('device') && !text.includes('browser driver')) ||
    text.includes('device offline') ||
    text.includes('device unauthorized') ||
    text.includes('could not find a connected android device') ||
    text.includes('no devices/emulators found') ||
    (text.includes('device') && text.includes('not found')) ||
    text.includes("adb: device '") ||
    text.includes('adb: device offline');

  if (deviceConnectionFailure) {
    return { code: 'device-disconnected', message };
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('fetch failed') ||
    text.includes('failed to fetch') ||
    text.includes('unable to connect') ||
    text.includes('make sure browser driver is running')
  ) {
    return { code: 'server-unavailable', message };
  }

  if (
    text.includes('invalid capabilities') ||
    text.includes('invalid argument') ||
    text.includes('illegal argument') ||
    (text.includes('session not created') && text.includes('capab')) ||
    text.includes('sessionnotcreated')
  ) {
    return { code: 'invalid-capabilities', message };
  }

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || text.includes('timed out') || text.includes('timeout')) {
    return { code: 'connection-timeout', message };
  }

  return { code: 'session-failed', message: message || 'Appium session creation failed.' };
}
