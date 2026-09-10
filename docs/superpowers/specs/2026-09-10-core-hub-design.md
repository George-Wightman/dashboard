# Dashboard — core hub design

2026-09-10. Piece 1 of 6. Approved in brainstorming, section by section.

## The whole programme

A personal "start of the work day" dashboard. Open the laptop, it's already on screen: what
have I got today, tick things off as I go. Six pieces, each with its own spec → plan → build:

1. **Core hub** — this spec
2. **Hebrew auto-tick** — read practice minutes from the Hebrew app's sync file
3. **Claude connector + skill** — a custom connector so Claude, in any chat, can see the
   dashboard and add to it
4. **Job search + Notion** — application counts and deadlines from the Notion Job Tracker
5. **Gemini coach** — goal shaping, evening check-in, weekly digest
6. **Google Calendar** — today's events alongside the list

Pieces 2–6 must not require changes to the hub's data model. This spec therefore fixes the
data format all of them write into (see *Integration contract*).

## Purpose and success

- **Laptop first.** Installed as a Chrome app, launched on Windows sign-in, sits open all day.
  The phone gets the same page, stacked; usable, not the priority.
- **Minimal.** One screen. The essential information up front, nothing to navigate to.
- **Success:** at 9am the day's list is on screen without a click, ticking and logging take one
  action each, and the phone and the laptop agree within seconds of either being opened.

## Data model

Four record types. Every record carries:

| Field | Meaning |
|---|---|
| `id` | Random unique id (importers may use deterministic ids — see contract) |
| `updated` | ISO timestamp of the last change; drives merge |
| `source` | `me` · `claude` · `gemini` · `hebrew` · `notion` |
| `status` | `active` · `suggested` · `dismissed` · `archived` |
| `created` | Logical day the record was created (history only counts an item from here) |
| `archivedOn` | Logical day it was archived, if it was (history stops counting it after this) |

Nothing is ever hard-deleted. Archiving, dismissing and un-ticking are all status or tombstone
changes, so a sync can never resurrect something removed on another device.

### Item

The one thing that appears on Today. Common fields: `title`, `area` (optional free-text tag,
e.g. "Job"), `goalId` (optional), `order` (number, for manual ordering). Three types:

- **`task`** — one-off. `date` (YYYY-MM-DD). If not done by the end of its day it carries
  forward to every following day until done, showing an orange marker: *from Tue* (within the
  last 6 days) or *from 3 Sep* (older). Its `date` never changes — the marker is computed.
- **`habit`** — repeating tick. `repeat` is one of:
  - `{kind: "daily"}`
  - `{kind: "weekdays", days: [1,3,5]}` — ISO weekday numbers, Mon = 1
  - `{kind: "perWeek", n: 3}` — shown every day until done `n` times that week, then gone
    for the rest of the week
  - `{kind: "weekly", day: 7}` — one weekday
  - `{kind: "monthly", date: 1}` — day of month; 29–31 fall on the last day in short months
- **`quota`** — weekly amount target. `target` (number) and `unit`: `count` (label e.g.
  "applications") or `minutes` (displayed as hours). Shown every day as `3 / 5 this week` with
  a **+**. Once met it shows as met and sinks to the bottom. Quotas have no tick box.

### Log entry

What happened. `itemId` or `goalId`, `day` (logical day, YYYY-MM-DD), `kind`, `at` (ISO
timestamp), optional `note`.

- `kind: "done"` — ticks a task or habit for that day. Un-ticking sets `status: "archived"` on
  the entry (a tombstone).
