// Declarative controls only: no expressions, scripts, arbitrary URLs or AI calls
// in rules. The browser collects facts; the single planner runner applies rules.
import { addDays } from './dates.js';

export const WORKFLOW_MAPS = ['rules', 'outcomes', 'workflowRuns', 'reviews'];
export const DETAIL_FIELDS = ['tags', 'context', 'location', 'energy', 'successCriteria', 'notBefore', 'deadline', 'dependsOn', 'checklist', 'requireChecklist', 'outcomeForm', 'custom', 'reviewEveryDays'];
const object = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 500) => typeof x === 'string' && x.length <= max;
const id = (x) => text(x, 250) && !!x && !['__proto__', 'constructor', 'prototype'].includes(x);
const key = (x) => typeof x === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(x) && id(x);
const scalar = (x) => x === null || typeof x === 'boolean' || text(x, 2000) || (typeof x === 'number' && Number.isFinite(x));
const date = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const instant = (x) => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x));
const require = (condition, message) => { if (!condition) throw new Error(message); };
function fields(value, allowed, what) {
  require(object(value), `${what} must be an object`);
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  require(!unknown.length, `${what}: unknown fields ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`);
}

export function checkDetails(d = {}) {
  fields(d, DETAIL_FIELDS, 'details');
  for (const k of ['context', 'location', 'successCriteria']) if (d[k] !== undefined) require(text(d[k], 1000), `Invalid ${k}`);
  if (d.energy !== undefined) require(['low', 'medium', 'high', ''].includes(d.energy), 'energy: low, medium or high');
  for (const k of ['notBefore', 'deadline']) if (d[k] != null) require(date(d[k]), `${k} needs YYYY-MM-DD`);
  if (d.notBefore && d.deadline) require(d.notBefore <= d.deadline, 'notBefore must not be after deadline');
  if (d.tags !== undefined) require(Array.isArray(d.tags) && d.tags.length <= 12 && d.tags.every((x) => text(x, 40)), 'Use up to 12 short tags');
  if (d.dependsOn !== undefined) require(Array.isArray(d.dependsOn) && d.dependsOn.length <= 20 && d.dependsOn.every(id), 'dependsOn needs up to 20 task IDs');
  if (d.requireChecklist !== undefined) require(typeof d.requireChecklist === 'boolean', 'requireChecklist must be boolean');
  if (d.reviewEveryDays !== undefined) require(Number.isInteger(d.reviewEveryDays) && d.reviewEveryDays >= 0 && d.reviewEveryDays <= 90, 'reviewEveryDays: 0 disables, or 1–90 days');
  if (d.checklist !== undefined) {
    require(Array.isArray(d.checklist) && d.checklist.length <= 20, 'Use up to 20 checklist steps');
    for (const c of d.checklist) { fields(c, ['label', 'done'], 'checklist step'); require(text(c.label, 200) && c.label.trim() && typeof c.done === 'boolean', 'A checklist step needs label and done'); }
  }
  if (d.custom !== undefined) require(object(d.custom) && Object.keys(d.custom).length <= 20
    && Object.entries(d.custom).every(([k, v]) => key(k) && scalar(v)), 'custom needs up to 20 named scalar values');
  if (d.outcomeForm !== undefined) {
    require(Array.isArray(d.outcomeForm) && d.outcomeForm.length <= 8, 'Use up to 8 outcome questions');
    const seen = new Set();
    for (const f of d.outcomeForm) {
      fields(f, ['key', 'label', 'type', 'required', 'choices', 'min', 'max'], 'outcome question');
      require(key(f.key) && !seen.has(f.key), 'Question keys must be unique lower_case names'); seen.add(f.key);
      require(text(f.label, 200) && f.label.trim() && ['choice', 'number', 'boolean', 'text'].includes(f.type), 'A question needs label and type');
      require(f.required === undefined || typeof f.required === 'boolean', 'required must be boolean');
      if (f.type === 'choice') require(Array.isArray(f.choices) && f.choices.length >= 2 && f.choices.length <= 10
        && f.choices.every((x) => text(x, 100) && x.trim()) && new Set(f.choices).size === f.choices.length, 'A choice needs 2–10 distinct options');
      else require(f.choices === undefined, 'choices is only for choice questions');
      for (const k of ['min', 'max']) if (f[k] !== undefined) require(f.type === 'number' && Number.isFinite(f[k]), `${k} is a numeric bound`);
      if (f.min !== undefined && f.max !== undefined) require(f.min <= f.max, 'min must not exceed max');
    }
  }
  return structuredClone(d);
}

