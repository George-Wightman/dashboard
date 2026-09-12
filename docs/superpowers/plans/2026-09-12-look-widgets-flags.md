# Look, Widgets and Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the hub the Hebrew app's Paper & Ink look by day and a Night version from the check-in hour (with a title bar that matches), a wider and larger page whose right-hand side is made of widgets George can move, reorder and hide, and the Hebrew app's ⚑ flag for noting something to change, carried to GitHub by the sync with what the app was doing at that moment.

**Architecture:** Three new pure modules, all unit-tested under Node: `js/look.js` (which look for a moment, mirrored by a six-line inline `<head>` script that a test runs in `vm` against it), `js/layout.js` (the device-local widget arrangement and every change to it) and `js/flags.js` (the flag context, its 4 KB cap, and the panel's readers). The synced document gains a `flags` map and the store `addFlag` / `addressFlag`. `styles.css` gets the two palettes under `data-theme`, gold and amber jobs, and type in `rem`. The browser layer gains `js/ui/widgets.js` (the widget registry, rendering the columns from the arrangement, and Arrange mode) and `js/ui/flags.js` (the ⚑ panel).

**Tech Stack:** HTML, CSS, JavaScript ES modules. Node 24's built-in `node:test` (and `node:vm` for the inline-script test). No npm dependencies, no build step, no framework. `python -m http.server 8080` (`preview_start` `dashboard`) to serve locally.

**Spec:** [`docs/superpowers/specs/2026-09-12-look-widgets-flags-design.md`](../specs/2026-09-12-look-widgets-flags-design.md) — read it before starting any task. The earlier plans ([`2026-09-10-core-hub.md`](2026-09-10-core-hub.md), [`2026-09-11-gemini-coach.md`](2026-09-11-gemini-coach.md)) describe the code this builds on.

## Global Constraints

Standing project rules:

- No build step, no framework, **no npm dependencies** (not even dev ones).
- Test command, from the repo root: `npm test` (runs `node --test tests/*.test.js`; 189 tests before
  this plan). Every task ends with the whole suite passing.
- Nothing is ever hard-deleted — archive, dismiss, or tombstone. A flag is addressed by archiving it.
- Work on the branch **`look-widgets-flags`**. Commit after every task. Every commit message ends with
  a blank line and then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never** `git push`. Never create or modify GitHub repos.
- Never read, print or log the values of `dash_settings.token`, `dash_settings.geminiKey`,
  `hvr_geminikey` or `hvr_geminikey2`. Browser checks run with `?fakegemini` and never type a real key.
- Settings (`dash_settings`), the arrangement (`dash_layout`) and the last sync time
  (`dash_last_synced`) are device-local and never synced. Every `localStorage` access outside the store
  is wrapped in try/catch.
- Something half-typed in `#list` / `#side` must never be wiped: `typing()` / `canRun()` in `js/app.js`
  and `keptFocus` / `restoreFocus` (`data-focus`) keep working, with `#side` still the id of the whole
  widget area.

Binding values from the design (copied verbatim; do not change them):

- **Colour jobs:** "**teal = something you can act on**, **gold = "you did this"** (streaks, a target met, a finished weekly habit), **amber = carried over**. Gold is new to the dashboard and is used for nothing else. Amber replaces today's orange carry marker."
- **Palettes:**

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

- **Token names:** "Existing token names in `styles.css` (`--surface`, `--text`, `--line`, `--carry`, `--danger`) are renamed to these so both apps share one vocabulary."
- **Type and OS:** "The date heading uses the Hebrew app's display face (`Georgia, "Times New Roman", serif`); everything else stays the system sans-serif. The `prefers-color-scheme` block is removed — the look no longer follows the operating system."
- **The setting:** "Device-local setting `look`: `'auto'` (default, "Follow the day"), `'paper'`, `'night'`."
- **The rule:** "`resolveLook(now, { look, checkinHour, dayStartHour })` in `js/look.js` (pure): `'paper'` / `'night'` → that. `'auto'` → Night when `now.getHours() >= checkinHour` **or** `now.getHours() < dayStartHour`, Paper otherwise. With the defaults that is Night from 18:00 until 04:00 … If the two hours meet (both 12, the only overlap the settings allow) it is always Night."
- **Applying it:** "`document.documentElement.dataset.theme = 'paper' | 'night'`, re-checked on the existing one-minute tick, on focus/visibility, and on every settings change."
- **No flash:** "`index.html` carries a six-line inline script in `<head>` that sets `data-theme` from `localStorage['dash_settings']` before the body paints … a Node test extracts that inline script from `index.html` and checks it agrees with `resolveLook` for every hour and a spread of settings."
- **Title bar:** "`<meta name="theme-color">` is set to the current `--bg` whenever the look changes … `manifest.webmanifest` `theme_color` and `background_color` become Paper's `#f5f0e7`."
- **⚙:** "A **Look** row: *Follow the day (Paper, then Night from the check-in hour)* · *Paper* · *Night*."
- **Size:** "The page (header and columns) is `width: min(88vw, 1500px)`, centred, with ~2.5rem at the top. Base type goes from 15px to **17px** on windows ≥ 1100px wide (15px below); sizes in `styles.css` move to `rem` where they are fixed in `px`."
- **Columns:** "**≥ 1500px:** today's list + **two** widget columns (`1.35fr 1fr 1fr`). **760–1499px:** today's list + **one** widget column (`1fr 340px`). **< 760px:** one column: the list, then the widgets. Today's list is fixed in the first column and is not a widget."
- **Widgets:** "`js/ui/widgets.js` holds the registry: `WIDGETS = [{ id, title, render(ctx) }]` for `coach` (Coach), `week` (This week), `goals` (Goals), `history` (Last 3 weeks) — the existing panel renderers, moved, not rewritten. A widget's `render` may return `null` when it has nothing to show (This week with no targets); outside Arrange mode it is then skipped."
- **The arrangement:** "`localStorage['dash_layout']` = `{ v: 1, columns: [[ids], [ids]], hidden: [ids] }`. Laptop and phone keep their own." "`DEFAULT_LAYOUT` = `{ v: 1, columns: [['coach', 'week'], ['goals', 'history']], hidden: [] }`." "`normalizeLayout(saved, knownIds)` → drops unknown ids and duplicates, always two columns, and appends any known id that appears nowhere (a new widget) to the end of column 0. Unreadable saved data → `DEFAULT_LAYOUT`." "`visibleColumns(layout, count)` → for `count` 2: the two columns without hidden ids; for 1: column 0 then column 1 as one list." "`moveWidget(layout, id, toColumn, beforeId | null)` → removes `id` and inserts it before `beforeId` in `toColumn`, or at its end." "`nudgeWidget(layout, id, dir)` (`-1` up, `+1` down) → moves one step in the single-column order; crossing the boundary moves it into the other column at the matching end." "`hideWidget(layout, id)` / `showWidget(layout, id)` (shown again at the end of column 0)."
- **Arrange mode:** "An **Arrange** link sits in the header next to ⚙, at every window width … Today's list dims and says "Today's list stays here". Each visible widget gets a dashed outline, a grip (`⋮⋮`, draggable) and **Hide**. On touch devices (`(pointer: coarse)`) and in the one-column layout the grip is replaced by **↑ ↓** buttons (`nudgeWidget`). Dragging a widget onto another inserts it before that one; onto a column's empty drop zone puts it at the end. Hidden widgets appear in an **Add a widget** row below the columns as `+ Title` chips. Empty widgets render a placeholder ("Nothing to show yet") so they can still be moved. The header link reads **Done**; clicking it (or Escape) leaves Arrange mode. The arrangement is saved on every change."
- **The ⚑ button:** "A pennant **⚑** in the header, left of Arrange and ⚙, titled "Note something to change". Grey normally; **teal** when a flag has been written or addressed on this device but has not reached GitHub yet — shown only when sync is set up … Steady, never pulsing."
- **The panel:** "A `<dialog>` like Settings: An **About:** line showing, before he types, what the flag will capture (e.g. "Today · Night look · 3 of 8 done · Coach: check-in waiting · synced 18:04"). A focused textarea ("What would you change about this?"), **Save** (or Ctrl+Enter). Saving writes the flag, clears the box, shows "Saved.", and asks for a sync straight away. The open flags, newest first: his sentence, when, **More details** (the captured context), and **Mark addressed**. "N addressed" as a single count when there are any — no archive list. One line at the bottom …: "All flags have reached GitHub" / "1 flag hasn't reached GitHub yet · Sync now" / "Sync is off — flags stay on this device until you add the sync repo in ⚙". Opening it changes nothing on the page underneath."
- **A flag:** "A new map `flags` in the synced document. A flag is a normal record (`id`, `updated`, `source: 'me'`, `status`, `created`, `archivedOn`) plus: `text` — his sentence, trimmed, at most 1000 characters. `ctx` — `flagContext(state)` (pure, in `js/flags.js`), captured at the moment the panel opened: time, logical day, look and look setting, window size, column count, the arrangement, whether Arrange mode was on, today's done/total, expanded goals count, the open history day, the coach state (check-in state, busy flags, last error texts), the sync state (state, last error, last successful sync time), whether a sync repo / GitHub key / Gemini key are set (**booleans only — never the values**), the app version (the service worker cache name), and a short user agent. Capped at 4 KB when serialised."
- **Addressing:** "**Mark addressed** sets `status: 'archived'` and `archivedOn` — nothing is ever deleted … there is deliberately no un-address."
- **Waiting:** "after every successful sync the device stores the time in `localStorage['dash_last_synced']`; a flag is waiting when its `updated` is later."
- **Integration:** "`MAPS` gains `flags`; `emptyDoc`, `isDoc`, `mergeDocs` and record normalisation treat it like `journal`, and documents written before it existed merge and load cleanly." "The store gains `addFlag(text, ctx)` and `addressFlag(id)`." "`sw.js`: `CACHE` → `dash-v3`; SHELL gains `js/look.js`, `js/layout.js`, `js/flags.js`, `js/ui/widgets.js`, `js/ui/flags.js`." "README: the look, Arrange mode, and flags, briefly."

## Decisions this plan makes (where the design was silent or ambiguous)

- **Each widget is in exactly one place.** `hideWidget` takes a widget out of its column into `hidden`;
  `showWidget` puts it back at the end of column 0 (the design's wording). A saved layout that lists an
  id both in a column and in `hidden` normalises to hidden. `visibleColumns` still filters `hidden`.
- **Nudging across the boundary is its own step**, read literally: ↓ on the bottom of column 0 puts it at
  the top of column 1; ↑ on the top of column 1 puts it at the bottom of column 0. In the one-column
  view that press doesn't change the list order, so Task 6 draws a thin divider, "Second column on wide
  windows", between column 0's and column 1's widgets in the one-column Arrange view, making it visible.
- **"The one-column layout"** (↑ ↓ instead of the grip) means whenever a single widget column shows —
  any window under 1500px — as well as `(pointer: coarse)`.
- `moveWidget` on a hidden widget places (shows) it; a drop on itself, an unknown id or a column other
  than 0/1 changes nothing; a `beforeId` not in the target column means the end.
- An unknown `look` value behaves as `'auto'`. The inline script reads the settings the way the store
  does (`{ ...defaults, ...saved }`) and also sets the theme-color meta, so the title bar is right
  before the first paint too.
- **Gold** goes on: streak text (`class="streak"`); a quota's count on Today once met; a met target's
  figures and bar in This week; a finished perWeek habit's "3 of 3 this week" (`class="met"`,
  `bar met`). Goal bars stay teal, even at 100%. Amber (`--warn`) is the carry marker and the dev-only
  "fake · ok" label that already used the orange.
- The date heading is Georgia at weight 400, 1.65rem. `px` stays for borders, outlines, shadows,
  media queries and page/column widths; the `.tag` pill radius becomes `999rem`. New shared tokens
  `--radius-sm` (the old 6px radii) and `--display` (the Georgia stack).
- **Flags.** Blank text throws "A flag needs some text"; the 1000 cap counts characters (code points).
  `addressFlag` on an already addressed flag changes nothing. A flag's "when" is its `updated` (an open
  flag is never edited), so no extra field. The 4 KB cap counts UTF-8 bytes of the JSON; when over, every
  string is clipped to 200 characters, `truncated: true` is added, and the largest fields go first.
