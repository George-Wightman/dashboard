# Task 8: Claude, the skill and the README

**Files:**
- Modify: `claude/ops.js`, `claude/read.js`, `claude/cli.js`, `claude/skill/SKILL.md`,
  `claude/skill/reference.md`, `README.md`
- Test: `tests/claude-ops.test.js`, `tests/claude-read.test.js`, `tests/claude-cli.test.js` (edit and append)

**Interfaces:**
- Consumes: `parseLength`, `parseClock`, `formatAmount` (`js/parse.js`); `checkConfigField`,
  `readPlannerConfig`, `dayRecord`, `plannerStatus`, `plannerNotes`, `clockLabel` (Task 1);
  `store.putCalendar` (Task 1).
- Produces: the ops `minutes`/`time` fields and `planner`; the reads `planner` and `week`'s calendar
  lines. Nothing later depends on them.

- [ ] **Step 1: Update and write the tests**

`tests/claude-ops.test.js` — in `runOp refuses what isn't an op`, both op lists gain `planner` at the end:

```js
    /Unknown op "fly" — ops: task, habit, target, goal, milestone, plan, done, undone, log, edit, archive, accept, dismiss, flag, undo, planner/);
  assert.deepEqual(Object.keys(OPS), ['task', 'habit', 'target', 'goal', 'milestone', 'plan', 'done', 'undone', 'log', 'edit', 'archive', 'accept', 'dismiss', 'flag', 'undo', 'planner']);
```

In the `edit` test, the refusal names the two new fields:

```js
    /Can't edit status on a task — editable: title, date, area, goalId, repeat, target, unitLabel, order, minutes, time/);
```

Append:

```js
test('lengths, times, and the planner settings', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: 'Draft cover letter', minutes: '2h', time: '09:30', date: 'tomorrow' }),
    'Added task "Draft cover letter" for Fri 11 Sep (2h, at 09:30) · #rec-1');
  assert.equal(s.doc().items['rec-1'].minutes, 120);
  assert.equal(runOp(s, { op: 'habit', title: 'Read', minutes: 20 }), 'Added habit "Read" (every day, 20m) · #rec-2');
  assert.throws(() => runOp(s, { op: 'task', title: 'x', minutes: 'ages' }), /minutes needs a length from 5m to 12h/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', time: '2pm' }), /time needs a time of day like "14:00"/);
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', time: '09:00' }), /Only a task has a time/);
  assert.equal(runOp(s, { op: 'edit', id: 'rec-1', set: { minutes: '90m', time: null } }), 'Edited task "Draft cover letter": minutes → 1.5h, time → none');
  assert.throws(() => runOp(s, { op: 'edit', id: 'rec-2', set: { time: '10:00' } }), /Only a task has a time/);
  assert.equal(runOp(s, { op: 'planner', hours: ['08:30', '18:00'], gapMinutes: 10 }), "Changed the planner's settings: hours → 08:30–18:00, gapMinutes → 10");
  const config = s.doc().calendar.config;
  assert.deepEqual([config.hours, config.gapMinutes, config.days, config.source], [['08:30', '18:00'], 10, 7, 'claude']);
  assert.throws(() => runOp(s, { op: 'planner' }), /planner needs a setting to change/);
  assert.throws(() => runOp(s, { op: 'planner', colour: 'red' }), /no setting "colour"/);
});
```

`tests/claude-cli.test.js` — the `USAGE` Ops line gains `· planner`:

```js
  assert.match(USAGE, /Ops: task · habit · target · goal · milestone · plan · done · undone · log · edit · archive · accept · dismiss · flag · undo · planner/);
```

`tests/claude-read.test.js` — add `import { clockLabel } from '../js/calendar.js';` and append:

```js
test("planner: its settings, when it last ran, its notes; week shows what it booked", () => {
  const empty = doc();
  assert.match(READS.planner(empty, TODAY), /^Calendar planner: hasn't run yet\.$/m);
  assert.match(READS.week(empty, TODAY), /^Calendar: the planner hasn't booked anything yet\.$/m);
  const d = doc();
  const block = (title, start, end, state) => ({ key: 'k', title, start, end, state, items: ['t1'] });
  d.calendar = {
    status: { id: 'status', status: 'active', lastRun: '2026-09-13T13:02:00.000Z', lastError: null, version: 'b1', paused: false },
    'day:7': { id: 'day:7', status: 'active', day: TODAY, skipped: [], missed: [], notes: ['Moved Gym to 09:30 (Learn Hebrew)'],
      blocks: [block('Job search ×2', '2026-09-13T12:15:00.000Z', '2026-09-13T13:15:00.000Z', 'exact')] },
    'day:2': { id: 'day:2', status: 'active', day: '2026-09-15', skipped: [], missed: [], notes: [],
      blocks: [block('~ Read the pack', '2026-09-15T08:00:00.000Z', '2026-09-15T08:30:00.000Z', 'rough')] },
  };
  const planner = READS.planner(d, TODAY);
  assert.match(planner, /^Calendar planner: last ran Sun 13 Sep, \d\d:\d\d · build b1$/m);
  assert.match(planner, /^Settings: hours 09:00–19:00 · gapMinutes 15 · defaultMinutes 30 · maxBlockMinutes 150 · days 7 · exactDays 2 · firmUpHour 20$/m);
  assert.match(planner, /^ {2}areaCalendars: Job search → Application, Assessment centre → Application, Health → Gym, Challenger → Challenger · defaultCalendar: main$/m);
  assert.match(planner, /^Its notes today:\n {2}Moved Gym to 09:30 \(Learn Hebrew\)$/m);
  const week = READS.week(d, TODAY);
  const span = (s, e) => `${clockLabel(s)}–${clockLabel(e)}`;
  assert.ok(week.includes('Calendar, as the planner booked it (~ = rough):'), week);
  assert.ok(week.includes(`  today: ${span('2026-09-13T12:15:00.000Z', '2026-09-13T13:15:00.000Z')} Job search ×2`), week);
  assert.ok(week.includes(`  Tue 15 Sep: ~${span('2026-09-15T08:00:00.000Z', '2026-09-15T08:30:00.000Z')} Read the pack`), week);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/claude-ops.test.js tests/claude-read.test.js tests/claude-cli.test.js`
Expected: FAIL on the changed and new tests.

- [ ] **Step 3: `claude/ops.js`**

Imports:

```js
import { parseAmount, parseLength, parseClock, formatAmount } from '../js/parse.js';
import { checkConfigField, readPlannerConfig } from '../js/calendar.js';
```

(the old `import { parseAmount } from '../js/parse.js';` line goes). Below `checkOrder`, add:

```js
// A length: "2h", "90m", "1h30" or a number of minutes, 5 to 720. Null clears it.
function lengthOf(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? (Number.isInteger(value) && value >= 5 && value <= 720 ? value : null) : parseLength(String(value));
  if (n == null) throw new Error('minutes needs a length from 5m to 12h, like "45m", "2h" or "1h30"');
  return n;
}

// A time of day, "14:00". Null clears it.
function clockOf(value) {
  if (value == null || value === '') return null;
  const t = parseClock(String(value));
  if (!t) throw new Error('time needs a time of day like "14:00"');
  return t;
}

const timing = (rec) => {
  const parts = [rec.minutes ? formatAmount(rec.minutes, 'minutes') : null, rec.time ? `at ${rec.time}` : null].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
};
```

`task`:

```js
function task(store, op) {
  const today = store.today();
  const minutes = lengthOf(op.minutes);
  const time = clockOf(op.time);
  const rec = store.addItem({
    type: 'task', title: title(op.title, 'A task'), date: toDay(op.date ?? 'today', today),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(time ? { time } : {}),
  });
  return tagged(`${verb(op)} task ${q(rec.title)} for ${dayName(rec.date, today)}${timing(rec)}`, rec.id);
}
```

