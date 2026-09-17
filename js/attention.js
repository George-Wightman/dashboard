// The attention list: what Claude should look at when it checks in — tasks with no length, tasks
// carried over for days, weekly targets behind pace, and what the planner couldn't do. Pure; the
// tool's `attention` read and ⚙ → Claude show it.

import { doneIndex, doneDays, weekTotal } from './schedule.js';
import { addDays, weekday, shortWeekday, shortDate } from './dates.js';
import { readPlannerConfig, plannerNotes } from './calendar.js';
import { formatProgress } from './parse.js';
import { blockers } from './workflow.js';

const quote = (t, n = 60) => `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function attention(doc, today) {
  const lines = [];
  const idx = doneIndex(doc);
  const { config, problems } = readPlannerConfig(doc);
  const items = Object.values(doc.items ?? {}).filter((i) => i.status === 'active');
  const open = (i) => i.type === 'task' && !doneDays(doc, i.id, idx).size;

  const noLength = items.filter((i) => open(i) && !i.minutes && i.date <= addDays(today, 14));
  if (noLength.length) {
    const it = noLength.length === 1 ? 'it' : 'each';
    lines.push(`${plural(noLength.length, 'task')} with no length (the planner gives ${it} ${config.defaultMinutes} minutes): ${noLength.slice(0, 6).map((i) => quote(i.title)).join(', ')}${noLength.length > 6 ? ', …' : ''}`);
  }

  for (const i of items.filter((x) => open(x) && x.date <= addDays(today, -3)).slice(0, 8)) {
    lines.push(`${quote(i.title)} has carried over since ${shortWeekday(i.date)} ${shortDate(i.date)}`);
  }

  const gone = weekday(today) - 1;
  if (gone > 0) {
    for (const q of items.filter((x) => x.type === 'quota')) {
      const total = weekTotal(doc, q.id, today);
      if (total < (q.target * gone) / 7) {
        const label = q.unit === 'count' && q.unitLabel ? ` ${q.unitLabel}` : '';
        lines.push(`${quote(q.title)} is behind: ${formatProgress(total, q.target, q.unit)}${label} with ${plural(8 - weekday(today), 'day')} left`);
      }
    }
  }

  for (const p of problems) lines.push(`Planner: ${p}`);
  if (doc.calendar?.['review-status']?.lastError) lines.push(doc.calendar['review-status'].lastError);
  for (const item of items.filter((i) => open(i) && i.details?.deadline < today).slice(0, 5)) lines.push(`${quote(item.title)} is past its target deadline ${item.details.deadline}`);
  for (const item of items.filter((i) => open(i) && i.date <= today && blockers(doc, i, today).length).slice(0, 5)) lines.push(`${quote(item.title)}: ${blockers(doc, item, today).join('; ')}`);
  for (const run of Object.values(doc.workflowRuns ?? {}).filter((r) => r.result === 'failed').sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 3)) lines.push(`Rule needs attention: ${doc.rules?.[run.ruleId]?.title ?? run.ruleId} — ${run.error}`);
  for (const n of plannerNotes(doc, today)) if (!n.startsWith('Moved ')) lines.push(`Planner: ${n}`);
  return lines;
}
