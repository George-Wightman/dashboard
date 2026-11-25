// Tries Start the day's food split (js/food.js daySplitPrompt) on real days before it is trusted:
// the last N days with at least two meals in his words, each day's words joined back into one
// ramble, sent to Gemini, and the split compared with what was logged. Reads the dashboard with the
// skill's config; writes nothing but the report, which holds his meals, so keep it out of the repo.
//
//   $env:GEMINI_KEY = '<key>'; node dev/try-split.mjs 10 <report.md>

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../claude/config.js';
import { openSession } from '../claude/session.js';
import { makeClient } from '../claude/github.js';
import { askGemini } from '../js/gemini.js';
import { DAY_SPLIT_SYSTEM, daySplitPrompt, parseDaySplit, mealsOn, slotName, MEAL_MODELS } from '../js/food.js';
import { addDays } from '../js/dates.js';

const [nArg, out] = process.argv.slice(2);
const key = process.env.GEMINI_KEY;
if (!out || !key) {
  console.log("Usage: $env:GEMINI_KEY = '<key>'; node dev/try-split.mjs <days> <report.md>");
  process.exit(2);
}
const config = readConfig(readFileSync(join(homedir(), '.dashboard-skill', 'config.json'), 'utf8'));
process.env.TZ = config.timeZone;
const { store } = await openSession({ client: makeClient({ token: config.token, repo: config.repo }), dayStartHour: config.dayStartHour });
const doc = store.doc();

const words = (m) => String(m.text ?? '').trim();
const days = [];
for (let d = addDays(store.today(), -1); days.length < Number(nArg) && d > addDays(store.today(), -60); d = addDays(d, -1)) {
  const ms = mealsOn(doc, d).filter((m) => words(m) && !m.batchId);
  if (ms.length >= 2) days.push({ day: d, meals: ms });
}

const lines = ['# Food split trial', ''];
let right = 0;
for (const { day, meals } of days) {
  const ramble = meals.map(words).join(', then ');
  lines.push(`## ${day}`, '', `Said: ${ramble}`, '');
  try {
    const { data } = await askGemini({ keys: [key], system: DAY_SPLIT_SYSTEM, prompt: daySplitPrompt({ text: ramble, day }), models: MEAL_MODELS, temperature: 0.2 });
    const split = parseDaySplit(data);
    const ok = split.length === meals.length;
    if (ok) right++;
    lines.push(`| logged | split |`, `|---|---|`);
    for (let i = 0; i < Math.max(split.length, meals.length); i++) {
      const a = meals[i] ? `${slotName(meals[i].slot)}: ${words(meals[i])}` : '';
      const b = split[i] ? `${slotName(split[i].slot)} ${split[i].time}: ${split[i].text}` : '';
      lines.push(`| ${a} | ${b} |`);
    }
    lines.push('', ok ? 'Same number of meals.' : `**${meals.length} logged, ${split.length} in the split.**`, '');
  } catch (e) {
    lines.push(`**Failed: ${e.message}**`, '');
  }
}
lines.splice(1, 0, `${right} of ${days.length} days split into the same number of meals.`);
writeFileSync(out, lines.join('\n'));
console.log(`${right} of ${days.length} days split into the same number of meals. Report: ${out}`);
