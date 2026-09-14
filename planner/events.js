// Google Calendar events as the planner sees them. Pure. The planner marks every event it makes
// with private properties George never sees — that it's the planner's, which block, which items,
// the title without its prefixes, where it last put it, its state, whether George has moved it — so
// its memory of each block lives on the event itself.

export const P = {
  mine: 'dash', key: 'dashKey', items: 'dashItems', title: 'dashTitle', at: 'dashAt',
  state: 'dashState', pin: 'dashPin', habit: 'dashHabit',
};

const when = (v) => (v ? new Date(v) : null);

export function normEvent(raw, calendarId) {
  const allDay = !!raw.start?.date && !raw.start?.dateTime;
  const props = { ...(raw.extendedProperties?.private ?? {}) };
  return {
    id: raw.id,
    calendarId,
    title: String(raw.summary ?? ''),
    description: String(raw.description ?? ''),
    start: allDay ? null : when(raw.start?.dateTime),
    end: allDay ? null : when(raw.end?.dateTime),
    allDay,
    free: raw.transparency === 'transparent',
    others: (raw.attendees ?? []).filter((a) => !a.self && !a.resource).length,
    cancelled: raw.status === 'cancelled',
    recurringEventId: raw.recurringEventId ?? null,
    originalStart: when(raw.originalStartTime?.dateTime),
    props,
    mine: props[P.mine] === '1',
    colorId: raw.colorId ?? null,
    useDefault: raw.reminders?.useDefault ?? true,
  };
}

export const atText = (start, end) => `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;

// George has moved it: marked so already, or no longer where the planner last put it.
export function movedByGeorge(ev) {
  if (ev.props[P.pin] === '1') return true;
  const at = ev.props[P.at];
  if (!at || !ev.start || !ev.end) return false;
  const [s, e] = at.split('/');
  return Date.parse(s) !== ev.start.getTime() || Date.parse(e) !== ev.end.getTime();
}

// A Hebrew or Gym session George placed himself: away from where the planner put it, or — if the
// planner never touched it — away from its series' own time.
export function habitPinned(ev) {
  if (ev.props[P.at] || ev.props[P.pin]) return movedByGeorge(ev);
  return !!ev.originalStart && !!ev.start && ev.originalStart.getTime() !== ev.start.getTime();
}

// "dashboard:<id>" lines: Claude writes the id as its tool shows it (the first 8 characters).
export function linkedIds(description) {
  return [...String(description ?? '').matchAll(/dashboard:([\w:.-]+)/g)].map((m) => m[1]);
}

// Google's event colours pair up dark and light. A rough block takes the light partner of the event
// colour nearest its calendar's colour — Graphite when that colour is already a light one.
const PALE = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '5', 7: '1', 8: '8', 9: '1', 10: '2', 11: '4' };

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// The event colour nearest a calendar's colour, by RGB distance; null when there's nothing to compare.
export function nearestColor(calendarHex, eventColors) {
  const c = rgb(calendarHex);
  if (!c) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const [id, hex] of Object.entries(eventColors ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const e = rgb(hex);
    if (!e) continue;
    const d = (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2;
    if (d < bestDistance) { best = id; bestDistance = d; }
  }
  return best;
}

// An event colour's light partner; Graphite when it is already a light one.
export function paleOf(id) {
  const pale = PALE[id] ?? '8';
  return pale === String(id) ? '8' : pale;
}

export function roughColor(calendarHex, eventColors) {
  const best = nearestColor(calendarHex, eventColors);
  return best == null ? '8' : paleOf(best);
}
