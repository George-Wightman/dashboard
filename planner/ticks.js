// Ticking from Google Calendar, so George never has to open the dashboard to say he did something
// (2 Nov 2026: opening the app had become a task of its own, and once skipped it stopped altogether).
// Two ways: drag a block to when he did it, once that time is over; or tap the ✓ link in its
// description, which the planner's web app answers (doGet).

import { logicalDay, shortWeekday, shortDate } from '../js/dates.js';
import { P } from './events.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEB_APP = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

// One tick per item and day, with a fixed id: made once, so a tick George takes off in the app
// stays off however often the block is dragged or the link tapped.
export const tickLogId = (itemId, day) => `calendar-done-${itemId}-${day}`;

const tickable = (item) => item && item.status === 'active' && (item.type === 'task' || item.type === 'habit')
  && !item.details?.outcomeForm?.length;

const doneOn = (doc, itemId, day) => Object.values(doc.logs ?? {}).some((l) =>
  l.itemId === itemId && l.kind === 'done' && l.status === 'active' && l.day === day);

function tick(store, item, day, fields) {
  const id = tickLogId(item.id, day);
  if (store.doc().logs?.[id] || doneOn(store.doc(), item.id, day)) return false;
  store.putLog(id, { itemId: item.id, kind: 'done', day, source: 'calendar', ...fields });
  return true;
}

// A planner block George has just dragged (it isn't where the planner last put it) to a time that's
// already over: he's saying when he did it. Each of its items is ticked for the day it landed on, at
// that time. Dragging into the future is still just a move. 2 Nov 2026: he dragged "Maya's
// storybook" back to the afternoon he'd spent on it; the planner called the day missed, deleted the
// block and booked another today, again and again.
export function importDrags(store, events, { now, dayStartHour = 4 }) {
  const nowMs = now.getTime();
  const ticked = [];
  const landed = events.filter((raw) => {
    const p = raw.extendedProperties?.private ?? {};
    if (p[P.mine] !== '1' || raw.status === 'cancelled' || ['done', 'partial'].includes(p[P.state])) return false;
    const start = Date.parse(raw.start?.dateTime ?? '');
    const end = Date.parse(raw.end?.dateTime ?? '');
    const [was, wasEnd] = String(p[P.at] ?? '').split('/').map((s) => Date.parse(s));
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(was)) return false;
    return (start !== was || end !== wasEnd) && end <= nowMs;
  });
  if (!landed.length) return ticked;
  store.transaction(() => {
    for (const raw of landed) {
      const from = new Date(raw.start.dateTime);
      const day = logicalDay(from, dayStartHour);
      for (const id of String(raw.extendedProperties.private[P.items] ?? '').split(',').filter(Boolean)) {
        const item = store.doc().items?.[id];
        if (tickable(item) && tick(store, item, day, { from: from.toISOString(), at: new Date(raw.end.dateTime).toISOString() })) {
          ticked.push({ itemId: id, day });
        }
      }
    }
  }, { summary: 'Ticked from Google Calendar (a block dragged to when it was done)', source: 'calendar' });
  return ticked;
}

// The web app's address, from the phone widgets' record (claude/glance-setup.mjs puts it there) or
// the WEB_APP_URL script property. None: blocks go without the link.
export function webAppUrl(doc, property) {
  const url = [property, doc?.calendar?.widgets?.url].map((u) => String(u ?? '').trim()).find((u) => WEB_APP.test(u));
  return url ?? null;
}

const signature = (hmacHex, itemId, day) => hmacHex(`tick|${itemId}|${day}`).slice(0, 32);

// The ✓ link for one item on one day, signed so only the planner's own links tick anything.
export function tickLink(base, hmacHex, itemId, day) {
  return `${base}?tick=${encodeURIComponent(itemId)}&day=${day}&sig=${signature(hmacHex, itemId, day)}`;
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A tap on a ✓ link: { ok, text }, the text being the page George sees. Never throws.
export function handleTick({ params, store, hmacHex, now }) {
  const itemId = String(params?.tick ?? '');
  const day = String(params?.day ?? '');
  const sig = String(params?.sig ?? '');
  if (!itemId || !DAY.test(day) || !sameText(sig, signature(hmacHex, itemId, day))) {
    return { ok: false, text: "That link isn't one the planner made, so nothing was ticked." };
  }
  const item = store.doc().items?.[itemId];
  const when = `${shortWeekday(day)} ${shortDate(day)}`;
  if (!tickable(item)) return { ok: false, text: "That's no longer on your list, so nothing was ticked." };
  if (doneOn(store.doc(), itemId, day)) return { ok: true, text: `✓ "${item.title}" is already ticked for ${when}.` };
  if (store.doc().logs?.[tickLogId(itemId, day)]) {
    return { ok: false, text: `"${item.title}" was ticked for ${when} and then unticked in the dashboard, so it's been left unticked.` };
  }
  store.transaction(() => tick(store, item, day, { at: now.toISOString() }),
    { summary: `Ticked "${item.title}" from its calendar link`, source: 'calendar' });
  return { ok: true, text: `✓ Ticked "${item.title}" for ${when}. Your calendar catches up within ten minutes.` };
}
