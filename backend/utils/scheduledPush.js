// utils/scheduledPush.js — minimal scheduler for PushCampaign docs.
//
// Runs every 60 seconds. Picks up every PushCampaign with status
// 'scheduled' whose sendAt <= now, atomically flips it to 'sending',
// resolves the segment to subscription endpoints via the admin route
// helpers, fans out notifications, then writes outcome + status=sent.
//
// Deliberately simple: single-process (not a distributed job queue),
// so replicas will race. We mitigate with a findOneAndUpdate atomic
// claim so only the worker that wins the race does the send. If two
// replicas race and both try to claim, only one succeeds and the
// other's query returns null.

import { PushCampaign } from '../models/PushCampaign.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { Device } from '../models/Device.js';
import { EventLog } from '../models/EventLog.js';
import { AuditLog } from '../models/AuditLog.js';
import webPush from 'web-push';
import { env } from '../config/env.js';
import { log } from './logger.js';
import { isConfigured as isPushConfigured } from './vapid.js';

// VAPID is set up once at boot by utils/vapid.js — that helper also
// handles the auto-generate + persist fallback when env isn't set.
// web-push keeps the details as module-level state, so importing it
// here uses whatever pair vapid.js wired. No need to re-configure.

const CONCURRENCY = 10;
const TIMEOUT_MS  = 5000;
const INTERVAL_MS = 60_000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('push_timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function resolveSegment(segment) {
  const now = Date.now();
  const match = {};
  if (segment.inactiveDays > 0)  match.lastSeen  = { $lt:  new Date(now - segment.inactiveDays * 86_400_000) };
  if (segment.activeDays > 0)    match.lastSeen  = { ...(match.lastSeen || {}), $gte: new Date(now - segment.activeDays * 86_400_000) };
  if (segment.newWithinDays > 0) match.firstSeen = { $gte: new Date(now - segment.newWithinDays * 86_400_000) };
  if (segment.sourceToken) match.sourceToken = segment.sourceToken;
  if (segment.utmSource)   match.utmSource   = segment.utmSource;
  if (segment.platform)    match.platform    = new RegExp('^' + escapeRe(segment.platform));
  if (segment.locale)      match.locale      = new RegExp('^' + escapeRe(segment.locale));

  let ids;
  if (segment.clickedButton) {
    ids = await EventLog.distinct('deviceId', { type: 'button_click', target: segment.clickedButton });
    if (Object.keys(match).length) {
      ids = await Device.distinct('_id', { _id: { $in: ids }, ...match });
    }
  } else {
    ids = await Device.distinct('_id', match);
  }
  return ids;
}

async function runOne(campaign) {
  const payload = JSON.stringify({
    title: campaign.title,
    body: campaign.body || '',
    // Append ?c=<id> so notificationclick can fire push_click with
    // the campaign ID and the admin can see CTR.
    url: appendParam(campaign.url || '/', 'c', String(campaign._id)),
  });

  const ids = await resolveSegment(campaign.segment || {});
  const directSubs = await PushSubscription.find({ deviceId: { $in: ids } }).limit(5000).lean();
  const covered = new Set(directSubs.map(s => s.deviceId).filter(Boolean));
  const uncovered = ids.filter(id => !covered.has(id));
  let legacySubs = [];
  if (uncovered.length) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const ipHashes = await Device.distinct('ipHash', {
      _id: { $in: uncovered }, lastSeen: { $gte: since }, ipHash: { $ne: '' },
    });
    if (ipHashes.length) {
      legacySubs = await PushSubscription.find({
        ipHash: { $in: ipHashes },
        $or: [{ deviceId: '' }, { deviceId: { $exists: false } }],
      }).limit(5000).lean();
    }
  }
  const subs = [...directSubs, ...legacySubs];

  let sent = 0, failed = 0;
  const stale = [];
  const failReasons = {};
  const sendOne = async (s) => {
    try {
      await withTimeout(
        webPush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 }),
        TIMEOUT_MS,
      );
      sent++;
    } catch (e) {
      failed++;
      const sc = e && e.statusCode;
      failReasons[sc || 'network'] = (failReasons[sc || 'network'] || 0) + 1;
      if (failed <= 3) {
        log.warn({
          campaignId: String(campaign._id),
          statusCode: sc,
          err: e?.message?.slice(0, 200),
          body: (e?.body || '').toString().slice(0, 300),
        }, 'scheduled_push_send_failed_sample');
      }
      if (sc === 404 || sc === 410 || sc === 403) stale.push(s.endpoint);
    }
  };
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    await Promise.all(subs.slice(i, i + CONCURRENCY).map(sendOne));
  }
  if (stale.length) {
    try { await PushSubscription.deleteMany({ endpoint: { $in: stale } }); } catch {}
  }

  await PushCampaign.updateOne(
    { _id: campaign._id },
    { $set: {
        status: 'sent', sentAt: new Date(),
        'stats.targeted': ids.length,
        'stats.sent': sent,
        'stats.failed': failed,
        'stats.pruned': stale.length,
    } },
  );
  try {
    await AuditLog.create({
      action: 'push_campaign_run', target: `campaign:${campaign._id}`,
      outcome: 'success',
      diff: { name: campaign.name, targeted: ids.length, sent, failed, pruned: stale.length },
    });
  } catch {}
}