`habit`:

```js
function habit(store, op) {
  if (op.time != null && op.time !== '') throw new Error('Only a task has a time');
  const minutes = lengthOf(op.minutes);
  const rec = store.addItem({
    type: 'habit', title: title(op.title, 'A habit'), repeat: checkRepeat(op.repeat),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}),
  });
  const length = rec.minutes ? `, ${formatAmount(rec.minutes, 'minutes')}` : '';
  return tagged(`${verb(op)} habit ${q(rec.title)} (${repeatText(rec.repeat)}${length})`, rec.id);
}
```

`EDITABLE.items` gains, after `order`:

```js
    minutes: (v, rec) => { if (rec.type === 'quota') throw new Error('A weekly target has no length'); return lengthOf(v); },
    time: (v, rec) => { onlyFor('task', 'Only a task has a time')(rec); return clockOf(v); },
```

In `show`, before the `typeof value === 'string'` line:

```js
  if (field === 'minutes') return formatAmount(value, 'minutes');
  if (field === 'time') return value;
```

The `planner` op, above `export const OPS`:

```js
// ---- The calendar planner ----------------------------------------------------------------------

const settingText = (field, value) => (field === 'hours' ? `${value[0]}–${value[1]}` : typeof value === 'object' ? JSON.stringify(value) : String(value));

function planner(store, op) {
  const fields = Object.keys(op).filter((k) => k !== 'op');
  if (!fields.length) throw new Error('planner needs a setting to change, like {"op": "planner", "hours": ["08:30", "18:00"]}');
  const changes = {};
  for (const field of fields) changes[field] = checkConfigField(field, op[field]);
  const { config } = readPlannerConfig(store.doc());
  store.putCalendar('config', { ...config, ...changes }, CLAUDE);
  return `Changed the planner's settings: ${fields.map((f) => `${f} → ${settingText(f, changes[f])}`).join(', ')}`;
}
```

and `OPS` ends `log, edit, archive, accept, dismiss, flag, undo, planner,`.

- [ ] **Step 4: `claude/read.js`**

Imports:

```js
import { readPlannerConfig, dayRecord, plannerStatus, plannerNotes, clockLabel } from '../js/calendar.js';
```

Below `week`'s helpers, add:

```js
// What the planner booked for the next seven days, from its day records.
function calendarLines(doc, day) {
  const line = (b) => `${b.state === 'rough' ? '~' : ''}${clockLabel(b.start)}–${clockLabel(b.end)} ${String(b.title).replace(/^~ /, '')}`;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(day, i);
    const blocks = dayRecord(doc, d)?.blocks ?? [];
    if (blocks.length) out.push(`  ${dayName(d, day)}: ${blocks.map(line).join(' · ')}`);
  }
  return out.length ? ['Calendar, as the planner booked it (~ = rough):', ...out] : ["Calendar: the planner hasn't booked anything yet."];
}
```

In `week`, just before `return out.join('\n');`: `out.push(...calendarLines(doc, day));`

Add the read:

```js
function plannerRead(doc, day) {
  const { config, problems } = readPlannerConfig(doc);
  const s = plannerStatus(doc);
  const out = [header(doc, day)];
  out.push(s
    ? `Calendar planner: last ran ${when(s.lastRun)}${s.paused ? ' · paused' : ''}${s.version ? ` · build ${s.version}` : ''}`
    : "Calendar planner: hasn't run yet.");
  if (s?.lastError) out.push(`  Last problem: ${s.lastError}`);
  out.push(`Settings: hours ${config.hours[0]}–${config.hours[1]} · gapMinutes ${config.gapMinutes} · defaultMinutes ${config.defaultMinutes} · maxBlockMinutes ${config.maxBlockMinutes} · days ${config.days} · exactDays ${config.exactDays} · firmUpHour ${config.firmUpHour}`);
  out.push(`  areaCalendars: ${Object.entries(config.areaCalendars).map(([a, c]) => `${a} → ${c}`).join(', ') || 'none'} · defaultCalendar: ${config.defaultCalendar}`);
  out.push(`  habitEvents: ${config.habitEvents.map((l) => `${l.habit} → "${l.title}" on ${l.calendar}`).join(', ') || 'none'}`);
  out.push(`  ignore: ${config.ignore.join(', ') || 'nothing'}`);
  for (const p of problems) out.push(`  ! ${p}`);
  const notes = plannerNotes(doc, day);
  out.push(notes.length ? 'Its notes today:' : 'No notes from it today.', ...notes.map((n) => `  ${n}`));
  return out.join('\n');
}
```

and `READS` gains `planner: plannerRead` at the end.

- [ ] **Step 5: `claude/cli.js`** — the Reads line in `USAGE` ends `· changes [n] · planner`.

- [ ] **Step 6: `claude/skill/SKILL.md`**

In the frontmatter description, after `"tick off …"` add `, "plan my week"`. Replace the whole
`## The calendar` section with:

```md
## The calendar

A planner — a Google Apps Script in George's account — books the dashboard into his Google Calendar
every 10 minutes: each day's tasks grouped by area into blocks, around his fixed events, exact for
today and tomorrow and rough (`~`, pale) further out. It moves blocks off new shifts and trims them
when he ticks. **Don't book blocks for dashboard tasks yourself.** Give the planner what it needs:

- `minutes` on anything longer than half an hour (`"2h"`, `"90m"`), and `time` when it happens at a
  set time (`"14:00"`) — an interview, the assessment centre day.
- An `area` on every task, so similar ones share a block (reuse the areas already in `list`).
- A date on each task — spread a week's work over its days rather than piling it on one.

**"Plan my week"** (the weekly check): read `week`, `list`, `goals` and `planner`, and the calendar if
the connector is on. Then spread the week's tasks and the next stage of each goal over the days, set
lengths and areas, and say what you changed. The calendar follows within 10 minutes.

An event booked by hand for a dashboard task should carry `dashboard:<id>` (the id as the tool shows
it) on its own line in the description; the planner then treats it as that task's time. The planner's
settings — planning hours, which calendar an area goes on, linked habits — change with the `planner`
op (reference.md). Its last run and notes are in the `planner` read.
```

- [ ] **Step 7: `claude/skill/reference.md`**

In the reads section, after `changes`:

```md
### `planner`
The calendar planner: when it last ran (and any problem), its settings, anything it couldn't use, and
its notes today (*Moved Job search ×2 on Wed to 15:15 (Signify)*).
```

In the ops section, document `minutes` and `time` under `task` (`"minutes": "2h"` — a length from 5
minutes to 12 hours, `"45m"`, `"1h30"` or a number of minutes; `"time": "14:00"` — a fixed start, which
makes it a fixed event in the calendar) and `minutes` under `habit`; add them to the `edit` field list
(`minutes, time` for tasks, `minutes` for habits; `null` clears either). Then, after `undo`:

```md
### `planner`
Change the calendar planner's settings; every other setting is kept.
`{"op": "planner", "hours": ["08:30", "18:00"]}`. Settings: `hours` (two times, planning hours),
`gapMinutes` (0–60, clear time around events), `defaultMinutes` (5–240, a task with no length),
`maxBlockMinutes` (30–480, longest block), `days` (1–14, how far ahead), `exactDays` (1–7, days with
exact times), `firmUpHour` (12–23, when the next day turns exact), `ignore` (calendar names, by their
start), `areaCalendars` (`{"Job search": "Application"}`), `defaultCalendar` (`"main"` or a name),
`habitEvents` (`[{"habit": "Gym", "calendar": "Gym", "title": "Gym"}]` — a habit by id or the start of
its title, and the events that are its sessions).
```

- [ ] **Step 8: `README.md`**

