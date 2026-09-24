// The widgets' panels: this week's targets, goals, and the last three weeks (and, opened big, every
// week since the start with each day's misses named). js/ui/widgets.js arranges them (with the
// Coach, from js/ui/coach.js) and uses the focus helpers at the end.

import { h } from './dom.js';
import { weekTotal, goalProgress, milestonesOf, goalItems, history, dayDetail, dayScore, countsOn } from '../schedule.js';
import { formatProgress, formatAmount, parseAmount } from '../parse.js';
import { shortDate, shortWeekday, daysBetween, weekStart } from '../dates.js';
import { offLine, excused } from '../calendar.js';
import { dayLines, cardioQuotaId, workouts } from '../gym.js';
import { HEBREW_IDS } from '../hebrewSync.js';
import { SOURCE_NAMES } from './sources.js';
import { renderDigest } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
import { bigSection } from './big.js';
import { proposedItems, proposalLine } from '../coach.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const level = (done, total) => (total === 0 ? 0 : Math.min(4, Math.ceil((done / total) * 4)));

// A progress bar; `met` fills it gold ("you did this") instead of teal.
function bar(pct, label, met = false) {
  return h('div', { class: met ? 'bar met' : 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
    h('span', { style: `width:${pct}%` }));
}

// The weekly targets This week shows: the ones no other widget does, and none in an area on time
// off today (paused, not behind). Cardio shows in Gym and Hebrew's three in Hebrew — unless that
// widget is hidden (or Gym has no workouts yet), when they come back here. `hidden` is the hidden
// widgets' ids.
export function weekTargets(doc, today, hidden = []) {
  const gymShows = !hidden.includes('gym') && workouts(doc).length > 0;
  const hebrewShows = !hidden.includes('hebrew') && doc.goals[HEBREW_IDS.goal]?.status === 'active';
  const cardio = cardioQuotaId(doc);
  return values(doc.items)
    .filter((i) => i.type === 'quota' && i.status === 'active' && countsOn(i, today) && !excused(doc, i, today))
    .filter((i) => !(gymShows && i.id === cardio) && !(hebrewShows && i.goalId === HEBREW_IDS.goal))
    .sort(byOrder);
}

export function renderWeek(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const quotas = weekTargets(doc, today, ctx.layout?.().hidden ?? []);
  if (!quotas.length) return null;
  return h('section', { class: 'panel' },
    h('h2', {}, 'This week'),
    quotas.map((q) => {
      const total = weekTotal(doc, q.id, today);
      const pct = Math.min(100, Math.round((total / q.target) * 100));
      const met = total >= q.target;
      const unit = q.unit === 'count' && q.unitLabel ? ` ${q.unitLabel}` : '';
      return h('div', { class: 'bar-row' },
        h('div', { class: 'bar-label' },
          h('button', { class: 'link bar-title', type: 'button', title: 'Edit this target', onclick: () => ctx.openEditor({ map: 'items', id: q.id }) }, q.title),
          h('span', { class: met ? 'met' : 'muted' }, `${formatProgress(total, q.target, q.unit)}${unit}`)),
        bar(pct, q.title, met));
    }));
}

function amountBox(goal, ctx) {
  const input = h('input', {
    type: 'text', 'aria-label': `Add to ${goal.title}`,
    placeholder: goal.unit === 'minutes' ? 'Log time: 45m, 1.5h' : 'Add an amount',
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const value = parseAmount(input.value, goal.unit);
    if (value == null) { input.classList.add('invalid'); return; }
    ctx.store.logAmount({ goalId: goal.id, amount: value });
  });
  return input;
}

function renderMilestones(goal, ctx) {
  const { store } = ctx;
  return h('ul', {}, milestonesOf(store.doc(), goal.id).map((m) => (m.status === 'suggested'
    ? h('li', { class: 'muted' },
      h('button', { class: 'accept', type: 'button', 'aria-label': `Accept milestone ${m.title}`, onclick: () => store.acceptSuggestion('milestones', m.id) }, '✓'),
      h('button', { class: 'dismiss', type: 'button', 'aria-label': `Dismiss milestone ${m.title}`, onclick: () => store.dismissSuggestion('milestones', m.id) }, '✕'),
      h('span', {}, m.title))
    : h('li', {},
      h('input', { type: 'checkbox', checked: m.done, 'aria-label': m.title, onchange: () => store.toggleMilestone(m.id) }),
      h('span', { style: 'flex:1' }, m.title),
      h('button', { class: 'link', type: 'button', 'aria-label': `Remove milestone ${m.title}`, onclick: () => store.archiveMilestone(m.id) }, '✕')))));
}

function renderGoalBody(goal, progress, ctx) {
  const { store } = ctx;
  const body = h('div', { class: 'goal-body' });
  if (goal.targetDate) body.append(h('div', { class: 'muted' }, `Target: ${shortDate(goal.targetDate)}`));
  if (progress.numeric) {
    const unit = goal.unit === 'count' && goal.unitLabel ? ` ${goal.unitLabel}` : '';
    body.append(h('div', {}, `${formatAmount(progress.done, goal.unit)} of ${formatAmount(progress.total, goal.unit)}${unit}`), amountBox(goal, ctx));
  }
  body.append(renderMilestones(goal, ctx));
  const add = h('input', { type: 'text', placeholder: 'Add a milestone…', 'aria-label': `New milestone for ${goal.title}` });
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && add.value.trim()) store.addMilestone(goal.id, add.value);
  });
  body.append(add);
  const linked = goalItems(store.doc(), goal.id);
  if (linked.length) body.append(h('div', { class: 'muted', style: 'margin-top:.5rem' }, `Linked: ${linked.map((i) => i.title).join(' · ')}`));
  body.append(h('div', { style: 'margin-top:.5rem' },
    h('button', { class: 'link', type: 'button', onclick: () => ctx.openEditor({ map: 'goals', id: goal.id }) }, 'Edit goal')));
  const review = Object.values(store.doc().reviews ?? {}).filter((r) => r.goalId === goal.id && r.status === 'active').sort((a, b) => b.day.localeCompare(a.day))[0];
  const labels = { on_track: 'On track', at_risk: 'Needs attention', insufficient_evidence: 'Not enough evidence yet' };
  if (review) body.append(h('div', { class: 'goal-review' }, h('strong', {}, `Review · ${review.day}`),
    h('p', {}, review.result.state === 'complete' ? `${labels[review.result.direction]}: ${review.result.summary}`
      : review.result.message ?? (review.result.state === 'pending' ? 'Queued for the planner. Its Gemini key must be configured.' : review.result.state))));
  body.append(h('button', { class: 'link', type: 'button', disabled: review?.day === store.today(),
    title: 'Uses the planner’s Gemini API. At most one review per goal per day; suggested tasks wait for your acceptance.',
    onclick: () => store.requestReview(goal.id) }, 'Review progress with AI'));
  return body;
}