function appendParam(url, key, value) {
  try {
    if (url.startsWith('/')) {
      const hasQ = url.includes('?');
      return url + (hasQ ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
    }
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch { return url; }
}

// Recovery window: campaigns that have been in 'sending' for longer
// than this are assumed to belong to a crashed worker and get flipped
// back to 'scheduled' so another replica can pick them up. The window
// must be LONGER than any realistic send round — worst-case math is
// 5000 subs × 5 s timeout / 10 concurrency = ~42 min. We set 45 min so
// a legitimately long send round (lots of flaky endpoints that all
// hit the 5 s timeout) doesn't get clobbered mid-flight.
const STUCK_RECOVERY_MS = 45 * 60_000;

async function recoverStuck() {
  const cutoff = new Date(Date.now() - STUCK_RECOVERY_MS);
  try {
    const r = await PushCampaign.updateMany(
      { status: 'sending', updatedAt: { $lt: cutoff } },
      { $set: { status: 'scheduled' } },
    );
    if (r.modifiedCount) log.warn({ count: r.modifiedCount }, 'campaign_stuck_recovered');
  } catch (e) { log.warn({ err: e?.message }, 'campaign_recovery_error'); }
}

async function tick() {
  if (!isPushConfigured()) return;
  // Before claiming new campaigns, recover any that are stuck in
  // 'sending' from a previous crashed worker.
  await recoverStuck();
  const now = new Date();
  // Atomic claim: flip ONE due campaign from 'scheduled' → 'sending'.
  // If multiple replicas run this worker, only the winner gets the doc.
  while (true) {
    const claimed = await PushCampaign.findOneAndUpdate(
      { status: 'scheduled', sendAt: { $lte: now } },
      { $set: { status: 'sending' } },
      { new: true, sort: { sendAt: 1 } },
    );
    if (!claimed) break;
    try { await runOne(claimed); }
    catch (e) {
      log.error({ err: e?.message, id: String(claimed._id) }, 'campaign_send_failed');
      try {
        await PushCampaign.updateOne({ _id: claimed._id }, { $set: { status: 'failed' } });
      } catch {}
    }
  }
}

let _timer = null;
export function startScheduledPushWorker() {
  if (_timer) return;
  // Small random jitter up to 15s so replicas don't all wake simultaneously.
  const jitter = Math.floor(Math.random() * 15_000);
  setTimeout(() => {
    tick().catch(() => {});
    _timer = setInterval(() => tick().catch(() => {}), INTERVAL_MS);
  }, jitter);
  log.info({ intervalMs: INTERVAL_MS, jitter }, 'scheduled_push_worker_started');
}
export function stopScheduledPushWorker() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
