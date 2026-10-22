# Duolingo → Hebrew practice

## Why

The dashboard only knows George practised Hebrew when the Hebrew Reader logs a session. Some days he
only does Duolingo, and the dashboard reads those days as a straight miss. He wants it to know he did
something, but a Duolingo-only day is **weaker** than a Reader session: he says he needs to lock in.

## What it does

- **The planner checks Duolingo.** On each run (the same runs that read Hevy), the Apps Script
  planner fetches his public Duolingo profile (`/2017-06-30/users?username=…`, no login; Duolingo
  doesn't allow browsers to call it from another site, so the dashboard can't) and reads the XP of
  his Hebrew course. When that XP is higher than at the last check, the gain is added to that day's
  `duolingo:<day>` log: an `amount` log on `hebrew-habit`, `source: 'duolingo'`, amount = XP gained.
  An `amount` log, not a new log kind, so builds that haven't updated yet still accept the record.
- **XP, not the streak.** His streak runs through freezes (339 days long, started 18 Mar 2025), so a
  streak that is still going says nothing about the day. Course XP only rises when he does something.
- **The first check only takes a starting point.** Duolingo's day-by-day history needs a login, which we won't
  use, so nothing before the link existed is filled in.
- **Weaker, in practice:**
  - The habit stays **unticked**. The honest day score, the map, the planner and check-ins treat the
    day as not done, exactly as now.
  - The habit's **streak survives** a Duolingo-only day. "Practised, but not properly" is not a miss.
  - Today's row shows a small Duolingo mark and *Duolingo · 30 XP*, so it's clear what happened.
  - Claude's catch-up says *Duolingo only (30 XP)* on the row. The phone widget's Hebrew week strip
    marks the day ◔ (smaller than ◐, which means Reader minutes).
  - The evening Hebrew push notification still fires, and says Duolingo is done.
  - Duolingo XP never counts towards Hebrew minutes.
- **Setting:** the planner setting `duolingo` (a username, set through Claude's `planner` op; empty =
  off). The username is not stored in the public code repo.
- **Status:** the planner saves `calendar['duolingo-status']` (`user`, `xp`, `lastSync`, `lastError`),
  written when something changes and at most hourly otherwise. ⚙ → Hebrew progress and Claude's
  `planner` read show it, including any problem.

## Not doing

- No Duolingo login, password or token.
- No Spanish or other courses; Hebrew (`learningLanguage: 'he'`) only.
- No change to how a Reader session ticks the habit.

## Risks

Duolingo's endpoint is unofficial. If it changes or blocks Apps Script, the status shows the problem
and nothing else breaks.