// A suggested goal, previewing the plan behind it: why, target date, the proposed milestones, and
// the habits and weekly targets that wait on Today. ✓ takes on the goal and its milestones; ✕
// turns down the goal, its milestones and whatever of its habits and targets is still suggested.
function renderSuggestedGoal(goal, ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const milestones = milestonesOf(doc, goal.id).filter((m) => m.status === 'suggested');
  const proposed = proposedItems(doc, goal.id);
  const preview = !!goal.why || !!goal.targetDate || milestones.length > 0 || proposed.length > 0;
  return h('div', { class: preview ? 'goal suggested plan' : 'goal suggested' },
    h('div', { class: 'goal-head' },
      h('span', {}, goal.title),
      h('span', {},
        h('button', {
          class: 'accept', type: 'button', title: 'Take on this goal and its milestones',
          'aria-label': `Accept goal ${goal.title}`, onclick: () => store.acceptGoalPlan(goal.id),
        }, '✓'),
        ' ',
        h('button', {
          class: 'dismiss', type: 'button', title: 'Not for me',
          'aria-label': `Dismiss goal ${goal.title}`, onclick: () => store.dismissGoalPlan(goal.id),
        }, '✕'))),
    h('div', { class: 'muted', style: 'font-size:.8rem' }, `suggested by ${SOURCE_NAMES[goal.source] ?? goal.source}`),
    goal.why ? h('p', { class: 'why' }, goal.why) : null,
    goal.targetDate ? h('div', { class: 'muted' }, `Target: ${shortDate(goal.targetDate)}`) : null,
    milestones.length ? h('ol', { class: 'proposal' }, milestones.map((m) => h('li', {}, m.title))) : null,
    proposed.length ? h('ul', { class: 'proposal' }, proposed.map((i) => h('li', {}, proposalLine(i)))) : null,
    proposed.length ? h('div', { class: 'muted plan-note' }, 'Habits and targets also wait at the top of Today.') : null);
}