export function checkDetailLinks(doc, itemId, details) {
  for (const dep of details.dependsOn ?? []) require(doc.items?.[dep]?.type === 'task', `Dependency ${dep} must be an existing one-off task`);
  const visited = new Set();
  const visit = (current, path = new Set()) => {
    require(!path.has(current), 'Task dependencies cannot form a cycle');
    if (visited.has(current)) return;
    const next = new Set(path).add(current);
    for (const dep of (current === itemId ? details : doc.items?.[current]?.details)?.dependsOn ?? []) visit(dep, next);
    visited.add(current);
  };
  visit(itemId);
}

export function completedBefore(doc, day) {
  return new Set(Object.values(doc.logs ?? {}).filter((l) => l.status === 'active' && l.kind === 'done' && l.day <= day).map((l) => l.itemId));
}

export function blockers(doc, item, day, completed = null) {
  const out = [];
  if (item.details?.notBefore > day) out.push(`Available ${item.details.notBefore}`);
  for (const dep of item.details?.dependsOn ?? []) {
    completed ??= completedBefore(doc, day);
    const done = completed.has(dep);
    if (!done) out.push(`Waiting for ${doc.items?.[dep]?.title ?? dep}`);
  }
  return out;
}

export function checkAnswers(form, answers) {
  fields(answers, form.map((f) => f.key), 'answers');
  for (const f of form) {
    const v = answers[f.key];
    if (v === undefined || v === '') { require(!f.required, `${f.label} needs an answer`); continue; }
    const ok = f.type === 'choice' ? f.choices.includes(v) : f.type === 'boolean' ? typeof v === 'boolean'
      : f.type === 'number' ? Number.isFinite(v) && (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)
      : text(v, 2000);
    require(ok, `Invalid answer for ${f.label}`);
  }
  return structuredClone(answers);
}

