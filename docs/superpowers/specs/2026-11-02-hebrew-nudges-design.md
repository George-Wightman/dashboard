# Hebrew nudges: a widget and pings that talk to him

2 November 2026. Spans two repos: this one (planner, widgets) and `hebrew-reader` (the Hebrew app).

## Why

George enjoys Hebrew once he's in it ("I can feel myself learning"). What fails is the first step:
he forgets during the day, and by the evening he can't be bothered. He wants his phone to pull him
back before it gets late, the way Duolingo does, but personal to him rather than a cartoon owl:
light, cheeky, honest when he's missed days ("three days, mate, come on"), never cringe, never
guilt. One tap takes him into the Hebrew app, where he chooses what to do.

He has stopped opening the dashboard, so none of this may depend on it. The Hebrew app is the place
he goes; the planner (which runs every 10 minutes and knows his calendar) does the thinking.

## Goals

1. **A Hebrew widget** on his Android home screen, in the Hebrew app's look, whose line changes
   through the day and with how he's doing.
2. **Up to three pings a day from the Hebrew app**, only while today isn't done, stopping the moment
   it is.
3. **Calendar-aware timing**: a nudge never lands while he's in a shift or anything else busy; it
   waits until that ends and says so.

## Non-goals and anti-goals

- Not a second way to choose a lesson. No "Walk" button: the whole widget opens the Hebrew app's home
  screen and he picks there (a sit-down, 15 cards, 5 cards, a node).
- No XP, coins or streak-freeze mechanics. The Hebrew app's style guide forbids paying for volume.
- **Anti-goal: a nag he learns to swipe away.** That is how the dashboard died. At most three pings,
  none once he's done, none at night, and done days go quiet.
- No AI writing lines at send time. The lines are written up front (below), with slots filled from
  his data, so they're instant, free and predictable.

## How a day counts (agreed with George)

From the Hebrew app's own practice time for the day (`hvr_stats[day].sec`):

| Level | Rule | Widget | Pings |
|---|---|---|---|
| Nothing | no session today | nudges by time of day | as scheduled |
| A bit | any session, under 15 min | "you did a bit, fancy a few more?"; the day's dot fills | at most one more, gentle |
| Done | 15 min or more | "well done, that's today"; quiet | stop |
| Gold | 30 min or more | goes properly gold, gold ink along the bottom, gold ring on the dot | stop |

The day *counts* (dot filled, streak kept) from any session, as the dashboard's Hebrew habit does
today. The dashboard's own Hebrew rules (the glance tile's ● ◐ ○, the habit) move to the same 15/30
cutoffs, so nothing disagrees about a day. *Builder's call: 15 and 30 are constants in one place.*

## Moments and lines

Three moments, his times: **09:30**, **15:00**, **19:00**. The widget's line changes at each; a
ping goes out at each while the day is "nothing" (or once, gently, at the next moment after "a bit").

### Calendar-aware (George's idea)

The planner already reads every watched calendar. At each moment:

- **Busy now** (inside a timed, busy event on a watched calendar: a Signify shift, a Gym block, a
  meeting): hold the ping until the event ends + 10 minutes, then send it with the "free now" line,
  naming the event when it's a shift ("Shift's done. You've got time now.").
- **Busy for most of what's left of the window** (e.g. a shift 09:00–13:00 at the 09:30 moment): say
  so honestly ("Busy morning. We'll find the time after.") and fire at the event's end instead.
- **Nothing known**: the general line.
- Never into the night: the existing quiet hours apply. A held 19:00 ping that would land after
  21:30 is dropped.

### The lines (starting set; written up front, rotated so the same one doesn't repeat two days running)

**09:30, nothing yet**: "Nothing yet. Loads of day left." / aside: "Half an hour with your coffee
and it's done."
**09:30, busy morning**: "Busy morning. We'll find the time after." / "Hebrew's waiting when you're
out."
**15:00, nothing yet**: "You've got half an hour. I know you have." / "Do it now, before it's 10pm
and you can't be bothered."
**Free now (after an event)**: "Shift's done. You've got time now." / "Get it in before the evening
takes it."
**19:00, nothing yet**: "Last call. Ten minutes keeps the road going." / "You always enjoy it once
you're in."
**Missed days (2+), any moment**: "{n} days off the road, mate. Come on." / "Ten minutes, just to
get started."
**A bit**: "You did a bit. Fancy a few more?" / "Five more minutes makes it count properly."
**Done**: "Done. That's {k} this week." / "{minutes} minutes{, n words to strong}. Nice."
**Gold**: "Half an hour. That's the good stuff." / "{minutes} minutes today."
**Personal hooks** (rotate in when the data supports them, at most one a day): words one good
session from strong ("{n} words are one good session from strong."), a countdown that matters
("Salzburg in {n} days. Say something to Maya in Hebrew."), what he did last time.

A small Hebrew word or phrase sits top right as flavour (בוקר טוב, יאללה, נו באמת, כל הכבוד,
מאיה). Ping titles are "Hebrew"; bodies are the line plus one short aside.

*Builder's call:* the exact rotation, extra lines in the same voice, and which personal hook wins.
Keep the voice: a mate who knows him, short sentences, British, no emoji in the widget (the Hebrew
style guide bans pictographs in the "world" layer).

## The widget (Android, `android/`)