// For a goal measured by a number with a target date still to come: what it takes a day, today
// included, to finish on time — '12 pages a day to finish by Thu 15 Oct'. Null for any other goal,
// and once it's done.
export function goalPace(goal, progress, today) {
  if (!progress.numeric || !goal.targetDate || goal.targetDate < today || progress.done >= progress.total) return null;
  const days = daysBetween(today, goal.targetDate) + 1;
  const left = progress.total - progress.done;
  const by = `${shortWeekday(goal.targetDate)} ${shortDate(goal.targetDate)}`;
  if (goal.unit === 'minutes') return `${formatAmount(Math.ceil(left / days), 'minutes')} a day to finish by ${by}`;
  const label = goal.unitLabel ? ` ${goal.unitLabel}` : '';
  return `${Math.ceil(left / days)}${label} a day to finish by ${by}`;
}

function renderGoal(goal, ctx) {
  const { store, ui } = ctx;
  if (goal.status === 'suggested') return renderSuggestedGoal(goal, ctx);
  const progress = goalProgress(store.doc(), goal);
  const open = ui.expandedGoals.has(goal.id);
  const toggle = () => {
    if (open) ui.expandedGoals.delete(goal.id);
    else ui.expandedGoals.add(goal.id);
    ctx.render();
  };
  // One line: the title, a slim bar and the %; tap it for the rest.
  const card = h('div', { class: open ? 'goal line open' : 'goal line' },
    h('div', {
      class: 'goal-head', role: 'button', tabindex: 0, 'aria-expanded': String(open), onclick: toggle, title: goal.title,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
    }, h('span', { class: 'goal-title' }, goal.title), bar(progress.pct, goal.title), h('span', { class: 'muted pct' }, `${progress.pct}%`)));
  const pace = goalPace(goal, progress, store.today());
  if (pace) card.append(h('div', { class: 'muted goal-pace' }, pace));
  if (open) card.append(renderGoalBody(goal, progress, ctx));
  return card;
}

export function renderGoals(ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  // New goals come from the Coach ("I want to …"), as a suggestion to accept here.
  return h('section', { class: 'panel' },
    h('h2', {}, 'Goals'),
    goals.length ? goals.map((g) => renderGoal(g, ctx)) : h('p', { class: 'muted' }, 'No goals yet. Tell the Coach what you want to achieve.'));
}

function renderDayDetail(ctx, day) {
  const { rows, amounts } = dayDetail(ctx.store.doc(), day);
  const gym = dayLines(ctx.store.doc(), day);
  const box = h('div', { class: 'day-detail' }, h('strong', {}, `${shortWeekday(day)} ${shortDate(day)}`));
  const off = offLine(ctx.store.doc(), day);
  if (off) box.append(h('div', { class: 'muted' }, off));
  if (!rows.length && !amounts.length && !gym.length) {
    box.append(h('div', { class: 'muted' }, 'Nothing was scheduled.'));
    return box;
  }
  box.append(h('ul', {},
    rows.map((r) => h('li', { class: r.done ? null : 'miss' }, `${r.done ? '✓' : '✗'} ${r.item.title}`)),
    amounts.map(({ log, item, goal }) => {
      const target = item ?? goal;
      return h('li', {}, `+ ${formatAmount(log.amount, target?.unit ?? 'count')} ${target?.title ?? ''}`);
    }),
    gym.map((line) => h('li', { class: 'gym' }, `Gym: ${line}`))));
  return box;
}

