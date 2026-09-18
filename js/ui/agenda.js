import { h } from './dom.js';
import { scheduleView, localDate } from '../plan-state.js';
import { clockLabel, momentLabel } from '../calendar.js';
import { shortWeekday, shortDate } from '../dates.js';
import { openOutcome } from './outcome.js';

export function resolveConflict(ctx, itemId, choice) {
  const conflict = ctx.store.doc().calendar[`conflict:${itemId}`];
  if (!conflict?.open) return;
  if (choice === 'calendar' && conflict.calendarValid === false) throw new Error('This Calendar edit is not a valid timed task. Use the Dashboard edit or correct the event in Calendar.');
  ctx.store.transaction(() => {
    if (choice === 'calendar') ctx.store.updateItem(itemId, conflict.changes);
    ctx.store.putCalendar(`conflict:${itemId}`, { open: false, resolution: choice });
  }, { summary: `Resolved calendar conflict for ${ctx.store.doc().items[itemId].title}: use ${choice}`, source: 'me' });
}

export function renderAgenda(ctx) {
  const today = ctx.store.today();
  const plan = scheduleView(ctx.store.doc(), today);
  const now = ctx.now?.() ?? new Date();
  let lastDay = '';
  const entries = [...plan.entries, ...plan.commitments.filter((b) => localDate(b.start) >= today).map((b, i) => ({
    item: { id: 'commitment-' + i, title: b.title }, day: localDate(b.start), bookings: [b], state: 'commitment', reason: '',
  }))].sort((a, b) => a.day.localeCompare(b.day) || (a.bookings[0]?.start ?? 'z').localeCompare(b.bookings[0]?.start ?? 'z'));
  const rows = entries.slice(0, ctx.ui.agendaExpanded ? undefined : 18).map((e) => {
    const heading = e.day === lastDay ? null : h('h3', {}, `${shortWeekday(e.day)} ${shortDate(e.day)}`);
    lastDay = e.day;
    const b = e.bookings[0];
    return h('div', { class: 'agenda-entry', 'data-task': e.item.id }, heading,
      e.state === 'commitment' ? h('span', { class: 'agenda-title' }, e.item.title) : h('button', { type: 'button', class: 'link agenda-title', onclick: () => openTaskCard(ctx, e.item.id) }, e.item.title),
      h('p', { class: 'muted' }, b ? `${b.allDay ? 'All day' : `${clockLabel(b.start)}–${clockLabel(b.end)}`} · ${b.calendar || 'Calendar'}${e.bookings.length > 1 ? ` · ${e.bookings.length} sessions` : ''}` : 'Unscheduled'),
      e.reason ? h('p', { class: 'muted' }, e.reason) : null,
      e.state === 'conflict' ? h('div', { class: 'buttons' }, ...(ctx.store.doc().calendar['conflict:' + e.item.id]?.calendarValid === false ? ['dashboard'] : ['calendar', 'dashboard']).map((choice) => h('button', {
        type: 'button', class: 'link', onclick: () => {
          try { resolveConflict(ctx, e.item.id, choice); ctx.ui.agendaError = ''; }
          catch (error) { ctx.ui.agendaError = error.message; }
          ctx.render();
        },
      }, `Use ${choice === 'calendar' ? 'Calendar' : 'Dashboard'} edit`))) : null);
  });
  return h('section', { class: 'panel agenda' }, h('h2', {}, 'Upcoming'),
    h('p', { class: 'muted' }, plan.lastSynced ? `Calendar confirmed ${momentLabel(plan.lastSynced, now)}` : 'Waiting for the calendar planner'),
    ctx.ui.agendaError ? h('p', { class: 'error', role: 'status' }, ctx.ui.agendaError) : null,
    rows.length ? rows : h('p', { class: 'muted' }, 'No upcoming tasks.'),
    entries.length > 18 ? h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.agendaExpanded = !ctx.ui.agendaExpanded; ctx.render(); } },
      ctx.ui.agendaExpanded ? 'Show fewer' : `Show all ${entries.length} entries`) : null);
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
          try { ctx.store.toggleDone(id, ctx.store.today()); content(); }
          catch (error) { dlg.append(h('p', { class: 'error' }, error.message)); }
        } }, 'Mark complete') : null,
        h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); ctx.openEditor({ map: 'items', id }); } }, 'Edit task'),
        h('button', { type: 'button', class: 'link', onclick: () => dlg.close() }, 'Close'))));
  };
  content(); document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal();
  return true;
}
