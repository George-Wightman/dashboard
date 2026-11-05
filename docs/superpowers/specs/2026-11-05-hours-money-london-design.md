# Hours, Money and London: three tools inside the dashboard

Date: 2026-11-05. Status: draft for George's approval.

> **Public repo.** This file is public. No real figures appear here: no pay rate, salary, balances,
> office address or spending. Where the build needs them they come from private files in the
> `dashboard-sync` repo (see "Where data lives"). Personal guidance for Claude goes in the sync repo's
> `notes/money.md` and `notes/london.md`.

## Why

George likes the dashboard as a hub of his own tools: food, Hebrew, EU days. These are "apps inside
the app" that help him understand what he's doing and plan from evidence. He now mostly uses it **on
his phone**. A tile only needs to say enough that he knows what it is. The value is in the big view
(⤢), which must work well at phone width.

He has three tools in mind, and they feed each other:

1. **Hours.** Signify shifts from his Work calendar: hours worked, pay expected, shifts booked ahead.
2. **Money.** What he earns and spends, looking back in detail (from bank statements) and forward
   (a plan to May), ending in what he'll have when the London job starts.
3. **London.** Where to look for a room when he moves for the job in spring 2027. It is a "what if"
   tool to explore, and to show and talk through with people.

Hours is **not a tile of its own** (George: "not enough to be standalone"). It is a section inside
Money, and Money's income line. So there are two tools: **Money (with Hours inside)** and **London**,
kept separate with some overlap. Build order: **Hours (as part of Money) → the rest of Money →
London.** Hours gives Money its income, and Money gives London its starting pot.

As everywhere in the dashboard, **Claude in chat does the thinking and the data entry**: reading
payslips and statements, refreshing prices. The app is the way of seeing it. No in-app AI, no paid
APIs, and Gemini never sees any of this data.

## Shared rules

- Two new tiles, `money` and `london`, added to `TILE_IDS` (js/tiles.js) with the usual
  tile and big-view wiring (js/ui/big.js `openBig`/`makeOpener`), like `eu`.
- Each tile shows one or two headline numbers. Everything else is in the big view.
- **Phone first.** Every big view is designed at ~380 px wide and then allowed to widen. No horizontal
  scrolling of the page. Tables become stacked rows or cards on a phone. Touch targets ≥ 44 px.
- Light and dark themes, as every existing view.
- Claude gets a read for each (`money` with its hours, and `london` in claude/ops.js and the skill playbooks)
  so a chat can answer "how many hours this month?" or "what will I have in May?".
- Phone widgets (js/glance.js) are **not** in scope.

---

## 1. Hours (a section of Money, not its own tile)

### What counts as a shift
Every event in the Work calendar (`config.workCalendar`) **counts unless its title clearly says it is
something else**. Most of his shifts are untitled or spelled "Signifi", "Signify", "Singify". So:
untitled, or a title that loosely matches "signify" (e.g. starts with `si`/`sig`/`sing`, case-
insensitive), counts. Anything else (e.g. an interview booked in that calendar) is **not counted** but
is listed in the big view under "Not counted", with a per-event switch to count it. That override is
saved as a record. He says the calendar is accurate: if a shift is on it, it happened.

### Where the hours come from
- **Past shifts:** `work:<event id>` records written by planner/work.js since it started (late Oct
  2026). **Do not change those or backfill into `work:`**: the Civ map turns `work:` records into
  hammers and must not change under him.
- **History before that** (from his first shift in May 2026): a one-off import by Claude from the
  calendar connector into a separate prefix (e.g. `hours:<event id>`), same shape as `work:` records.
  The Hours view reads both, deduplicated by event id.
- **Booked shifts ahead:** the planner already lists events for its window (yesterday to
  `config.days` ahead, default 7). It should also save the Work events still to come in that window,
  e.g. one record `hours:upcoming` with `[{id, day, start, end, minutes, title}]`. These must not
  touch `work:` records.

### Pay
- Pay is hourly plus holiday pay as a fixed percentage on top. The base rate and the percentage live in
  a private record or file, not in the code.
- **Pay periods:** each payslip pays hours worked up to a **cut-off day** (currently the 23rd) and is
  paid around the last working day of the month. The cut-off is a setting. Historically it moved
  around, so each recorded payslip stores the hours it paid.
- **Payslips:** Claude reads the payslip PDFs he gives it and records a summary per payslip: date
  paid, period, hours paid, holiday pay, gross, tax, NI, net. Nothing identifying: no NI number,
  address or employee id.
