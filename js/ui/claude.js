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
import { checkinsSince, CHECKIN_STATUS } from '../checkins.js';

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
  'Read your check-ins — what you said about each task you ticked or missed — and catch up on everything since you last talked',
  'Set task readiness, dependencies, checklists and success criteria; configure simple follow-up rules',
  'Request or schedule goal reviews that suggest a few next steps for you to accept',
];

// Check-ins: today's so far, and how the planner's asking has gone (planner/checkins.js).
export function checkinLines(doc, today) {
  const recs = checkinsSince(doc, today).filter((r) => r.day === today);
  const answered = recs.filter((r) => r.answeredAt).length;
  const skipped = recs.filter((r) => r.status === 'dismissed').length;
  const status = doc.calendar?.[CHECKIN_STATUS];
  const run = status?.day === today && status.runs ? status : null;
  return [
    recs.length ? `Today: ${recs.length} asked, ${answered} answered${skipped ? `, ${skipped} skipped` : ''}` : 'None asked today yet',
    ...(run ? [`Pings today: ${run.pings ?? 0}`, `Apps Script today: ${Math.round((run.runMs ?? 0) / 60000)} of Google's 90 minutes, over ${run.runs} planner runs`] : []),
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
    section('Time off', lines(timeOff(doc).filter((o) => o.end.slice(0, 10) >= today).map(offText), 'None coming up.')),
    section('Priorities, colours and hours', lines(steering, 'Nothing set.')),
    section('Calendar planner', ...plannerSummary(doc, new Date()).lines.map((l) => h('p', { class: 'note' }, l))),
    section('Gym', lines(gymLines(doc, new Date()), '')),
    section('Check-ins', lines(checkinLines(doc, today), '')),
    followups,
    section('Needs attention', lines(attention(doc, today), 'Nothing right now.')),
    section('What Claude can do', lines(CLAUDE_CAN, '')),
    section('Changes', changesPanel(ctx)));
}