Look (mocked up and approved; mockup in `.superpowers/brainstorm/`): the Hebrew app's paper. Day:
gradient `#f8f3e9 → #f2ece0 → #eae1d0`, ink `#2a2620`, muted `#6b665c`, gold `#b3803a`, teal
`#0d6e6e`. Night (19:00–07:00 by the clock, like the app, never the phone's dark mode): `#1d1a14 →
#16140f → #110f0b`, ink `#ece3cf`, muted `#a89e89`, gold `#d6a55a`, teal `#52b8aa`. Type: Frank Ruhl
Libre for the line and the Hebrew, Cormorant Garamond italic for the aside, Instrument Sans for the
small caps label (the Hebrew app ships all three under OFL in `assets/fonts`).

Layout: a small label top left ("4 of 7 this week", "3 days off the road", "Salzburg in 3 days"),
the Hebrew word top right, the line, the aside, and the week as seven dots along the bottom: gold
filled = counted, gold ring = gold day, dashed = missed, teal ring = today, plain = ahead. Gold
means "you did this" and nothing else; teal only marks today.

Tap anywhere → the Hebrew app (`https://george-wightman.github.io/hebrew-reader/hebrew-reader.html`,
which Android opens in the installed app). The existing "tap the time to refresh" can stay.

The text comes from `js/glance.js` as now (the planner's web app answers `{glance}`), extended with
what the new layout needs: label, line, aside, hebrew, a seven-day list of states, level, night. The
glance request reads Hebrew progress directly (below), so the widget is right even when the
dashboard hasn't been opened. Android wakes widgets every 30 minutes, which is close enough to the
moments; *builder's call* whether to ask for an update at each moment.

This is a layout change, so it needs a new build, signing on the laptop (`node android/sign.mjs`, the
key in `~/.dashboard-android`), and George installing the new APK. The other widgets are untouched.

## Pings from the Hebrew app

George wants them to come from the Hebrew app itself (and the dashboard's own pushes aren't reaching
him at the moment, likely a sign-up lost on reinstall: check separately, not part of this).

**In `hebrew-reader`** (small, but read its `CLAUDE.md` and style guide first; the service-worker
traps there are real):
- A "Reminders" row in the profile sheet: turn on → ask permission → subscribe with Web Push using
  the planner's public VAPID key (hard-coded; it's public) → store the subscription in a synced key
  (e.g. `hvr_push`) so it travels in `progress.json`. Turn off → unsubscribe and clear it.
- `sw.js`: a `push` handler showing the notification (the app's icon, title "Hebrew", the body), and
  a `notificationclick` that focuses or opens the app's home screen.
- No other change to the app.

**In the planner** (this repo):
- **Read Hebrew progress itself.** Today only the dashboard app on a device pulls `progress.json`
  from `hebrew-reader-sync`, so the planner doesn't know whether he's practised. Each run (or at
  least each moment), read it with a token that can see that repo (`HEBREW_TOKEN` script property, or
  the existing token if it already has access), decode it as `js/hebrewSync.js` does, and take
  today's `sec`, the week, the bands, and `hvr_push`. The Hebrew app pushes at the end of every
  session and on open, so a session shows up within one run.
- **A Hebrew nudge per moment**, sent to the `hvr_push` subscription with the planner's existing
  Web Push code. It replaces the current 20:00 dashboard Hebrew nudge. Its own budget: at most three
  a day, separate from the dashboard's four, so the two never starve each other. Sent ids kept in
  script properties as now.
- A subscription that answers 404/410 is dropped (as the dashboard's are) and noted so the widget can
  say reminders are off.

## Settled after review (Claude's calls; George can overrule)

1. **The new widget replaces the existing Hebrew widget** (`HebrewWidget` / `widget_hebrew.xml` and
   the `hebrew` glance tile), not a second one beside it. He has no Hebrew widget on his home screen,
   so nothing changes under him. "The other widgets are untouched" means Today, Fuel, Body and the
   rest. The 15/30 cutoffs also apply to the dashboard app's own Hebrew tile and habit (its ● ◐ ○).
2. **Duolingo-only days follow the rule he already agreed:** they keep the streak but aren't ticked.
   So a Duolingo-only day draws a third dot state (a muted half-fill, like the tile's ◔). It isn't
   dashed, and it doesn't count towards "{n} days off the road". It doesn't silence the pings,
   because Duolingo is the top-up, not the half hour. The 19:00 line can acknowledge it ("Duolingo's
   done; ten minutes of the real thing?").
3. **Pings go to every device where he turns Reminders on**, in practice his phone. Each device
   stores its subscription under its own key (`hvr_push:<deviceId>`, using the app's existing
   `syncDeviceId()`), so last-writer-wins merging can't overwrite one device with another. Turning it
   off clears only that device's key. This is still the only change to the app's sync: one key per
   device, merged by the rules that already exist. The planner reads every `hvr_push:*` key.
4. **The dashboard's own Hebrew nudge (`hebrewNudge` in `js/nudges.js`) is deleted**, with no
   fallback. If the Hebrew app's subscription goes (404/410), the widget says "Reminders are off:
   turn them on in the Hebrew app" rather than the dashboard pinging instead.
5. **21:30 is a cutoff for Hebrew only.** The shared quiet hours (22:30–07:00) stay as they are. A
   held Hebrew ping that would land after 21:30 is dropped.

## Things George has to do

1. Install the new widgets APK and put the Hebrew widget on his main home screen.
2. In the Hebrew app, turn on Reminders and allow notifications.
3. Possibly: give the planner read access to `hebrew-reader-sync` (if its current token lacks it),
   which the builder can do through his Chrome as before.

## Left to the builder

How the line-picking code is structured and tested (a pure function from {time, day's practice,
week, calendar, data} to {label, line, aside, hebrew, level}, shared by the widget and the pings, is
the obvious shape); how the Android layout draws the dots and the gold state; exact rotation; how
often the planner reads `progress.json`.
