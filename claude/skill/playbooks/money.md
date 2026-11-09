# Playbook: his money

## What it is

Money is a tile on his dashboard. Looking back, it shows what he spent by category and by stretch
(Salzburg against the UK, from his EU days). Looking forward, it shows a plan up to his London start
date (`move:start`, 1 May 2027 unless changed) and what he'll have when it comes. Hours (`hours`) is
part of it: his shifts and the pay they'll bring are the plan's income.

The app only shows it. You fill it in, in a chat on the laptop, from statements he gives you.

## Reading his statements

He gives you bank statement PDFs (several accounts: pay lands in one and he spends from another, and
the personal note for this, `reference money`, names them). For each:

1. Read every transaction. Leave out **money moved between his own accounts**, which would otherwise
   count twice.
2. Put each spending line in one category: `groceries`, `eating-out`, `going-out`, `local-travel`
   (petrol, buses, parking), `car` (buying it, insurance, tax), `trips` (flights, trains home),
   `gym-health`, `phone-subs`, `shopping`, `gifts`, `rent-bills`, `other`, and give it a **place**: the
   shop, in plain words ("Tesco", "Tesco petrol", "Paid to Maya: flights"). Gift cards bought through
   EverUp go under the shop the card is for (he sends screenshots of his EverUp orders). `other` is
   for what fits nowhere, never a dumping ground; money moved to an account you can't see is
   "To your Monzo (not itemised)". When you're unsure, ask him in one line rather than guess a big one.
3. Income: Signify pay is `pay`. A tax refund is `refund` with `"oneOff": true`. Anything else is
   `other`; mark it one-off unless it repeats.
4. Note the **closing balance** of the accounts that make up his pot, added together, on the
   statement's last day.
5. Note the days the statements cover.

Then write a JSON file **outside any repo** (your scratchpad) and import it:

```json
{
  "days": { "2026-10-01": { "groceries": 1240, "local-travel": 350 } },
  "places": { "2026-10-01": { "groceries": { "Tesco": 1240 }, "local-travel": { "TfL": 350 } } },
  "income": [{ "day": "2026-10-30", "amount": 47658, "kind": "pay" }],
  "balances": [{ "day": "2026-10-31", "total": 123400 }],
  "covered": [{ "from": "2026-10-01", "to": "2026-10-31" }],
  "plan": [{ "month": "2026-12", "label": "Flight to Salzburg", "amount": 12000, "kind": "spend", "cat": "trips" }]
}
```

`"since": "2026-05-01"` (optional) is the day his *In and out* view counts from; add a balance for
the day before it so the view shows where he started. `"since": null` clears it.

`bash run.sh money-import <file.json>`. All amounts are **whole pence**. Days in `days` replace
what's there for that day, so import a whole statement at a time. Then `bash run.sh money` checks
it.

**Never store** account numbers, sort codes, card numbers, transaction IDs or per-account balances,
and never copy the PDFs anywhere. Shop and payee names are stored (he asked for them, 9 Nov 2026), as
`places` in the private ledger only, never in the public code repo or its fixtures.

## Planning with him

- **The forecast** (Money → Forecast to London): his pot month by month from the latest balance to
  the start date, from his hours a week, spending a month by category, flights and one-offs. What
  you agree with him goes in the ledger as `forecast` (it replaces the whole of what was there):
  `{"forecast": {"hours": 7, "spend": {"groceries": 26000, ...}, "flights": {"count": 5, "price": 8000},
  "oneOffs": [{"id": "xmas-gifts", "label": "Christmas presents", "amount": -15000, "month": "2026-12", "on": true}]}}`.
  Amounts are pence a month; a one-off is + for money in, − for out. Categories you leave out start
  at his average since `since`, 5% over and rounded up to £10; the car never counts. His own slider
  moves are a synced record on top, and `money` shows which you're reading. Never change his settings
  without asking; update the agreed figures when you agree new ones.

- `money` shows the months ahead with `~`. A plan line covers a known cost or income: a flight, a
  deposit, a birthday. Send it again with `"amount": 0` to remove it.
- Payslips go in with the `hours` op, not here. If tax shows up on one, say so: his pay is far under
  the tax-free allowance.
- Compare stretches when he asks ("did Salzburg cost more?"): `money` prints the EU split per week.
- Talk about what the numbers say, never give investment advice. His Lifetime ISA and shares are left
  out of the pot on purpose.
