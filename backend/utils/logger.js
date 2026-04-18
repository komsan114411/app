// utils/logger.js — Structured logging with sensitive-field redaction.

import pino from 'pino';
import { env } from '../config/env.js';

export const log = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Redact anything that might carry secrets.
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
    ],
    censor: '[REDACTED]',
  },
  // Never include env vars or full query strings
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});
