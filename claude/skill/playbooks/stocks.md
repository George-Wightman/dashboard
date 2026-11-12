# Playbook: his stocks

## What it is

Stocks is a tile on his dashboard. It checks every holding in his Trading 212 Invest account against
**his thesis**: one line, in his words, saying why he owns it. Five number lenses (trend, price,
health, expectations, risk) say whether the numbers agree with him. His philosophy is *buy what you
believe in*. The numbers check that belief; they don't replace it.

The planner (free, no AI) writes `stocks/market.json` each morning: positions, prices and the
trend, risk, price and health lenses. You own `stocks/desk.json`: theses, themes, tiers, the brief,
your notes, the shortlist, and the expectations lens (plus price and health for non-US companies,
after their results). Personal guidance is in the sync repo's `notes/stocks.md`: read it first.

## Never advice

You say what happened, what's coming and what to watch. You never say buy or sell, never say how
much to invest, and never say whether he should keep cash instead. "A moment to add?" is a question,
never an order. If he asks you to decide for him, say plainly that you aren't a licensed adviser and
that it's his decision; show him what the numbers say.

## The bar

Ask of every item: **would this change what George thinks about holding it?**

- **In:** results beats or misses and guidance changes; several analysts upgrading or downgrading in
  the same week; big contracts won or lost; regulation, sanctions or policy that touches a thesis or
  one of its watch points; a CEO or CFO leaving; a lens going red against the thesis; a moment to add.
- **Out:** price-target chatter, a single analyst note, "stocks to watch" lists, daily market colour,
  anything you'd have to stretch to connect to his thesis.

Most days nothing passes. Then the brief says "Nothing that changes your view today." and that's a
good brief.

## The morning routine (daily or weekly)

1. `bash run.sh stocks brief-input daily` (or `weekly` on Saturdays). It is your whole picture: don't
   fetch prices yourself, and don't read anything else unless a line asks you to.
2. **New holdings first, on any run.** If brief-input names new holdings (Trading 212 codes such as
   `NVDA_US_EQ` or `RRl_EQ`), map each in the same write with `symbols`, a `tiers` entry and, for a
   company, a draft thesis (tell him in `look` so he can correct it):
   `"symbols": { "<t212 code>": { "ticker": "RR", "name": "Rolls-Royce", "yahoo": "RR.L", "stooq": "rr.uk", "cik": null, "ccy": "GBp" } }`
   - `yahoo` must be the **same listing Trading 212 holds**: a London code ending `l_EQ` is `.L`, a
     US one `_US_EQ` is the plain ticker, a Xetra one is `.DE`.
   - `ccy` is the currency of that listing's price: `USD`, `EUR`, `GBP`, or **`GBp` for a London
     price in pence** (most LSE shares and many LSE ETFs; check the price: hundreds or thousands
     means pence). A wrong `GBP` on a pence price values the holding 100 times too high.
   - `cik` only for US companies filing 10-Qs (SEC accounts); `null` otherwise.
   - `notes/stocks.md` has a table of likely codes for his current holdings.
3. Search **only** what it lists under "Search these", in that order, and stop at the cap (8 daily,
   15 weekly). Then search the themes it names, one search each. Keep each search narrow: the ticker
   or company name plus what triggered it ("results guidance", "uranium ban").
4. Write one JSON file and `bash run.sh stocks-write <file>`:
   - `brief`: `verdict`, `happened` (0–3 items that pass the bar, each `{ text, ticker, url, day }`),
     `coming` (0–3 dated items), `look` (0–2: `kind` `add` for a moment to add, `idea` for a
     shortlist idea, `theme` for an adjacent theme), `payday` (only on the run after his payday).
   - `notes`: for each subject you looked at, a `looked` note (what you checked and found). Add a
     `thinking` note only when your read changed, and a `next` note with a `due` day for what you want
     to check and when. A `looked` note that answers a `next` note carries `answers: <that note's at>`.
     Subjects: the ticker, `theme:<id>`, or `idea:<ticker>`. One or two sentences each.
   - `lensNotes`: `{ "<ticker>": { "expectations": { dot, reason } } }` when you learned something
     about forecasts. Say in the reason that this lens is soft ("from public reporting").
   - `theses`: set `intact: false` (with a reason in a thinking note) only when news breaks his
     thesis. That stops "a moment to add" for it.
   - `alert`: only for the single most important "changes your view" item, at most one a day,
     `{ id, text, ticker }`, text under 140 characters. Never for something merely coming up.
   - `run`: `{ kind, searches, looked: [subjects], skipped: [subjects] }`, plus `tokens` and `pct`
     when the host can measure them (see below).
5. Stop. Don't chat, don't summarise in the transcript.

**Weekly extras (Saturday):**
- For each non-US watched company that reported this week, set `lensNotes` price and health from its
  results (P/E against its own history; margins, returns, debt).
- Look up the next results date for every watched holding without one in the next 90 days and add
  `events`.
- Check insider buying (clusters of directors buying) for watched holdings: `insider`.
- Review the shortlist: for each idea, keep it watching or set `status: "dropped"` with `why`.
  Raise at most one new idea, in one of his themes or clearly next to one, with the price today.
- `fold` subjects with more than four notes into one "So far: …" line each.

## Measuring cost

He agreed to at most about 5% of his weekly Claude usage. Each run records `searches`, and when it
runs as a desktop scheduled task, also:
- `pct`: the "Weekly · all models" percent from `get_usage` at the end of the run, minus the same
  figure at the start (read it first thing);
- `tokens`: `node claude/run-tokens.mjs <this session's id>` once the write is done, if available.

## In a chat

- "How's the portfolio?" → `stocks`.
- He corrects a thesis or adds a watch point → `stocks-write` with `theses`.
- "I'm interested in grid infrastructure" → add it to a theme's `interests` (or a new theme with no
  holdings) via `themes`.
- He buys something new → give it a symbol entry, a tier and his thesis.
- Tiers: `watched` (companies he chose: all five lenses, news), `fund` (theme ETFs: trend and risk),
  `market` (index funds: big moves only), `pie` (his cashback Pie: never searched).
