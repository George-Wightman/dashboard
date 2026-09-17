import { DETAIL_FIELDS } from '../js/workflow.js';
import { FIELDS } from './ops.js';

const TOPICS = {
  details: { purpose: 'Task/goal context, readiness, success criteria and optional outcome questions', op: 'details',
    fields: DETAIL_FIELDS, example: { op: 'details', id: '<task-id>', set: { successCriteria: 'Know the exercise types and timings', tags: ['assessment'],
      outcomeForm: [{ key: 'ready', label: 'Do you have enough information to practise?', type: 'boolean', required: true }] } },
    note: 'Context, energy, tags and custom values describe work; only dependsOn and notBefore block scheduling. Deadline is advisory. Checklist gates completion only when requireChecklist is true.' },
  workflows: { purpose: 'Simple predictable follow-ups from explicitly reported outcomes', ops: ['rule', 'report'],
    conditions: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'], actions: ['task', 'reschedule', 'log', 'flag', 'review'],
    limits: '50 enabled rules; 8 conditions; 5 actions per rule; 20 matches per planner run; no recursion or generated code',
    example: { op: 'rule', title: 'Review readiness after checking the format', enabled: true,
      definition: { sourceId: '<task-id>', match: 'all', conditions: [{ field: 'ready', op: 'eq', value: true }], actions: [{ type: 'review', goalId: '<goal-id>' }] } },
    guide: 'reference workflows' },
  reviews: { purpose: 'Evidence-based goal direction review through the existing planner Gemini integration',
    request: { op: 'review', id: '<goal-id>' }, schedule: { op: 'details', id: '<goal-id>', set: { reviewEveryDays: 7 } },
    limits: 'Opt-in; one request per goal per day; at most 2 API calls per planner run and 6 per day; 0–3 suggested tasks; no automatic acceptance',
    setup: 'Planner must be running with GEMINI_KEY configured in Script Properties. No key belongs in synced records.', guide: 'reference reviews' },
};

export function capabilities(topic = '') {
  if (!topic) return JSON.stringify({ version: 1, topics: Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.purpose])),
    workflow: 'find → inspect <id> → capabilities <topic> → preview JSON → apply same JSON → inspect/workflows',
    discovery: 'capabilities <op> also lists accepted top-level fields. Read a focused playbook only for the capability you need.' }, null, 2);
  const value = TOPICS[topic] ?? (FIELDS[topic] ? { op: topic, fields: FIELDS[topic] } : null);
  if (!value) throw new Error('Unknown capability; run capabilities for topics');
  return JSON.stringify(value, null, 2);
}