export function checkRule(def, doc) {
  fields(def, ['sourceId', 'match', 'conditions', 'actions'], 'rule definition');
  require(id(def.sourceId), 'A rule needs sourceId');
  require(['all', 'any'].includes(def.match), 'match must be all or any');
  require(Array.isArray(def.conditions) && def.conditions.length <= 8, 'Use up to 8 conditions');
  require(Array.isArray(def.actions) && def.actions.length >= 1 && def.actions.length <= 5, 'Use 1–5 actions');
  const source = doc && (doc.items?.[def.sourceId] ?? doc.goals?.[def.sourceId]);
  if (doc) require(source, 'Rule source must be an existing item or goal');
  for (const c of def.conditions) {
    fields(c, ['field', 'op', 'value'], 'condition');
    require(key(c.field) && ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(c.op) && scalar(c.value), 'Invalid condition');
    if (doc) {
      const f = source.details?.outcomeForm?.find((f) => f.key === c.field);
      require(f, `No outcome question named ${c.field}`);
      if (['gt', 'gte', 'lt', 'lte'].includes(c.op)) require(f.type === 'number' && Number.isFinite(c.value), 'Numeric comparison requires a number question and value');
      else if (c.op === 'contains') require(f.type === 'text' && typeof c.value === 'string', 'contains requires text');
      else checkAnswers([{ ...f, required: true }], { [f.key]: c.value });
    }
  }
  for (const a of def.actions) {
    require(object(a), 'An action must be an object');
    const allowed = { task: ['type', 'title', 'offsetDays', 'area', 'minutes', 'goalId', 'notes', 'priority'],
      reschedule: ['type', 'itemId', 'offsetDays'], log: ['type', 'targetId', 'amount', 'answerField'],
      flag: ['type', 'text'], review: ['type', 'goalId'] }[a.type];
    require(allowed, 'Action type: task, reschedule, log, flag or review'); fields(a, allowed, 'action');
    if (['task', 'reschedule'].includes(a.type)) require(Number.isInteger(a.offsetDays) && a.offsetDays >= 0 && a.offsetDays <= 365, 'offsetDays must be 0–365');
    if (a.type === 'task') {
      require(text(a.title, 200) && a.title.trim(), 'Follow-up needs a title');
      if (a.minutes !== undefined) require(Number.isInteger(a.minutes) && a.minutes >= 5 && a.minutes <= 720, 'minutes must be 5–720');
      for (const k of ['area', 'notes']) if (a[k] !== undefined) require(text(a[k], 1000), `Invalid ${k}`);
      if (a.priority !== undefined) require(typeof a.priority === 'boolean', 'priority must be boolean');
      if (a.goalId != null) require(id(a.goalId) && (!doc || doc.goals?.[a.goalId]), 'Unknown goalId');
    }
    if (a.type === 'reschedule') require(id(a.itemId) && (!doc || doc.items?.[a.itemId]?.type === 'task'), 'Reschedule needs a task ID');
    if (a.type === 'log') {
      require(id(a.targetId), 'Log needs targetId');
      require((Number.isFinite(a.amount) && a.amount > 0 && a.answerField === undefined)
        || (key(a.answerField) && a.amount === undefined), 'Log needs positive amount OR answerField');
      if (doc) {
        const t = doc.items?.[a.targetId] ?? doc.goals?.[a.targetId];
        require(t?.status === 'active' && (t.type === 'quota' || (!t.type && t.target > 0)), 'Log target must be active and measure an amount');
        if (a.answerField) require(source.details?.outcomeForm?.some((f) => f.key === a.answerField && f.type === 'number'), 'answerField must name a number question');
      }
    }
    if (a.type === 'flag') require(text(a.text, 500) && a.text.trim(), 'Flag needs text');
    if (a.type === 'review') require(id(a.goalId) && (!doc || doc.goals?.[a.goalId]?.status === 'active'), 'Review needs an active goalId');
  }
  return structuredClone(def);
}

export function matchesRule(def, outcome) {
  if (def.sourceId !== outcome.sourceId) return false;
  const results = def.conditions.map((c) => {
    const v = outcome.answers[c.field];
    if (v === undefined || v === '') return false; // unknown is not evidence, including for ne
    if (c.op === 'eq') return v === c.value;
    if (c.op === 'ne') return v !== c.value;
    if (c.op === 'contains') return typeof v === 'string' && v.includes(c.value);
    if (!Number.isFinite(v) || !Number.isFinite(c.value)) return false;
    return ({ gt: v > c.value, gte: v >= c.value, lt: v < c.value, lte: v <= c.value })[c.op];
  });
  return !results.length || (def.match === 'all' ? results.every(Boolean) : results.some(Boolean));
}