- **Check:** for each payslip, compare hours paid with calendar hours in that pay period. A history
  check (May to Oct 2026) found them within a few hours, with July and September exact. The big view
  shows the difference per payslip, so a real gap stands out. He keeps his own spreadsheet as well;
  this doesn't replace it.

### Forecast
- Hours booked in the calendar but not yet paid × rate × (1 + holiday %) = **expected next pay**,
  split by which pay period each shift falls in.
- Beyond the booked shifts, the forecast uses his recent average weekly hours (builder's call on the
  window, e.g. the last 8 weeks), clearly marked as a guess.

### Screens
- **In Money's tile:** expected next pay sits on Money's one line of income (no separate tile).
- **In Money's big view, an Hours section:** weekly hour bars over the last few months, each pay period marked; a list of
  payslips with "paid vs calendar"; upcoming shifts; "Not counted"; the forecast to May, which is
  what Money uses as income.

---

## 2. Money

### Looking back: statements
- George gives Claude **bank statement PDFs** (several accounts: he's paid into one and spends from
  another) and payslips, in a chat on the laptop.
- Claude extracts the transactions, **drops transfers between his own accounts** (otherwise they would
  count twice), and sorts each transaction into a small fixed set of categories. Builder's call on the
  exact list. Something like: groceries, eating out, going out, local travel, trips (flights, trains
  home), gym and health, phone and subscriptions, shopping, gifts, other. Category rules are kept on
  the laptop (outside any repo) so each month gets quicker.
- Only **totals per day per category**, income items (pay, tax refund, other) and an optional total
  balance on a date are stored. **No shop names, no account numbers, no per-account balances**, and
  never the PDFs. The statements stay on the laptop.
- One-offs are flagged as one-offs, e.g. a tax refund, so they don't inflate "normal" income.

### Looking forward: the plan
- A timeline of months from his first data up to the London start, past months **actual**, future
  months **planned**, like EU days looks both ways.
- Income in future months comes from Hours (booked shifts, then the average), marked as a guess.
- Spending in future months defaults to his recent average per category. He or Claude can add plan
  lines, e.g. "flight to Salzburg, Dec, £x" or "deposit, Apr", and override a month's category.
- A **running pot**: the last known balance total plus planned income minus planned spending, month by
  month. The headline is **what he'll have when the job starts**. London reads this.

### Comparing periods
- **Salzburg vs UK** comes for free: `eu:<day>` records say which days he was in the EU. The big view
  can compare spending per day (or per week) in Salzburg stays against UK stretches, by category.
- Any two date ranges can be compared side by side, normalised per week so different lengths compare
  fairly.

### Screens
- **Tile:** what he'll have at the start date · this month spent vs plan.
- **Big view:** the month timeline (stacked category bars, actual vs plan, pot line); tap a month for
  its categories and income; a "Compare" panel (Salzburg/UK, or two ranges); the plan lines.

---

## 3. London

### What it's for
Deciding **where to look** for a room. Not running the move. It merges two claude.ai artifacts
George made ("Where to live for Westminster", the commute map, and "Where to live for Millbank", the
room finder) into one tool, and goes further: a real map, real journey times and well-explained
priorities he can drag. He wants to play with it ("if I want to live like this, it's this price, here")
and show it to people on his phone.

### Areas
- The areas are the **room finder's 56 SpareRoom areas** (zones 1 to 3, with typical rent, number of
  matching rooms and the typical walk to the station). Not the commute map's original eight.
- Each area is placed at its **real station** on a real map and labelled with its **borough** (and
  rough side: north, south, east, west), so an unfamiliar name like "Lea Bridge" reads as
  "Lea Bridge · Waltham Forest".
- The room data is a snapshot from 24 Oct 2026. Only the area summaries survive, not the listings.
  That is enough to build with. Before he starts looking (around Feb or Mar 2027), Claude reruns the
  SpareRoom search in a chat with the same filters and updates the file. The data records its date,
  and the view shows "prices from <date>". Spring is the peak season, so the refresh also shows the
  change since October.

### Real journeys (computed offline, not live)
A script on the laptop (e.g. `dev/build-london.mjs`) computes every area's journeys with **TfL's
Unified API Journey Planner** (free; an app key is optional and raises the limit), and saves the
results into the area file. The app never calls TfL itself. Google's routing APIs are out (billing
account). Per area:
- **To the office**, arriving 08:30 on a weekday (a normal Tuesday). The office location is in the
  private file.
- **West London placements**, which can be anywhere in zones 1 to 3 west. Use the average of a few
  points spread across that patch (builder's call, e.g. Paddington, Hammersmith, Acton, Ealing
  Broadway), arriving 08:30.
