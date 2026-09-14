// ⚙ → Claude: everything Claude steers, in one place — today's brief and the ones before it, time
// off, priorities, area colours and day hours, the calendar planner, what needs attention, what Claude
// can do, and its changes with Details and Undo. George reads it here and asks Claude to change it.

import { h } from './dom.js';
import { changesPanel } from './changes.js';
import { changeCountLine } from '../changes.js';
import { readPlannerConfig, timeOff, plannerSummary, briefFor, offText } from '../calendar.js';
import { attention } from '../attention.js';
import { shortWeekday, shortDate } from '../dates.js';

export const CLAUDE_CAN = [
  'Add, change, tick and archive anything on the dashboard — every change is listed below, with Undo',
  'Mark time off, for everything or for some areas: nothing gets booked, and streaks are safe',
  "Write today's brief, and briefs for the days ahead",
  'Make a task, a habit or a whole area a priority: booked first, and starred on your list',
  'Give an area its own colour in your calendar',
  "Set the planner's hours, days and calendars, including different hours on particular days",
  'Put notes on tasks, habits, weekly targets and goals',
  "See what needs attention: tasks with no length, what didn't fit, targets falling behind",
];

const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
const section = (title, ...body) => h('section', { class: 'claude-part' }, h('h4', {}, title), ...body);
const lines = (list, empty) => (list.length
  ? h('ul', { class: 'claude-lines' }, list.map((l) => h('li', {}, l)))
  : h('p', { class: 'note' }, empty));

export { offText };

// The folded line: Claude's changes this week, and how much needs looking at.
export function claudeSummary(doc, today, now) {
  const n = attention(doc, today).length;
  return `${changeCountLine(doc, now)}${n ? ` · ${n} to look at` : ''}`;
}

export function claudePanel(ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const today = store.today();
  const { config } = readPlannerConfig(doc);
  const earlier = Object.values(doc.journal ?? {})
    .filter((r) => r.kind === 'brief' && r.status === 'active' && r.day < today && r.text)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 14);
  const steering = [
    ...config.priorityAreas.map((a) => `★ ${a} — the whole area`),
    ...Object.values(doc.items ?? {}).filter((i) => i.status === 'active' && i.priority === true).map((i) => `★ ${i.title}`),
    ...Object.entries(config.areaColors).map(([area, colour]) => `${area} blocks are ${colour}`),
    ...Object.entries(config.dayHours).filter(([d]) => d >= today).map(([d, [from, to]]) => `${dayText(d)}: planning ${from}–${to}`),
  ];
  return h('div', { class: 'claude-panel' },
    section("Today's brief",
      h('p', {}, briefFor(doc, today) ?? 'No brief for today yet.'),
      earlier.length
        ? h('details', {}, h('summary', {}, 'Earlier briefs'), lines(earlier.map((b) => `${dayText(b.day)}: ${b.text}`), ''))
        : null),
    section('Time off', lines(timeOff(doc).filter((o) => o.end.slice(0, 10) >= today).map(offText), 'None coming up.')),
    section('Priorities, colours and hours', lines(steering, 'Nothing set.')),
    section('Calendar planner', ...plannerSummary(doc, new Date()).lines.map((l) => h('p', { class: 'note' }, l))),
    section('Needs attention', lines(attention(doc, today), 'Nothing right now.')),
    section('What Claude can do', lines(CLAUDE_CAN, '')),
    section('Changes', changesPanel(ctx)));
}
