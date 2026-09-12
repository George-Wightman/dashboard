# Look, widgets and flags — design

2026-09-12. Approved in brainstorming (mockups in the visual companion). Three changes to the
hub, built together because they touch the same screen:

1. **Look** — the Hebrew app's Paper & Ink palette by day, a Night version in the evening, and an
   installed-app title bar that matches the page.
2. **Layout and widgets** — a wider, larger page that uses a big window, and a right-hand side made
   of widgets you can move, reorder and hide, ready for future integrations.
3. **Flags** — the Hebrew app's flag: note something to change, from inside the app, with what the
   app was doing at that moment, carried to GitHub by the sync.

## Where this came from

George, on the installed app at 1912×1000: the page is "glued to the top", not using the space,
"too dark / not enough contrast", and the dark page clashes with a light title bar. He wanted the
Hebrew app's Paper & Ink style, then — shown both a Paper and a Night version — *"lets have it as a
'follow the time of day effect'… in the day the ink and the night mode version for evenings…
when it turns 6 and the coach asks me it changes then."* On layout he chose the wider, larger
version plus a third column on wide windows, and asked for widgets that are *"movable and
customisable (we may want to add more later like custom integrations…)"*. Then: *"I would like the
flag feature from the Hebrew app, so if any bugs come up / changes I can flag in the app."*

## 1. Look

### Two palettes, one set of colour jobs

Colours keep the Hebrew app's rule (its style guide §3): **teal = something you can act on**,
**gold = "you did this"** (streaks, a target met, a finished weekly habit), **amber = carried over**.
Gold is new to the dashboard and is used for nothing else. Amber replaces today's orange carry
marker.

| Token | Paper (day) | Night (evening) | Used for |
|---|---|---|---|
| `--bg` | `#f5f0e7` | `#1c232b` | page, title bar |
| `--panel` | `#fffdf8` | `#252e38` | list, cards, dialogs |
| `--ink` | `#22303c` | `#eef1ed` | text |
| `--muted` | `#6b7a88` | `#a8b3be` | secondary text |
| `--border` | `#e4ded1` | `#36424e` | lines |
| `--accent` | `#0d6e6e` | `#4fb8ac` | teal: buttons, ticks, bars, links |
| `--accent-soft` | `#e3f0ee` | `#20413f` | tags, soft fills |
| `--gold` | `#b3803a` | `#e0ae62` | streaks, targets met |
| `--warn` | `#c07a2e` | `#eb9a52` | carry-over marker |
| `--bad` | `#b3453a` | `#f0806f` | errors, "sync failing" |
| `--lvl1`–`--lvl4` | `#e3f0ee` `#b8d9d4` `#6fb0a7` `#0d6e6e` | `#20413f` `#2d6660` `#3f958b` `#4fb8ac` | history shading |

Paper is the Hebrew app's `:root` exactly; Night is the same jobs on an inky blue-grey with brighter
text. The date heading uses the Hebrew app's display face (`Georgia, "Times New Roman", serif`);
everything else stays the system sans-serif. The `prefers-color-scheme` block is removed — the look
no longer follows the operating system.

Existing token names in `styles.css` (`--surface`, `--text`, `--line`, `--carry`, `--danger`) are
renamed to these so both apps share one vocabulary.

### When it switches

Device-local setting `look`: `'auto'` (default, "Follow the day"), `'paper'`, `'night'`.

`resolveLook(now, { look, checkinHour, dayStartHour })` in `js/look.js` (pure):

- `'paper'` / `'night'` → that.
- `'auto'` → Night when `now.getHours() >= checkinHour` **or** `now.getHours() < dayStartHour`,
  Paper otherwise. With the defaults that is Night from 18:00 until 04:00 — it turns at the moment
  the coach starts offering the check-in, and back at the day rollover.
- If the two hours meet (both 12, the only overlap the settings allow) it is always Night.

The page applies it as `document.documentElement.dataset.theme = 'paper' | 'night'`, re-checked on
the existing one-minute tick, on focus/visibility, and on every settings change.

