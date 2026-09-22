// Import edits to known task events before planning outbound changes. The last
// exported input is a three-way merge baseline, not an assumption that Calendar wins.
import { taskInput, localDate, readPinMarker } from '../js/plan-state.js';
import { clockLabel } from '../js/calendar.js';
import { shortWeekday, shortDate } from '../js/dates.js';
import { P } from './events.js';

export function reconcileCalendar(store, events, removed = []) {
  const conflicts = [];
  store.transaction(() => {
    for (const raw of [...events, ...removed]) {
      const props = raw.extendedProperties?.private ?? {};
      if (props[P.mine] !== '1') continue;
      const ids = String(props[P.items] ?? '').split(',').filter(Boolean);
      if (!ids.length || ['done', 'partial'].includes(props[P.state])) continue;
      for (const id of ids) {
        const item = store.doc().items[id];
        if (item?.type !== 'task' || item.status !== 'active') continue;
        if (store.doc().calendar['conflict:' + id]?.resolution === 'dashboard') continue;
        let baseline;
        try { baseline = JSON.parse(props[P.input] || 'null'); } catch { baseline = null; }
        const changes = {};
        // Deleting a task's block removes the task (docs/superpowers/specs/2026-09-22-calendar-one-to-one-design.md),
        // with a note so Claude and George can see why it went. One part of a long task says nothing
        // clear about the rest, so that only unschedules it.
        const onePart = Number(props[P.parts] ?? 1) <= 1 && !/ \(\d+ of \d+\)$/.test(String(props[P.title] ?? ''));
        if (raw.status === 'cancelled' && ids.length === 1 && onePart) {
          const [from] = String(props[P.at] ?? '').split('/');
          const when = Date.parse(from) ? ` (${shortWeekday(localDate(from))} ${shortDate(localDate(from))}, ${clockLabel(from)})` : '';
          store.archiveItem(id);
          store.addFlag(`Removed "${item.title}" from your list: its calendar block${when} was deleted. Undo it in ⚙ → changes if that was a mistake.`, null, 'calendar', 'note');
          if (store.doc().calendar[`conflict:${id}`]?.open) store.putCalendar(`conflict:${id}`, { open: false });
          continue;
        }
        if (raw.status === 'cancelled') changes.scheduleHold = true;
        else if (ids.length === 1 && baseline) {
          if (raw.summary !== props[P.summary]) {
            const read = readPinMarker(raw.summary);
            changes.title = read.title;
            // Only when it changes, so an ordinary rename doesn't log a pin it never had.
            if (read.pinned || item.pinned) changes.pinned = read.pinned;
            // Taking the pin off hands the block back to the planner.
            if (item.pinned && !read.pinned) changes.time = null;
          }
          const [oldStart, oldEnd] = String(props[P.at] ?? '').split('/');
          const moved = Date.parse(oldStart) !== Date.parse(raw.start?.dateTime) || Date.parse(oldEnd) !== Date.parse(raw.end?.dateTime);
          // A pin is only worth anything against a concrete slot, so STAY takes the one it is
          // sitting in — the same fields a drag would have set, without the drag.
          if ((moved || changes.pinned) && Number(props[P.parts] ?? 1) <= 1) {
            if (raw.start?.dateTime && raw.end?.dateTime) {
              changes.date = localDate(raw.start.dateTime);
              changes.time = clockLabel(raw.start.dateTime);
              changes.minutes = Math.round((Date.parse(raw.end.dateTime) - Date.parse(raw.start.dateTime)) / 60000);
              changes.scheduleHold = false;
            } else changes.time = 'invalid';
          }
        }
        if (!Object.keys(changes).length) continue;
        const current = taskInput(item);
        const collided = baseline && Object.keys(changes).filter((k) => {
          const field = k === 'scheduleHold' ? 'hold' : k;
          return current[field] !== baseline[field] && item[k] !== changes[k];
        });
        const invalid = ('title' in changes && (!changes.title || changes.title.length > 200))
          || (changes.minutes != null && (changes.minutes < 5 || changes.minutes > 720)) || changes.time === 'invalid';
        if (invalid || collided?.length) {
          store.putCalendar(`conflict:${id}`, { open: true, itemId: id, changes,
            eventId: raw.id, calendarId: raw.calendarId, fields: collided || [], calendarValid: !invalid,
            reason: invalid ? 'Calendar edit is not a valid timed task' : 'Both Calendar and Dashboard changed this task' });
          conflicts.push(id);
          continue;
        }
        const effective = Object.fromEntries(Object.entries(changes).filter(([k, v]) => (k === 'scheduleHold' ? item[k] === true : item[k] ?? null) !== v));
        if (Object.keys(effective).length) store.updateItem(id, effective);
        if (store.doc().calendar[`conflict:${id}`]?.open) store.putCalendar(`conflict:${id}`, { open: false });
      }
    }
  }, { summary: 'Imported task edits from Google Calendar', source: 'calendar' });
  return conflicts;
}
