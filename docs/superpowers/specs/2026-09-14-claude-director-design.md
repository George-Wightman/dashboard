# Claude as director — design

2026-09-14. Approved in brainstorming, question by question and in two parts. Builds on the Claude
skill (piece 3) and the calendar planner (piece 6).

## Where this came from

After a first week of Claude populating the dashboard and the planner landing, Claude sent George
four items: a Hevy integration, marking a day off, a notes field on tasks, and planner defaults /
area-calendar mapping. George's framing: *"I want to give Claude admin access to the app … he should
be hands on and really able to direct and control the app, whereas I can surface level observe and
mark off. Claude is the controller, the director."*

Decisions:

- **Roles** — a hybrid: George keeps full editing (*"I want to be able to rename things … change
  stuff as it is"*), but Claude is the main driver of change and gets abilities George doesn't, which
  George can see in ⚙ *"under Claude's tab"*.
- **Six abilities** for Claude, all taken: time off, notes, today's brief, priorities, planner
  control, an attention list.
- **Time off** stops everything by default; Claude may limit it to some areas (Maya's move: work areas
  off, Hebrew and Gym carry on).
- **Standing out** is by colour, not a ★ in the calendar: *"all AC related blocks are the same colour
  … shouldn't conflict with any other blocks' colour (red already for work), can be a subtle change
  from something like purple"*. This replaces giving an area its own new calendar.
- **Notes on the list**: a small mark, tapped to open (option A).
- **Hevy** (George has Pro) is a separate piece, designed later.

## 1. Time off

A record in the `calendar` map, id `off:<start day>` (`off:2026-09-16`, then `off:2026-09-16b` …),
`source: 'claude'`:

| Field | |
|---|---|
| `start`, `end` | Both `YYYY-MM-DD` (whole days, `end` included) or both `YYYY-MM-DDTHH:MM` (a stretch of hours, `end` not included) |
| `areas` | Area names it covers; `[]` means everything |
| `reason` | One line, shown wherever the time off shows |

Cancelling sets `status: 'archived'`. Whole days:

- **An item is excused** on a day inside whole-day time off that covers its area. An excused item is
  not on that day's list, not in its count, and never breaks a streak (the day is skipped, as if the
  habit weren't due). A task dated inside the time off carries over to the next day, with its usual
  *from Wed* marker.
- **The planner books nothing covered.** A task dated inside moves to the next day that isn't off for
  it; excused habits aren't booked; a weekly time target's share is spread over the days not off for
  its area.
- **History:** a day covered by time off for everything shows *off* instead of a score, with the reason
  on hover or tap.

A stretch of hours: the planner books nothing covered in it (the covered areas' blocks go round it);
nothing is excused. Hebrew and Gym events are George's and are never touched.

## 2. Notes

`notes` (text, up to 1000 characters) on tasks, habits, weekly targets and goals. On the list: a
small mark on rows that have notes; tapping it opens the note under the row (as weekly targets open
their entries). In the edit panel: a Notes box. In the calendar: the block's description starts with
its items' notes (*Title — note* when a block has several); the title stays the title.

## 3. Today's brief

A journal record, kind `brief`, id `brief:<day>`, `text` (up to 500 characters), `source: 'claude'`.
Shown under the date with Claude's logo, above the planner's notes, with × to hide it for the day.
Claude can write one for any day; in *plan my week* it writes the week's.

## 4. Priority

`priority: true` on a task or habit, or an area in the planner setting `priorityAreas`. Priority
blocks are placed first each day (before carried-over ones) and priority rows show a ★ on the list.
The calendar title is unchanged — distinctness there is colour (section 5).

## 5. Area colours

The planner setting `areaColors` maps an area to one of Google's event colours by name (Lavender,
Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato). All of the
area's exact blocks take it; rough blocks take its light partner (Graphite when it is already light).

**No clashes.** A colour is *taken* when it is the event colour nearest a watched calendar's colour,
or another area's. The planner ignores a taken colour and notes it (*Grape is taken by your
Application calendar — free: Sage, Flamingo, …*); it publishes the taken colours in its `status`
record, so Claude's tool refuses a clash up front. Removing an area's colour replaces its future
blocks with fresh ones in the calendar's own colour.

## 6. Planner control

- `dayHours`: planning hours for a date, `{"2026-09-18": ["09:00", "13:00"]}`.
- Object settings (`areaCalendars`, `areaColors`, `dayHours`) change one key at a time; `null` removes
  a key. So Claude can repoint one area without rewriting the rest.
- To fix a block's time, Claude moves it in the calendar through its connector; the planner already
  leaves moved blocks alone.

## 7. The attention list (for Claude)

From the document and the planner's records: tasks with no length (overdue or in the next 14 days);
what the planner couldn't fit, and its problems; tasks carried over 3 days or more; weekly targets
behind pace (less logged than `target × days gone / 7`); a taken area colour. A read for Claude, and a
section of ⚙ → Claude.

## 8. What George sees

- **Today:** the brief; a time-off line on time-off days (*Time off — Maya leaves for Austria · Job
  search, Assessment centre*); ★ on priority rows; the notes mark.
- **Last 3 weeks:** *off* days.
- **Edit panel:** Notes (items and goals). Priority, time off, colours and the brief are Claude's.
- **⚙ → Claude**, replacing the *Claude's changes* and *Calendar planner* groups: today's brief and
  the last 14; time off, current and coming; priorities and area colours; the planner (as the old
  group); the attention list; what Claude can do; Claude's changes with Details and Undo.

## 9. Claude's tool and skill

- `task`, `habit`, `target`, `goal` take `notes`; `task`, `habit` take `priority`; `edit` accepts both.
- New ops: `off` (`start`, `end`, `areas`, `reason`; or `cancel`), `brief` (`text`, `day`).
- `planner` op: the new settings and one-key changes; refuses unknown colour names, two areas sharing
  a colour, and colours the planner says are taken.
- Reads: `attention`; `today` shows the brief, time off, ★ and notes; `list` notes and ★; `day` the
  time off; `week` coming time off; `planner` the new settings and taken colours.
- `SKILL.md`: Claude directs — plans, prioritises, sets time off, writes briefs, colours areas; George
  ticks and renames. Check `attention` in *plan my week* and when asked how things stand.

## Data and versions

Additive: `schema` stays 1. `sw.js` → `dash-v8`, with `js/attention.js` and `js/ui/claude.js` in the
shell. The planner bundle is rebuilt; the skill zip is rebuilt for George to upload.

## Testing

Unit tests for every rule above: config checks and one-key merges; time-off readers; excusing in the
list, the count, streaks and history; the attention list; the planner with whole-day and hours time
off, area-limited time off, moved task dates, priority order, area colours and a clash, colour
removal, `dayHours`, notes in descriptions; the tool's ops and reads. The app checked in the browser
with seeded data.

## Out of scope

Hevy; creating calendars; a ★ in calendar titles; George editing priority, time off, colours or the
brief in the app (he asks Claude).
