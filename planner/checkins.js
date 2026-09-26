// Check-ins from the planner (docs/superpowers/specs/2026-09-26-checkins-design.md). ask(), before
// data.json is saved: a task whose calendar block ended half an hour ago with it unticked gets its
// question (js/checkins.js), once. ping(), once data.json holds those questions: each new one buzzes
// George's devices — at most PINGS_PER_DAY a day, none in the quiet hours — and a device whose
// subscription has gone is retired. No AI here. Nothing in it can stop the planner.

import { logicalDay } from '../js/dates.js';
import { missedTasks, questionFor, CHECKIN_STATUS } from '../js/checkins.js';
import { pushRequest, makeVapidKeys, gasCrypto, vapidAuthorization, fromB64url } from './webpush.js';
import { bytesToBig } from './p256.js';

export const PINGS_PER_DAY = 4;
export const QUIET_FROM = '22:30';
export const QUIET_UNTIL = '07:00';
export const PUSH_MAX_AGE_HOURS = 3;
export const VAPID_SUBJECT = 'https://george-wightman.github.io/dashboard/';
const HEARTBEAT_MS = 55 * 60000;

const live = (r) => r?.status === 'active';
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function isQuiet(t) {
  const m = t.getHours() * 60 + t.getMinutes();
  return m >= minutes(QUIET_FROM) || m < minutes(QUIET_UNTIL);
}

// The devices that turned notifications on (js/push-client.js writes these).
export function pushSubscriptions(doc) {
  return Object.values(doc?.calendar ?? {}).filter((r) => live(r) && String(r.id).startsWith('push:')
    && typeof r.endpoint === 'string' && typeof r.p256dh === 'string' && typeof r.auth === 'string');
}

