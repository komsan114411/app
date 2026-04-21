// utils/dailyDigest.js — daily summary email to every active admin.
//
// Fires once per day (midnight Bangkok). Pulls yesterday's + baseline
// stats and ships a plain-text email. Skips silently when SMTP isn't
// configured so the worker never breaks boot.

import { sendMail } from './email.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Device } from '../models/Device.js';
import { EventLog } from '../models/EventLog.js';
import { log } from './logger.js';

const INTERVAL_MS = 60 * 60_000;  // check every hour, send only at target hour
const TARGET_HOUR_UTC = 1;        // 01:00 UTC ≈ 08:00 Bangkok
let _lastRunDay = '';

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function buildDigest() {
  const now = new Date();
  const day0 = new Date(now); day0.setUTCHours(0, 0, 0, 0);
  const day1 = new Date(day0); day1.setUTCDate(day0.getUTCDate() - 1);
  const day7 = new Date(day0); day7.setUTCDate(day0.getUTCDate() - 7);

  const [devicesYesterday, newYesterday, totalDevices,
         bootsYesterday, clicksYesterday, installViews, installClicks,
         errorsYesterday, boots7d] = await Promise.all([
    Device.countDocuments({ lastSeen: { $gte: day1, $lt: day0 } }),
    Device.countDocuments({ firstSeen: { $gte: day1, $lt: day0 } }),
    Device.countDocuments({}),
    EventLog.countDocuments({ type: 'app_boot',          createdAt: { $gte: day1, $lt: day0 } }),
    EventLog.countDocuments({ type: 'button_click',      createdAt: { $gte: day1, $lt: day0 } }),
    EventLog.countDocuments({ type: 'install_page_view', createdAt: { $gte: day1, $lt: day0 } }),
    EventLog.countDocuments({ type: 'install_click',     createdAt: { $gte: day1, $lt: day0 } }),
    EventLog.countDocuments({ type: 'error',             createdAt: { $gte: day1, $lt: day0 } }),
    EventLog.countDocuments({ type: 'app_boot',          createdAt: { $gte: day7, $lt: day0 } }),
  ]);

  return { day: formatDate(day1), devicesYesterday, newYesterday, totalDevices,
           bootsYesterday, clicksYesterday, installViews, installClicks,
           errorsYesterday, boots7d };
}

function renderDigest(d) {
  const text = [
    `สรุปการใช้งานประจำวัน — ${d.day}`,
    '',
    `ผู้ใช้:`,
    `  · Active เมื่อวาน:   ${d.devicesYesterday}`,
    `  · ใหม่เมื่อวาน:       ${d.newYesterday}`,
    `  · Total devices:     ${d.totalDevices}`,
    '',
    `Events:`,
    `  · เปิดแอป:            ${d.bootsYesterday}`,
    `  · กดปุ่มในแอป:       ${d.clicksYesterday}`,
    `  · เปิดหน้าติดตั้ง:   ${d.installViews}`,
    `  · กดดาวน์โหลด:       ${d.installClicks}`,
    `  · Errors:             ${d.errorsYesterday}`,
    '',
    `Rolling 7d:`,
    `  · App boots:          ${d.boots7d}`,
    '',
    `Conversion เมื่อวาน:`,
    `  · Install page → download:  ${d.installViews ? ((d.installClicks / d.installViews) * 100).toFixed(1) : '—'}%`,
    `  · Download → first button:  ${d.bootsYesterday ? ((d.clicksYesterday / d.bootsYesterday) * 100).toFixed(1) : '—'}%`,
  ].join('\n');

  const html = `<pre style="font-family:'IBM Plex Mono',ui-monospace,Consolas,monospace;font-size:13px;line-height:1.5;color:#1F1B17;background:#FBFAF7;padding:16px;border-radius:10px">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`;
  return { text, html };
}

async function tick() {
  if (!env.SMTP_HOST) return;
  const now = new Date();
  if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
  const today = formatDate(now);
  if (_lastRunDay === today) return;
  _lastRunDay = today;

  try {
    const digest = await buildDigest();
    const { text, html } = renderDigest(digest);
    // Digest goes to FULL admins only. Editors are per-content users
    // and don't need the whole-app metrics dump; they can always
    // eyeball the Analytics tab themselves.
    const admins = await User.find(
      { disabledAt: null, role: 'admin', email: { $exists: true, $ne: '' } },
      { email: 1, displayName: 1 },
    ).lean();
    const recipients = admins.map(a => a.email).filter(Boolean);
    if (!recipients.length) return;
    await sendMail({
      to: recipients.join(','),
      subject: `📊 สรุปประจำวัน ${digest.day}`,
      text, html,
    });
    log.info({ day: digest.day, recipients: recipients.length }, 'daily_digest_sent');
  } catch (e) {
    log.warn({ err: e?.message }, 'daily_digest_failed');
  }
}

let _timer = null;
export function startDailyDigest() {
  if (_timer) return;
  const jitter = Math.floor(Math.random() * 60_000);
  setTimeout(() => {
    tick().catch(() => {});
    _timer = setInterval(() => tick().catch(() => {}), INTERVAL_MS);
  }, jitter);
  log.info('daily_digest_started');
}
export function stopDailyDigest() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