- **Secrets in the context.** Besides storing booleans only, `flagContext` scrubs the token's and the
  Gemini key's values (6+ characters) out of every string before clipping, so a secret passed by
  mistake — in an error text, the user agent, anywhere — can't reach a flag even in part. The Hebrew
  app's key is recorded as a boolean `hebrewKey` passed in by the caller; `flagContext` never sees it.
- **`dash_last_synced`** holds the time a successful sync *started*, so a flag saved while a sync is in
  flight still counts as waiting. "Waiting" includes addressed flags (addressing must reach GitHub too).
  The ⚑ turns teal only when a repo and a token are set (and never in `?fakegemini` mode, which never
  syncs).
- **The app version** a flag records is `APP_VERSION = 'dash-v3'` in `js/flags.js`; Task 8 adds
  `tests/sw.test.js`, which checks it equals `sw.js`'s `CACHE`.
- The About line's wording comes from `flagAbout(ctx)`: e.g. "Arranging widgets · Paper look · nothing
  on today · Coach: thinking · sync off".
- `renderSide` moves into `js/ui/widgets.js` (app.js imports it from there); `js/ui/side.js` keeps the
  panel renderers and the focus helpers and exports them — so the registry imports the renderers
  without an import cycle.
- At ≥ 1500px `#side` spans the second and third grid tracks as a CSS `subgrid`, so the three columns
  are exactly `1.35fr 1fr 1fr`. `#side` keeps its id (and stays an `<aside>`).

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/look.js`, `tests/look.test.js` | `resolveLook`, the ⚙ choices, the title-bar colours; the inline-script parity test | 1 |
| `index.html` | Inline `<head>` look script and theme-color (1); widget column container (5); Arrange link and note (6); ⚑ button and flag dialog (7) | 1, 5, 6, 7 |
| `manifest.webmanifest` | Paper's `#f5f0e7` | 1 |
| `js/data.js` | `look: 'auto'` in `DEFAULT_SETTINGS` (1); `addFlag`, `addressFlag` (4) | 1, 4 |
| `js/app.js` | `applyLook` (1); the arrangement, column count, `ui.arranging` (5, 6); flag state, last-sync time, ⚑ state (7) | 1, 5, 6, 7 |
| `js/ui/settings.js` | The Look row | 1 |
| `styles.css`, `tests/palette.test.js` | Palettes, gold/amber, Georgia, rem (2); page width and columns (5); Arrange mode (6); ⚑ and its panel (7) | 2, 5, 6, 7 |
| `js/ui/today.js`, `js/ui/side.js`, `js/dates.js` | Gold class names (2); side.js exports its renderers and focus helpers (5) | 2, 5 |
| `js/layout.js`, `tests/layout.test.js` | The arrangement, pure | 3 |
| `js/doc.js`, `js/flags.js`, `tests/flags.test.js` | `flags` in `MAPS`; the flag context, cap and readers | 4 |
| `tests/helpers.js`, `tests/data.test.js`, `tests/journal.test.js`, `tests/sync.test.js` | `fixture` flags; key list; `DEFAULT_SETTINGS`; flag sync tests | 1, 4 |
| `js/ui/widgets.js` | Registry, `renderSide` from the layout (5); Arrange mode (6) | 5, 6 |
| `js/ui/flags.js` | The ⚑ button state and panel | 7 |
| `sw.js`, `tests/sw.test.js`, `README.md` | `dash-v3` and the new files; version check; docs | 8 |