**No flash at night.** `app.js` is a module and runs after first paint, so `index.html` carries a
six-line inline script in `<head>` that sets `data-theme` from `localStorage['dash_settings']` before
the body paints. It duplicates `resolveLook`'s rule by necessity; a Node test extracts that inline
script from `index.html` and checks it agrees with `resolveLook` for every hour and a spread of
settings, so the two can't drift.

### Title bar

`<meta name="theme-color">` is set to the current `--bg` whenever the look changes (the installed
Chrome app colours its title bar from it). `manifest.webmanifest` `theme_color` and
`background_color` become Paper's `#f5f0e7`.

### ⚙

A **Look** row: *Follow the day (Paper, then Night from the check-in hour)* · *Paper* · *Night*.

## 2. Layout and widgets

### Size

- The page (header and columns) is `width: min(88vw, 1500px)`, centred, with ~2.5rem at the top.
- Base type goes from 15px to **17px** on windows ≥ 1100px wide (15px below); sizes in `styles.css`
  move to `rem` where they are fixed in `px` so rows, gaps and controls scale with it.

### Columns

- **≥ 1500px:** today's list + **two** widget columns (`1.35fr 1fr 1fr`).
- **760–1499px:** today's list + **one** widget column (`1fr 340px`).
- **< 760px:** one column: the list, then the widgets.

Today's list is fixed in the first column and is not a widget.

### Widgets

`js/ui/widgets.js` holds the registry: `WIDGETS = [{ id, title, render(ctx) }]` for
`coach` (Coach), `week` (This week), `goals` (Goals), `history` (Last 3 weeks) — the existing
panel renderers, moved, not rewritten. A widget's `render` may return `null` when it has nothing to
show (This week with no targets); outside Arrange mode it is then skipped.

### The arrangement (device-local, never synced)

`localStorage['dash_layout']` = `{ v: 1, columns: [[ids], [ids]], hidden: [ids] }`. Laptop and phone
keep their own.

Pure functions in `js/layout.js`, all tested:

- `DEFAULT_LAYOUT` = `{ v: 1, columns: [['coach', 'week'], ['goals', 'history']], hidden: [] }`.
- `normalizeLayout(saved, knownIds)` → drops unknown ids and duplicates, always two columns, and
  appends any known id that appears nowhere (a new widget) to the end of column 0. Unreadable
  saved data → `DEFAULT_LAYOUT`.
- `visibleColumns(layout, count)` → for `count` 2: the two columns without hidden ids; for 1: column
  0 then column 1 as one list.
- `moveWidget(layout, id, toColumn, beforeId | null)` → removes `id` and inserts it before
  `beforeId` in `toColumn`, or at its end.
- `nudgeWidget(layout, id, dir)` (`-1` up, `+1` down) → moves one step in the single-column order;
  crossing the boundary moves it into the other column at the matching end.
- `hideWidget(layout, id)` / `showWidget(layout, id)` (shown again at the end of column 0).

### Arrange mode

An **Arrange** link sits in the header next to ⚙, at every window width (on a phone the header
wraps, as it already does). Clicking it sets `ui.arranging`:

- Today's list dims and says "Today's list stays here".
- Each visible widget gets a dashed outline, a grip (`⋮⋮`, draggable) and **Hide**. On touch
  devices (`(pointer: coarse)`) and in the one-column layout the grip is replaced by **↑ ↓** buttons
  (`nudgeWidget`).
- Dragging a widget onto another inserts it before that one; onto a column's empty drop zone puts it
  at the end.
- Hidden widgets appear in an **Add a widget** row below the columns as `+ Title` chips.
- Empty widgets render a placeholder ("Nothing to show yet") so they can still be moved.
- The header link reads **Done**; clicking it (or Escape) leaves Arrange mode.

The arrangement is saved on every change. Typing protection, sync and focus restoration
(`data-focus`) work as they do now — they already look for the whole side area, which becomes the
widget columns.

## 3. Flags

The Hebrew app's feature (`docs/superpowers/specs/2026-08-28-flagging-things-to-change-design.md`
and `2026-08-29-resolving-flags-design.md` in that project), carried over as-is where it applies.

### The button

A pennant **⚑** in the header, left of Arrange and ⚙, titled "Note something to change". Grey
normally; **teal** when a flag has been written or addressed on this device but has not reached
GitHub yet — shown only when sync is set up, so it never becomes permanent wallpaper. Steady, never
pulsing.