- `kind: "amount"` with `amount` (number; minutes for minute quotas) — one per quick-add.
  Amounts are **summed**, and each is its own record, so 30 minutes logged on the laptop and 20
  on the phone total 50. (This deliberately avoids the Hebrew app's max-per-day undercount.)

### Goal

`title`, optional `targetDate`, optional numeric target `{target, unit}`. Progress: if a numeric
target is set, the sum of `amount` log entries against the goal ÷ `target`; otherwise milestones
done ÷ milestones total. Items with a matching `goalId` are listed under it when expanded.

### Milestone

Its own record, not nested in the goal, so ticking one on the phone and renaming another on the
laptop both survive a merge. `goalId`, `title`, `done` (bool), `order`.

### Suggestions

Unprompted AI proposals (piece 5's goal shaping, Claude proposing something on its own) are
written as `status: "suggested"`. They show dimmed at the top of Today (items) or in the Goals
panel (goals, milestones) with ✓ (→ `active`) and ✕ (→ `dismissed`). Things added because George
explicitly asked Claude in chat are written `active` and show a small *added by Claude* marker.
The hub supports both; which to use is the writer's decision, not the hub's.

## Derived values

All pure functions of the data and the current logical day.

- **Logical day.** A day starts at **04:00** local time (setting, default 4), so working past
  midnight counts as the day before. Weeks run Monday–Sunday.
- **Today's list:** active tasks dated today, carried-over undone tasks, habits scheduled today
  (per the rules above), all active quotas, and suggested items at the top.
- **Order:** suggestions first; then undone rows in manual `order`; then done/met rows, faded.
  Drag reorders by rewriting `order`.
- **"X of Y done"** in the header counts tasks and habits on today's list. Quotas are excluded —
  they're weekly and have their own bars.
- **Streaks**, current and best:
  - `daily` / `weekdays` / `weekly` / `monthly` habits — consecutive scheduled occurrences
    done.
  - `perWeek` habits and quotas — consecutive weeks meeting the target.
  - An occurrence still in progress (today, this week) counts if already met and never breaks
    the streak until it's over. Tasks have no streak.
- **Day completion** (history): done ÷ (tasks and habits that appeared on that day's list).

## Screen

One screen. Laptop layout, two columns:

- **Header:** date · *X of Y done* · sync status (*synced 08:52* / *sync failing*) · ⚙.
- **Left, most of the width:** the flat list. Each row: tick box, title, area tag, and where
  relevant the orange carry-over marker, streak count, or weekly count. Quota rows: count and
  **+**. Below the list, the add box: typing a title creates a task for today; a toggle picks
  tomorrow or a date.
- **Right, narrow column:**
  - *This week* — one bar per quota.
  - *Goals* — title and %. Click to expand in place: milestones checklist, linked items,
    target date, numeric quick-add.
  - *Last 3 weeks* — current week and the two before, Mon–Sun columns, each day shaded by
    completion with its `done/total`. Future days blank. Click a day for what was done and
    missed.
- **Quick-add on quotas.** Count: click **+** for +1, shift-click (or long-press on phone) to
  type an amount. Minutes: **+** opens a small input accepting `45m`, `1.5h`, `1h30`. Click a
  quota's count to see this week's entries and remove a mistaken one.
- **Edit panel** slides in from the right: add/edit item or goal — type, title, area, goal,
  repeat rule or target. Archive, never delete.
- **Settings** (⚙): GitHub token and sync repo, day-start hour, export/import backup file.
- **Phone (< 760px):** the right column stacks under the list. Nothing removed.
- **Look:** plain and quiet. System font, neutral greys, one accent colour, follows the OS
  light/dark setting. Orange only for carry-over markers.

**Launch with the laptop:** a web app manifest and a service worker make it installable in
Chrome as its own window and usable offline. The README explains setting it to start on sign-in
(Chrome's installed-app option, or a shortcut in the Windows Startup folder).

## Storage and sync

- **Local.** One JSON document in `localStorage` under `dash_data`:
  `{schema: 1, items, goals, milestones, logs}`, each a map keyed by `id`. Device-local
  settings (token, repo, day-start) under `dash_settings`, never synced. Expected size: tens of
  log entries a day, a few hundred KB a year — well inside the ~5MB allowance.
- **Remote.** The same pattern as the Hebrew app. A private repo `dashboard-sync` holding
  `data.json`, written through the GitHub Contents API with a fine-grained token scoped to that
  one repo (contents read/write). The code repo `dashboard` is public, on GitHub Pages, and
  holds no data.
- **Flow.** GET remote (content + `sha`) → merge into local → apply locally → PUT with `sha`.
  On 409, repeat, up to 3 attempts; then give up quietly until the next trigger.
- **Triggers.** On open; when the window regains focus; 5 seconds after the last change
  (debounced); a manual sync button in the header. Never while an edit panel has unsaved input.
- **Merge.** Per record, across all four maps: the record with the later `updated` wins; a tie
  is broken by comparing the two records' JSON so every device picks the same winner. Because
  every quick-add is its own record and nothing is hard-deleted, "later wins per record" is the
  only rule needed.
- **Day rollover.** Checked every minute and on focus. When the logical day changes, Today is
  rebuilt: carry-overs appear, new habits are scheduled, completion for yesterday is final.

## Integration contract

Later pieces write into the same `data.json`, through the same merge, as if they were another
device:

- They create items, goals, milestones and log entries with their own `source`, and choose
  `active` or `suggested`.
- Importers that mirror an external total (e.g. Hebrew minutes per day) use **deterministic
  ids** such as `hebrew:2026-09-10`, so re-importing updates one record instead of adding a
  duplicate.
- `schema` is bumped only by additive changes; the hub ignores fields it doesn't know.

## Failure handling

Never blocks, never shows a dialog for a background problem.

- No token or repo → sync is off; the header says *on this device*.
- Offline → skipped, retried at the next trigger.
- API error → *sync failing* in the header, with the reason on hover.
- A merge that throws → keep local, push nothing, report it the same way.
- A `localStorage` write that fails (quota) → a visible warning in the header.
- Settings → export writes the whole document to a file; import merges a file in (same merge
  rules, so importing an old backup cannot overwrite newer work).

## Code layout

Plain HTML, CSS and JavaScript modules. No build step, no framework.

| File | Job |
|---|---|
| `index.html` | The page shell |
| `styles.css` | The look |
| `js/data.js` | Load/save the document, create and update records |
| `js/schedule.js` | Pure: logical day, what's on today, carry-over, streaks, weekly totals, completion, quick-add parsing |
| `js/merge.js` | Pure: merging two documents |
| `js/sync.js` | GitHub reads and writes, triggers, retries |
| `js/ui.js` | Rendering the screen and handling input |
| `sw.js`, `manifest.webmanifest` | Offline and install |
| `tests.html` | Runs the test suites in the browser |

## Testing

`tests.html` runs self-contained suites against the pure modules:

- **Schedule:** each repeat kind; `perWeek` dropping off once met; monthly on the 31st in short
  months; the 04:00 boundary; carry-over markers (*from Tue* vs *from 3 Sep*).
- **Streaks:** each rule, including an unfinished today/this week not breaking a streak.
- **Totals and completion:** weekly quota sums, day completion, header count excluding quotas.
- **Quick-add parsing:** `45m`, `1.5h`, `1h30`, bare numbers, rejects nonsense.
- **Merge:** commutative (same result whichever side is local), idempotent (merging twice
  changes nothing), never drops a record, tombstones stay tombstoned.

Manual check before calling it done: edit on the laptop and the phone at once, confirm both
converge and amounts sum.

## Out of scope for piece 1

Hebrew import, the Claude connector, Notion, Gemini, Google Calendar, notifications, a timer,
multiple users, and any dashboard-to-Notion summary.