## Tasks

Each task lives in its own file under [`2026-09-12-look-widgets-flags/`](2026-09-12-look-widgets-flags/). Tick here when a task is committed.

- [ ] [Task 1: The look — Paper by day, Night in the evening](2026-09-12-look-widgets-flags/task-01-look.md) — `js/look.js`, the inline `<head>` script and its `vm` parity test, `applyLook` in `app.js`, `look` in settings and ⚙, the manifest colours
- [ ] [Task 2: Palettes and type](2026-09-12-look-widgets-flags/task-02-palettes-type.md) — `styles.css` replaced: the design's tokens, Paper and Night, gold and amber, Georgia, `rem`, 15px/17px; the gold class names in `today.js` / `side.js`
- [ ] [Task 3: The widget arrangement](2026-09-12-look-widgets-flags/task-03-layout-logic.md) — `js/layout.js`, pure and fully tested
- [ ] [Task 4: Flags — the map, the store and the context](2026-09-12-look-widgets-flags/task-04-flags-data.md) — `flags` in `MAPS`, `addFlag` / `addressFlag`, `js/flags.js`
- [ ] [Task 5: Columns and widgets](2026-09-12-look-widgets-flags/task-05-columns-widgets.md) — page width and columns, the column structure in `index.html`, `js/ui/widgets.js` registry, `renderSide` from the layout, column count from `matchMedia('(min-width: 1500px)')`, focus restore and `typing()` intact
- [ ] [Task 6: Arrange mode](2026-09-12-look-widgets-flags/task-06-arrange.md) — the Arrange link, frames, grip and ↑ ↓, drag and drop, Hide, Add a widget, Done / Escape
- [ ] [Task 7: The ⚑ flag](2026-09-12-look-widgets-flags/task-07-flags-ui.md) — the button and its teal state, the dialog, `dash_last_synced`, sync on save
- [ ] [Task 8: Offline shell and README](2026-09-12-look-widgets-flags/task-08-sw-readme.md) — `sw.js` `dash-v3` and SHELL, `tests/sw.test.js`, README

