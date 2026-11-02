# Hebrew nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hebrew home-screen widget and up to three pings a day that talk to George in the Hebrew app's voice and look, timed around his calendar, and go quiet once he's practised.

**Architecture:** One pure module (`js/hebrew-voice.js`) decides everything said: the widget's words, the week's dots, and which ping is due. The planner reads the Hebrew app's own sync file synchronously (`planner/hebrew-progress.js`) for both the widget (glance) and the pings (`planner/hebrew-nudges.js`, Web Push to the subscription the Hebrew app publishes in that file). The Android widget gets a layout of its own, and the Hebrew app a Reminders switch and push handlers.

**Tech Stack:** Plain ES modules (node:test), Apps Script via `planner/bundle.mjs`, Kotlin RemoteViews + Robolectric, the Hebrew app's single HTML file and `sw.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-hebrew-nudges-design.md`

## Global Constraints

- Levels from `hvr_stats[day].sec`: any session = counts; ≥ 15 min = done; ≥ 30 min = gold.
- Moments 09:30, 15:00, 19:00 (his local time); a Hebrew ping is never sent after 21:30; shared quiet hours (22:30–07:00) unchanged.
- Busy now → hold until the event's end + 10 min; at most 3 Hebrew pings a day, a separate budget from the dashboard's 4.
- After "a bit" (under 15 min), at most one more ping, the gentle one. None once done.
- Duolingo-only day: a third dot state, not a miss, and the pings still go.
- Night look from 19:00 to 07:00 by the clock.
- Colours: day `#f8f3e9 → #f2ece0 → #eae1d0`, ink `#2a2620`, muted `#6b665c`, gold `#b3803a`, teal `#0d6e6e`; night `#1d1a14 → #16140f → #110f0b`, ink `#ece3cf`, muted `#a89e89`, gold `#d6a55a`, teal `#52b8aa`.
- No emoji in the widget. Lines are fixed copy with slots; no AI at send time. The public repo gets only invented fixtures.
- The dashboard's `hebrewNudge` (js/nudges.js) is deleted.
- Hebrew app: read its `CLAUDE.md` first. LF only, the selftest at `?selftest`, and clear the service worker before verifying.

## Review Focus

