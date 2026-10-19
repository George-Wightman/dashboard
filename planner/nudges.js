// Nudges from the planner (js/nudges.js has the rules): each due one is pushed to George's devices
// once, at most NUDGES_PER_DAY a day, none in the quiet hours. What was sent is kept in the script's
// properties, so nothing is written to the dashboard but a retired device. Nothing here can stop
// the planner.

import { logicalDay } from '../js/dates.js';
import { dueNudges, NUDGES_PER_DAY } from '../js/nudges.js';
import { pushSubscriptions, isQuiet, makePusher } from './checkins.js';
import { gasCrypto } from './webpush.js';

export function createNudges({ UrlFetchApp, Utilities = null, props, log = () => {}, now, dayStartHour = 4, crypto = null }) {
  const tools = crypto ?? (Utilities ? gasCrypto(Utilities) : null);

  // Returns { changed, sent }: changed when a device was retired (data.json needs saving).
  function send(store) {
    const t = now();
    const today = logicalDay(t, dayStartHour);
    let state = null;
    try { state = JSON.parse(props.get('NUDGES') ?? 'null'); } catch { /* start the day afresh */ }
    if (state?.day !== today || !Array.isArray(state.sent)) state = { day: today, sent: [] };
    const privateKey = props.get('VAPID_PRIVATE');
    const publicKey = props.get('VAPID_PUBLIC');
    const subs = pushSubscriptions(store.doc());
    if (isQuiet(t) || !tools || !privateKey || !publicKey || !subs.length) return { changed: false, sent: 0 };
    const due = dueNudges(store.doc(), t, dayStartHour).filter((n) => !state.sent.includes(n.id))
      .slice(0, Math.max(0, NUDGES_PER_DAY - state.sent.length));
    if (!due.length) return { changed: false, sent: 0 };
    const push = makePusher({ UrlFetchApp, Utilities, tools, keys: { privateKey, publicKey }, t });
    const gone = new Set();
    let sent = 0;
    for (const n of due) {
      const devices = subs.filter((s) => !gone.has(s.id));
      if (!devices.length) break;
      try {
        const r = push(devices, { title: n.title, body: n.body.slice(0, 140), url: n.url, tag: n.id });
        r.gone.forEach((id) => gone.add(id));
        r.failed.forEach((f) => log(`Nudges: ${f}`));
        if (r.ok) sent++;
      } catch (e) {
        log(`Nudges: couldn't send (${e?.message ?? e})`);
        break;
      }
      // Kept as sent even when it failed: a nudge is tried once.
      state.sent.push(n.id);
    }
    props.put('NUDGES', JSON.stringify(state));
    for (const id of gone) store.putCalendar(id, { status: 'archived', archivedOn: today }, 'planner');
    return { changed: gone.size > 0, sent };
  }

  return { send };
}
