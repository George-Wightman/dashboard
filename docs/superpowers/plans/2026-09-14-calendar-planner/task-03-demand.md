# Task 3: What needs time

**Files:**
- Create: `planner/demand.js`
- Test: `tests/planner-demand.test.js`

**Interfaces:**
- Consumes: `addDays`, `weekStart` (`js/dates.js`); `isHabitDue`, `doneIndex`, `doneDays`, `doneBetween`,
  `weekTotal` (`js/schedule.js`); `at`, `MINUTE` (Task 2); `norm` (Task 2); `CALENDAR_DEFAULTS` (Task 1).
- Produces: `evenPicks(list, k)`, `fixedTasks({ doc, days, config })`, `demand({ doc, today, days, config,
  links, covered, usedKeys, todayClosed })` → `{ blocks }`, each block `{ key, day, area, items, minutes,
  carried, base }`. Task 4 uses all three.

- [ ] **Step 1: Write the failing tests** — create `tests/planner-demand.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evenPicks, fixedTasks, demand } from '../planner/demand.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { addDays } from '../js/dates.js';
import { at } from '../planner/time.js';
import { fixture, done, amount } from './helpers.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(TUE, i));
const config = JSON.parse(JSON.stringify(CALENDAR_DEFAULTS));
const run = (doc, extra = {}) => demand({ doc, today: TUE, days: DAYS, config, links: [], covered: new Map(), usedKeys: new Map(), todayClosed: false, ...extra }).blocks;
const brief = (b) => [b.key, b.base, b.minutes, b.items.join(',')];
const task = (id, title, area, date, extra = {}) => ({ id, type: 'task', title, area, date, order: Number(id.replace(/\D/g, '')) || 0, ...extra });

test('evenPicks: spread from the first', () => {
  assert.deepEqual(evenPicks(['a', 'b', 'c', 'd', 'e', 'f'], 2), ['a', 'd']);
  assert.deepEqual(evenPicks(['a', 'b'], 5), ['a', 'b']);
  assert.deepEqual(evenPicks(['a', 'b'], 0), []);
});

test("a day's tasks: grouped by area, carried-over first, done and timed ones left out", () => {
  const doc = fixture({
    items: [
      task('t1', 'Email Sarah', 'Job search', TUE),
      task('t2', 'Update CV', 'Job search', TUE, { minutes: 45 }),
      task('t3', 'Write the day out', 'Assessment centre', TUE),
      task('t4', 'Buy stamps', '', TUE),
      task('t5', 'Chase GSS', 'Job search', '2026-09-14'),
      task('t6', 'Done already', 'Job search', TUE),
      task('t7', 'Call NatCen', 'Job search', TUE, { time: '14:00' }),
      { id: 's1', type: 'task', title: 'Suggested', area: 'Job search', date: TUE, status: 'suggested' },
    ],
    logs: [done('t6', TUE)],
  });
  assert.deepEqual(run(doc).filter((b) => b.day === TUE).map(brief), [
    [`${TUE}||0`, 'Buy stamps', 30, 't4'],
    [`${TUE}|assessment centre|0`, 'Write the day out', 30, 't3'],
    [`${TUE}|job search|0`, 'Job search ×3', 105, 't5,t1,t2'],
  ]);
  assert.equal(run(doc).find((b) => b.key === `${TUE}|job search|0`).carried, true);
});

test('long blocks split: tasks packed in order, a very long task in equal parts', () => {
  const doc = fixture({ items: [
    task('t1', 'A', 'Job search', TUE, { minutes: 60 }),
    task('t2', 'B', 'Job search', TUE, { minutes: 60 }),
    task('t3', 'C', 'Job search', TUE, { minutes: 60 }),
    task('t4', 'Full mock day', 'Assessment centre', TUE, { minutes: 300 }),
  ] });
  assert.deepEqual(run(doc).map(brief), [
    [`${TUE}|assessment centre|0`, 'Full mock day (1 of 2)', 150, 't4'],
    [`${TUE}|assessment centre|1`, 'Full mock day (2 of 2)', 150, 't4'],
    [`${TUE}|job search|0`, 'Job search ×2', 120, 't1,t2'],
    [`${TUE}|job search|1`, 'C', 60, 't3'],
  ]);
});

test('covered items and used keys are left alone', () => {
  const doc = fixture({ items: [task('t1', 'A', 'Job search', TUE), task('t2', 'B', 'Job search', TUE)] });
  const blocks = run(doc, { covered: new Map([[TUE, new Set(['t1'])]]), usedKeys: new Map([[TUE, new Set([`${TUE}|job search|0`])]]) });
  assert.deepEqual(blocks.map(brief), [[`${TUE}|job search|1`, 'B', 30, 't2']]);
});

test("a weekly time target: what's left spread over the week's days, next week an even share", () => {
  const doc = fixture({ items: [
    { id: 'q1', type: 'quota', title: 'Assessment centre prep', area: 'Assessment centre', target: 300, unit: 'minutes' },
    { id: 'q2', type: 'quota', title: 'Hebrew', area: 'Hebrew', target: 240, unit: 'minutes' },
    { id: 'q3', type: 'quota', title: 'Applications', area: 'Job search', target: 3, unit: 'count' },
    task('t1', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 }),
    task('t2', 'Map competencies', 'Assessment centre', '2026-09-17'),
  ] });
  const links = [{ habitId: 'heb', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }];
  const blocks = run(doc, { links });
  assert.deepEqual(blocks.map(brief), [
    [`${TUE}|assessment centre|0`, 'Write the day out', 60, 't1'],
    ['2026-09-16|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-17|assessment centre|0', 'Assessment centre', 60, 't2'],
    ['2026-09-18|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-19|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-20|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-21|assessment centre|0', 'Assessment centre prep', 45, ''],
  ]);
  const logged = fixture({ items: doc.items ? Object.values(doc.items) : [], logs: [amount('a1', 'q1', '2026-09-14', 240)] });
  assert.equal(run(logged, { links }).find((b) => b.day === '2026-09-16').minutes, 15, '60 left over 6 days');
  const closed = run(doc, { links, todayClosed: true });
  assert.equal(closed.find((b) => b.day === '2026-09-16').minutes, 60, '300 over the 5 days left');
});

test('habits: due days, times-a-week spread over the week, linked ones never booked', () => {
  const doc = fixture({
    items: [
      { id: 'h1', type: 'habit', title: 'Outreach', area: 'Job search', repeat: { kind: 'perWeek', n: 2 } },
      { id: 'h2', type: 'habit', title: 'Sweep the boards', area: 'Job search', repeat: { kind: 'weekdays', days: [1, 3, 5] } },
      { id: 'h3', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    ],
  });
  const links = [{ habitId: 'h3', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }];
  const byDay = (blocks) => Object.fromEntries(DAYS.map((d) => [d, blocks.filter((b) => b.day === d).flatMap((b) => b.items).join(',')]));
  assert.deepEqual(byDay(run(doc, { links })), {
    '2026-09-15': 'h1', '2026-09-16': 'h2', '2026-09-17': '', '2026-09-18': 'h1,h2',
    '2026-09-19': '', '2026-09-20': '', '2026-09-21': 'h1,h2',
  });
  const once = fixture({ items: Object.values(doc.items), logs: [done('h1', '2026-09-14')] });
  assert.equal(byDay(run(once, { links }))['2026-09-18'], 'h2', 'one left this week: today only');
});

test('fixedTasks: a task with a time, on its date, for its length', () => {
  const doc = fixture({ items: [
    task('t1', 'ASSESSMENT CENTRE', 'Assessment centre', '2026-09-16', { time: '09:30', minutes: 390 }),
    task('t2', 'Call', '', '2026-09-30', { time: '10:00' }),
  ] });
  assert.deepEqual(fixedTasks({ doc, days: DAYS, config }), [{
    key: '2026-09-16|fixed|t1', itemId: 't1', day: '2026-09-16', title: 'ASSESSMENT CENTRE', area: 'Assessment centre',
    start: at('2026-09-16', '09:30').getTime(), end: at('2026-09-16', '16:00').getTime(),
  }]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/planner-demand.test.js`