Add a section after `## Claude` (before `## Updates`):

```md
## The calendar planner

Your dashboard, booked into your Google Calendar. A small script in your own Google account (the
*Dashboard planner*) runs every 10 minutes, and whenever one of your calendars changes:

- **Every task gets time.** A day's tasks and habits are grouped by area into one block — *Job
  search ×2* — around your fixed events, between 9:00 and 19:00, 15 minutes clear of anything else. A
  task's length is its own (*Draft cover letter 2h* in the add box, or Length in the edit panel),
  otherwise 30 minutes; *Call NatCen 14:00* makes it a fixed event at 14:00. A weekly time target
  (*Assessment centre prep 5h*) adds its share to each day.
- **Today and tomorrow are exact; later days are rough** — `~` and a paler colour — and at 20:00 each
  evening the day after tomorrow turns exact.
- **Blocks go on the calendar for their area** (Job search and Assessment centre on Application,
  Health on Gym), so they take your colours. Hebrew and Gym are your own events: moved off a clash,
  never copied.
- **When things change:** a shift on top of a block moves it, and a note under the date says so. Move
  a block yourself and it stays where you put it. Delete one and it isn't booked again that day.
- **When you tick:** during its block, the block ends at the tick; before it or later that day, it
  moves to end at the tick; part done, it says *1 of 2 done* and the rest gets a new slot; missed, it
  goes and the task gets a new slot.
- **On the list,** today's tasks show their time and follow the day's order. ⚙ → *Calendar planner*
  says when it last ran; the header warns if it stops.

Claude does the thinking: say **"plan my week"** and it spreads the week's work over the days, with
lengths and areas, and the calendar follows. Its settings (planning hours, calendars, linked habits)
change by asking Claude.

**Setting it up (once, about 10 minutes):**

1. GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: name it
   *Calendar planner*, *Only select repositories* → `dashboard-sync`, *Contents: Read and write*.
2. Go to [script.google.com](https://script.google.com) → *New project*, and name it *Dashboard
   planner*. In ⚙ Project Settings tick *Show "appsscript.json" manifest file in editor*. Replace the
   contents of `appsscript.json` and `Code.gs` with the two files in `planner/apps-script/`.
3. ⚙ Project Settings → *Script properties*: `GITHUB_TOKEN` (the token), `SYNC_REPO`
   (`George-Wightman/dashboard-sync`), and `GEMINI_KEY` if you'd like untagged tasks sorted into areas.
4. Back in the editor, choose `install` and press *Run*. Google asks for permission; *Google hasn't
   verified this app* is expected for a script of your own → *Advanced* → *Go to Dashboard planner* →
   *Allow*. Within 10 minutes your next 7 days fill in.

`pause`, `resume` and `removeAll` (every future block it made, then pause) run the same way. Updates
arrive by themselves: the script loads the planner from this site each time it runs.
```

In `## How it's built`, add a line for `planner/` — "the calendar planner: a pure planning core
(`plan.js` and its parts), the Apps Script side (`gas.js`), bundled by `npm run build-planner` into
`planner/planner.js`, which the loader in `planner/apps-script/` fetches". In `## Roadmap`, item 6
becomes `6. **Google Calendar** — the planner books the dashboard into your calendar — built`.

- [ ] **Step 9: Run the tests**

Run: `node --test tests/claude-ops.test.js tests/claude-read.test.js tests/claude-cli.test.js tests/claude-skill.test.js` → PASS.
Then `npm test` → PASS. Then `npm run build-skill` → the zip in `~/.dashboard-skill/` (for George to upload).

- [ ] **Step 10: Commit**

```bash
git add claude/ops.js claude/read.js claude/cli.js claude/skill/SKILL.md claude/skill/reference.md README.md tests/claude-ops.test.js tests/claude-read.test.js tests/claude-cli.test.js
git commit -m "Teach Claude lengths, times and the planner; the skill's calendar section; the README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
