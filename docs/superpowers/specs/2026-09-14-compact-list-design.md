# Compact list — design

2026-09-14. Approved in chat from an inline mockup ("that is what I want it to look like, build
that"). George, looking at the app with real content in it: *"added by Claude"* takes up loads of
the line, the task text is too large and wraps, and a full day's tasks should fit on one screen
without scrolling.

## What was wrong

- A row's meta (source, tag, count, +) never shrank, so on weekly-target rows the title was
  squeezed to ~70px and broke mid-word ("Applic / ations / submi / tted").
- Weekly targets showed twice: as rows in the list and as bars in the This week widget.
- The list had 1.35 of 3.35 parts of the page; the widget columns were half empty.
- History cells were ~65px squares; the header had 2.5rem above it.

## The design

### Source logos

"added by Claude" becomes a small Claude logo (a rayed spark), and a Gemini item gets Gemini's
four-point star. Shapes follow the companies' marks; the colour is the app's `--muted`, because
teal and gold already mean "act on this" and "you did this". Hovering gives the old words
(`title` "added by Claude" / "suggested by Gemini"), also the `aria-label`. Suggestions use the same
logo with "suggested by". Sources without a logo (Hebrew app, Notion) keep the text.
`js/ui/sources.js` holds `SOURCE_NAMES`, the logo SVGs and `sourceMark(source, verb)`.

### Rows as aligned columns

The list is a CSS grid and each row a subgrid, so the columns line up down the whole list:

| 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|
| checkbox / ✓ | title (+ carry or "for Tue" label) | logo | tag | progress | + / ✕ |

- The title is one line, ending in "…" when too long, full title on hover.
- Progress: a weekly habit (`perWeek`) shows one dot per time (filled teal as ticked, all gold
  when met), e.g. Gym ○○○○○. A weekly target shows `0/3` and a thin bar (gold when met); clicking
  the count still opens this week's entries, and logging an amount puts the input in this cell.
  Streaks stay, in gold, in the same cell.
- List text is .85rem on big windows (~14.5px, from 17px); rows are shorter (2.35rem).
- Under 760px the row keeps checkbox, title (wrapping, no ellipsis) and +/✕ on the first line and
  puts logo, tag and progress on a second line under the title.

### Weekly targets at the foot of the list

Quota rows move to the bottom of the list under a small "This week" heading, in their own order
(dragging only reorders within a section). The This week widget is hidden by default: the layout
goes to `v: 2`, whose default is Coach and Goals, then Last 3 weeks, with This week hidden. A
saved `v: 1` layout is migrated once by hiding This week and leaving everything else where George
put it. It can be brought back from Arrange.

### Space

- The ≥1500px page is `1.8fr 1fr 1fr` (from 1.35).
- History cells are at most 2.5rem.
- The header has 1.5rem above it (from 2.5rem).

## Integration

- `sw.js`: `js/ui/sources.js` in SHELL; `CACHE`/`APP_VERSION` → `dash-v6`.
- README: logos, the This week section, This week hidden by default.

## Testing

Node: `sourceMark`'s labels and fallbacks via the pure `sourceLabel`; `splitRows` (quotas last,
order kept, suggestions stay at the top); `pipState`; `compactProgress`; layout `v: 2` default and
the `v: 1` migration; the updated CSS checks. Browser: seeded data at 1900px and at phone width,
Paper and Night, the quota +, entries, drag within a section, and Arrange bringing This week back.
