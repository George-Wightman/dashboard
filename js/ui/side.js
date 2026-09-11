// The right-hand column: this week's quotas, goals, and the last three weeks.

import { h } from './dom.js';
import { weekTotal, goalProgress, milestonesOf, goalItems, history, dayDetail } from '../schedule.js';
import { formatProgress, formatAmount, parseAmount } from '../parse.js';
import { shortDate, shortWeekday } from '../dates.js';
import { SOURCE_NAMES } from './today.js';
import { renderCoach } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const level = (done, total) => (total === 0 ? 0 : Math.min(4, Math.ceil((done / total) * 4)));

function bar(pct, label) {
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
    h('span', { style: `width:${pct}%` }));
}

function renderWeek(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const quotas = values(doc.items).filter((i) => i.type === 'quota' && i.status === 'active').sort(byOrder);
  if (!quotas.length) return null;
  return h('section', { class: 'panel' },
    h('h2', {}, 'This week'),
    quotas.map((q) => {
      const total = weekTotal(doc, q.id, today);
      const pct = Math.min(100, Math.round((total / q.target) * 100));
      return h('div', { class: 'bar-row' },
        h('div', { class: 'bar-label' }, h('span', {}, q.title), h('span', { class: 'muted' }, formatProgress(total, q.target, q.unit))),
        bar(pct, q.title));
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
  return body;
}

function renderGoal(goal, ctx) {
  const { store, ui } = ctx;
  if (goal.status === 'suggested') {
    return h('div', { class: 'goal suggested' },
      h('div', { class: 'goal-head' },
        h('span', {}, goal.title),
        h('span', {},
          h('button', { class: 'accept', type: 'button', 'aria-label': `Accept goal ${goal.title}`, onclick: () => store.acceptSuggestion('goals', goal.id) }, '✓'),
          ' ',
          h('button', { class: 'dismiss', type: 'button', 'aria-label': `Dismiss goal ${goal.title}`, onclick: () => store.dismissSuggestion('goals', goal.id) }, '✕'))),
      h('div', { class: 'muted', style: 'font-size:.8rem' }, `suggested by ${SOURCE_NAMES[goal.source] ?? goal.source}`));
  }
  const progress = goalProgress(store.doc(), goal);
  const open = ui.expandedGoals.has(goal.id);
  const toggle = () => {
    if (open) ui.expandedGoals.delete(goal.id);
    else ui.expandedGoals.add(goal.id);
    ctx.render();
  };
  const card = h('div', { class: 'goal' },
    h('div', {
      class: 'goal-head', role: 'button', tabindex: 0, 'aria-expanded': String(open), onclick: toggle,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
    }, h('span', {}, goal.title), h('span', { class: 'muted' }, `${progress.pct}%`)),
    bar(progress.pct, goal.title));
  if (open) card.append(renderGoalBody(goal, progress, ctx));
  return card;
}

function renderGoals(ctx) {
  const doc = ctx.store.doc();
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  return h('section', { class: 'panel' },
    h('h2', {}, 'Goals', h('button', { class: 'link', type: 'button', onclick: () => ctx.openEditor({ map: 'goals' }) }, '+ goal')),
    goals.length ? goals.map((g) => renderGoal(g, ctx)) : h('p', { class: 'muted' }, 'No goals yet.'));
}

function renderDayDetail(ctx, day) {
  const { rows, amounts } = dayDetail(ctx.store.doc(), day);
  const box = h('div', { class: 'day-detail' }, h('strong', {}, `${shortWeekday(day)} ${shortDate(day)}`));
  if (!rows.length && !amounts.length) {
    box.append(h('div', { class: 'muted' }, 'Nothing was scheduled.'));
    return box;
  }
  box.append(h('ul', {},
    rows.map((r) => h('li', { class: r.done ? null : 'miss' }, `${r.done ? '✓' : '✗'} ${r.item.title}`)),
    amounts.map(({ log, item, goal }) => {
      const target = item ?? goal;
      return h('li', {}, `+ ${formatAmount(log.amount, target?.unit ?? 'count')} ${target?.title ?? ''}`);
    })));
  return box;
}

function renderHistory(ctx) {
  const { store, ui } = ctx;
  const today = store.today();
  const cells = history(store.doc(), today);
  const grid = h('div', { class: 'grid' },
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', { class: 'dow' }, d)),
    cells.map((c) => {
      if (c.future) return h('span', { class: 'cell future', 'aria-hidden': 'true' });
      const cls = ['cell', `lvl${level(c.done, c.total)}`, c.day === today && 'today', c.day === ui.historyDay && 'selected']
        .filter(Boolean).join(' ');
      const label = `${shortWeekday(c.day)} ${shortDate(c.day)}: ${c.done} of ${c.total} done`;
      return h('button', {
        class: cls, type: 'button', title: label, 'aria-label': label,
        onclick: () => { ui.historyDay = ui.historyDay === c.day ? null : c.day; ctx.render(); },
      }, c.total ? `${c.done}/${c.total}` : '');
    }));
  const section = h('section', { class: 'panel' }, h('h2', {}, 'Last 3 weeks'), grid);
  if (ui.historyDay) section.append(renderDayDetail(ctx, ui.historyDay));
  return section;
}

// A re-render replaces the whole column. A text box marked data-focus gets its focus and caret
// back afterwards (its text comes back from ctx.ui), so typing carries on uninterrupted.
function keptFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset.focus) return null;
  return { key: el.dataset.focus, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(root, kept) {
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

export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  side.replaceChildren(
    ...[renderCoach(ctx), renderWeek(ctx), renderGoals(ctx), renderHistory(ctx)].filter(Boolean));
  restoreFocus(side, kept);
}
