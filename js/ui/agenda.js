import { h } from './dom.js';
import { scheduleView, localDate } from '../plan-state.js';
import { clockLabel } from '../calendar.js';
import { shortWeekday, addDays } from '../dates.js';
import { openOutcome } from './outcome.js';
import { tickAndAsk } from './checkin.js';

export function resolveConflict(ctx, itemId, choice) {
  const conflict = ctx.store.doc().calendar[`conflict:${itemId}`];
  if (!conflict?.open) return;
  if (choice === 'calendar' && conflict.calendarValid === false) throw new Error('This Calendar edit is not a valid timed task. Use the Dashboard edit or correct the event in Calendar.');
  ctx.store.transaction(() => {
    if (choice === 'calendar') ctx.store.updateItem(itemId, conflict.changes);
    ctx.store.putCalendar(`conflict:${itemId}`, { open: false, resolution: choice });
  }, { summary: `Resolved calendar conflict for ${ctx.store.doc().items[itemId].title}: use ${choice}`, source: 'me' });
}

// Upcoming: only what needs George. Calendar already shows what's booked, so this is the next
// booking on one line, then the tasks that need a decision — a Calendar/Dashboard conflict, one
// taken out of Calendar, a later one still without a slot — five at a time. Today's own tasks
// are already on Today's list, so an unbooked one only shows here if it's for a later day.
const NEEDS_SHOWN = 5;
const needsYou = (e, today, end) => e.state === 'conflict' || e.item.scheduleHold
  || (e.state === 'unscheduled' && e.day > today && e.day < end);

function whenLabel(day, today, start) {
  const clock = start ? clockLabel(start) : '';
  if (day === today) return clock || 'Today';
  return `${shortWeekday(day)}${clock ? ` ${clock}` : ''}`;
}

export function renderAgenda(ctx) {
  const today = ctx.store.today();
  const plan = scheduleView(ctx.store.doc(), today);
  const now = ctx.now?.() ?? new Date();
  const horizon = addDays(today, 14);
  const upcoming = [
    ...plan.entries.filter((e) => e.state === 'scheduled' && !e.bookings[0].allDay).map((e) => ({ title: e.item.title, id: e.item.id, start: e.bookings[0].start })),
    ...plan.commitments.filter((b) => !b.allDay).map((b) => ({ title: b.title, id: null, start: b.start })),
  ].filter((x) => new Date(x.start) > now).sort((a, b) => a.start.localeCompare(b.start));
  const next = upcoming[0];
  const needs = plan.entries.filter((e) => needsYou(e, today, horizon));
  if (!next && !needs.length && !ctx.ui.agendaError) return null;
  const shown = ctx.ui.agendaExpanded ? needs : needs.slice(0, NEEDS_SHOWN);
  const titleEl = (title, id) => (id
    ? h('button', { type: 'button', class: 'link agenda-title', onclick: () => openTaskCard(ctx, id) }, title)
    : h('span', { class: 'agenda-title' }, title));
  // No "synced" time of its own: the header's is the one to read, and the header warns when the
  // planner stops. Only a planner that has never run says so here.
  return h('section', { class: 'panel agenda' },
    h('h2', {}, 'Upcoming', plan.lastSynced ? null : h('span', { class: 'muted agenda-sync' }, 'planner not synced')),
    ctx.ui.agendaError ? h('p', { class: 'error', role: 'status' }, ctx.ui.agendaError) : null,
    next ? h('div', { class: 'agenda-next' }, h('span', { class: 'agenda-when' }, `Next · ${whenLabel(localDate(next.start), today, next.start)}`), titleEl(next.title, next.id)) : null,
    shown.map((e) => h('div', { class: 'agenda-entry', 'data-task': e.item.id },
      h('div', { class: 'agenda-line' }, titleEl(e.item.title, e.item.id), h('span', { class: 'agenda-when' }, whenLabel(e.day, today, e.bookings[0]?.start))),
      h('p', { class: 'muted' }, e.reason),
      e.state === 'conflict' ? h('div', { class: 'buttons' }, ...(ctx.store.doc().calendar['conflict:' + e.item.id]?.calendarValid === false ? ['dashboard'] : ['calendar', 'dashboard']).map((choice) => h('button', {
        type: 'button', class: 'link', onclick: () => {
          try { resolveConflict(ctx, e.item.id, choice); ctx.ui.agendaError = ''; }
          catch (error) { ctx.ui.agendaError = error.message; }
          ctx.render();
        },
      }, `Use ${choice === 'calendar' ? 'Calendar' : 'Dashboard'} edit`))) : null)),
    needs.length > NEEDS_SHOWN ? h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.agendaExpanded = !ctx.ui.agendaExpanded; ctx.render(); } },
      ctx.ui.agendaExpanded ? 'Show fewer' : `${needs.length - NEEDS_SHOWN} more need you`) : null);
}

// A link from Calendar opens a task; opening a URL never marks it complete.
export function openTaskCard(ctx, id) {
  const item = ctx.store.doc().items[id];
  if (!item) return false;
  document.getElementById('task-card')?.remove();
  const dlg = h('dialog', { id: 'task-card' });
  const content = () => {
    const current = ctx.store.doc().items[id];
    const done = Object.values(ctx.store.doc().logs).some((l) => l.itemId === id && l.kind === 'done' && l.status === 'active');
    const e = scheduleView(ctx.store.doc(), ctx.store.today()).entries.find((r) => r.item.id === id);
    dlg.replaceChildren(h('div', { class: 'sheet-body' }, h('h2', {}, current.title),
      h('p', {}, done ? 'Completed' : e?.bookings[0] ? `${e.scheduledDay} · ${clockLabel(e.bookings[0].start)}–${clockLabel(e.bookings[0].end)}` : `Requested ${current.date} · unscheduled`),
      current.notes ? h('p', {}, current.notes) : null,
      h('div', { class: 'buttons' },
        !done && current.status === 'active' ? h('button', { type: 'button', class: 'btn primary', onclick: () => {
          if (current.details?.outcomeForm?.length) { dlg.close(); openOutcome(ctx, id, true); return; }
          try { tickAndAsk(ctx, id); content(); }
          catch (error) { dlg.append(h('p', { class: 'error' }, error.message)); }
        } }, 'Mark complete') : null,
        h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); ctx.openEditor({ map: 'items', id }); } }, 'Edit task'),
        h('button', { type: 'button', class: 'link', onclick: () => dlg.close() }, 'Close'))));
  };
  content(); document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal();
  return true;
}