export function workflowRecordProblem(map, r) {
  try {
    if (map === 'rules') {
      require(text(r.title, 200) && r.title.trim() && typeof r.enabled === 'boolean' && instant(r.enabledAt), 'Invalid rule'); checkRule(r.definition);
    } else if (map === 'outcomes') {
      require(id(r.sourceId) && date(r.day) && instant(r.at) && object(r.answers)
        && Object.keys(r.answers).length <= 8 && Object.entries(r.answers).every(([k, v]) => key(k) && scalar(v)), 'Invalid outcome');
    } else if (map === 'workflowRuns') {
      require(id(r.ruleId) && id(r.outcomeId) && ['applied', 'failed'].includes(r.result) && text(r.error ?? '', 500), 'Invalid workflow run');
    } else if (map === 'reviews') {
      require(id(r.goalId) && date(r.day) && text(r.reason, 500), 'Invalid review');
      require(object(r.result) && ['pending', 'complete', 'failed', 'unknown', 'cancelled'].includes(r.result.state), 'Invalid review state');
      if (r.result.state === 'complete') require(text(r.result.summary, 2000)
        && ['on_track', 'at_risk', 'insufficient_evidence'].includes(r.result.direction)
        && Array.isArray(r.result.suggestionIds) && r.result.suggestionIds.length <= 3 && r.result.suggestionIds.every(id), 'Invalid review result');
    }
    return null;
  } catch (e) { return e.message; }
}

// Single writer: called by the Apps Script planner under its existing script lock.
// Each (rule, outcome) is consumed once. Actions never emit outcomes or recurse.
export function processWorkflows(store, limit = 20) {
  let processed = 0;
  const rulesBySource = new Map();
  for (const rule of Object.values(store.doc().rules ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    if (rule.status !== 'active' || !rule.enabled) continue;
    const rules = rulesBySource.get(rule.definition.sourceId) ?? [];
    rules.push(rule); rulesBySource.set(rule.definition.sourceId, rules);
  }
  const outcomes = Object.values(store.doc().outcomes ?? {}).filter((x) => x.status === 'active').sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  for (const outcome of outcomes) for (const rule of rulesBySource.get(outcome.sourceId) ?? []) {
    const runId = `wf:${rule.id}:${outcome.id}`;
    if (processed >= limit) return processed;
    if (rule.status !== 'active' || !rule.enabled || outcome.at < rule.enabledAt || store.doc().workflowRuns?.[runId] || !matchesRule(rule.definition, outcome)) continue;
    processed++;
    try {
      store.transaction(() => {
        checkRule(rule.definition, store.doc());
        rule.definition.actions.forEach((a, index) => {
          const actionId = `${runId}:${index}`;
          if (a.type === 'task') {
            const { type, offsetDays, ...fields } = a;
            store.addItem({ ...fields, id: actionId, type: 'task', date: addDays(outcome.day, offsetDays), source: 'workflow' });
          } else if (a.type === 'reschedule') {
            require(store.doc().items[a.itemId]?.status === 'active', 'Reschedule target is no longer active');
            require(!Object.values(store.doc().logs).some((l) => l.itemId === a.itemId && l.kind === 'done' && l.status === 'active'), 'A completed task cannot be rescheduled by a rule');
            store.updateItem(a.itemId, { date: addDays(outcome.day, a.offsetDays) });
          } else if (a.type === 'log') {
            const amount = a.answerField ? outcome.answers[a.answerField] : a.amount;
            require(Number.isFinite(amount) && amount > 0, 'Outcome amount must be positive');
            store.putLog(actionId, { kind: 'amount', itemId: store.doc().items[a.targetId] ? a.targetId : null,
              goalId: store.doc().goals[a.targetId] ? a.targetId : null, amount, day: outcome.day, at: outcome.at }, 'workflow');
          } else if (a.type === 'flag') store.addFlag(a.text, null, 'workflow', 'note');
          else store.requestReview(a.goalId, `Outcome reported for ${store.doc().items[outcome.sourceId]?.title ?? store.doc().goals[outcome.sourceId]?.title}`);
        });
        store.putWorkflow('workflowRuns', runId, { ruleId: rule.id, outcomeId: outcome.id, result: 'applied' });
      }, { summary: `Rule: ${rule.title}`, source: 'workflow' });
    } catch (e) {
      store.putWorkflow('workflowRuns', runId, { ruleId: rule.id, outcomeId: outcome.id, result: 'failed', error: String(e.message).slice(0, 500) });
    }
  }
  return processed;
}
