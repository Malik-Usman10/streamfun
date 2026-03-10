// Structured logging utility using Pino
import pino from 'pino';
import { appConfig } from '../config/index.js';

const logger = pino({
  level: appConfig.logging.level,
  transport: appConfig.logging.pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;

// Helper functions for contextual logging
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

export function createServiceLogger(service: string) {
  return logger.child({ service });
}

export function createWorkerLogger(worker: string) {
  return logger.child({ worker });
}
