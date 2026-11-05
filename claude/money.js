// Money for Claude (js/money.js): the read, and importing a ledger Claude has built from his bank
// statements. The ledger is the private sync repo's money.json, beside data.json; an import merges
// into it (days, income and balances by day, plan lines by month and label, covered stretches join).

import { MONEY_PATH, validMoney, mergeMoney, potForecast, averageSpend, monthActuals, compare, categoryLabel, gbp, startDay, emptyMoney, lastCovered } from '../js/money.js';
import { hoursSummary } from '../js/hours.js';

export async function readMoney(files) {
  const f = await files.read(MONEY_PATH);
  if (!f) return null;
  const doc = JSON.parse(f.text);
  if (!validMoney(doc)) throw new Error('money.json in the sync repo is malformed');
  return doc;
}

const cats = (o) => Object.entries(o).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${categoryLabel(c)} ${gbp(v)}`).join(', ');

export function moneyLines(money, doc, today) {
  const start = startDay(doc);
  const h = hoursSummary(doc, today);
  const out = [`Start date in London: ${start}`];
  out.push(`Next pay (${h.expected.period}): ${h.expected.hours} h${h.expected.net != null ? `, about £${h.expected.net.toFixed(2)}` : ''}`);
  if (!money) {
    out.push('No ledger yet: read his bank statements and import one with `money-import <file.json>` (see reference money).');
    return out;
  }
  const f = potForecast({ money, doc, today });
  out.push(`Statements cover up to ${lastCovered(money) ?? '—'} · what he'll have at the start: ${gbp(f.atStart)}`);
  const avg = averageSpend(money, today);
  if (avg.months) out.push(`Average month (last ${avg.months} full): ${gbp(avg.total)} — ${cats(avg.spend)}`);
  out.push('Month by month (spend · income · pot after; ~ = planned):');
  for (const r of f.rows) out.push(`  ${r.actual ? ' ' : '~'}${r.month}: ${gbp(r.spend)} · ${gbp(r.income)} · ${gbp(r.pot)}`);
  const m = monthActuals(money, today.slice(0, 7));
  if (m.days) out.push(`This month so far (${m.days} days on statements): ${gbp(m.total)} — ${cats(m.spend)}`);
  const c = compare(money, doc, { eu: true });
  if (c.a.days && c.b.days) out.push(`Per week in Salzburg ${gbp(c.a.total)} (${c.a.days} days) vs the UK ${gbp(c.b.total)} (${c.b.days} days)`);
  if (money.plan.length) out.push(`Plan lines: ${money.plan.map((p) => `${p.month} ${p.label} ${p.kind === 'income' ? '+' : ''}${gbp(p.amount)}`).join(' · ')}`);
  return out;
}

// Merges a local JSON file into money.json and saves it. Returns what changed in words.
export async function importMoney(files, text) {
  let add;
  try { add = JSON.parse(text); } catch { throw new Error('money-import needs a JSON file'); }
  const base = (await readMoney(files)) ?? emptyMoney();
  const merged = mergeMoney(base, { ...add, updated: new Date().toISOString() });
  if (!validMoney(merged)) throw new Error('That import doesn\'t fit money.json: amounts are whole pence, days YYYY-MM-DD, categories from the list, income kind pay|refund|other, and "covered" says which days the statements cover');
  await files.write(MONEY_PATH, `${JSON.stringify(merged)}\n`, 'money: import');
  const days = Object.keys(add.days ?? {}).length;
  return `Saved money.json: ${days} day${days === 1 ? '' : 's'} of spending, ${add.income?.length ?? 0} income, ${add.balances?.length ?? 0} balance${add.balances?.length === 1 ? '' : 's'}, ${add.plan?.length ?? 0} plan line${add.plan?.length === 1 ? '' : 's'} · covered up to ${lastCovered(merged)}`;
}
