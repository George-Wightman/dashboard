# The archive: a slim synced file, a full copy everywhere

20 November 2026. Approved idea "slim-file" (19 Nov review): move cold records into a yearly archive
file that only Claude and the history views read, keep the change log lean, aim for under 1 MB.
The safe half shipped the same day (f3f7831: changes leave after 21 days, month-old records drop
their per-field stamps). This is the other half.

## Why

`data.json` is read by every device about once a minute while the app is open, twice in every
planner run, by every widget refresh and by every Claude command. Over 1 MB, GitHub's contents API
stops sending the file inline, so every read takes two requests and downloads it all. It was 1.75 MB
on 20 Nov and 1.41 MB after f3f7831. It also grows for ever: nothing about a past day ever leaves.

## Goals

1. `data.json` under 1 MB, and staying there: it holds the last month or so, not all of history.
2. Nothing lost. Every record that leaves `data.json` is in an archive file first, read back.
3. Removal is the same on every device, the planner and Claude's tool. An older copy of a record can't
   come back, a newer edit to an archived record isn't swallowed, and a failed archive write drops
   nothing.
4. Every number the dashboard, the widgets and Claude show stays exactly what it is today: streaks,
   goal totals, PRs, the EU count, past days.

## Non-goals and anti-goals

- Not a change to what any view shows. No "load older history" button, no shorter charts.
- Not deleting anything. The archive keeps every record it is given, for good.
- **Anti-goal: a history view that quietly shows less.** A streak that resets or a goal total that
  drops because its old logs moved would be worse than a big file.
- **Anti-goal: a writer that puts back what moved.** Several writers create records by fixed id when
  they find none (Hevy ticks, Hebrew day logs, Duolingo days). If one of them can't see an archived
  record, it writes a fresh one that beats the archived version everywhere.

## What was measured (the real file, 20 Nov, 1,405 KB)

| Part | KB | Notes |
|---|---|---|
| Change log | 327 | all within 21 days; 71 KB of it is per-field stamps copied into the before/after snapshots |
| Gym | 265 | 134 workouts (207 KB) back to March 2025; all re-copied on 19 Nov |
| Meals | 168 | almost all from the last month |
| Calendar | 148 | day-keyed records (hours, EU days, commitments, time off) plus live settings |
| Items | 136 | 60 KB archived |
| Journal | 132 | 45 KB is the retired Coach's talks, never read again |
| Logs | 115 | |
| Flags | 66 | all archived |

Two findings shape the design:

- **Records are young.** Moving only records *untouched* for 30 days moves 307 KB and leaves 1,098 KB:
  still over. Almost everything was edited in the last month (the gym re-copy, the stamp strip). What
  makes a record cold has to be the day it is *about*, not when it was last touched.
- **History is read everywhere.** Streaks walk every log from a habit's start; goal totals add every
  amount ever logged; the gym's lift charts and PR board read every workout; the widgets show goal
  totals; the planner's Hevy step recreates any tick it can't find. A design where "history views
  read the archive" means changing dozens of readers and every one of those writers.

## Approaches

**A. A slim synced file, a full copy everywhere (recommended).** The archive is a transport detail.
Every place that opens the document works on the whole of it, exactly as today: each device keeps its
full copy (IndexedDB already holds everything) and merges the archive in; the planner, the widgets and
Claude's tool read `data.json` and the archive files together. Only what is *written* to `data.json`
changes: records the archive already holds are left out. No reader or writer changes, so no number
can change and no writer can put anything back. Cost: the planner, the widgets and each Claude command
read one more file (per year of archive); each device downloads the archive once when it changes.

**B. History readers read the archive.** Devices keep only recent records; streaks, goal totals, the
gym views, past days, the EU count, Claude's `history`, `day` and `catchup`, the widgets' goal tiles
and every fixed-id writer learn to fetch and merge the archive. This is the idea's literal wording,
but it touches 40-odd readers and writers, each a chance for a number to go quietly wrong or a record
to come back. Rejected.

**C. Compaction without an archive.** Strip workouts' sets sooner, trim meals, drop the retired
Coach's talks. Either loses content (ruled out) or isn't enough on its own. Rejected, except for one
safe piece kept below: the change log's snapshots stop carrying copies of sync stamps.

## The design (approach A)

### Files

- `data.json`: as now, minus archived records, plus one small record naming the archive
  (`calendar['archive:status']`).
- `archive/<year>.json` in the sync repo: an ordinary dashboard document (`schema: 1`, the same maps,
  the same record format, passes `isDoc`), holding the records about days in that year. Built with
  `mergeDocs`, so its records are normalised and lose month-old stamps like any other. Private, like
  `data.json`; nothing in the public code repo.

