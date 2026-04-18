// utils/email.js — Nodemailer transport with a console fallback for dev.
// If SMTP_HOST is unset, emails are logged (not sent) — safe for local dev.

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { log } from './logger.js';

let transport = null;
let transportReady = false;

function getTransport() {
  if (transportReady) return transport;
  transportReady = true;
  if (!env.SMTP_HOST) {
    log.warn('SMTP_HOST not set — emails will only be logged to stdout');
    return null;
  }
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: (env.SMTP_PORT || 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  const from = env.SMTP_FROM || 'no-reply@example.com';
  const t = getTransport();
  if (!t) {
    log.info({ to, subject, preview: text?.slice(0, 200) }, 'email_stub (no SMTP configured)');
    return { stubbed: true };
  }
  try {
    const info = await t.sendMail({ from, to, subject, text, html });
    log.info({ to, subject, messageId: info.messageId }, 'email_sent');
    return { messageId: info.messageId };
  } catch (err) {
    log.error({ err: err.message, to }, 'email_failed');
    throw new Error('email_failed');
  }
}