Tasks 1–4 run in order (2 uses Task 1's `THEME_COLORS`; 4 comes after 3 only for the test counts).
Tasks 5–8 are browser work, in order, each checked by the controller in the Browser pane: serve with
`preview_start` `dashboard`, open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`, and reload twice (the offline cache). Test counts: 189 before;
200 after Task 1, 208 after 2, 228 after 3, 250 after 4, 254 after 5, 259 after 6, 263 after 7, 266
after 8.

## Shared interfaces (the contract between tasks)

Tasks 5–8 are written from this section. Everything listed under Tasks 1–4 exists exactly as shown
once those tasks are committed.

```js
// ---- js/look.js (Task 1) -----------------------------------------------------------------------
LOOK_CHOICES = [['auto', 'Follow the day (Paper, then Night from the check-in hour)'], ['paper', 'Paper'], ['night', 'Night']]
LOOKS = ['auto', 'paper', 'night']
THEME_COLORS = { paper: '#f5f0e7', night: '#1c232b' }          // each look's --bg, for the title bar
resolveLook(now: Date, { look = 'auto', checkinHour = 18, dayStartHour = 4 } = {}): 'paper' | 'night'
  // 'paper' / 'night' → that; anything else → hour >= checkinHour || hour < dayStartHour ? 'night' : 'paper'

// ---- js/data.js (Tasks 1 and 4) ----------------------------------------------------------------
DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' }
Store gains (Task 4):
  addFlag(text, ctx = null): FlagRecord
    // text trimmed, capped at FLAG_TEXT_MAX (1000) characters; blank → throws 'A flag needs some text'.
    // ctx → capContext(ctx) (a JSON copy ≤ 4 KB, or null). One commit ('local'), so the page re-renders
    // and scheduler.changed() runs as for any local change.
  addressFlag(id): FlagRecord
    // status 'archived', archivedOn today (patch → later `updated`). Already archived → returned as it
    // is, no commit. Unknown id → throws 'No flags record <id>'.
FlagRecord = { id, source: 'me', status: 'active' | 'archived', created: day, archivedOn: day | null,
               updated: ISO, text: string, ctx: FlagContext | null }

// ---- js/doc.js (Task 4) ------------------------------------------------------------------------
MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags']
emptyDoc(): { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {} }

// ---- js/app.js (Task 1) ------------------------------------------------------------------------
applyLook(): void   // module-private. data-theme on <html> + meta[name="theme-color"] from
                    // resolveLook(new Date(), store.settings()); at boot, in wake() (focus, visible,
                    // every 'settings' change) and first thing in the one-minute setInterval.

// ---- index.html (Task 1) -----------------------------------------------------------------------
// <meta name="theme-color" content="#f5f0e7"> then the page's ONLY attribute-less <script> (the
// inline look script). tests/look.test.js finds it as the single /<script>([\s\S]*?)<\/script>/
// match, so Tasks 5–8 must not add another inline <script> with no attributes.

// ---- styles.css (Task 2) -----------------------------------------------------------------------
// Tokens (Paper on `:root, :root[data-theme="paper"]`, Night on `:root[data-theme="night"]`):
//   --bg --panel --ink --muted --border --accent --accent-soft --gold --warn --bad --lvl1..--lvl4
// Shared (bare `:root`): --radius (.5rem) --radius-sm (.4rem) --font --display (Georgia stack)
// html { font-size: 15px } and 17px at (min-width: 1100px); body 1rem.
// Classes: .streak (gold streak text) · .met (gold "done" text) · .bar.met > span (gold bar fill) ·
//          .carry (amber). JS: today.js streak span has class 'streak'; a met quota count 'count met';
//          a finished perWeek span 'met'; side.js bar(pct, label, met = false) → 'bar met'.
// tests/palette.test.js also binds Tasks 5–7's CSS: only defined tokens; none of the old names; no
// `Npx` in font-size/font/border-radius/gap/row-gap/column-gap/height/width/min-height/padding*/
// margin*/letter-spacing/line-height except inside min()/max()/clamp() (grid templates, borders,
// outlines, shadows, max-width and media queries are fine); var(--gold) only in the three rules above
// and var(--warn) only in .carry and .coach h2 .fake — so Tasks 5–7 add no gold or amber.

// ---- js/layout.js (Task 3) ---------------------------------------------------------------------
LAYOUT_KEY = 'dash_layout'
DEFAULT_LAYOUT = { v: 1, columns: [['coach', 'week'], ['goals', 'history']], hidden: [] }   // deep-frozen
Layout = { v: 1, columns: [string[], string[]], hidden: string[] }   // after normalizeLayout, each known id in exactly one place
normalizeLayout(saved: any, knownIds: string[]): Layout
  // not { v: 1, columns: [...] } → DEFAULT_LAYOUT (normalised against knownIds). Reads hidden first
  // (placed + hidden → hidden); drops unknown ids, non-strings, repeats; columns past the second merge
  // into the second; pads to two; known ids found nowhere appended to column 0 in knownIds order.
visibleColumns(layout, count: 1 | 2): string[][]     // 2 → [col0, col1]; 1 → [[...col0, ...col1]]; hidden left out
moveWidget(layout, id, toColumn: 0 | 1, beforeId: string | null = null): Layout
  // before beforeId in toColumn, else at its end; a hidden id is placed (shown); id === beforeId,
  // unknown id or bad column → unchanged copy
nudgeWidget(layout, id, dir: -1 | 1): Layout
  // one step in col0-then-col1 order; bottom of col0 +1 → top of col1; top of col1 -1 → bottom of col0;
  // very top / very bottom / unknown id / other dir → unchanged copy
hideWidget(layout, id): Layout    // out of its column, appended to hidden; not in a column → unchanged copy
showWidget(layout, id): Layout    // out of hidden, appended to column 0; not hidden → unchanged copy
loadLayout(storage, knownIds): Layout              // try/catch; nothing/unreadable → default
saveLayout(storage, layout): boolean               // try/catch; false when storage refuses
// All pure: a new Layout every time; the argument is never changed.

// ---- js/flags.js (Task 4) — pure, imports nothing ----------------------------------------------
FLAG_TEXT_MAX = 1000; FLAG_CTX_MAX = 4096; LAST_SYNCED_KEY = 'dash_last_synced'; APP_VERSION = 'dash-v3'
capContext(ctx): object | null     // JSON copy ≤ 4096 UTF-8 bytes (clip strings to 200, truncated: true,
                                   // drop largest fields first); non-object / unserialisable → null
flagContext(state: FlagState): FlagContext          // reads only the fields below; never changes `state`
FlagState = {                                       // what Task 7 builds when the ⚑ panel opens
  now: Date,                                        // new Date()
  today: string,                                    // store.today()
  settings: object,                                 // store.settings() — token/repo/geminiKey become booleans; their values are scrubbed from every string
  look: 'paper' | 'night',                          // document.documentElement.dataset.theme
  window: { width: number, height: number },        // innerWidth, innerHeight
  columns: 1 | 2,                                   // ctx.columnCount()
  layout: Layout,                                   // ctx.layout()
  arranging: boolean,                               // ui.arranging
  day: { done: number, total: number },             // dayCompletion(store.doc(), store.today())
  expandedGoals: number,                            // ui.expandedGoals.size
  historyDay: string | null,                        // ui.historyDay
  coach: { checkin, busy, shapeBusy, digestBusy, error, shapeError, digestError },
                                                    // checkin = checkinNow(ctx); the rest from ui.coach
  sync: { state, error, lastSynced: string | Date | null },   // sync.state, sync.error, readLastSynced(localStorage)
  hebrewKey: boolean,                               // hebrewKeys(localStorage).length > 0 (never the key)
  version: string,                                  // APP_VERSION
  userAgent: string,                                // navigator.userAgent
}
FlagContext = {
  at: ISO | null, day, look, lookSetting, checkinHour, dayStartHour,
  window: { width, height }, columns, layout: { columns: [[ids], [ids]], hidden: [ids] }, arranging,
  today: { done, total }, expandedGoals, historyDay,
  coach: { checkin, busy, shapeBusy, digestBusy, error, shapeError, digestError },
  sync: { state, error, lastSynced: ISO | null },
  set: { repo: boolean, token: boolean, geminiKey: boolean, hebrewKey: boolean },
  version, ua,                                      // ua = shortAgent(userAgent), e.g. 'Chrome 128 · Windows'
  truncated?: true,                                 // only when the 4 KB cap had to cut
}
shortAgent(ua): string | null                       // 'Chrome 128 · Windows', 'Safari 17 · iPhone'
flagAbout(ctx: FlagContext): string                 // 'Today · Night look · 3 of 8 done · Coach: check-in waiting · synced 18:04'
openFlags(doc): FlagRecord[]                        // status 'active', newest `updated` first
addressedCount(doc): number                         // status 'archived'
waitingFlags(doc, lastSynced: ISO | null): FlagRecord[]   // updated > lastSynced (all when null); includes addressed ones
flagSyncLine(syncOn: boolean, waiting: number): string
  // 'Sync is off — flags stay on this device until you add the sync repo in ⚙' ·
  // 'All flags have reached GitHub' · "1 flag hasn't reached GitHub yet" · "2 flags haven't reached GitHub yet"
readLastSynced(storage): ISO | null                 // try/catch
writeLastSynced(storage, iso): boolean              // try/catch
```

### Tasks 5–8 (browser work, written from this contract)

**Task 5 — columns and widgets** (`index.html`, `styles.css`, `js/ui/side.js`, new `js/ui/widgets.js`, `js/app.js`)

```js
// index.html: the side area keeps its id (typing(), keptFocus and renderGoals' '#side [data-focus=…]'
// all look for it) and gets a new label:
//   <aside id="side" class="side" aria-label="Widgets"></aside>

// styles.css (replacing the .top / .layout width, padding and grid rules; all else from Task 2 stays):
//   .top, .layout { width: min(88vw, 1500px); margin: 0 auto; }          /* no max-width any more */
//   .top { padding: 2.5rem 0 .75rem; }
//   .layout { padding: 0 0 3rem; grid-template-columns: minmax(0, 1fr) 340px; }   /* 760–1499px */
//   .side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
//   .widget-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
//   @media (min-width: 1500px) {
//     .layout { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 1fr); }
//     .side { grid-column: 2 / 4; display: grid; grid-template-columns: subgrid; align-items: start; }
//   }
//   @media (max-width: 759px) { .layout { grid-template-columns: 1fr; } }   /* as now: list, then widgets */

// js/ui/side.js keeps renderWeek, renderGoals, renderHistory (unchanged bodies) and keptFocus /
// restoreFocus, now all exported; its renderSide is removed (moved to widgets.js).
export function renderWeek(ctx): HTMLElement | null      // null when there are no active quotas
export function renderGoals(ctx): HTMLElement
export function renderHistory(ctx): HTMLElement
export function keptFocus(root): { key, start, end } | null
export function restoreFocus(root, kept): void

// js/ui/widgets.js (new)
export const WIDGETS = [
  { id: 'coach', title: 'Coach', render: renderCoach },          // from js/ui/coach.js
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);             // ['coach', 'week', 'goals', 'history']
export function renderSide(ctx): void
  // kept = keptFocus(#side); count = ctx.columnCount(); #side.dataset.columns = count;
  // for each list in visibleColumns(ctx.layout(), count): <div class="widget-col" data-col="i">;
  // each id → el = widget.render(ctx); outside Arrange mode a null el is skipped, otherwise
  // el.dataset.widget = id and it is appended (in Arrange mode, Task 6 wraps it in a frame);
  // #side.replaceChildren(...columns); restoreFocus(#side, kept).

// js/app.js
import { renderSide, WIDGET_IDS } from './ui/widgets.js';   // replaces the import from './ui/side.js'
import { LAYOUT_KEY, loadLayout, saveLayout, normalizeLayout } from './layout.js';
const WIDE = matchMedia('(min-width: 1500px)');
let layout = loadLayout(localStorage, WIDGET_IDS);
ctx.layout = () => layout;
ctx.columnCount = () => (WIDE.matches ? 2 : 1);
ctx.setLayout = (next) => { layout = normalizeLayout(next, WIDGET_IDS); saveLayout(localStorage, layout); render(); };
WIDE.addEventListener('change', () => render());               // restoreFocus keeps any caret
// 'storage' listener, first line: if (e.key === LAYOUT_KEY) { layout = loadLayout(localStorage, WIDGET_IDS); render(); return; }
// typing() and canRun() are unchanged: they already look for '#list, #side'.
```

Browser checks (controller): at 1900px the page is 88vw capped at 1500px wide, centred, ~2.5rem from
the top, with the list and two widget columns (Coach and This week, then Goals and Last 3 weeks); at
1200px the list and one 340px column in the order Coach, This week, Goals, Last 3 weeks; at 700px one
column, list first. Typing in a check-in answer or the shaping box survives a sync and a resize across
1500px (the caret comes back). A `dash_layout` edited in the console and reloaded is followed.

**Task 6 — Arrange mode** (`index.html`, `styles.css`, `js/ui/widgets.js`, `js/app.js`)

```js
// index.html: in .top-actions, just before #settings-button:
//   <button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange</button>
// first child of <section class="today">:
//   <p id="arrange-note" class="arrange-note" hidden>Today's list stays here</p>

// js/app.js: ui.arranging = false, new field in the `ui` literal (nothing in Task 5 reads or
// writes it, so it is added here, alongside the button and CSS class that use it).

// js/ui/widgets.js gains
export function setArranging(ctx, on: boolean): void     // ui.arranging = on; ctx.render()
// renderSide, when ctx.ui.arranging, wraps every visible widget:
//   <div class="widget-frame" data-widget="week">
//     <div class="widget-bar">
//       <span class="grip" draggable="true" title="Drag to move">⋮⋮</span>         — or, when
//         ctx.columnCount() === 1 || matchMedia('(pointer: coarse)').matches, instead of the grip:
//       <button class="nudge" type="button" aria-label="Move This week up">↑</button>
//       <button class="nudge" type="button" aria-label="Move This week down">↓</button>
//       <span class="widget-title">This week</span>
//       <button class="link" type="button">Hide</button>
//     </div>
//     {the widget's element, or <p class="muted placeholder">Nothing to show yet</p> when render returns null}
//   </div>
// Grip: dragstart → e.dataTransfer.setData('text/x-widget', id), effectAllowed 'move'. A frame is a
//   drop target (dragover: preventDefault + class 'drop-before'): drop → ctx.setLayout(moveWidget(
//   ctx.layout(), dragged, col, frameId)). In the two-column view each column ends with
//   <div class="drop-zone" data-col="i">Drop here</div> → moveWidget(…, col, null).
// ↑ / ↓ → ctx.setLayout(nudgeWidget(ctx.layout(), id, -1 | 1)). Hide → hideWidget. Every change saves (setLayout).
// One-column Arrange view: column 0's frames, then <div class="column-break" role="separator">Second
//   column on wide windows</div>, then column 1's frames (from visibleColumns(layout, 2)) — always
//   drawn, even when a side is empty.
// Hidden widgets: after the columns, inside #side (grid-column: 1 / -1 at ≥1500px):
//   <div class="add-widget"><span class="muted">Add a widget:</span> <button class="chip" type="button">+ This week</button> …</div>
//   → ctx.setLayout(showWidget(ctx.layout(), id)); only when layout.hidden is not empty.
// Widget contents inside a frame don't respond while arranging (.widget-frame > :not(.widget-bar) { pointer-events: none; }).

// js/app.js: #arrange-button click → setArranging(ctx, !ui.arranging). renderHeader: button text
// 'Done' / 'Arrange', aria-pressed, section.today class 'arranging' (dimmed, pointer-events none on
// #list and #add), #arrange-note.hidden = !ui.arranging. document keydown: Escape while ui.arranging,
// no dialog[open] and #editor hidden → setArranging(ctx, false).
```

Browser checks (controller): drag across columns at 1900px, drop on another widget and on a drop
zone; ↑ ↓ on a 1200px window, including a press across the divider; Hide, then + Title brings it back
at the end of column 0; Done and Escape; the arrangement survives a reload; This week with no targets
shows "Nothing to show yet" only while arranging.

**Task 7 — the ⚑ flag** (`index.html`, `styles.css`, new `js/ui/flags.js`, `js/app.js`)

```js
// index.html: in .top-actions, after #sync-status and before #arrange-button:
//   <button id="flag-button" class="icon flag-button" type="button" title="Note something to change" aria-label="Note something to change">⚑</button>
// after <dialog id="settings" …>:
//   <dialog id="flags" class="settings flags" aria-label="Flags"></dialog>
// styles.css: #flag-button grey (var(--muted)); #flag-button.waiting { color: var(--accent); } — steady, no animation.

// js/app.js
import { readLastSynced, writeLastSynced, waitingFlags, APP_VERSION } from './flags.js';
import { askGemini, geminiKeys, hebrewKeys } from './gemini.js';   // hebrewKeys added
import { openFlagPanel } from './ui/flags.js';
ctx.syncOn = () => !FAKE && !!store.settings().token && !!store.settings().repo;
ctx.lastSynced = () => readLastSynced(localStorage);
ctx.flagState = () => FlagState    // exactly the object in the js/flags.js section above, built from store, ui, sync, WIDE
// runSync: const started = new Date().toISOString(); just before syncOnce(); when result.ok,
//   writeLastSynced(localStorage, started) before renderHeader().
// renderHeader: #flag-button.classList.toggle('waiting', ctx.syncOn() && waitingFlags(store.doc(), ctx.lastSynced()).length > 0)
// #flag-button click → openFlagPanel(ctx).

// js/ui/flags.js (new)
export function openFlagPanel(ctx): void
  // captured = flagContext(ctx.flagState()), once, at open. Fills dialog#flags and showModal()s it;
  // never calls ctx.render() on opening. Contents, top to bottom:
  //   <h2>Note something to change</h2>
  //   <p class="about"><strong>About:</strong> {flagAbout(captured)}</p>
  //   <form>: <textarea rows="4" maxlength="1000" placeholder="What would you change about this?"
  //           aria-label="What would you change about this?"> (focused), Save (btn primary), Close (btn);
  //           Ctrl/Cmd+Enter saves. Blank → status "Write something first." Otherwise
  //           store.addFlag(text, captured); box cleared (focus kept); status "Saved."; list repainted;
  //           await ctx.syncNow(); foot line repainted.
  //   <ul class="flag-list">: openFlags(store.doc()) → <li class="flag-item"> his text, when
  //           (new Date(f.updated).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
  //           <details><summary>More details</summary><pre>{JSON.stringify(f.ctx, null, 2)}</pre></details>,
  //           a 'Mark addressed' link → store.addressFlag(f.id), repaint.
  //   <p class="muted">{n} addressed</p> when addressedCount(doc) > 0.
  //   <p class="flag-sync">{flagSyncLine(ctx.syncOn(), waitingFlags(doc, ctx.lastSynced()).length)}</p>,
  //           plus ' · ' and a 'Sync now' link (→ ctx.syncNow(), then repaint) when sync is on and some wait.
  // While open it subscribes to the store and repaints its list and foot line on every change;
  // unsubscribes on the dialog's 'close'.
```

Browser checks (controller): save (button and Ctrl+Enter), "Saved.", the flag at the top of the list;
More details shows the context with `set` booleans and no key values
(`!document.documentElement.outerHTML.includes(<the dummy key>)` with a dummy key set as in the coach
plan); Mark addressed moves it into "1 addressed"; the three foot lines (sync off; waiting · Sync now;
all reached — the last two by pointing ⚙ at a dummy repo and faking `dash_last_synced`); the ⚑ is teal
only with sync set up and something waiting; opening the panel doesn't change the page underneath.

**Task 8 — offline shell and README** (`sw.js`, new `tests/sw.test.js`, `README.md`)

```js
// sw.js
const CACHE = 'dash-v3';
// SHELL gains 'js/look.js', 'js/layout.js', 'js/flags.js' (with the other js/ files) and
// 'js/ui/widgets.js', 'js/ui/flags.js' (with the other js/ui/ files): 28 entries. dev/ stays out.

// tests/sw.test.js (new) reads sw.js as text and checks: CACHE === APP_VERSION (js/flags.js); every
// SHELL entry except './' exists; every .js file under js/ (recursively) is in SHELL; nothing under dev/ is.
```

README: carry markers are *amber* (not orange); short sections on the look (Paper by day, Night from
the check-in hour, ⚙ → Look, the title bar), arranging the widgets (Arrange, drag or ↑ ↓, Hide, Add a
widget, Done / Escape, kept per device) and flags (⚑, the About line, Save / Ctrl+Enter, Mark
addressed, the teal ⚑ while one hasn't reached GitHub, carried in `dashboard-sync/data.json`, never
deleted); `js/look.js`, `js/layout.js` and `js/flags.js` in the build table; `flags` in the data line;
the look, the arrangement and the last sync time among the device-local things; the tests paragraph
mentions the look's inline-script check, the palette check, the arrangement and flags.
