// utils/logger.js — Structured logging with sensitive-field redaction.
// Supports optional Loki transport for centralised log aggregation.

import pino from 'pino';
import { env } from '../config/env.js';

const baseOpts = {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password', '*.password',
      'token', '*.token',
      'accessToken', 'refreshToken',
      'secret', '*.secret',
      'currentPassword', 'newPassword',
      'totpCode', 'backupCode', 'captchaToken',
    ],
    censor: '[REDACTED]',
  },
  base: { pid: process.pid, app: 'myapp' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

let transport = undefined;
if (env.LOG_TRANSPORT === 'loki' && env.LOKI_URL) {
  transport = pino.transport({
    target: 'pino-loki',
    options: { host: env.LOKI_URL, labels: { app: 'myapp', env: env.NODE_ENV } },
  });
} else if (env.LOG_TRANSPORT === 'file') {
  transport = pino.transport({
    target: 'pino/file',
    options: { destination: './logs/app.log', mkdir: true },
  });
}

export const log = transport ? pino(baseOpts, transport) : pino(baseOpts);