The pointer record:

```
calendar['archive:status'] = {
  id: 'archive:status', status: 'active', source: 'planner', ...
  files: { '2025': '<blob sha>', '2026': '<blob sha>' },  // the exact version of each year's file
  through: '2026-10-19',                                   // records about days before this have moved
  lastRun: '<ISO>', lastError: null, moved: 757,
}
```

The shas are git blob shas: content hashes. A client reads a year's file with
`GET /repos/<repo>/git/blobs/<sha>`, which always returns exactly that version (one request at any
size, and the relay already allows it).

### What makes a record cold

A record moves when the day it is about is before the cut, and it isn't one of the live kinds:

| Map | The day it is about | Never moves |
|---|---|---|
| logs, journal | `day` | |
| gym | `day` of `w:`, `h:`, `back:` | config, status, routines, templates |
| meals | `day` of a meal | usuals, batches |
| items | `archivedOn` if archived/dismissed; `date` of an active task (done or missed) | active habits, weekly targets, suggestions |
| goals, milestones | `archivedOn` if archived/dismissed | anything active |
| flags | `archivedOn` if not active | open flags |
| calendar | `day` of `hours:`, `work:`, `eu:`, `commit:`, `closed:`, `count:`, `conflict:`; end of `off:`; `to` of `payslip:` | settings, statuses, push devices, `day:1-7`, usage weeks (expire already drops those) |
| game | `day` of `day:` | claims and places (the map) |
| changes, workflow maps | | all (the change log expires on its own) |

**The cut is the Monday of this week less 28 days**, so the planner moves records once a week and
`data.json` holds the last four to five weeks. *My call:* nothing on screen depends on it (every
client still sees everything), so it only trades file size against how often the archive changes.
Weekly means devices download a new archive once a week, not daily, for about 40 KB more in the file.

Getting this rule slightly wrong is harmless. A record that moves and is then edited simply comes back
into `data.json` (below) and moves again the next week.

### Who writes the archive: the planner, once a week

The planner is the only writer of archive files. On a run where `through` is before this week's cut
(or there is no pointer yet):

1. Open the document as every run does: `data.json` plus the archive files the pointer names (the
   whole document).
2. Pick the records about days before the cut that the archive doesn't already cover (below). None:
   just move `through` on.
3. For each year they fall in: read `archive/<year>.json` (none yet: an empty document), merge them
   in with `mergeDocs`, and write it with its sha.
4. Read each written file back by the blob sha GitHub returned, and check it is a valid document. A
   year whose write or read-back failed keeps its old sha in the pointer.
5. Update the pointer (new shas, `through`, `moved`, `lastError`) with `putRecord`. The run's normal
   save then leaves the newly covered records out of `data.json`.

It never runs twice at once (the script lock), retries on the next run if anything failed, and writes
nothing when nothing is waiting. A failure is a sentence in `lastError`, shown in ⚙ like the
planner's others.

### How removal stays the same everywhere: "covered"

One rule, in one function (`js/archive.js`), used by every client before it writes `data.json`:

> **A record is left out of `data.json` when the archive covers it**: the archive (every year file the
> pointer names, merged) holds a version of that record, and merging this copy into that version
> changes nothing about its content.

Everything else goes into `data.json` as now. Why this is safe:

- **Nothing leaves before the archive has it, read back.** The rule only drops a record the archive
  file *as read by its hash* already holds. If the archive write failed, the pointer still names the
  old file, which doesn't hold the record, so it stays. A half-written archive is never named.
- **The same on every device.** The rule depends only on the record and the archive, and the pointer
  names the archive by content hash, so every client given the same document drops the same records.
  No clock is involved.
- **An older copy can't bring a record back.** A device with an old version of an archived record
  merges the archive in, and the archive's version is newer, so it is covered and left out again.
- **A newer edit isn't swallowed.** If George (or Claude, or the planner) edits an archived record,
  the edit is newer than the archive's version, so it isn't covered: it goes back into `data.json`,
  reaches every device, and moves into the archive at the next weekly run.
- **Writers can't put anything back**, because every writer works on the whole document and so finds
  the archived record where it always was.

### Who reads the archive

Every place that opens the document gets the whole of it, so no reader or writer changes:

| Opens the document | How it gets the archive | Reads that need old records (unchanged) |
|---|---|---|
| The dashboard, each device | its own full copy (IndexedDB) plus each archive file, downloaded once per new sha, kept in IndexedDB, merged in on the first sync after a load and whenever the pointer changes | habit streaks and best runs, goal totals and reviews, past days and their scores, the gym's lift charts, PR board and year grid, the Hebrew log, the EU count, Hours and payslips, flags, the change log's undo |
| Claude's tool (`claude/session.js`, so every command and the dev scripts) | reads the pointer's files after `data.json` | `history`, `day <date>`, `catchup`, `usage`, goal and gym reads, undo |
| The planner's run (`planner/gas.js` `open`) | the same, each run | Hevy ticks and set-stripping, Health, Duolingo, Hebrew day logs, goal reviews, the plan's done checks |
| The widgets (`planner/glance.js` `handleGlance`) | the same, each refresh | goal totals, today, this week |

Two writers deliberately stay on `data.json` alone: the widget's tap actions (`glanceAct`) and the
calendar ✓ link (`tick`). Both read, change today and write back in one go; they only ever add today's
tick or minutes, never look at the past, and never had the archived records to put back. The relay
passes files through and already allows `archive/` paths and blobs.

When a client can't read an archive file the pointer names, it says so and doesn't write `data.json`
that round (a device keeps its changes and tries again at the next sync); it never writes a copy that
would put archived records back. Claude's tool and the planner stop with the error, as they do when
`data.json` can't be read.

### The change log, leaner

Each change's before/after snapshots carry a copy of the record's per-field sync stamps: 71 KB of the
327 KB. Nothing reads them (undo compares and restores content, then stamps afresh). New snapshots
leave them out, and the merge's `expire()` strips them from existing ones, the same on every copy.

### Size

Dry estimate on the real file with the cut at 19 Oct: 757 records (495 KB) move, 20 KB of them to
`archive/2025.json` and 475 KB to `archive/2026.json`. `data.json` goes from 1,405 KB to about 910 KB,
and to about 840 KB with the snapshot stamps gone. Week to week it should stay between roughly 840 and
900 KB; the change log is what swings it (a heavy week of Claude edits adds up to 100 KB).

Built and dry-run on a fresh copy the same evening (`dev/archive-dry-run.mjs`, cut 19 Oct): 744 records
move, `data.json` goes from 1,407 KB to 848 KB (1,335 KB from the snapshot stamps alone), and the archive
files are 20 KB and 468 KB. Every check passed: the slim file and the archive together hold every record
unchanged, an old full copy merged back is left out again, and both files are ordinary documents.

Requests: a device's every-minute check drops to one request (and still costs nothing when the file
hasn't changed); a new archive is one more download a week. The planner, a widget refresh and a Claude
command read one more file per archive year in place of the second request they make today.

### Rollout

- The planner loads its code from the site, so it moves to the new version (and makes the first cut)
  on its first run after the push.
- Devices pick up the new app on their next load. Until then an older copy pushes its full document,
  putting archived records back into `data.json`; the next new client's write leaves them out again.
  Bigger for a while, nothing lost.
- Claude in an ordinary chat needs nothing: the skill's `run.sh` clones the latest code at every run,
  so it reads the archive from the push on. (The skill's own docs didn't change, so no re-upload.)
- After the push I compare the first real cut against a copy of `data.json` taken before it.

## Tests (invented data only)

- Covered: an exact copy and an older copy are left out; a newer edit, a record the archive lacks and
  a stamped copy whose content matches are handled as above; the result is the same in either merge
  order.
- An old copy merged back after a cut changes nothing in `data.json` or in the full document.
- `syncOnce` with an archive: pushes the slim document, keeps the full one locally, doesn't push when
  the named archive can't be read, merges a new archive in once.
- The planner's weekly cut: picks by the table above; writes per year; a failed write or read-back
  leaves the pointer alone and drops nothing; a second run the same week does nothing; a late edit
  comes back and moves again.
- Claude's session, the planner's `open` and `handleGlance` see archived records.
- Snapshots without stamps: undo still works on old and new changes.

## Dry run on the real file

A script (`dev/archive-dry-run.mjs`, nothing written to GitHub) runs the cut on a fresh copy of
`data.json`, prints the sizes of `data.json` and each archive file, and checks that the slim file plus
the archive, merged, equals the original record for record, and that merging the original back in
leaves nothing extra in the slim file.

## Left to the builder

- Module layout (`js/archive.js` for the rule, the cut and the pointer; the device's archive cache
  beside `js/docstore.js`; the planner's weekly step in its own file).
- Error wording.
- Whether the device's cached archive files go in the existing `dash_files` database or their own.
