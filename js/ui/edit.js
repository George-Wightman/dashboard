// The edit panel: add or edit an item (task, habit, weekly target) or a goal. Archive, never delete.

import { h } from './dom.js';
import { weekday } from '../dates.js';
import { parseLength, formatAmount } from '../parse.js';
import { stableStringify } from '../doc.js';

// Save only the fields changed in this form. A remote update may have reached
// the store while the user was still editing the original snapshot.
export function editedFields(initial, next) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    stableStringify(initial[key]) !== stableStringify(value)));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TYPES = [['task', 'Task — one-off'], ['habit', 'Habit — repeats'], ['quota', 'Weekly target — an amount']];
const REPEATS = [
  ['daily', 'Every day'], ['weekdays', 'On certain days'], ['perWeek', 'A number of times a week'],
  ['weekly', 'Once a week'], ['monthly', 'Once a month'],
];

function defaultRepeat(kind, today) {
  switch (kind) {
    case 'weekdays': return { kind, days: [1, 2, 3, 4, 5] };
    case 'perWeek': return { kind, n: 3 };
    case 'weekly': return { kind, day: weekday(today) };
    case 'monthly': return { kind, date: 1 };
    default: return { kind: 'daily' };
  }
}

function defaultDraft(map, type, today) {
  if (map === 'goals') return { title: '', targetDate: '', target: null, unit: 'count', unitLabel: '', notes: '' };
  return { type, title: '', area: '', goalId: '', date: today, repeat: { kind: 'daily' }, target: '', unit: 'count', unitLabel: '', minutesText: '', time: '', notes: '' };
}