// The squares, a row a week. With `pick` each day is a button that opens its detail; without (the
// big view, which lists every day anyway) they only say what they are on hover.
function historyGrid(ctx, cells, pick = true) {
  const { ui } = ctx;
  const today = ctx.store.today();
  const toggle = (day) => () => { ui.historyDay = ui.historyDay === day ? null : day; ctx.render(); };
  return h('div', { class: 'grid' },
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', { class: 'dow' }, d)),
    cells.map((c) => {
      if (c.future) return h('span', { class: 'cell future', 'aria-hidden': 'true' });
      const label = c.off
        ? `${shortWeekday(c.day)} ${shortDate(c.day)}: time off — ${c.off}`
        : `${shortWeekday(c.day)} ${shortDate(c.day)}: ${c.done} of ${c.total} done`;
      const cls = [c.off ? 'cell off' : `cell lvl${level(c.done, c.total)}`, c.day === today && 'today', pick && c.day === ui.historyDay && 'selected']
        .filter(Boolean).join(' ');
      return pick
        ? h('button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick: toggle(c.day) })
        : h('span', { class: cls, title: label, role: 'img', 'aria-label': label });
    }));
}

export function renderHistory(ctx) {
  const { store, ui } = ctx;
  const cells = history(store.doc(), store.today());
  const grid = historyGrid(ctx, cells);
  // The squares carry the colour; the counts are on hover, and this week's total is in the heading.
  const week = cells.slice(-7).filter((c) => !c.future && !c.off);
  const done = week.reduce((n, c) => n + c.done, 0);
  const total = week.reduce((n, c) => n + c.total, 0);
  const section = h('section', { class: 'panel history' },
    h('h2', {}, 'Last 3 weeks', total ? h('span', { class: 'muted history-week', title: 'Done so far this week' }, `this week ${done}/${total}`) : null), grid);
  if (ui.historyDay) section.append(renderDayDetail(ctx, ui.historyDay));
  const digest = renderDigest(ctx);
  if (digest) section.append(digest);
  return section;
}

// ---- Last 3 weeks, opened big ----------------------------------------------------------------------

// How many weeks the big view shows: every week since the dashboard's first record (its first
// item, or the first day anything was logged), at least three and at most a year.
export function historyWeeks(doc, today) {
  const days = [
    ...Object.values(doc.items ?? {}).map((i) => i.created),
    ...Object.values(doc.logs ?? {}).filter((l) => l.status === 'active').map((l) => l.day),
  ].filter((d) => typeof d === 'string' && d <= today).sort();
  if (!days.length) return 3;
  const weeks = Math.floor(daysBetween(weekStart(days[0]), today) / 7) + 1;
  return Math.min(52, Math.max(3, weeks));
}

// What a past day left undone, by name, as the day's score counts it (js/schedule.js's dayScore):
// what wasn't ticked, what was deleted after he'd committed to it, and what he pushed to a later
// day — moving work never makes a day a success. A times-a-week habit on a rest day isn't a miss.
export function dayMisses(doc, day) {
  const s = dayScore(doc, day);
  return [
    ...[...s.open, ...s.missed].map((r) => ({ title: r.item.title, how: 'missed' })),
    ...s.dropped.map((r) => ({ title: r.item.title, how: 'deleted' })),
    ...s.pushed.map((r) => ({ title: r.item.title, how: `moved to ${shortWeekday(r.to)}` })),
  ];
}

// Each day so far, newest first: how it went, and what was missed by name. Today is still going,
// so it only says how far it's got.
function dayRows(ctx, cells) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  return h('ul', { class: 'day-list' }, [...cells].reverse().filter((c) => !c.future).map((c) => {
    const when = `${shortWeekday(c.day)} ${shortDate(c.day)}`;
    if (c.off) return h('li', { class: 'day-row' }, h('strong', {}, when), h('span', { class: 'muted' }, `Time off — ${c.off}`));
    const misses = c.day < today ? dayMisses(doc, c.day) : [];
    const score = c.total ? `${c.done} of ${c.total}${c.day === today ? ' so far' : ''}` : 'nothing scheduled';
    return h('li', { class: 'day-row' },
      h('strong', {}, when),
      h('span', { class: c.total && c.done === c.total && !misses.length ? 'met' : 'muted' }, score),
      misses.length ? h('span', { class: 'day-missed' }, misses.map((m) => h('span', { class: 'miss' },
        m.how === 'missed' ? `✗ ${m.title}` : `✗ ${m.title} (${m.how})`))) : null);
  }));
}

export function renderHistoryBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const weeks = historyWeeks(doc, today);
  const cells = history(doc, today, weeks);
  return h('div', { class: 'big history' },
    bigSection(weeks >= 52 ? 'The last year' : `Every week since ${shortDate(cells[0].day)}`, historyGrid(ctx, cells, false)),
    bigSection('Day by day', dayRows(ctx, cells)));
}

// A re-render replaces the whole widget area. A text box marked data-focus gets its focus and
// caret back afterwards (its text comes back from ctx.ui), so typing carries on uninterrupted.
// js/ui/widgets.js's renderSide calls these two around every redraw.
export function keptFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset.focus) return null;
  return { key: el.dataset.focus, start: el.selectionStart, end: el.selectionEnd };
}

export function restoreFocus(root, kept) {
  if (!kept) return;
  const el = [...root.querySelectorAll('[data-focus]')].find((x) => x.dataset.focus === kept.key);
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(kept.start, kept.end);
  } catch {
    // not a text box
  }
}