Expected: FAIL — `Cannot find module '.../planner/demand.js'`.

- [ ] **Step 3: Create `planner/demand.js`**

```js
// What needs time on each day of the window, before any of it has a time: the day's tasks and
// habits grouped by area into blocks, their lengths, a weekly time target's share, and tasks with a
// set time. Pure; planner/plan.js places what this returns.

import { addDays, weekStart } from '../js/dates.js';
import { isHabitDue, doneIndex, doneDays, doneBetween, weekTotal } from '../js/schedule.js';
import { at, MINUTE } from './time.js';
import { norm } from './calendars.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ceil15 = (n) => Math.ceil(n / 15) * 15;

// k of the list, spread evenly from the first: 2 of six days → the 1st and the 4th.
export function evenPicks(list, k) {
  if (k <= 0) return [];
  if (k >= list.length) return [...list];
  return Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]);
}

// Tasks with a set time: a fixed event on their date, for their length.
export function fixedTasks({ doc, days, config }) {
  return values(doc.items)
    .filter((i) => i.type === 'task' && i.status === 'active' && i.time && days.includes(i.date))
    .sort(byOrder)
    .map((i) => {
      const start = at(i.date, i.time).getTime();
      return {
        key: `${i.date}|fixed|${i.id}`, itemId: i.id, day: i.date, title: i.title, area: String(i.area ?? '').trim(),
        start, end: start + (i.minutes ?? config.defaultMinutes) * MINUTE,
      };
    });
}

// One area's entries on one day as blocks of at most maxBlockMinutes: tasks packed in order, a task
// longer than that in equal parts, then the weekly target's extra time.
function parts(entries, share, name, config) {
  const max = config.maxBlockMinutes;
  const out = [];
  let cur = null;
  for (const { item, carried } of entries) {
    const m = item.minutes ?? config.defaultMinutes;
    if (m > max) {
      const n = Math.ceil(m / max);
      const each = Math.min(max, ceil15(m / n));
      for (let k = 1; k <= n; k++) out.push({ ids: [item.id], titles: [], minutes: each, carried, split: `${item.title} (${k} of ${n})` });
      cur = null;
      continue;
    }
    if (!cur || cur.minutes + m > max) {
      cur = { ids: [], titles: [], minutes: 0, carried: false };
      out.push(cur);
    }
    cur.ids.push(item.id);
    cur.titles.push(item.title);
    cur.minutes += m;
    cur.carried = cur.carried || carried;
  }
  let extra = Math.max(0, (share?.minutes ?? 0) - out.reduce((s, p) => s + p.minutes, 0));
  const last = out[out.length - 1];
  if (extra > 0 && last && !last.split && last.minutes < max) {
    const add = Math.min(extra, max - last.minutes);
    last.minutes += add;
    last.padded = true;
    extra -= add;
  }
  while (extra > 0) {
    const m = Math.min(extra, max);
    out.push({ ids: [], titles: [], minutes: m, carried: false });
    extra -= m;
  }
  const targetTitle = share?.titles.length === 1 ? share.titles[0] : name;
  return out.map((p) => {
    const many = `${name} ×${p.ids.length}`;
    let base;
    if (p.split) base = p.split;
    else if (p.padded) base = p.ids.length > 1 ? many : name;
    else if (p.ids.length === 1) base = p.titles[0];
    else base = p.ids.length ? many : targetTitle;
    return { ids: p.ids, minutes: p.minutes, carried: p.carried, base };
  });
}

export function demand({ doc, today, days, config, links, covered = new Map(), usedKeys = new Map(), todayClosed = false }) {
  const idx = doneIndex(doc);
  const linked = new Set(links.map((l) => l.habitId));
  const linkedAreas = new Set(links.map((l) => norm(l.area)).filter(Boolean));
  const active = values(doc.items).filter((i) => i.status === 'active').sort(byOrder);
  const inWindow = new Set(days);
  const thisMonday = weekStart(today);

  // A times-a-week habit: what's left this week spread over its remaining days; next week's n over
  // the whole of next week.
  const perWeekDays = new Map();
  for (const h of active.filter((i) => i.type === 'habit' && i.repeat?.kind === 'perWeek' && !linked.has(i.id))) {
    const picks = new Set();
    for (const monday of [...new Set(days.map(weekStart))]) {
      const week = Array.from({ length: 7 }, (_, n) => addDays(monday, n));
      let left = h.repeat.n;
      let candidates = week;
      if (monday === thisMonday) {
        left -= doneBetween(doc, h.id, monday, addDays(today, 1), idx);
        const doneToday = doneDays(doc, h.id, idx).has(today);
        candidates = week.filter((d) => d > today || (d === today && !doneToday && !todayClosed));
      }
      for (const d of evenPicks(candidates, left)) if (inWindow.has(d)) picks.add(d);
    }
    perWeekDays.set(h.id, picks);
  }

  // A weekly time target's share of each day, by area.
  const daysLeft = days.filter((d) => weekStart(d) === thisMonday && (d !== today || !todayClosed));
  const shares = new Map();
  for (const q of active.filter((i) => i.type === 'quota' && i.unit === 'minutes' && !linkedAreas.has(norm(i.area)))) {
    const remaining = Math.max(0, q.target - weekTotal(doc, q.id, today));
    for (const d of days) {
      const minutes = weekStart(d) === thisMonday
        ? (daysLeft.includes(d) ? ceil15(remaining / daysLeft.length) : 0)
        : ceil15(q.target / 7);
      if (!minutes) continue;
      const a = norm(q.area);
      const byDay = shares.get(a) ?? new Map();
      const s = byDay.get(d) ?? { minutes: 0, titles: [], area: String(q.area ?? '').trim() };
      s.minutes += minutes;
      s.titles.push(q.title);
      byDay.set(d, s);
      shares.set(a, byDay);
    }
  }

  const blocks = [];
  for (const d of days) {
    const skip = covered.get(d) ?? new Set();
    const groups = new Map();
    const add = (item, carried) => {
      const a = norm(item.area);
      const g = groups.get(a) ?? { area: String(item.area ?? '').trim(), entries: [] };
      g.entries.push({ item, carried });
      groups.set(a, g);
    };
    for (const i of active) {
      if (skip.has(i.id)) continue;
      if (i.type === 'task' && !i.time) {
        if (doneDays(doc, i.id, idx).size) continue;
        const carried = i.date < today;
        if (i.date === d || (d === today && carried)) add(i, carried);
      } else if (i.type === 'habit' && !linked.has(i.id)) {
        if (doneDays(doc, i.id, idx).has(d)) continue;
        const due = i.repeat?.kind === 'perWeek' ? perWeekDays.get(i.id)?.has(d) : isHabitDue(doc, i, d, idx);
        if (due) add(i, false);
      }
    }
    for (const [a, byDay] of shares) {
      if (byDay.has(d) && !groups.has(a)) groups.set(a, { area: byDay.get(d).area, entries: [] });
    }
    const used = usedKeys.get(d) ?? new Set();
    for (const [a, g] of [...groups].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      g.entries.sort((x, y) => Number(y.carried) - Number(x.carried) || byOrder(x.item, y.item));
      let n = 0;
      for (const p of parts(g.entries, shares.get(a)?.get(d), g.area || 'Tasks', config)) {
        while (used.has(`${d}|${a}|${n}`)) n++;
        blocks.push({ key: `${d}|${a}|${n++}`, day: d, area: g.area, items: p.ids, minutes: p.minutes, carried: p.carried, base: p.base });
      }
    }
  }
  return { blocks };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/planner-demand.test.js` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add planner/demand.js tests/planner-demand.test.js
git commit -m "Add what needs time each day: blocks by area, lengths, splits, target shares, spread habits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