### The panel

A `<dialog>` like Settings:

- An **About:** line showing, before he types, what the flag will capture (e.g. "Today · Night look ·
  3 of 8 done · Coach: check-in waiting · synced 18:04").
- A focused textarea ("What would you change about this?"), **Save** (or Ctrl+Enter). Saving writes
  the flag, clears the box, shows "Saved.", and asks for a sync straight away.
- The open flags, newest first: his sentence, when, **More details** (the captured context), and
  **Mark addressed**.
- "N addressed" as a single count when there are any — no archive list.
- One line at the bottom on whether they have reached GitHub: "All flags have reached GitHub" /
  "1 flag hasn't reached GitHub yet · Sync now" / "Sync is off — flags stay on this device until you
  add the sync repo in ⚙".

Opening it changes nothing on the page underneath.

### What a flag holds

A new map `flags` in the synced document. A flag is a normal record (`id`, `updated`, `source: 'me'`,
`status`, `created`, `archivedOn`) plus:

- `text` — his sentence, trimmed, at most 1000 characters.
- `ctx` — `flagContext(state)` (pure, in `js/flags.js`), captured at the moment the panel opened:
  time, logical day, look and look setting, window size, column count, the arrangement, whether
  Arrange mode was on, today's done/total, expanded goals count, the open history day, the coach
  state (check-in state, busy flags, last error texts), the sync state (state, last error, last
  successful sync time), whether a sync repo / GitHub key / Gemini key are set (**booleans only —
  never the values**), the app version (the service worker cache name), and a short user agent.
  Capped at 4 KB when serialised.

**Mark addressed** sets `status: 'archived'` and `archivedOn` — nothing is ever deleted. The existing
merge (later `updated` wins per record) already gives "addressed anywhere wins", because addressing
is always the later write; there is deliberately no un-address.

"Hasn't reached GitHub yet": after every successful sync the device stores the time in
`localStorage['dash_last_synced']`; a flag is waiting when its `updated` is later.

### Reaching Claude

Flags ride the sync into `dashboard-sync/data.json`. Reading them from Claude's side — and ticking
off the ones fixed — belongs to the Claude integration, the next piece; this spec only makes sure
they are there, complete, and addressable.

## Integration with existing code

- `MAPS` gains `flags`; `emptyDoc`, `isDoc`, `mergeDocs` and record normalisation treat it like
  `journal`, and documents written before it existed merge and load cleanly (tests, as for
  `journal`).
- The store gains `addFlag(text, ctx)` and `addressFlag(id)`.
- `sw.js`: `CACHE` → `dash-v3`; SHELL gains `js/look.js`, `js/layout.js`, `js/flags.js`,
  `js/ui/widgets.js`, `js/ui/flags.js`.
- README: the look, Arrange mode, and flags, briefly.

## Testing

Node tests:

- `resolveLook`: every hour of the day for the defaults; custom check-in and day-start hours; the
  fixed settings; the 12/12 overlap.
- The inline `<head>` script agrees with `resolveLook` (extracted from `index.html` and run in a
  `vm` sandbox with a fake `localStorage`/`document`).
- `normalizeLayout`, `visibleColumns`, `moveWidget`, `nudgeWidget`, `hideWidget`, `showWidget`,
  including unknown/duplicate/new ids and crossing columns.
- Flags: store add/address, merge of a flag addressed on one side, a document from before `flags`
  existed, `flagContext` never containing the token or Gemini key values, the 4 KB cap.

Browser checks (controller): both looks and the switch at the check-in hour (by changing the setting
and by faking the clock), the title-bar colour (`meta[name=theme-color]`), the three window widths,
Arrange mode (drag across columns, nudge on a narrow window, hide, add back, Done, persistence after
reload), and the flag panel (save, details, address, the three sync lines, teal button state).
Screenshots of Paper and Night at 1900px for the report.

## Out of scope

Per-widget settings; new integration widgets; un-addressing a flag; a screenshot in a flag (as in the
Hebrew app — George sends photos himself when a picture is the point); reading flags from Claude's
side (next piece).