- No `progress.json` access (token can't see the repo): the widget still renders from the dashboard's own data, and the planner status says why → test in Task 2/4.
- A subscription that's gone (404/410) isn't retried every run → test in Task 3.
- A day crossing the planner's `dayStartHour` (an 00:30 session counts for the day before) → test in Task 1.
- The same line two days running → rotation by day seed, tested in Task 1.
- A held ping whose event ends after 21:30 → dropped, tested in Task 1.

---

### Task 1: The voice (pure)

**Files:** Create `js/hebrew-voice.js`, `tests/hebrew-voice.test.js`.

**Interfaces — Produces:**
- `HEBREW_DONE_MIN = 15`, `HEBREW_GOLD_MIN = 30`, `MOMENTS = [['morning','09:30'],['afternoon','15:00'],['evening','19:00']]`, `LAST_PING = '21:30'`, `HEBREW_PINGS_PER_DAY = 3`.
- `hebrewLevel({ sec, sessions }) → 'none'|'bit'|'done'|'gold'`
- `hebrewVoice({ now: Date, today: 'YYYY-MM-DD', days: { [day]: { sec, sessions } }, duolingo: string[] /* days with XP */, busy: [{ title, start, end, calendar }], countdown: { title, days } | null, strongGain: number }) → { level, label, hebrew, line, aside, night, week: Array<'gold'|'done'|'bit'|'duo'|'miss'|'today'|'ahead'>, missed: number }`
- `duePing(sameInput, sent: string[]) → { id, title: 'Hebrew', body, url } | null` (the id is `heb:<day>:<moment|free:<eventEnd>|bit>`).

- [ ] Tests (each with the spec's values): `hebrewLevel` boundaries (0 → none; 1 session 300 s → bit; 900 s → done; 1800 s → gold). The line at 10:00 with nothing is the morning set; with a Signify 09:00–13:00 it's the busy-morning set. At 13:05 that day `duePing` holds; at 13:12 it returns the free-now ping naming the shift. After 2 missed days, label `2 days off the road` and the missed line. A Duolingo-only yesterday gives `duo` and doesn't count as missed. A done day gives `null` from `duePing`, and level done. A bit gives the bit ping once, then `null` (id in `sent`). An event ending 21:40 drops the 19:00 ping. `night` is true at 19:00 and 06:59, false at 07:00. Two consecutive days don't pick the same morning line when the set has two or more. An 00:30 session on the day after counts for `today` when `today` was given as the logical day (the caller passes the logical day; the module never computes it from `now`).
- [ ] Implement. The lines are the spec's starting set, rotated by `hash(today + moment) % set.length`. Hebrew flavour words are from the spec.
- [ ] `node --test tests/hebrew-voice.test.js` passes; commit.

### Task 2: The planner reads the Hebrew app's file

**Files:** Create `planner/hebrew-progress.js`, `tests/hebrew-progress.test.js`; modify `planner/gas.js` (inject `gunzip`).

**Interfaces — Produces:** `readHebrewProgress({ request /* (url, init) → { status, text } */, repo, token, gunzip /* base64 → string */ }) → { ok: true, days: { [day]: { sec, sessions } }, strong: number, strongWeekAgo: number, push: [{ id, endpoint, p256dh, auth }] } | { ok: false, error }`. It reads the raw `progress.json` (`Accept: application/vnd.github.raw+json`), expects the `{ enc: 'gzip', body }` envelope, and parses `keys.hvr_stats` and `keys.hvr_push` (`{ [deviceId]: { endpoint, p256dh, auth, off? } }`; `off` entries are skipped).
- Repo: script property `HEBREW_REPO`, defaulting to `George-Wightman/hebrew-reader-sync`. Token: `HEBREW_TOKEN`, else `GITHUB_TOKEN`.
- In gas.js: `gunzip = (b64) => Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString('UTF-8')`; tests pass node's `zlib.gunzipSync`.

- [ ] Tests: a fixture envelope built with `zlib.gzipSync` → days and push read; 404 → `{ ok: false, error: /can't see/ }`; a non-envelope → error; an `off` device skipped.
- [ ] Implement, run, commit.

### Task 3: Hebrew pings from the planner

**Files:** Create `planner/hebrew-nudges.js`, `tests/hebrew-nudges.test.js`; modify `planner/gas.js` (call it after nudges), `js/nudges.js` (delete `hebrewNudge`), `tests/nudges.test.js`.

**Interfaces — Consumes:** `duePing`, `readHebrewProgress`, `makePusher` (`planner/checkins.js`). **Produces:** `createHebrewNudges({ UrlFetchApp, Utilities, props, log, now, crypto }) → { send({ progress, voiceInput }) → { sent, error } }`. State is in the script property `HEBREW_NUDGES = { day, sent: [], gone: [endpoint] }`. It writes `hebrew:status` (`{ day, sent, lastError, devices }`) to the dashboard via `store.putCalendar` in gas.js, for the `planner` read.

- [ ] Tests: one due ping goes to every live device; a second run in the same minute sends nothing; after 3 none; a 410 endpoint goes into `gone` and isn't tried again; no devices → `sent: 0` and `error: 'Reminders are off'`. The dashboard's nudges no longer include a `hebrew:` id.
- [ ] Wire into `run()`: read progress once per run (after `apply`); busy = today's watched, timed, non-transparent events that aren't the planner's own; countdown = the first of `countdowns(doc, today)`; duolingo days from `duolingoOn(doc, 'hebrew-habit', d)`.
- [ ] Run all tests, build the planner, commit.

### Task 4: The widget's words (glance)

**Files:** Modify `js/glance.js` (the hebrew tile), `planner/glance.js` (read progress), `planner/gas.js` (pass token/repo/gunzip to `handleGlance`), `tests/glance.test.js`, `tests/glance-planner.test.js`.

**Interfaces — Produces:** the `hebrew` tile gains `voice: { label, hebrew, line, aside, level, night, week }` and `open: HEBREW_APP = 'https://george-wightman.github.io/hebrew-reader/hebrew-reader.html'`. It keeps `title/number/caption/lines` for old app builds. `glanceOf(doc, today, now, maps, hebrew)` takes the progress (or `null` → it falls back to the dashboard's Hebrew minutes logs for `days`). Busy comes from `doc.calendar.agenda.busy`.

- [ ] Tests: the tile carries `voice` and the Hebrew app link; with `hebrew: null` it still has a voice from the logs.
- [ ] Implement, run, commit.

### Task 5: Hebrew app — Reminders

**Repo:** `Hebrew Learning` (`hebrew-reader.html`, `sw.js`). **Interfaces — Consumes:** the planner's VAPID public key (read it from the dashboard's `calendar['push-config'].publicKey`; hard-code it as `PUSH_VAPID_PUBLIC`). **Produces:** `hvr_push` = `{ [syncDeviceId()]: { endpoint, p256dh, auth, ts } | { off: true, ts } }`.

- [ ] Selftests: `pushRecordFor(sub)` shapes a subscription; turning off writes `{ off: true }` for this device only; `mergeKeyMap` keeps both devices' entries.
- [ ] A "Reminders" row in the profile sheet (interface register: sans, teal): On/Off, with the permission prompt on turning on. Then `syncRun('reminders', { pushOnly: true, quiet: true })`.
- [ ] `sw.js`: `push` → `showNotification(title, { body, tag, icon, data: { url } })`; `notificationclick` → focus an open window of the app, or open `./hebrew-reader.html`. Bump the shell cache name per its rules.
- [ ] Selftest passes in the browser (clear the SW first); push to its repo; check the live build.

### Task 6: The Android widget

**Files:** `android/app/src/main/java/.../Glance.kt` (parse `voice`; allow `open` to start with the dashboard **or** the Hebrew app), `Widgets.kt` (the hebrew tile draws `widget_hebrew_voice` when `voice` is present), new `res/layout/widget_hebrew_voice.xml`, `res/drawable/bg_hebrew_day.xml`, `bg_hebrew_night.xml`, `bg_hebrew_gold.xml`, dot drawables, `res/font/` (Frank Ruhl Libre, Cormorant Garamond italic, Instrument Sans, copied from the Hebrew app with their OFL texts), `WidgetsTest.kt` (sample with `voice`; a screenshot day, night and gold).

- [ ] Tests: `parse` reads `voice`; the Hebrew app link is kept and an evil link isn't; a layout snapshot for each look.
- [ ] Implement; push; the Actions build passes; read the shots from `android-builds`; sign with `node android/sign.mjs`.

### Task 7: Live

- [ ] Push all; GitHub's test run passes; the planner's next run shows `hebrew:status` (or the token problem).
- [ ] George: install the APK, add the Hebrew widget, turn on Reminders in the Hebrew app. If the token can't see `hebrew-reader-sync`, George puts a read-only token in the script property `HEBREW_TOKEN` himself.
