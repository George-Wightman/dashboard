# Stocks: a portfolio tile that only speaks when it matters

Date: 2026-11-12. Status: draft for George's approval.

> **Public repo.** This file is public. It names no holdings, quantities, values or theses. Those
> live in the private `dashboard-sync` repo (see "Where data lives"). Examples below are invented.

## Why

George holds a portfolio of shares and ETFs in Trading 212 and wants one place that pulls together
news, results, analyst moves and numbers, then says only what matters. Google Alerts style "every
little bit of news" is the anti-goal. Most days the honest answer is "nothing changes your view", and
the tile should say exactly that.

His philosophy is **buy what you believe in**. He isn't a quant and doesn't want to become one. The
numbers are there to **check his beliefs, not replace them**: "I think this company is going this way,
and the quant agrees" (or doesn't, which is the interesting case).

He can't invest monthly until the London job starts (May 2027), but the tool behaves **as if he
invests every month** from day one. There is one mode, no "watch mode". He just won't act on every
call yet.

## Goals

- A tile that fits the one-screen glance, with depth behind ⤢, like Money.
- Every holding is checked against a one-line **thesis** (his belief) through five number **lenses**.
- A morning Claude routine reads the numbers and its own notes, searches only where something has
  changed or is due, and writes a short brief plus dated notes that show throughout the tool.
- **Opportunities**, in three kinds: good moments to add to what he holds; new companies inside his
  themes; adjacent themes that are clearly gathering pace. At most one or two at a time, often none.
- A push to his phone only when something would change what he currently thinks.
- Cheap: the numbers cost nothing, and the routine's daily token use is small and capped.

## Non-goals

- **No buy/sell advice.** Claude says what happened, what's coming and what to watch; the tile shows
  whether the numbers agree with *his* thesis. It never says "buy" or "sell", and never tells him how
  much to invest or whether to keep cash. Copy uses "a moment to add?" style questions, never orders.
- No trading, no order placement, no Pie changes. Read-only.
- No paid data (TipRanks and the like) and no paid AI APIs. Claude runs on his subscription.
- No social media sentiment. Too noisy, and it costs searching every day.
- No infinite news feed and no history of every headline.
- Phone widgets (js/glance.js) are not in scope.

## Anti-goals (a failure even if it works)

- A tile that shouts every day. If more than about one day in five has a "changes your view" item,
  the bar is too low.
- Confident predictions. Factors are tilts across thousands of stocks; for one stock they are weak.
  The tool must say so where it matters (Expectations is the softest lens and is labelled as such).
- Bloating the browser storage the Hebrew app shares (see 11 Nov 2026 incident).
- A daily routine that eats a large share of his Claude usage.

## The pieces

```
Trading 212 API ─┐
free price data ─┼─► planner (Apps Script, free) ─► stocks.json ─► app tile + big view
company accounts ┘           ▲        │                  ▲
                             │        └─ push when the brief says so
               Claude morning routine ── reads `stocks` digest, searches, writes brief + notes
```

1. **The planner** (Apps Script, already runs on a timer) fetches holdings and numbers, computes the
   lenses, and saves them. No AI, no tokens.
2. **The Claude routine** runs each weekday morning, reads a compact digest, decides what to look at,
   searches, and writes the brief and its notes.
3. **The app** shows the tile and big view from `stocks.json`.
4. **The dashboard skill** gets a `stocks` read and write ops, so any chat can talk about it, edit a
   thesis or add an interest.

## Holdings: the Trading 212 API

- George creates an API key in Trading 212 with **only the Portfolio permission** ticked (positions:
  ticker, quantity, average price, current price, profit/loss). Not History, not Account data, not
  Orders, not Pies. If it leaked, someone could see what he holds and roughly its value; nothing else.
  He can revoke it in the app at any time.
- **One account only**: his Trading 212 Invest account. He has no Trading 212 ISA. His Lifetime ISA
  (with another provider) is out of scope.
- **He enters the key himself** into the planner's Script Properties (`T212_KEY`, and `T212_SECRET`
  if the app issues a pair). Claude never types or sees it. The setup step goes in the README, like
  `HEBREW_TOKEN`.
- The planner reads positions once per run in the morning window (and at most hourly otherwise).
- The API is labelled beta. If it fails, the tile keeps the last holdings with "as of" and the brief
  says so once; nothing breaks.