- **Stansted for a 7 am flight**: arrive about 05:30. Store the latest leaving time and the route, or
  "not possible by public transport" (night buses count; the first Stansted Express and the
  overnight coaches are the usual options).
- **Mansfield**: door to King's Cross (for **Newark Northgate**, the main route, then a lift) and to
  St Pancras (for **Mansfield via Nottingham**, second). Add the fixed rail legs beyond London from
  timetables, recorded once in the file with their date.
- Each journey also counts the **walk from home to the station** (the area's typical walk, capped as
  in the room finder).

### Neighbourhood data (computed offline, real sources)
Around each station (builder's call on radius, e.g. 800 m to 1 km):
- **Gyms**, **green space** and **places to eat and drink** from OpenStreetMap (Overpass API).
- **Safety**: reported street crime per month from police.uk's free API (recent 12 months).
Each is turned into a 0 to 1 score relative to the other areas.

### The settings (sliders), and how they combine
Every setting has a one-line plain explanation under it. The whole ranking is **one monthly money
figure per area**, "what living here really costs you", so every factor trades off against rent
openly and the area card can show the breakdown. Lower is better.

1. **Year to plan with:** Year 1 (known), Year 2 (his estimate), Year 3 (continuing the same rise).
   Salaries are editable. Take-home uses the same UK tax, NI, Plan 2 student loan and pension
   working as the artifacts, at the current frozen thresholds.
2. **Most I'll spend on room, bills and travel** (% of take-home). Areas over it **sink below** those
   within it but stay visible, labelled "stretch".
3. **Savings I want each month.** Leftover = take-home − all-in cost − everything else (an editable
   monthly figure). If leftover falls short of the target, the shortfall is **added** to the area's
   figure, so cost bites harder as money gets tight.
4. **What an hour of commuting is worth to me** (£). Monthly commute hours × this is added.
5. **Longest commute I'll accept** (minutes each way to the office). Areas over it are greyed out
   and ranked last.
6. **How much of my time might be on West London placements** (0 to 100 %, starting at "don't know
   yet" = a middle default). The weekday commute is a mix of office and west journeys in this
   proportion.
7. **Trips home to Mansfield a month** and **trips to Salzburg a month.** Round-trip hours to King's
   Cross (or St Pancras) and Stansted × trips × the hour value are added. An area that can't make a
   7 am flight by public transport adds a set per-trip cost (an editable "cab or night before" figure)
   and is flagged.
8. **How much I trust areas with few rooms.** Each area's rent is pulled towards the typical rent of
   its side of London in proportion to how few rooms were listed: `(n·rent + k·prior) / (n + k)`,
   where this setting sets `k`. It stops a couple of cheap outliers from topping the list. Thin
   areas also carry a "few rooms" badge.
9. **What's around me:** gyms, green space, places to eat and drink, safety. Each has its own
   **don't care / a bit / matters / really matters** (0 to 3). Each step is worth a set amount a
   month (builder's call, e.g. £25) between the best and the average area, subtracted for good
   scores and added for poor ones. The explanation says it in money: "really matters ≈ worth about
   £75 a month to live somewhere with lots of gyms".

Settings save to the synced doc, so phone and laptop agree. A "reset" goes back to the defaults.

### Screens (phone first)
- **Tile:** today's top area and its all-in monthly cost, plus what's left to save.
- **Big view:**
  - A **real map** (pinch and zoom) with every area as a pin numbered by its current rank and
    coloured by cost against the limit. Greyed pins are over the commute limit. Moving a setting
    re-ranks live.
  - The **settings** in a collapsible panel (a bottom sheet on a phone) so the map stays visible.
  - **Tap a pin** → an area card: name · borough · line; rank and "really costs you £x a month", with
    a breakdown (rent, bills, travelcard, commute time, trips, neighbourhood); room count and
    "prices from <date>"; journeys to the office, west, Stansted (leave by hh:mm) and Mansfield (via
    Newark, via Nottingham); neighbourhood scores; a link to a SpareRoom search near that station
    with his filters.
  - A **ranked list** below the map (cards on a phone) and the **cost vs commute** chart from the room
    finder.
  - A **budget** panel: take-home for the chosen year, the chosen area's costs, leftover, and the
    **starting pot from Money** (what he'll have at the start date) to cover deposit and the first
    month.

### Map technology
No map library is used in the app yet. Builder's call, within these limits: a small open-source
library (e.g. Leaflet) **vendored into the repo** (no CDN at runtime, works with the service worker
and offline shell; add its files to `sw.js` SHELL and rebuild `release.json`); free tiles that allow
light personal use with attribution (e.g. OpenStreetMap standard, or CARTO light/dark for the dark
theme). Tiles are not added to the offline shell. Offline, the list, cards and chart still work and
the map shows a placeholder.

---

## Where data lives

- **Private `dashboard-sync` repo** (read with the same key as data.json, cached on the device for
  offline like js/map/files.js does for maps):
  - `money.json`: daily category totals, income items, plan lines, balance snapshots, payslip
    summaries, pay rate settings. One file Claude writes in one go after reading statements.
  - `london/areas.json`: the area data, journeys, neighbourhood scores, office location, data dates.
    Private because it reveals where he's moving and why.
  - `notes/money.md`, `notes/london.md`: guidance for Claude (category rules in words, which
    accounts are his, how to refresh).
- **Synced doc (data.json)**: `hours:` records, `hours:upcoming`, count overrides, London and Money
  settings (small).
- **Laptop only, outside any repo:** statement and payslip PDFs, category rules, TfL key if used.
- **Public repo:** code and invented fixtures only. Tests use made-up figures.

## Goals
- Hours: see hours and expected pay at a glance, and spot a pay discrepancy from the calendar alone.
- Money: understand past spending by category and by period (Salzburg vs UK), and know what he'll
  have at the start date.
- London: a playful, honest "what if" that ranks the real room areas by what they really cost him,
  using real journeys, and explains why.

## Non-goals
- Running the move (checklists, viewings, contracts). He said it's about finding a place.
- Live bank connections or open-banking APIs.
- A visa tracker (his Visa D was refused; EU days covers it), a trips module, a subscriptions
  module. Considered and dropped.
- Reading habit: parked for a later conversation.
- Phone widgets for the new tiles.

## Anti-goals (would make it a failure even if it works)
- Any real money, pay or location detail in the public repo, tests or docs.
- Raw statements or shop-level transactions stored anywhere synced.
- Changing the Civ map's hammers by touching `work:` records.
- Opaque scores: if an area ranks high, the card must show why in pounds.
- A big view that only works on the laptop.
- Calling paid APIs (Google Maps routing, Anthropic API, a paid Gemini tier).

## Settled after review (Claude's calls unless marked)

- **Source data for London.** Both artifacts were read on 5 Nov 2026. Their full HTML is saved locally
  and holds the 56 areas (rent, rent + bills where bills are extra, room count, typical walk, line,
  side), the take-home working (tax, NI, Plan 2, pension tiers), the Travelcard prices, the default
  "everything else" budget, the office location and his Year 1 salary. **Step one of London is
  extracting these into `london/areas.json`** in the sync repo. Personal values (salary, office,
  budget) go to the private file and are never written into code.
- **Gross vs take-home pay.** His yearly Signify pay is far below the tax-free allowance, and recent
  payslips take nothing off (an earlier overpayment of tax has been refunded). So the forecast uses
  **net = gross**, with a check: if the latest payslip shows tax or NI, use its net/gross ratio instead
  (older taxed months don't count, as that tax was refunded). No PAYE engine in Hours.
- **Start date.** The job starts in **May 2027, in London** (not Austria; older notes are out of
  date). It is one synced setting, `move:start`, defaulting to 1 May 2027 and editable, read by
  Money, London and both tiles.
- **Shifts further ahead.** Besides its normal window, the planner makes one extra light query of the
  **Work calendar only**, up to the end of the pay period after next (about 6 weeks). The main
  planning window stays as it is.
- **"Not counted" is for Hours only.** Overrides and the title rule apply in Hours. `work:` records
  and the map's hammers stay exactly as they are, even though the two may disagree.
- **The pot (George's answer).** His cash sits in his **Trading 212** account, which is both his savings
  and what he spends from. His pay lands in a separate current account and is moved across. So the pot
  is the cash balance of those two accounts together (from the statements' closing balances), and
  money moved between them is a transfer. His Lifetime ISA and stocks and shares are untouched and
  **left out of the pot**. They could be shown as a separate "not counted" figure later if he gives one.
  Shared costs with Maya: none were mentioned, so for now everything he pays counts as his spending
  (Claude's call; revisit if statements show regular splitting).

## Left to the builder
Exact category list; averaging windows; the west sample points; neighbourhood radius and the £ value
per step; chart styling; record and file shapes beyond what's stated; whether the London file is built
by one script or several; the map library and tile provider within the limits above.
