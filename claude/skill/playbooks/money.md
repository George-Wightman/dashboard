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
2. Put each spending line in one category: `groceries`, `eating-out`, `going-out`, `local-travel`,
   `trips` (flights, trains home), `gym-health`, `phone-subs`, `shopping`, `gifts`, `rent-bills`,
   `other`. When you're unsure, ask him in one line rather than guess a big one.
3. Income: Signify pay is `pay`. A tax refund is `refund` with `"oneOff": true`. Anything else is
   `other`; mark it one-off unless it repeats.
4. Note the **closing balance** of the accounts that make up his pot, added together, on the
   statement's last day.
5. Note the days the statements cover.

Then write a JSON file **outside any repo** (your scratchpad) and import it:

```json
{
  "days": { "2026-10-01": { "groceries": 1240, "local-travel": 350 } },
  "income": [{ "day": "2026-10-30", "amount": 47658, "kind": "pay" }],
  "balances": [{ "day": "2026-10-31", "total": 123400 }],
  "covered": [{ "from": "2026-10-01", "to": "2026-10-31" }],
  "plan": [{ "month": "2026-12", "label": "Flight to Salzburg", "amount": 12000, "kind": "spend", "cat": "trips" }]
}
```

`bash run.sh money-import <file.json>`. All amounts are **whole pence**. Days in `days` replace
what's there for that day, so import a whole statement at a time. Then `bash run.sh money` checks
it.

**Never store** shop names, payees, account numbers, sort codes or per-account balances, and never
copy the PDFs anywhere. Only totals per day per category leave the laptop.

## Planning with him

- `money` shows the months ahead with `~`. A plan line covers a known cost or income: a flight, a
  deposit, a birthday. Send it again with `"amount": 0` to remove it.
- Payslips go in with the `hours` op, not here. If tax shows up on one, say so: his pay is far under
  the tax-free allowance.
- Compare stretches when he asks ("did Salzburg cost more?"): `money` prints the EU split per week.
- Talk about what the numbers say, never give investment advice. His Lifetime ISA and shares are left
  out of the pot on purpose.
