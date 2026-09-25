// ⚙ → Claude: everything Claude steers, in one place — today's brief and the ones before it, time
// off, priorities, area colours and day hours, the calendar planner, what needs attention, what Claude
// can do, and its changes with Details and Undo. George reads it here and asks Claude to change it.

import { h } from './dom.js';
import { changesPanel } from './changes.js';
import { changeCountLine } from '../changes.js';
import { readPlannerConfig, timeOff, plannerSummary, briefFor, offText, momentLabel } from '../calendar.js';
import { attention } from '../attention.js';
import { shortWeekday, shortDate } from '../dates.js';
import { gymConfig, gymStatusLines, cardioQuotaId, shortLift, kgText } from '../gym.js';
import { guideFor } from '../talk.js';
import { mindConfig, mindStatus, picture } from '../mind.js';

export const CLAUDE_CAN = [
  'Add, change, tick and archive anything on the dashboard — every change is listed below, with Undo',
  'Mark time off, for everything or for some areas: nothing gets booked, and streaks are safe',
  "Write today's brief, and briefs for the days ahead",
  'Make a task, a habit or a whole area a priority: booked first, and starred on your list',
  'Give an area its own colour in your calendar',
  "Set the planner's hours, days and calendars, including different hours on particular days",
  'Put notes on tasks, habits, weekly targets and goals',
  "See what needs attention: tasks with no length, what didn't fit, targets falling behind",
  'Read your Hevy training — lifts, PRs, pace and cardio — and set the Cardio target and lift targets with you',
  "Give the Coach a guide for the week, read your journal, and pick up what the Coach hands over",
  'Set task readiness, dependencies, checklists and success criteria; configure simple follow-up rules',
  'Request or schedule goal reviews that suggest a few next steps for you to accept',
  "Run the Coach's deep reviews: keep a picture of you, speak through the Coach, and propose changes you apply with one tap",
];

// The Coach's mind: whether it's on, when it last reacted and last thought something through, and
// anything that went wrong.
export function mindLines(doc, now) {
  const config = mindConfig(doc);
  const status = mindStatus(doc);
  const when = (iso) => (iso ? momentLabel(iso, now) : 'not yet');
  const pic = picture(doc);
  return [
    config.enabled ? 'On: the background notices, and the Coach speaks first' : 'Off: the planner is watching, but nothing is said until Claude switches it on',
    `Last reacted ${when(status?.lastReflex)} · last reviewed ${when(status?.lastDeep)}`,
    ...(status?.today ? [`Today: ${[[status.today.messages, 'background message'], [status.today.pings, 'ping'], [status.today.gemini, 'Gemini call']]
      .map(([n = 0, what]) => `${n} ${what}${n === 1 ? '' : 's'}`).join(', ')}${status.today.flash != null ? ` (${status.today.flash} of ${config.thinkPerDay} on Flash)` : ''}`] : []),
    ...(status?.note ? [status.note.charAt(0).toUpperCase() + status.note.slice(1)] : []),
    ...(status?.today?.runs ? [`Apps Script today: ${Math.round(status.today.runMs / 60000)} of Google's 90 minutes, over ${status.today.runs} planner runs (the mind's share ${Math.round((status.today.mindMs ?? 0) / 60000)} min)`] : []),
    ...(pic ? [`Claude's picture of you was last written ${when(pic.at)}`] : []),
    ...(status?.lastError ? [`Problem: ${status.lastError}`] : []),
  ];
}

// The Gym section: the connection, then what Claude has set.
export function gymLines(doc, now) {
  const config = gymConfig(doc);
  const quota = cardioQuotaId(doc, config);
  return [
    ...gymStatusLines(doc, (iso) => momentLabel(iso, now)),
    `Key lifts: ${config.keyLifts.map(shortLift).join(', ')}`,
    quota ? `Cardio minutes count towards "${doc.items[quota].title}"` : 'No Cardio target yet — Claude sets one up with you',
    ...Object.entries(config.liftTargets).map(([lift, kg]) => `${shortLift(lift)} target: ${kgText(kg)} kg estimated 1RM`),
  ];
}

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
  const rules = Object.values(doc.rules ?? {}).filter((r) => r.status === 'active');
  const ruleError = h('p', { class: 'error', role: 'alert' });
  const followups = rules.length ? section('Follow-up rules', h('p', { class: 'note' }, 'Ask Claude to change the conditions. Turn a rule off here to pause future actions.'),
    rules.map((rule) => h('label', { class: 'checklist-step' }, h('input', { type: 'checkbox', checked: rule.enabled,
      'aria-label': `Enable rule: ${rule.title}`, onchange: (e) => {
        try {
          const latest = store.doc().rules[rule.id];
          store.saveRule({ ...latest, enabled: e.target.checked });
          ruleError.textContent = '';
        } catch (error) { e.target.checked = !e.target.checked; ruleError.textContent = error.message; }
      } }), rule.title)), ruleError) : null;
  return h('div', { class: 'claude-panel' },
    section("Today's brief",
      h('p', {}, briefFor(doc, today) ?? 'No brief for today yet.'),
      earlier.length
        ? h('details', {}, h('summary', {}, 'Earlier briefs'), lines(earlier.map((b) => `${dayText(b.day)}: ${b.text}`), ''))
        : null),
    section("The Coach's guide this week", h('p', {}, guideFor(doc, today) ?? 'None yet — Claude writes one when you plan your week.')),
    section('Time off', lines(timeOff(doc).filter((o) => o.end.slice(0, 10) >= today).map(offText), 'None coming up.')),
    section('Priorities, colours and hours', lines(steering, 'Nothing set.')),
    section('Calendar planner', ...plannerSummary(doc, new Date()).lines.map((l) => h('p', { class: 'note' }, l))),
    section('Gym', lines(gymLines(doc, new Date()), '')),
    section("The Coach's mind", lines(mindLines(doc, new Date()), '')),
    followups,
    section('Needs attention', lines(attention(doc, today), 'Nothing right now.')),
    section('What Claude can do', lines(CLAUDE_CAN, '')),
    section('Changes', changesPanel(ctx)));
}