- Tiers are set per ticker. Today no Pie ticker is also held directly; if one ever is, the position
  takes the higher tier (Watched over Pie) as one row. *(Claude's call.)*
- Instruments are mapped from Trading 212 tickers (e.g. `RRl_EQ`) to the price source's symbols in a
  small map kept in the sync repo (`stocks.json → symbols`), which Claude fills in on first run and
  when a new holding appears.

## Tiers: what gets attention

Not every position deserves a search. Each holding has a tier, set by Claude on first run and
editable by George in chat:

- **Watched**: individual companies he chose. Full thesis, all five lenses, news.
- **Theme fund**: a thematic ETF. Trend and Risk lenses only; covered by its theme's news.
- **Market**: broad index funds. Trend and Risk; only mentioned on big market moves.
- **Pie**: the small positions his cashback auto-invests into. Shown collapsed, no lenses, no
  searches, mentioned only on something drastic.

## Themes

Holdings are grouped into themes (for example "AI and chips", "Defence", "Nuclear", "Bets on the
future", "Index"). A holding can also be *watched under* a second theme (e.g. a software company in
AI that is also watched for defence news). Themes also hold **interests**: areas George has said
he cares about with no holding yet, which feed the "worth a look" ideas.

Each theme shows a **colour dot** (green / amber / red), not a weather icon (George found the
weather confusing). The dot is the worst-of-majority of its watched holdings' verdicts (below), so a
theme goes amber when most of it is mixed, red when most of it disagrees.

## The thesis and the five lenses

Each watched holding has a **thesis**: one line in George's words of why he owns it. Claude drafted
the first set in chat on 12 Nov and George corrected them. The first step of the build writes them,
with the themes, tiers, watch points and interests agreed in that chat, into `stocks.json` and
`notes/stocks.md` in the sync repo (done by the session that holds that chat, since this public file
can't carry them). A thesis
can also carry **watch points** (e.g. "AI spending is a worry"; "Western supply: watch Russian
uranium bans") that steer the routine's searching.

Five lenses, each a dot (green / amber / red, grey when it doesn't apply or data is missing), with a
one-line plain-English reason:

| Lens | Question | Worked out from | Who computes |
| --- | --- | --- | --- |
| Trend | Has the price risen over 12 months, skipping the last month? | prices | planner |
| Price | Expensive versus its own 5-year history and its peers? | P/E or EV/sales vs own median | planner (US via SEC filings), routine for non-US |
| Health | High, steady margins; good return on capital; sensible debt? | company accounts | planner (US), routine (non-US, from results reports) |
| Expectations | Are analysts raising or cutting forecasts? | public reporting of revisions; recent results vs expectations | routine (soft; labelled so) |
| Risk | How far from its high, how volatile versus its normal? | prices | planner |

Thresholds are the builder's to set and should be written down in the code, each with a short
reason. Starting point: Trend green above +10% 12-1 month return, red below −10%; Risk amber when the
drawdown from the 52-week high exceeds 1.5× the stock's own typical drawdown, red at 2.5×.

**Small print** (shown under the lenses, never a dot): RSI(14) from prices (no tokens), and insider
buying (clusters of directors buying), checked weekly by the routine. These nudge, they never decide.

**Verdict** per holding: *agrees with you* (4–5 green, no red), *mixed*, or *disagrees with you* (2+
red, or Trend and Expectations both red). Shown as one line on the card and as the row's colour.

**Funds** (theme funds and Market) have only Trend and Risk, so their verdict is: both green →
agrees; one red → mixed; both red → disagrees; otherwise mixed. A theme with no watched companies
takes its dot from its funds. *(Builder's call, made in review.)*

**A moment to add?** is raised only when all three hold: the thesis is intact (routine's judgement,
from the news), Health and Expectations are not red, and Price has dipped (Risk amber or red) on news
that doesn't touch the thesis.

## The Claude routine

### When and where

- Weekday mornings (time set so the brief is ready by 08:00 London), plus one deeper **weekly run**
  on Saturday morning.
- It runs as a scheduled Claude Code routine on George's subscription, using the dashboard skill's
  CLI to read and write. Where it runs, and how it gets write access to the sync repo (the relay, with
  its own key), is for the plan to settle; see "Open for the builder".
- Model: the cheapest model that writes good briefs. Start with Sonnet; fall back further only if
  briefs stay good.

### Keeping tokens down

- **The planner does all the arithmetic.** The routine never fetches prices or computes lenses.
- **One compact read.** `stocks brief-input` prints a digest of roughly 1–2k tokens: holdings by tier
  with today's lens dots, *only what changed* since the last run, events in the next 7 days, the
  routine's own open "next" notes, and the list of triggers.
- **Triggers decide what gets a search.** A watched holding gets searched only if:
  a move of more than 2× its typical daily move; results within 2 days either side; an ex-dividend
  or other dated event today; a lens changed colour; its own note says "look on <date>"; or it hasn't
  been looked at for 7 days (rotation, so each one gets a look at least weekly).
- **A cap**: at most 8 searches on a weekday run. If more triggers fire, it takes the largest
  holdings and the oldest "last looked" first, and notes what it skipped.
- **Themes and interests**: one or two theme searches per weekday, rotating, plus any theme whose
  holdings all moved together.
- **One write** at the end (`stocks-write <file.json>`).
- **Notes are capped**: the last 5 notes per holding and theme are kept in full; older ones are
  folded into one "so far" line by the weekly run. The file stays small and so does the next read.
- **The weekly run is capped too**: at most 15 searches. The target for the whole routine is a
  small share of his weekly Claude usage (aim: under 5%); the routine logs its searches per run in
  `meta` so the cost can be checked after the first two weeks and the caps tuned. *(Claude's call.)*
- **Measuring the real cost.** George wants to see what the routine uses in a week, not just its
  search count. The Claude app's usage meter shows his overall weekly use, not per routine, so the
  build must find a way to attribute usage to the routine's own runs: from the routine sessions'
  own token counts where the platform exposes them (session usage, or local transcripts if it runs
  on the laptop), recorded per run in `meta`. The `stocks` read and the big view's footer show
  "this week: N runs, N searches, ~N tokens". If the platform gives no per-run figure, the fallback
  is a check by Claude in chat after two weeks, comparing the meter on run and non-run days. Which of
  these works is for the plan to establish first, before the routine is built.
- The weekly run does the slower jobs: Health and Price for non-US holdings after results, insider
  buying, the shortlist review, pruning notes, and the payday digest when it falls in that week.

### The bar for "changes your view"

Every item is tested with one question: *would this change what George thinks about holding it?*
In: results beats/misses and guidance changes, analyst downgrades/upgrades in a cluster, big
contracts or losses, regulation, sanctions or policy that touches a thesis or watch point, a CEO or
CFO leaving, a lens going red against the thesis, a "moment to add". Out: price-target chatter, a
single analyst note, "stocks to watch" listicles, daily market colour.

Only items that pass go in **What happened**. Only the strongest go to his phone (see Push).

### What it writes

- `brief`: the day's verdict line, What happened (0–3 items), Coming up (0–3 dated items), Worth a
  look (0–2 items), each item with a source link, and the date and time of the run.
- `notes`: dated notes on holdings, themes and the shortlist, each of a kind:
  - **looked**: what it checked and found ("Results: beat; data-centre guidance raised. Thesis intact.")
  - **thinking**: its current read ("Price is stretched against its history; fine while forecasts rise.")
  - **next**: what it wants to check and when ("Look on 19 Nov: results; watch data-centre guidance.")
  An open **next** note is closed by a later **looked** note that answers it.
- `shortlist`: ideas raised (new companies within his themes or adjacent ones) with the day raised,
  the price then, the reason, and status (watching / dropped, with why). The app shows performance
  since raised from prices.
- `alert`: set when an item should go to his phone.

### Its notes are visible throughout the tool

George wants to see what Claude is thinking everywhere, not just in a log:

- **Tile**: "Looked at 3 today" under the verdict, with when the routine last ran.
- **Theme row**: the latest thinking note for the theme, one line.
- **Holding card**: "Last looked 12 Nov", the latest thinking note, any open next note ("Next: 19
  Nov, results"), and the earlier notes in a fold.
- **Never a stream of thought.** Everywhere shows only three things: when it last looked, what it
  thinks now, and what it will look at next. Earlier notes stay folded away (and the weekly run
  folds old ones into one line), so George is never handed every step of its reasoning.
- **Shortlist item**: why it was raised and its latest note.
- Notes carry the small Claude logo (icons over text), with the date; detail on hover/tap.

## Push

Only when the brief sets `alert` (at most one a day, and never for routine "coming up" items). The
planner sends it with the existing web-push pusher (planner/checkins.js `makePusher`) on its next run,
once, and records that it was sent. Text: one line, e.g. "NVDA: guidance cut after results. Thesis
check inside." Tapping opens the Stocks big view on that holding.

## Payday digest

On the run after his pay lands each month (the date from Money's pay settings), the brief adds a
short digest: the month's portfolio move, which holdings changed verdict, the shortlist ideas that
still hold up and the ones that fell away. It's the natural moment for George's "do I put anything
in?" review. The tool shows the information; it doesn't answer that question.

## The app

Follows the layout George approved in an inline mockup in the 12 Nov chat (not saved: it carried
real tickers), with colour dots replacing weather icons. The description below is the whole design.

**Tile (one-screen glance)**
- Portfolio value, today's move, all-time return.
- Verdict line: "Nothing that changes your view today" (most days) or the top What happened item.
- "Looked at N today" with the Claude logo.
- Themes as chips, each with its colour dot; hover/tap for the theme's one-line reason.
- Coming up: up to 2 dated items.
- Worth a look: up to 1 item (a moment to add, or a shortlist idea).

**Big view (⤢)**
- Holdings grouped by theme; each row: ticker, five lens dots, value, and a short note only when it
  matters ("results Thu", "quiet 12 days", "numbers disagree with you").
- A row opens its **card**: thesis (in George's words), verdict line, the five lenses each with a
  plain reason, small print (RSI, insider buying), Claude's notes, upcoming events.
- Theme funds show grey dots for lenses that don't apply; Market and Pie are collapsed by default.
- Shortlist at the bottom: idea, theme, day raised, move since raised, status.
- Phone first (~380 px), no horizontal scroll, touch targets ≥ 44 px, light and dark.
- A lens dot explains its colour on hover/tap. A legend line names the five dots in order.

## Where data lives

- **`stocks.json`** in the private sync repo, beside `money.json`, read by the app with
  `refreshFile` like Money. Sections: `holdings` (from the planner), `lenses` and `prices` summaries
  (planner), `symbols`, `tiers`, `themes`, `theses`, `brief`, `notes`, `shortlist`, `alert`, `meta`
  (last runs). The planner writes only its own sections; the routine and chats write only theirs, so
  the two never overwrite each other. A malformed file is ignored and the last good one kept.
- **Not in localStorage beyond today's copy.** The app keeps one cached copy of `stocks.json`
  (a few KB) for offline, like Money. No history accumulates on the device. Price history used for
  the lenses lives with the planner (Script Properties or a cache file in the sync repo), never in
  the browser.
- **`notes/stocks.md`** in the sync repo: George's standing guidance for the routine (his philosophy,
  the bar, the no-advice rule, his interests), read by the routine each run.
- The public repo holds code and invented fixtures only.

## Claude in chat (the skill)

- `stocks`: the read, for "how's the portfolio?", "why is TSLA red?", "what's on the shortlist?".
- `stocks-write <file>`: merges a JSON of brief/notes/shortlist/theses/themes/tiers/symbols.
- Playbook: editing a thesis or watch point, adding an interest ("I'm interested in grid
  infrastructure"), changing a tier, and the routine's own steps.

## Sources and limits (be honest in the UI)

- **Prices**: a free source reachable from Apps Script (the builder picks one and records the
  fallback). Reliable enough for Trend, Risk and RSI.
- **Accounts**: free and good for US companies (SEC filings). Patchier for European and UK
  companies, so the routine reads those from results reports after each results date.
- **Analyst forecast revisions**: mostly behind paywalls. Expectations is pieced together from public
  reporting, is the softest lens, and its reason line says so.

## Open for the builder

- Where the routine runs and how it writes (cloud routine through the relay with its own key, or
  something else) and how it's scheduled.
- The price source and fallback; where price history is kept.
- Exact thresholds, written down in the code with reasons.
- The exact shape of `stocks.json`.

## Not now

- A quarterly "do you still believe this?" conviction check, one tap per holding.
- A report card of how past shortlist ideas did.
- A "disagreement" badge on the glance when a holding has disagreed for several weeks.
