import { h } from './dom.js';
import { matchesRule } from '../workflow.js';

export function openOutcome(ctx, sourceId, complete = false) {
  const { store, ui } = ctx;
  ui.closeEditor?.();
  const record = store.doc().items[sourceId] ?? store.doc().goals[sourceId];
  const questions = record?.details?.outcomeForm ?? [];
  if (!questions.length) return;
  const panel = document.getElementById('editor');
  const answers = {};
  const reportId = crypto.randomUUID();
  const error = h('p', { class: 'error', role: 'alert' });
  const effects = h('p', { class: 'note', 'aria-live': 'polite' });
  function close() {
    panel.hidden = true; panel.replaceChildren(); ui.editorDirty = false;
    document.removeEventListener('keydown', escape);
    if (ui.closeEditor === close) ui.closeEditor = null;
    ctx.render();
  }
  function escape(e) { if (e.key === 'Escape') close(); }
  const describe = { task: 'create a follow-up task', reschedule: 'reschedule a task', log: 'log an amount', flag: 'add an attention note', review: 'request a goal review' };
  function preview() {
    const actions = Object.values(store.doc().rules ?? {}).filter((r) => r.status === 'active' && r.enabled
      && matchesRule(r.definition, { sourceId, answers })).flatMap((r) => r.definition.actions.map((a) => describe[a.type]));
    effects.textContent = actions.length ? `On the next planner check: ${actions.join('; ')}.` : 'Saved as evidence for this item and its goal. No follow-up currently matches.';
  }
  const controls = questions.map((q) => {
    const choices = q.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (q.choices ?? []).map((v) => [v, v]);
    const input = ['choice', 'boolean'].includes(q.type)
      ? h('select', { required: q.required, 'aria-label': q.label }, h('option', { value: '' }, 'Choose…'), choices.map(([value, label]) => h('option', { value }, label)))
      : h(q.type === 'text' ? 'textarea' : 'input', { type: q.type === 'number' ? 'number' : null, required: q.required, 'aria-label': q.label,
        min: q.min, max: q.max, step: q.type === 'number' ? 'any' : null, maxlength: 2000 });
    const change = () => {
      if (input.value === '') delete answers[q.key];
      else answers[q.key] = q.type === 'number' ? Number(input.value) : q.type === 'boolean' ? input.value === 'true' : input.value;
      preview();
    };
    input.addEventListener('input', change); input.addEventListener('change', change);
    return h('label', { class: 'field' }, h('span', {}, q.label), input);
  });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, complete ? 'Save outcome and complete' : 'Save outcome');
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault(); submit.disabled = true;
    try { store.reportOutcome({ sourceId, answers, complete, id: reportId }); close(); }
    catch (e) { error.textContent = e.message; submit.disabled = false; }
  } }, h('h2', {}, record.title), h('p', { class: 'note' }, 'Record what actually happened. Leave optional answers blank if you do not know.'),
  controls, effects, error, h('div', { class: 'buttons' }, submit, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')));
  ui.editorDirty = true; ui.closeEditor = close;
  document.addEventListener('keydown', escape);
  panel.replaceChildren(form); panel.hidden = false; preview();
  panel.querySelector('input, select, textarea')?.focus();
}