export function createCheckins({ UrlFetchApp, Utilities = null, props, log = () => {}, now, dayStartHour = 4, crypto = null }) {
  const tools = crypto ?? (Utilities ? gasCrypto(Utilities) : null);
  const problems = [];
  const note = (text) => { problems.push(text); log(`Check-ins: ${text}`); };

  // The planner's keys for Web Push, made once; the public half is published for the devices.
  function vapid(store) {
    if (!tools) return null;
    let privateKey = props.get('VAPID_PRIVATE');
    let publicKey = props.get('VAPID_PUBLIC');
    if (!privateKey || !publicKey) {
      ({ privateKey, publicKey } = makeVapidKeys(tools.randomBytes));
      props.put('VAPID_PRIVATE', privateKey);
      props.put('VAPID_PUBLIC', publicKey);
    }
    if (store && store.doc().calendar?.['push-config']?.publicKey !== publicKey) store.putCalendar('push-config', { publicKey }, 'planner');
    return { privateKey, publicKey };
  }

  function ask(store) {
    const t = now();
    const today = logicalDay(t, dayStartHour);
    try { vapid(store); } catch (e) { note(`Couldn't make the notification keys: ${e?.message ?? e}`); }
    const asked = [];
    for (const { itemId } of missedTasks(store.doc(), today, t)) {
      try {
        const rec = store.askCheckin({ day: today, itemId, why: 'missed', source: 'planner', onlyNew: true });
        if (rec) asked.push(rec.id);
      } catch (e) { note(`Couldn't ask about ${itemId}: ${e?.message ?? e}`); }
    }
    writeStatus(store, t, today, 0);
    return asked;
  }

  // Today's count of pings, the run time Apps Script has used today, and any problem, for ⚙ → Claude.
  // Written only when something shows a change, or hourly, so a quiet run saves nothing.
  function writeStatus(store, t, today, sent) {
    const prev = store.doc().calendar?.[CHECKIN_STATUS];
    const same = live(prev) && prev.day === today;
    let run = null;
    try { run = JSON.parse(props.get('RUN_MS') ?? 'null'); } catch { /* only a measurement */ }
    const content = {
      day: today, lastRun: t.toISOString(), pings: (same ? prev.pings ?? 0 : 0) + sent,
      runMs: run?.day === today ? run.ms : 0, runs: run?.day === today ? run.n ?? 0 : 0,
      lastError: problems.length ? problems.join('; ').slice(0, 500) : null,
    };
    const due = !same || sent > 0 || prev.lastError !== content.lastError || t.getTime() - Date.parse(prev.lastRun ?? 0) > HEARTBEAT_MS;
    if (due) store.putCalendar(CHECKIN_STATUS, content, 'planner');
    return content.pings;
  }

  // Returns { changed } — true when data.json needs saving again.
  function ping(store) {
    const t = now();
    const today = logicalDay(t, dayStartHour);
    const doc = store.doc();
    const prev = doc.calendar?.[CHECKIN_STATUS];
    let left = PINGS_PER_DAY - (live(prev) && prev.day === today ? prev.pings ?? 0 : 0);
    const pending = Object.values(doc.journal ?? {}).filter((r) => r.kind === 'reflect' && live(r) && r.day === today && r.why === 'missed'
      && !r.answeredAt && !r.pushedAt && t.getTime() - Date.parse(r.askedAt ?? 0) < PUSH_MAX_AGE_HOURS * 3600000)
      .sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
    const subs = pushSubscriptions(doc);
    const keys = tools ? vapid(null) : null;
    let sent = 0;
    const gone = new Set();
    if (pending.length && subs.length && keys && !isQuiet(t)) {
      const auth = new Map();
      const authFor = (endpoint) => {
        const origin = (/^(https:\/\/[^/]+)/.exec(endpoint) ?? [])[1] ?? endpoint;
        if (!auth.has(origin)) {
          auth.set(origin, vapidAuthorization({ ...tools, endpoint, now: t, subject: VAPID_SUBJECT,
            privateKey: bytesToBig(fromB64url(keys.privateKey)), publicKey: fromB64url(keys.publicKey) }));
        }
        return auth.get(origin);
      };
      for (const rec of pending) {
        if (left <= 0) break;
        const devices = subs.filter((s) => !gone.has(s.id));
        if (!devices.length) break;
        const message = { title: 'Check-in', body: questionFor(rec.why, rec.title).slice(0, 140), url: `./?checkin=${encodeURIComponent(rec.id)}`, tag: rec.id };
        let responses;
        try {
          // A body of bytes goes as a Blob: a plain array could be taken for form fields.
          const asBlob = (req) => (Utilities ? { ...req, payload: Utilities.newBlob(req.payload, 'application/octet-stream') } : req);
          responses = UrlFetchApp.fetchAll(devices.map((sub) => asBlob(pushRequest({ ...tools, sub, message, vapid: keys, now: t, subject: VAPID_SUBJECT, authorization: authFor(sub.endpoint) }))));
        } catch (e) {
          note(`Couldn't send a ping: ${e?.message ?? e}`);
          break;
        }
        let ok = false;
        responses.forEach((res, i) => {
          const code = res.getResponseCode();
          if (code >= 200 && code < 300) ok = true;
          else if (code === 404 || code === 410) gone.add(devices[i].id);
          else note(`A ping to the ${devices[i].label ?? 'device'} failed (HTTP ${code})`);
        });
        // Marked even when it failed: a question is pinged once, and it's waiting in the app anyway.
        store.updateJournal(rec.id, { pushedAt: t.toISOString() });
        if (ok) { sent++; left--; }
      }
    }
    for (const id of gone) store.putCalendar(id, { status: 'archived', archivedOn: today }, 'planner');
    const tried = pending.some((r) => store.doc().journal[r.id]?.pushedAt);
    if (tried || gone.size || problems.length) writeStatus(store, t, today, sent);
    return { changed: tried || gone.size > 0 || problems.length > 0, sent };
  }

  return { ask, ping, problems: () => [...problems] };
}
