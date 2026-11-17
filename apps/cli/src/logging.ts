import type { Logger } from '@chaostwin/contracts';
import { noopLogger } from '@chaostwin/contracts';
import pino from 'pino';

export function createCliLogger(level = process.env.CHAOSTWIN_LOG_LEVEL ?? 'info'): Logger {
  if (level === 'silent') {
    return noopLogger;
  }
  const logger = pino({ level }, pino.destination({ dest: 2, sync: true }));
  return {
    debug(obj, msg) {
      logger.debug(obj, msg);
    },
    info(obj, msg) {
      logger.info(obj, msg);
    },
    warn(obj, msg) {
      logger.warn(obj, msg);
    },
    error(obj, msg) {
      logger.error(obj, msg);
    },
  };
}