export function openEditor(ctx, { map = 'items', id = null, type = 'task' } = {}) {
  const { store, ui } = ctx;
  ui.closeEditor?.(); // only one editor at a time
  const panel = document.getElementById('editor');
  const today = store.today();
  const existing = id ? store.doc()[map][id] : null;
  const draft = existing ? structuredClone(existing) : defaultDraft(map, type, today);
  draft.repeat ??= { kind: 'daily' };
  draft.minutesText ??= draft.minutes ? formatAmount(draft.minutes, 'minutes') : '';
  draft.time ??= '';
  let measure = map === 'goals' && draft.target > 0 ? 'number' : 'milestones';
  let errorEl = null;

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    panel.hidden = true;
    panel.replaceChildren();
    ui.editorDirty = false;
    document.removeEventListener('keydown', onKey);
    if (ui.closeEditor === close) ui.closeEditor = null;
  }
  const fail = (message) => { errorEl.textContent = message; };

  function set(path, value) {
    ui.editorDirty = true;
    if (path.startsWith('repeat.')) draft.repeat = { ...draft.repeat, [path.slice(7)]: value };
    else if (path === 'targetHours') draft.target = value === '' ? '' : Number(value) * 60;
    else draft[path] = value;
  }

  // Selects that change which fields exist repaint the form; the draft carries everything over.
  function choose(name, value) {
    ui.editorDirty = true;
    if (name === 'type') draft.type = value;
    else if (name === 'repeat.kind') draft.repeat = defaultRepeat(value, today);
    else if (name === 'unit') { draft.unit = value; draft.target = ''; }
    else if (name === 'measure') { measure = value; if (value === 'milestones') draft.target = null; }
    else { set(name, value); return; }
    paint();
  }

  const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);

  function input(name, value, attrs = {}) {
    const el = h('input', { name, value: value ?? '', ...attrs });
    el.addEventListener('input', () => set(name, el.value));
    return el;
  }

  function textarea(name, value, attrs = {}) {
    const el = h('textarea', { name, rows: 3, ...attrs }, value ?? '');
    el.addEventListener('input', () => set(name, el.value));
    return el;
  }

  const notesField = () => field('Notes (optional)', textarea('notes', draft.notes, { maxlength: 1000, placeholder: 'Anything worth knowing — shows under the title and in its calendar block' }));

  function select(name, value, options, attrs = {}) {
    const el = h('select', { name, ...attrs },
      options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, label)));
    el.addEventListener('change', () => choose(name, el.value));
    return el;
  }

  function dayChecks() {
    const days = new Set(draft.repeat.days ?? []);
    return h('div', { class: 'days' }, WEEKDAYS.map((name, i) => h('label', {},
      h('input', {
        type: 'checkbox', checked: days.has(i + 1),
        onchange: (e) => {
          if (e.target.checked) days.add(i + 1); else days.delete(i + 1);
          set('repeat.days', [...days].sort((a, b) => a - b));
        },
      }), name)));
  }

  const lengthField = () => field('Length (optional)', input('minutesText', draft.minutesText, { placeholder: '45m, 2h, 1h30' }));

  function typeFields() {
    if (draft.type === 'task') {
      return [
        field('Date', input('date', draft.date, { type: 'date' })),
        field('Time (optional)', input('time', draft.time, { type: 'time' })),
        lengthField(),
      ];
    }
    if (draft.type === 'habit') {
      const r = draft.repeat;
      const rows = [field('Repeats', select('repeat.kind', r.kind, REPEATS))];
      if (r.kind === 'weekdays') rows.push(field('On', dayChecks()));
      if (r.kind === 'perWeek') rows.push(field('Times a week', input('repeat.n', r.n, { type: 'number', min: 1, max: 7 })));
      if (r.kind === 'weekly') rows.push(field('Day', select('repeat.day', r.day, WEEKDAYS.map((n, i) => [i + 1, n]))));
      if (r.kind === 'monthly') rows.push(field('Day of the month', input('repeat.date', r.date, { type: 'number', min: 1, max: 31 })));
      rows.push(field('Time (optional)', input('time', draft.time, { type: 'time' })));
      rows.push(lengthField());
      return rows;
    }
    const minutes = draft.unit === 'minutes';
    return [
      field('Measured in', select('unit', draft.unit, [['count', 'A count (e.g. applications)'], ['minutes', 'Time']])),
      minutes
        ? field('Target per week (hours)', input('targetHours', draft.target === '' ? '' : draft.target / 60, { type: 'number', min: 0.25, step: 0.25 }))
        : field('Target per week', input('target', draft.target, { type: 'number', min: 1, step: 1 })),
      minutes ? null : field('What you count (optional)', input('unitLabel', draft.unitLabel, { placeholder: 'applications' })),
    ];
  }

  function buttons() {
    return h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
      existing && existing.status !== 'archived'
        ? h('button', { class: 'btn danger', type: 'button', onclick: archive }, 'Archive')
        : null);
  }

  function itemForm() {
    const goals = Object.values(store.doc().goals).filter((g) => g.status === 'active');
    return [
      h('h2', {}, existing ? 'Edit' : 'New'),
      field('Type', select('type', draft.type, TYPES, { disabled: !!existing })),
      field('Title', input('title', draft.title)),
      ...typeFields(),
      field('Area (optional)', input('area', draft.area, { placeholder: 'e.g. Job, Hebrew, Health' })),
      field('Goal (optional)', select('goalId', draft.goalId ?? '', [['', 'None'], ...goals.map((g) => [g.id, g.title])])),
      notesField(),
    ];
  }

  function goalForm() {
    return [
      h('h2', {}, existing ? 'Edit goal' : 'New goal'),
      field('Title', input('title', draft.title)),
      field('Target date (optional)', input('targetDate', draft.targetDate ?? '', { type: 'date' })),
      field('Progress measured by', select('measure', measure, [['milestones', 'Milestones ticked off'], ['number', 'A number (e.g. £ saved, pages read)']])),
      measure === 'number' ? field('Target', input('target', draft.target ?? '', { type: 'number', min: 1 })) : null,
      measure === 'number' ? field('Unit (optional)', input('unitLabel', draft.unitLabel, { placeholder: '£, pages, books' })) : null,
      notesField(),
    ];
  }

  function paint() {
    errorEl = h('div', { class: 'error', role: 'alert' });
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); save(); } },
      map === 'goals' ? goalForm() : itemForm(), errorEl, buttons());
    panel.replaceChildren(form);
  }

  function itemFields(title) {
    const fields = { type: draft.type, title, area: String(draft.area ?? '').trim(), goalId: draft.goalId || null };
    if (draft.type === 'task') {
      if (!draft.date) throw new Error('Pick a date.');
      fields.date = draft.date;
    }
    if (draft.type === 'habit') {
      const r = draft.repeat;
      if (r.kind === 'weekdays') {
        if (!r.days?.length) throw new Error('Pick at least one day.');
        fields.repeat = { kind: 'weekdays', days: [...r.days].sort((a, b) => a - b) };
      } else if (r.kind === 'perWeek') {
        const n = Number(r.n);
        if (!(Number.isInteger(n) && n >= 1 && n <= 7)) throw new Error('Times a week must be a whole number from 1 to 7.');
        fields.repeat = { kind: 'perWeek', n };
      } else if (r.kind === 'weekly') {
        fields.repeat = { kind: 'weekly', day: Number(r.day) };
      } else if (r.kind === 'monthly') {
        const d = Number(r.date);
        if (!(Number.isInteger(d) && d >= 1 && d <= 31)) throw new Error('Day of the month must be 1 to 31.');
        fields.repeat = { kind: 'monthly', date: d };
      } else {
        fields.repeat = { kind: 'daily' };
      }
    }
    if (draft.type === 'quota') {
      const target = Number(draft.target);
      if (!(target > 0)) throw new Error('The weekly target needs to be above 0.');
      fields.target = draft.unit === 'minutes' ? Math.round(target) : target;
      fields.unit = draft.unit;
      fields.unitLabel = draft.unit === 'count' ? String(draft.unitLabel ?? '').trim() : '';
    }
    if (draft.type === 'task' || draft.type === 'habit') {
      const text = String(draft.minutesText ?? '').trim();
      const minutes = text ? parseLength(text) : null;
      if (text && minutes == null) throw new Error('Length: try 45m, 2h or 1h30 (5 minutes to 12 hours).');
      fields.minutes = minutes;
    }
    if (draft.type === 'task' || draft.type === 'habit') fields.time = draft.time || null;
    fields.notes = String(draft.notes ?? '').trim();
    if (fields.notes.length > 1000) throw new Error('Notes can be at most 1000 characters.');
    return fields;
  }

  function goalFields(title) {
    const target = measure === 'number' ? Number(draft.target) : null;
    if (measure === 'number' && !(target > 0)) throw new Error('The target needs to be a number above 0.');
    const notes = String(draft.notes ?? '').trim();
    if (notes.length > 1000) throw new Error('Notes can be at most 1000 characters.');
    return {
      title, targetDate: draft.targetDate || null, target, unit: 'count',
      unitLabel: measure === 'number' ? String(draft.unitLabel ?? '').trim() : '', notes,
    };
  }

  function save() {
    const title = String(draft.title ?? '').trim();
    if (!title) return fail('Give it a title.');
    try {
      if (map === 'goals') {
        const fields = goalFields(title);
        if (existing) store.updateGoal(existing.id, editedFields(initialFields, fields)); else store.addGoal(fields);
      } else {
        const fields = itemFields(title);
        if (existing) store.updateItem(existing.id, editedFields(initialFields, fields)); else store.addItem(fields);
      }
    } catch (e) {
      return fail(e.message);
    }
    close();
  }

  function archive() {
    if (map === 'goals') store.archiveGoal(existing.id); else store.archiveItem(existing.id);
    close();
  }

  const initialFields = existing ? (map === 'goals' ? goalFields(existing.title) : itemFields(existing.title)) : null;
  ui.editorDirty = false;
  document.addEventListener('keydown', onKey);
  ui.closeEditor = close;
  paint();
  panel.hidden = false;
  panel.querySelector('input[name=title]')?.focus();
}
